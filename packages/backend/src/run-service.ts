import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  artifactRows,
  artifacts,
  benchmarkCaseResults,
  citations,
  forecastAggregates,
  forecastAttempts,
  forecastScores,
  sessions,
  sourceBankEntries,
  tasks,
  taskRows,
  traceEvents,
  type createDb,
} from "@open-superforecaster/db";
import type { OperationMode } from "@open-superforecaster/workflow-contracts";
import { inspectSmithersRun, launchSmithersDetached, readSmithersNodeOutput } from "./smithers-launcher";

type Db = ReturnType<typeof createDb>["db"];

export type RunLaunchRecord = {
  taskId: string;
  smithersRunId: string;
  status: string;
};

export async function createQueuedWorkflowTask(
  db: Db,
  input: {
    operationMode: OperationMode;
    operationSubmode: string;
    label: string;
    workflowPath: string;
    workflowVersion?: string;
    benchmarkRunId?: string;
    workflowVariantId?: string;
    experimentLabel?: string;
    configJson?: Record<string, unknown>;
  },
): Promise<RunLaunchRecord> {
  const [session] = await db
    .insert(sessions)
    .values({ label: "Local workspace" })
    .returning({ id: sessions.id });

  const [task] = await db
    .insert(tasks)
    .values({
      sessionId: session.id,
      operationMode: input.operationMode,
      operationSubmode: input.operationSubmode,
      workflowVersion: input.workflowVersion ?? "bootstrap",
      label: input.label,
      status: "queued",
      progressTotal: 1,
      progressPending: 1,
      configJson: {
        workflow: input.workflowPath,
        ...(input.configJson ?? {}),
      },
      benchmarkRunId: input.benchmarkRunId,
      workflowVariantId: input.workflowVariantId,
      experimentLabel: input.experimentLabel,
    })
    .returning({ id: tasks.id, status: tasks.status });

  return {
    taskId: task.id,
    smithersRunId: `osf-${task.id}`,
    status: task.status,
  };
}

export async function createQueuedSmokeTask(db: Db): Promise<RunLaunchRecord> {
  return createQueuedWorkflowTask(db, {
    operationMode: "fixed_evidence_eval",
    operationSubmode: "codex_smoke",
    label: "CodexAgent smoke run",
    workflowPath: ".smithers/workflows/codex-smoke.tsx",
  });
}

export async function markTaskRunning(db: Db, input: { taskId: string; smithersRunId: string }) {
  await db
    .update(tasks)
    .set({
      smithersRunId: input.smithersRunId,
      status: "running",
      progressPending: 0,
      progressRunning: 1,
      activeWorkers: 1,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, input.taskId));
}

export async function markTaskFailed(db: Db, input: { taskId: string; error: string }) {
  await db
    .update(tasks)
    .set({
      status: "failed",
      error: input.error,
      progressPending: 0,
      progressRunning: 0,
      progressFailed: 1,
      activeWorkers: 0,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, input.taskId));
}

export async function seedTaskRows(
  db: Db,
  input: {
    taskId: string;
    rows: Array<Record<string, unknown>>;
    retryable: boolean;
    lineage?: Record<string, unknown>;
  },
) {
  for (const [index, row] of input.rows.entries()) {
    const sourceRowId = sourceRowIdFor(row, index);
    const normalizedRow = normalizeLineageRow(row, sourceRowId);
    await db.insert(taskRows).values({
      taskId: input.taskId,
      sourceRowId,
      rowHash: hashJson(normalizedRow),
      status: "queued",
      lineageJson: {
        ...(input.lineage ?? {}),
        retryable: input.retryable,
        originalInput: normalizedRow,
      },
    });
  }
}

export async function markTaskRowsRunning(db: Db, taskId: string) {
  await db
    .update(taskRows)
    .set({
      status: "running",
      updatedAt: new Date(),
    })
    .where(and(eq(taskRows.taskId, taskId), eq(taskRows.status, "queued")));
}

async function markTaskRowsCompleted(db: Db, taskId: string) {
  await db
    .update(taskRows)
    .set({
      status: "completed",
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(taskRows.taskId, taskId));
}

export async function backfillTableTaskRows(db: Db) {
  const completedTableTasks = await db
    .select({
      id: tasks.id,
      operationSubmode: tasks.operationSubmode,
      outputArtifactId: tasks.outputArtifactId,
    })
    .from(tasks)
    .where(eq(tasks.status, "completed"));

  for (const task of completedTableTasks.filter((row) => isAgentMapSubmode(row.operationSubmode) && row.outputArtifactId)) {
    const existing = await db.select({ id: taskRows.id }).from(taskRows).where(eq(taskRows.taskId, task.id)).limit(1);
    if (existing.length > 0 || !task.outputArtifactId) {
      continue;
    }
    const rows = await db
      .select({
        id: artifactRows.id,
        rowIndex: artifactRows.rowIndex,
        sourceRowId: artifactRows.sourceRowId,
        rowJson: artifactRows.rowJson,
      })
      .from(artifactRows)
      .where(eq(artifactRows.artifactId, task.outputArtifactId))
      .orderBy(asc(artifactRows.rowIndex));

    for (const row of rows.filter((candidate) => candidate.rowIndex > 0)) {
      const sourceRowId = row.sourceRowId ?? readString(row.rowJson, "rowId", "row_id") ?? `row-${row.rowIndex}`;
      await db.insert(taskRows).values({
        taskId: task.id,
        sourceRowId,
        rowHash: hashJson(row.rowJson),
        status: "completed",
        retryCount: 0,
        lineageJson: {
          retryable: true,
          backfilledFromArtifactRowId: row.id,
          originalInput: normalizeLineageRow(row.rowJson, sourceRowId),
        },
        completedAt: new Date(),
      });
    }
  }
}

export async function retryTableTaskRow(
  db: Db,
  root: string,
  input: {
    taskId: string;
    taskRowId: string;
  },
) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }
  if (!isAgentMapSubmode(task.operationSubmode)) {
    throw new Error(`Row retry is only available for agent_map, classify, and rank tasks.`);
  }

  const [row] = await db
    .select()
    .from(taskRows)
    .where(and(eq(taskRows.id, input.taskRowId), eq(taskRows.taskId, input.taskId)))
    .limit(1);
  if (!row) {
    throw new Error(`Task row not found: ${input.taskRowId}`);
  }

  const lineage = isRecord(row.lineageJson) ? row.lineageJson : {};
  if (lineage.retryable === false) {
    throw new Error(`Task row ${input.taskRowId} is not retryable.`);
  }

  const originalInput = isRecord(lineage.originalInput)
    ? lineage.originalInput
    : { rowId: row.sourceRowId ?? "row-1", input: row.sourceRowId ?? "Retry row" };
  const retryCount = row.retryCount + 1;
  const retryWorkflow = task.operationSubmode === "rank" ? "rank" : "agent-map";
  const workflowPath = retryWorkflow === "rank" ? ".smithers/workflows/rank.tsx" : ".smithers/workflows/agent-map.tsx";
  const retryRows = [normalizeLineageRow(originalInput, row.sourceRowId ?? "row-1")];
  const retryConfig = {
    prompt: readString(task.configJson, "prompt") ?? task.label,
    rows: retryRows,
    retryOf: {
      taskId: task.id,
      taskRowId: row.id,
      sourceRowId: row.sourceRowId,
      retryCount,
    },
  };

  const record = await createQueuedWorkflowTask(db, {
    operationMode: task.operationMode,
    operationSubmode: task.operationSubmode ?? "agent_map",
    label: `${task.label} row retry ${row.sourceRowId ?? row.id.slice(0, 8)}`,
    workflowPath,
    configJson: retryConfig,
  });
  await seedTaskRows(db, {
    taskId: record.taskId,
    rows: retryRows,
    retryable: true,
    lineage: {
      retryOf: retryConfig.retryOf,
    },
  });
  await createBootstrapArtifact(db, {
    taskId: record.taskId,
    smithersRunId: record.smithersRunId,
    createdBy: `${retryWorkflow}-row-retry`,
    schemaJson: {
      type: "object",
      properties: {
        reportType: { enum: ["agent_map", "rank"] },
        rowCount: { const: 1 },
        results: { type: "array" },
      },
    },
  });

  const launched = await launchSmithersDetached({
    root,
    workflowPath,
    runId: record.smithersRunId,
    input: retryWorkflow === "rank"
      ? {
          taskId: record.taskId,
          source: "open-superforecaster-row-retry",
          prompt: retryConfig.prompt,
          objective: retryConfig.prompt,
          rows: retryRows,
        }
      : {
          taskId: record.taskId,
          source: "open-superforecaster-row-retry",
          mode: task.operationSubmode,
          prompt: retryConfig.prompt,
          objective: retryConfig.prompt,
          rows: retryRows.map((retryRow) => ({
            rowId: retryRow.rowId,
            input: rowInputFromRecord(retryRow),
          })),
        },
  });

  await markTaskRunning(db, {
    taskId: record.taskId,
    smithersRunId: launched.runId,
  });
  await markTaskRowsRunning(db, record.taskId);
  await db
    .update(taskRows)
    .set({
      retryCount,
      updatedAt: new Date(),
    })
    .where(eq(taskRows.id, row.id));

  return {
    taskId: record.taskId,
    smithersRunId: launched.runId,
    workflowPath: launched.workflowPath,
    retriedTaskRowId: row.id,
    retryCount,
  };
}

export async function listRecentTasks(db: Db, limit = 20) {
  const recentTasks = await db
    .select({
      id: tasks.id,
      label: tasks.label,
      status: tasks.status,
      operationMode: tasks.operationMode,
      operationSubmode: tasks.operationSubmode,
      smithersRunId: tasks.smithersRunId,
      outputArtifactId: tasks.outputArtifactId,
      progressTotal: tasks.progressTotal,
      progressRunning: tasks.progressRunning,
      progressCompleted: tasks.progressCompleted,
      progressFailed: tasks.progressFailed,
      createdAt: tasks.createdAt,
      startedAt: tasks.startedAt,
      completedAt: tasks.completedAt,
      error: tasks.error,
    })
    .from(tasks)
    .orderBy(desc(tasks.createdAt))
    .limit(limit);

  const enriched = [];
  for (const task of recentTasks) {
    const [outputRow] = task.outputArtifactId
      ? await db
          .select({ rowJson: artifactRows.rowJson })
          .from(artifactRows)
          .where(and(eq(artifactRows.artifactId, task.outputArtifactId), eq(artifactRows.rowIndex, 0)))
          .limit(1)
      : [];
    const sources = await db
      .select({ id: sourceBankEntries.id })
      .from(sourceBankEntries)
      .where(eq(sourceBankEntries.taskId, task.id));

    enriched.push({
      ...task,
      outputPreview: outputRow?.rowJson ?? null,
      sourceCount: sources.length,
    });
  }

  return enriched;
}

export async function getTaskDetail(db: Db, taskId: string) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const artifactRecords = await db.select().from(artifacts).where(eq(artifacts.taskId, task.id)).orderBy(desc(artifacts.createdAt));
  const taskRowRecords = await db.select().from(taskRows).where(eq(taskRows.taskId, task.id)).orderBy(asc(taskRows.createdAt));
  const artifactsWithRows = [];
  for (const artifact of artifactRecords) {
    const rows = await db
      .select()
      .from(artifactRows)
      .where(eq(artifactRows.artifactId, artifact.id))
      .orderBy(asc(artifactRows.rowIndex));
    artifactsWithRows.push({
      ...artifact,
      rows,
    });
  }

  const sourceRecords = await db
    .select()
    .from(sourceBankEntries)
    .where(eq(sourceBankEntries.taskId, task.id))
    .orderBy(asc(sourceBankEntries.rank), desc(sourceBankEntries.createdAt));
  const sourceIds = sourceRecords.map((source) => source.id);
  const citationRecords = sourceIds.length
    ? await db.select().from(citations).where(inArray(citations.sourceId, sourceIds))
    : [];

  const attemptRecords = task.smithersRunId
    ? await db.select().from(forecastAttempts).where(eq(forecastAttempts.researchPassId, task.smithersRunId)).orderBy(desc(forecastAttempts.createdAt))
    : [];
  const attemptIds = attemptRecords.map((attempt) => attempt.id);
  const aggregateRecords = attemptIds.length
    ? (await db.select().from(forecastAggregates)).filter((aggregate) =>
        aggregate.componentAttemptIds.some((attemptId) => attemptIds.includes(attemptId)),
      )
    : [];
  const aggregateIds = aggregateRecords.map((aggregate) => aggregate.id);
  const attemptScoreRecords = attemptIds.length
    ? await db.select().from(forecastScores).where(inArray(forecastScores.forecastAttemptId, attemptIds))
    : [];
  const aggregateScoreRecords = aggregateIds.length
    ? await db.select().from(forecastScores).where(inArray(forecastScores.forecastAggregateId, aggregateIds))
    : [];
  const recentTraceEvents = await db
    .select()
    .from(traceEvents)
    .where(eq(traceEvents.taskId, task.id))
    .orderBy(desc(traceEvents.sequenceNumber))
    .limit(25);
  const benchmarkResults = await db.select().from(benchmarkCaseResults).where(eq(benchmarkCaseResults.taskId, task.id));

  return {
    task,
    taskRows: taskRowRecords,
    artifacts: artifactsWithRows,
    sources: sourceRecords,
    citations: citationRecords,
    forecastAttempts: attemptRecords,
    forecastAggregates: aggregateRecords,
    forecastScores: [...aggregateScoreRecords, ...attemptScoreRecords],
    benchmarkCaseResults: benchmarkResults,
    traceEvents: recentTraceEvents.reverse(),
    traceBundleApiPath: `/api/runs/${task.id}/trace-bundle`,
  };
}

export async function getRunEventSnapshot(db: Db, taskId: string, afterSequenceNumber = 0) {
  const [task] = await db
    .select({
      id: tasks.id,
      status: tasks.status,
      progressTotal: tasks.progressTotal,
      progressPending: tasks.progressPending,
      progressRunning: tasks.progressRunning,
      progressCompleted: tasks.progressCompleted,
      progressFailed: tasks.progressFailed,
      activeWorkers: tasks.activeWorkers,
      updatedAt: tasks.updatedAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const events = await db
    .select({
      id: traceEvents.id,
      eventType: traceEvents.eventType,
      phase: traceEvents.phase,
      agentLabel: traceEvents.agentLabel,
      payloadJson: traceEvents.payloadJson,
      sequenceNumber: traceEvents.sequenceNumber,
      createdAt: traceEvents.createdAt,
    })
    .from(traceEvents)
    .where(and(eq(traceEvents.taskId, taskId), gt(traceEvents.sequenceNumber, afterSequenceNumber)))
    .orderBy(asc(traceEvents.sequenceNumber))
    .limit(50);

  return {
    task,
    events,
    lastSequenceNumber: events.at(-1)?.sequenceNumber ?? afterSequenceNumber,
  };
}

export async function exportArtifactRowsCsv(db: Db, artifactId: string) {
  const exported = await buildArtifactRowsExport(db, artifactId);
  const lines = [
    exported.columns.map(csvEscape).join(","),
    ...exported.rows.map((row) => exported.columns.map((column) => csvEscape(row[column] ?? "")).join(",")),
  ];
  return {
    artifact: exported.artifact,
    filename: `artifact-${exported.artifact.id}.csv`,
    csv: `${lines.join("\n")}\n`,
    rowCount: exported.rows.length,
  };
}

export async function exportArtifactRowsParquet(db: Db, artifactId: string) {
  const exported = await buildArtifactRowsExport(db, artifactId);
  const tempDir = await mkdtemp(join(tmpdir(), "open-superforecaster-artifact-"));
  const parquetPath = join(tempDir, `artifact-${exported.artifact.id}.parquet`);
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:");
  const duck = await instance.connect();

  try {
    const duckColumns = exported.columns.map((column) =>
      `${duckIdentifier(column)} ${column === "row_index" ? "INTEGER" : "VARCHAR"}`,
    );
    await duck.run(`create table artifact_export(${duckColumns.join(", ")})`);
    const appender = await duck.createAppender("artifact_export");
    for (const row of exported.rows) {
      for (const column of exported.columns) {
        appendArtifactExportValue(appender, column, row[column]);
      }
      appender.endRow();
    }
    appender.closeSync();
    await duck.run(`copy artifact_export to ${duckString(parquetPath)} (format parquet)`);
    return {
      artifact: exported.artifact,
      filename: `artifact-${exported.artifact.id}.parquet`,
      parquet: await readFile(parquetPath),
      rowCount: exported.rows.length,
    };
  } finally {
    duck.closeSync();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function buildArtifactRowsExport(db: Db, artifactId: string) {
  const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, artifactId)).limit(1);
  if (!artifact) {
    throw new Error(`Artifact not found: ${artifactId}`);
  }
  const rows = await db
    .select()
    .from(artifactRows)
    .where(eq(artifactRows.artifactId, artifactId))
    .orderBy(asc(artifactRows.rowIndex));
  const rowObjects = rows.map((row) => (isRecord(row.rowJson) ? row.rowJson : { value: row.rowJson }));
  const metadataColumns = ["row_index", "source_row_id", "status"];
  const jsonColumns = Array.from(new Set(rowObjects.flatMap((row) => Object.keys(row))))
    .filter((column) => !metadataColumns.includes(column))
    .sort();
  const columns = [...metadataColumns, ...jsonColumns];
  return {
    artifact,
    columns,
    rows: rows.map((row, index) => {
      const rowJson = rowObjects[index] ?? {};
      return Object.fromEntries(columns.map((column) => {
        if (column === "row_index") {
          return [column, row.rowIndex];
        }
        if (column === "source_row_id") {
          return [column, row.sourceRowId ?? ""];
        }
        if (column === "status") {
          return [column, row.status];
        }
        return [column, artifactExportValue(rowJson[column])];
      })) as Record<string, unknown>;
    }),
  };
}

export async function createBootstrapArtifact(
  db: Db,
  input: {
    taskId: string;
    smithersRunId: string;
    createdBy?: string;
    schemaJson?: Record<string, unknown>;
    benchmarkRunId?: string;
    benchmarkCaseId?: string;
    workflowVariantId?: string;
  },
) {
  const [artifact] = await db
    .insert(artifacts)
    .values({
      taskId: input.taskId,
      artifactType: "report",
      createdBy: input.createdBy ?? "codex-smoke",
      schemaJson: input.schemaJson ?? {
        type: "object",
        properties: {
          smithersRunId: { type: "string" },
        },
      },
      rowCount: 1,
      storageUri: `runs/${input.smithersRunId}/trace.jsonl`,
    })
    .returning({ id: artifacts.id });

  await db.insert(traceEvents).values({
    taskId: input.taskId,
    eventType: "trace_start",
    phase: "launch",
    agentLabel: "smithers",
    payloadJson: {
      smithersRunId: input.smithersRunId,
      artifactId: artifact.id,
    },
    benchmarkRunId: input.benchmarkRunId,
    benchmarkCaseId: input.benchmarkCaseId,
    workflowVariantId: input.workflowVariantId,
    sequenceNumber: 1,
  });

  await db
    .update(tasks)
    .set({
      outputArtifactId: artifact.id,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, input.taskId));

  return artifact;
}

export async function reconcileRunningTasks(db: Db, root: string) {
  const running = await db
    .select({
      id: tasks.id,
      smithersRunId: tasks.smithersRunId,
      outputArtifactId: tasks.outputArtifactId,
      operationSubmode: tasks.operationSubmode,
      startedAt: tasks.startedAt,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(eq(tasks.status, "running"));

  for (const task of running) {
    if (!task.smithersRunId) {
      continue;
    }

    let inspect;
    try {
      inspect = await inspectSmithersRun(task.smithersRunId, root);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const runAgeMs = Date.now() - (task.startedAt ?? task.createdAt).getTime();
      if (isSmithersRunNotFound(message) && runAgeMs < 10 * 60 * 1000) {
        continue;
      }
      await markTaskFailed(db, {
        taskId: task.id,
        error: `Smithers inspect failed for ${task.smithersRunId}: ${message}`,
      });
      continue;
    }
    const status = inspect.run?.status;
    const state = inspect.runState?.state;

    if (status === "finished" || state === "succeeded") {
      const outputNodeId = outputNodeForSubmode(task.operationSubmode);
      const output = await readSmithersNodeOutput(task.smithersRunId, outputNodeId, root);
      let outputArtifactId = task.outputArtifactId;

      if (!outputArtifactId) {
        const [artifact] = await db
          .select({ id: artifacts.id })
          .from(artifacts)
          .where(eq(artifacts.taskId, task.id))
          .limit(1);
        outputArtifactId = artifact?.id ?? null;

        if (outputArtifactId) {
          await db
            .update(tasks)
            .set({
              outputArtifactId,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, task.id));
        }
      }

      if (outputArtifactId) {
        await db
          .insert(artifactRows)
          .values({
            artifactId: outputArtifactId,
            rowIndex: 0,
            rowJson: output,
            status: "completed",
            completedAt: new Date(),
          })
          .onConflictDoNothing({
            target: [artifactRows.artifactId, artifactRows.rowIndex],
          });

        const [artifactRow] = await db
          .select({ id: artifactRows.id })
          .from(artifactRows)
          .where(and(eq(artifactRows.artifactId, outputArtifactId), eq(artifactRows.rowIndex, 0)))
          .limit(1);

        if (task.operationSubmode === "binary_forecast") {
          await persistBinaryForecastLedger(db, {
            taskId: task.id,
            artifactId: outputArtifactId,
            artifactRowId: artifactRow?.id ?? null,
            smithersRunId: task.smithersRunId,
            aggregateOutput: output,
            root,
          });
        } else if (isForecastSubmode(task.operationSubmode)) {
          await persistNonBinaryForecastLedger(db, {
            taskId: task.id,
            artifactId: outputArtifactId,
            artifactRowId: artifactRow?.id ?? null,
            smithersRunId: task.smithersRunId,
            operationSubmode: task.operationSubmode,
            aggregateOutput: output,
            root,
          });
        } else if (task.operationSubmode === "deep_research") {
          await persistCitedSources(db, {
            taskId: task.id,
            artifactId: outputArtifactId,
            artifactRowId: artifactRow?.id ?? null,
            output,
            sourceType: "agent_reported_research_citation",
          });
        } else if (isTableSummarySubmode(task.operationSubmode)) {
          await persistAgentMapRows(db, {
            taskId: task.id,
            artifactId: outputArtifactId,
            summaryRowId: artifactRow?.id ?? null,
            output,
          });
          if (isAgentMapSubmode(task.operationSubmode)) {
            await markTaskRowsCompleted(db, task.id);
          }
        }
      }

      await db
        .update(tasks)
        .set({
          status: "completed",
          progressRunning: 0,
          progressCompleted: 1,
          activeWorkers: 0,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));
    } else if (status === "failed" || state === "failed") {
      await markTaskFailed(db, {
        taskId: task.id,
        error: `Smithers run ${task.smithersRunId} failed`,
      });
    }
  }
}

function isSmithersRunNotFound(message: string) {
  return message.includes("RUN_NOT_FOUND") || /Run not found:/i.test(message);
}

function outputNodeForSubmode(operationSubmode: string | null) {
  if (isForecastSubmode(operationSubmode)) {
    return "aggregate";
  }
  if (operationSubmode === "deep_research") {
    return "synthesis";
  }
  if (isTableSummarySubmode(operationSubmode)) {
    return "summary";
  }
  return "codex-smoke";
}

function isAgentMapSubmode(operationSubmode: string | null) {
  return operationSubmode === "agent_map" || operationSubmode === "rank" || operationSubmode === "classify";
}

function isTableSummarySubmode(operationSubmode: string | null) {
  return isAgentMapSubmode(operationSubmode) || operationSubmode === "merge" || operationSubmode === "dedupe";
}

function isForecastSubmode(operationSubmode: string | null) {
  return (
    operationSubmode === "binary_forecast" ||
    operationSubmode === "date_forecast" ||
    operationSubmode === "numeric_forecast" ||
    operationSubmode === "categorical_forecast" ||
    operationSubmode === "thresholded_forecast" ||
    operationSubmode === "conditional_forecast"
  );
}

export async function backfillBinaryForecastLedgers(db: Db, root: string) {
  const completedForecastTasks = await db
    .select({
      id: tasks.id,
      smithersRunId: tasks.smithersRunId,
      outputArtifactId: tasks.outputArtifactId,
      operationSubmode: tasks.operationSubmode,
    })
    .from(tasks)
    .where(eq(tasks.status, "completed"));

  for (const task of completedForecastTasks) {
    if (!task.outputArtifactId || !task.smithersRunId || !isForecastSubmode(task.operationSubmode)) {
      continue;
    }

    const [existingSource] = await db
      .select({ id: sourceBankEntries.id })
      .from(sourceBankEntries)
      .where(eq(sourceBankEntries.taskId, task.id))
      .limit(1);
    if (existingSource) {
      continue;
    }

    const [artifactRow] = await db
      .select()
      .from(artifactRows)
      .where(and(eq(artifactRows.artifactId, task.outputArtifactId), eq(artifactRows.rowIndex, 0)))
      .limit(1);
    if (!artifactRow) {
      continue;
    }

    if (task.operationSubmode === "binary_forecast") {
      await persistBinaryForecastLedger(db, {
        taskId: task.id,
        artifactId: task.outputArtifactId,
        artifactRowId: artifactRow.id,
        smithersRunId: task.smithersRunId,
        aggregateOutput: artifactRow.rowJson,
        root,
      });
    } else {
      await persistNonBinaryForecastLedger(db, {
        taskId: task.id,
        artifactId: task.outputArtifactId,
        artifactRowId: artifactRow.id,
        smithersRunId: task.smithersRunId,
        operationSubmode: task.operationSubmode,
        aggregateOutput: artifactRow.rowJson,
        root,
      });
    }
  }
}

async function persistBinaryForecastLedger(
  db: Db,
  input: {
    taskId: string;
    artifactId: string;
    artifactRowId: string | null;
    smithersRunId: string;
    aggregateOutput: Record<string, unknown>;
    root: string;
  },
) {
  const lockAcquired = await acquireForecastLedgerLock(db, input.smithersRunId);
  if (!lockAcquired) {
    return;
  }
  try {
  if (await hasForecastLedgerForRun(db, input.smithersRunId)) {
    return;
  }

  const attemptOutputs = await readBinaryAttemptOutputs(input.smithersRunId, input.root);
  const componentFallbacks = readArray(input.aggregateOutput, "componentProbabilities", "component_probabilities");
  const attemptsToPersist = attemptOutputs.length
    ? attemptOutputs
    : componentFallbacks.map((component) => ({
        forecasterLabel: readString(component, "forecasterLabel", "forecaster_label") ?? "component forecaster",
        probability: readNumber(component, "probability") ?? readProbability(input.aggregateOutput) ?? 50,
        rationale: "Component probability imported from aggregate output.",
      }));

  const componentAttemptIds: string[] = [];
  for (const attemptOutput of attemptsToPersist) {
    const probability = readNumber(attemptOutput, "probability") ?? 50;
    const forecasterLabel = readString(attemptOutput, "forecasterLabel", "forecaster_label") ?? "binary forecaster";
    const [attempt] = await db
      .insert(forecastAttempts)
      .values({
        forecasterLabel,
        forecastType: "binary",
        researchPassId: input.smithersRunId,
        model: process.env.CODEX_MODEL ?? "codex-subscription",
        promptVersion: "binary-forecast-inline-v0",
        rawPrediction: attemptOutput,
        parsedPrediction: {
          probability,
          strongestYes: readString(attemptOutput, "strongestYes", "strongest_yes"),
          strongestNo: readString(attemptOutput, "strongestNo", "strongest_no"),
          keyUncertainties: readArray(attemptOutput, "keyUncertainties", "key_uncertainties"),
        },
        rationale: readString(attemptOutput, "rationale") ?? "No rationale was provided.",
        premortem: readString(attemptOutput, "premortem"),
        wildcards: readStringArray(attemptOutput, "wildcards"),
        status: "completed",
        costProxy: {
          smithersRunId: input.smithersRunId,
          source: "smithers-codexagent",
        },
      })
      .returning({ id: forecastAttempts.id });
    componentAttemptIds.push(attempt.id);
  }
  await appendTraceEvent(db, {
    taskId: input.taskId,
    eventType: "trace_summary",
    phase: "forecast_attempts",
    agentLabel: "forecast-ledger",
    payloadJson: {
      forecastType: "binary",
      attemptCount: componentAttemptIds.length,
      forecasters: attemptsToPersist.map((attempt) => readString(attempt, "forecasterLabel", "forecaster_label") ?? "binary forecaster"),
    },
  });

  await db.insert(forecastAggregates).values({
    forecastType: "binary",
    method: readString(input.aggregateOutput, "method") ?? "unknown",
    componentAttemptIds,
    rawAggregate: input.aggregateOutput,
    rationale: readString(input.aggregateOutput, "rationale") ?? "No aggregate rationale was provided.",
  });
  await appendTraceEvent(db, {
    taskId: input.taskId,
    eventType: "synthesis",
    phase: "aggregate",
    agentLabel: "forecast-ledger",
    payloadJson: {
      forecastType: "binary",
      method: readString(input.aggregateOutput, "method") ?? "unknown",
      componentAttemptCount: componentAttemptIds.length,
    },
  });

  const citedSources = await resolveForecastLedgerSources(db, {
    taskId: input.taskId,
    artifactId: input.artifactId,
    artifactRowId: input.artifactRowId,
    smithersRunId: input.smithersRunId,
    root: input.root,
    aggregateOutput: input.aggregateOutput,
    attemptOutputs,
  });
  await appendTraceEvent(db, {
    taskId: input.taskId,
    eventType: "source_added",
    phase: "source_bank",
    agentLabel: "forecast-ledger",
    payloadJson: {
      sourceCount: citedSources.length,
      domains: uniqueDomains(citedSources),
    },
  });
  } finally {
    await releaseForecastLedgerLock(db, input.smithersRunId);
  }
}

async function persistNonBinaryForecastLedger(
  db: Db,
  input: {
    taskId: string;
    artifactId: string;
    artifactRowId: string | null;
    smithersRunId: string;
    operationSubmode: string | null;
    aggregateOutput: Record<string, unknown>;
    root: string;
  },
) {
  const lockAcquired = await acquireForecastLedgerLock(db, input.smithersRunId);
  if (!lockAcquired) {
    return;
  }
  try {
  if (await hasForecastLedgerForRun(db, input.smithersRunId)) {
    return;
  }

  const forecastType = forecastTypeFromSubmode(input.operationSubmode);
  const attemptOutputs = await readForecastAttemptOutputs(input.smithersRunId, input.root);
  const componentAttemptIds: string[] = [];

  for (const attemptOutput of attemptOutputs) {
    const [attempt] = await db
      .insert(forecastAttempts)
      .values({
        forecasterLabel: readString(attemptOutput, "forecasterLabel", "forecaster_label") ?? `${forecastType} forecaster`,
        forecastType,
        researchPassId: input.smithersRunId,
        model: process.env.CODEX_MODEL ?? "codex-subscription",
        promptVersion: `${forecastType}-forecast-inline-v0`,
        rawPrediction: attemptOutput,
        parsedPrediction: attemptOutput,
        rationale: readString(attemptOutput, "rationale") ?? "No rationale was provided.",
        wildcards: readStringArray(attemptOutput, "wildcards"),
        status: "completed",
        costProxy: {
          smithersRunId: input.smithersRunId,
          source: "smithers-codexagent",
        },
      })
      .returning({ id: forecastAttempts.id });
    componentAttemptIds.push(attempt.id);
  }
  await appendTraceEvent(db, {
    taskId: input.taskId,
    eventType: "trace_summary",
    phase: "forecast_attempts",
    agentLabel: "forecast-ledger",
    payloadJson: {
      forecastType,
      attemptCount: componentAttemptIds.length,
      forecasters: attemptOutputs.map((attempt) => readString(attempt, "forecasterLabel", "forecaster_label") ?? `${forecastType} forecaster`),
    },
  });

  await db.insert(forecastAggregates).values({
    forecastType,
    method: readString(input.aggregateOutput, "method") ?? "unknown",
    componentAttemptIds,
    rawAggregate: input.aggregateOutput,
    rationale: readString(input.aggregateOutput, "rationale") ?? "No aggregate rationale was provided.",
  });
  await appendTraceEvent(db, {
    taskId: input.taskId,
    eventType: "synthesis",
    phase: "aggregate",
    agentLabel: "forecast-ledger",
    payloadJson: {
      forecastType,
      method: readString(input.aggregateOutput, "method") ?? "unknown",
      componentAttemptCount: componentAttemptIds.length,
    },
  });

  const citedSources = dedupeSources([
    ...extractCitedSources(input.aggregateOutput),
    ...attemptOutputs.flatMap((attempt) => extractCitedSources(attempt)),
  ]);
  await persistSources(db, {
    taskId: input.taskId,
    artifactId: input.artifactId,
    artifactRowId: input.artifactRowId,
    sources: citedSources,
    sourceType: `agent_reported_${forecastType}_forecast_citation`,
  });
  await appendTraceEvent(db, {
    taskId: input.taskId,
    eventType: "source_added",
    phase: "source_bank",
    agentLabel: "forecast-ledger",
    payloadJson: {
      sourceCount: citedSources.length,
      domains: uniqueDomains(citedSources),
    },
  });
  } finally {
    await releaseForecastLedgerLock(db, input.smithersRunId);
  }
}

async function persistCitedSources(
  db: Db,
  input: {
    taskId: string;
    artifactId: string;
    artifactRowId: string | null;
    output: Record<string, unknown>;
    sourceType: string;
  },
) {
  await persistSources(db, {
    taskId: input.taskId,
    artifactId: input.artifactId,
    artifactRowId: input.artifactRowId,
    sources: dedupeSources(extractCitedSources(input.output)),
    sourceType: input.sourceType,
  });
}

async function persistAgentMapRows(
  db: Db,
  input: {
    taskId: string;
    artifactId: string;
    summaryRowId: string | null;
    output: Record<string, unknown>;
  },
) {
  const results = readArray(input.output, "results");
  for (const [index, result] of results.entries()) {
    await db
      .insert(artifactRows)
      .values({
        artifactId: input.artifactId,
        rowIndex: index + 1,
        sourceRowId: readString(result, "rowId", "row_id"),
        rowJson: result,
        status: "completed",
        completedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [artifactRows.artifactId, artifactRows.rowIndex],
      });
  }

  await db
    .update(artifacts)
    .set({
      rowCount: results.length + 1,
      updatedAt: new Date(),
    })
    .where(eq(artifacts.id, input.artifactId));

  await persistSources(db, {
    taskId: input.taskId,
    artifactId: input.artifactId,
    artifactRowId: input.summaryRowId,
    sources: dedupeSources([
      ...extractCitedSources(input.output),
      ...results.flatMap((result) => extractCitedSources(result)),
    ]),
    sourceType: "agent_reported_row_citation",
  });
}

async function persistSources(
  db: Db,
  input: {
    taskId: string;
    artifactId: string;
    artifactRowId: string | null;
    sources: Array<{
      title: string | null;
      url: string | null;
      claim: string;
      publishedAt?: string | null;
      sourceType?: string | null;
      usedInFinal?: boolean;
      qualityScore?: number | null;
      rank?: number | null;
      query?: string | null;
    }>;
    sourceType: string;
  },
) {
  for (const source of dedupeSources(input.sources)) {
    const [sourceRow] = await db
      .insert(sourceBankEntries)
      .values({
        taskId: input.taskId,
        url: source.url,
        domain: source.url ? safeDomain(source.url) : null,
        title: source.title,
        contentSummary: source.claim,
        sourceType: source.sourceType ?? input.sourceType,
        publishedAt: parseOptionalDate(source.publishedAt),
        query: source.query ?? null,
        rank: source.rank ?? null,
        qualityScore: source.qualityScore ?? null,
        usedInFinal: source.usedInFinal ?? true,
      })
      .returning({ id: sourceBankEntries.id });

    if (input.artifactRowId) {
      await db.insert(citations).values({
        sourceId: sourceRow.id,
        artifactId: input.artifactId,
        rowId: input.artifactRowId,
        fieldName: "cited_sources",
        claimText: source.claim,
      });
    }
  }
}

/**
 * Choose and persist the source ledger for a forecast run. When the workflow's
 * deterministic `research` node produced a live evidence bank, that bank is the
 * source of record: its sources carry real url/publishedAt/query/rank/quality
 * metadata and reconcile away hallucinated agent citations. Otherwise we fall
 * back to persisting whatever sources the agents self-reported.
 */
async function resolveForecastLedgerSources(
  db: Db,
  input: {
    taskId: string;
    artifactId: string;
    artifactRowId: string | null;
    smithersRunId: string;
    root: string;
    aggregateOutput: Record<string, unknown>;
    attemptOutputs: Array<Record<string, unknown>>;
  },
): Promise<Array<{ url: string | null }>> {
  const bank = await readResearchEvidenceBank(input.smithersRunId, input.root);
  const bankSourceRecords = bank ? readArray(bank, "sources") : [];
  const bankEnabled = bank?.enabled === true && bankSourceRecords.length > 0;

  if (bankEnabled) {
    const finalCitedUrls = new Set(
      extractCitedSources(input.aggregateOutput)
        .map((source) => (source.url ? canonicalSourceKey({ url: source.url, title: null, claim: "" }) : null))
        .filter((value): value is string => Boolean(value)),
    );
    const sources = dedupeSources(evidenceBankToLedgerSources(bankSourceRecords, finalCitedUrls));
    await persistSources(db, {
      taskId: input.taskId,
      artifactId: input.artifactId,
      artifactRowId: input.artifactRowId,
      sources,
      sourceType: "firecrawl_web_evidence",
    });
    return sources;
  }

  const citedSources = dedupeSources([
    ...extractCitedSources(input.aggregateOutput),
    ...input.attemptOutputs.flatMap((attempt) => extractCitedSources(attempt)),
  ]);
  await persistSources(db, {
    taskId: input.taskId,
    artifactId: input.artifactId,
    artifactRowId: input.artifactRowId,
    sources: citedSources,
    sourceType: "agent_reported_citation",
  });
  return citedSources;
}

async function readResearchEvidenceBank(smithersRunId: string, root: string): Promise<Record<string, unknown> | null> {
  try {
    const output = await readSmithersNodeOutput(smithersRunId, "research", root);
    return output && typeof output === "object" ? (output as Record<string, unknown>) : null;
  } catch {
    // Older runs, non-forecast workflows, or research-disabled runs have no node.
    return null;
  }
}

function evidenceBankToLedgerSources(
  bankSources: Array<Record<string, unknown>>,
  finalCitedUrls: Set<string>,
) {
  return bankSources
    .map((source) => {
      const url = readString(source, "url") ?? null;
      const scraped = source.scraped === true;
      const category = readString(source, "category");
      const publishedAt = readString(source, "publishedAt", "published_at") ?? null;
      const content = readString(source, "content");
      const snippet = readString(source, "snippet");
      let quality = 0.4;
      if (scraped) quality += 0.25;
      if (publishedAt) quality += 0.15;
      if (category === "market") quality += 0.2;
      const normalizedUrl = url ? canonicalSourceKey({ url, title: null, claim: "" }) : null;
      const usedInFinal = Boolean(
        (normalizedUrl && finalCitedUrls.has(normalizedUrl)) || scraped || category === "market",
      );
      return {
        title: readString(source, "title") ?? null,
        url,
        claim: snippet ?? (content ? content.slice(0, 320) : undefined) ?? readString(source, "title") ?? url ?? "",
        publishedAt,
        sourceType: category === "market" ? "market_signal" : "firecrawl_web_evidence",
        qualityScore: Math.min(1, quality),
        rank: readNumber(source, "rank") ?? null,
        query: readString(source, "query") ?? null,
        usedInFinal,
      };
    })
    .filter((source) => source.claim.length > 0);
}

async function readBinaryAttemptOutputs(smithersRunId: string, root: string) {
  return readForecastAttemptOutputs(smithersRunId, root);
}

async function hasForecastLedgerForRun(db: Db, smithersRunId: string) {
  const [attempt] = await db
    .select({ id: forecastAttempts.id })
    .from(forecastAttempts)
    .where(eq(forecastAttempts.researchPassId, smithersRunId))
    .limit(1);
  return Boolean(attempt);
}

async function acquireForecastLedgerLock(db: Db, smithersRunId: string) {
  const rows = await db.execute(sql<{ acquired: boolean }>`select pg_try_advisory_lock(hashtext(${smithersRunId})) as acquired`);
  return Boolean(rows[0]?.acquired);
}

async function releaseForecastLedgerLock(db: Db, smithersRunId: string) {
  await db.execute(sql`select pg_advisory_unlock(hashtext(${smithersRunId}))`);
}

async function readForecastAttemptOutputs(smithersRunId: string, root: string) {
  const nodeIds = ["attempt-base-rate", "attempt-inside-view", "attempt-skeptic"];
  const outputs: Array<Record<string, unknown>> = [];
  for (const nodeId of nodeIds) {
    try {
      outputs.push(await readSmithersNodeOutput(smithersRunId, nodeId, root));
    } catch {
      // Older or partial runs may lack individual attempt outputs. The aggregate fallback still preserves the final forecast.
    }
  }
  return outputs;
}

function forecastTypeFromSubmode(operationSubmode: string | null): "date" | "numeric" | "categorical" | "thresholded" | "conditional" {
  if (operationSubmode === "date_forecast") {
    return "date";
  }
  if (operationSubmode === "numeric_forecast") {
    return "numeric";
  }
  if (operationSubmode === "thresholded_forecast") {
    return "thresholded";
  }
  if (operationSubmode === "conditional_forecast") {
    return "conditional";
  }
  return "categorical";
}

function extractCitedSources(value: Record<string, unknown>) {
  return readArray(value, "citedSources", "cited_sources")
    .map((source) => ({
      title: readString(source, "title") ?? null,
      url: readString(source, "url") ?? null,
      claim: readString(source, "claim") ?? "",
      publishedAt: readString(source, "publishedAt", "published_at"),
      sourceType: readString(source, "sourceType", "source_type"),
    }))
    .filter((source) => source.claim.length > 0);
}

function dedupeSources<T extends { title: string | null; url: string | null; claim: string }>(sources: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const source of sources) {
    const key = canonicalSourceKey(source);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(source);
  }
  return deduped;
}

function canonicalSourceKey(source: { title: string | null; url: string | null; claim: string }) {
  if (source.url) {
    try {
      const url = new URL(source.url);
      url.hash = "";
      url.searchParams.sort();
      return `url:${url.toString().replace(/\/$/, "")}`;
    } catch {
      return `url:${source.url.trim().replace(/\/$/, "").toLowerCase()}`;
    }
  }
  return `fallback:${(source.title ?? "").trim().toLowerCase()}::${source.claim.trim().toLowerCase()}`;
}

function uniqueDomains(sources: Array<{ url: string | null }>) {
  return Array.from(new Set(sources.flatMap((source) => {
    if (!source.url) {
      return [];
    }
    const domain = safeDomain(source.url);
    return domain ? [domain] : [];
  }))).slice(0, 12);
}

async function appendTraceEvent(
  db: Db,
  input: {
    taskId: string;
    eventType: string;
    phase: string;
    agentLabel?: string;
    payloadJson?: Record<string, unknown>;
  },
) {
  const [latest] = await db
    .select({ sequenceNumber: traceEvents.sequenceNumber })
    .from(traceEvents)
    .where(eq(traceEvents.taskId, input.taskId))
    .orderBy(desc(traceEvents.sequenceNumber))
    .limit(1);

  await db
    .insert(traceEvents)
    .values({
      taskId: input.taskId,
      eventType: input.eventType,
      phase: input.phase,
      agentLabel: input.agentLabel,
      payloadJson: input.payloadJson ?? {},
      sequenceNumber: (latest?.sequenceNumber ?? 0) + 1,
    })
    .onConflictDoNothing({
      target: [traceEvents.taskId, traceEvents.sequenceNumber],
    });
}

function csvEscape(value: unknown) {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  return `"${(text ?? "").replaceAll('"', '""')}"`;
}

function artifactExportValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return JSON.stringify(value);
}

type ArtifactExportAppender = {
  appendNull: () => void;
  appendInteger: (value: number) => void;
  appendVarchar: (value: string) => void;
};

function appendArtifactExportValue(appender: ArtifactExportAppender, column: string, value: unknown) {
  if (value === null || value === undefined || value === "") {
    appender.appendNull();
    return;
  }
  if (column === "row_index") {
    appender.appendInteger(Number(value));
    return;
  }
  appender.appendVarchar(String(value));
}

function duckIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function duckString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sourceRowIdFor(row: Record<string, unknown>, index: number) {
  return String(row.rowId ?? row.row_id ?? row.id ?? `row-${index + 1}`);
}

function normalizeLineageRow(row: Record<string, unknown>, fallbackRowId: string) {
  const rowId = String(row.rowId ?? row.row_id ?? row.id ?? fallbackRowId);
  return {
    ...row,
    rowId,
    input: rowInputFromRecord(row),
  };
}

function rowInputFromRecord(row: Record<string, unknown>) {
  const direct = row.input ?? row.value ?? row.text;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct;
  }
  const fields = Object.entries(row)
    .filter(([key]) => !["rowId", "row_id", "id"].includes(key))
    .map(([key, value]) => `${key}: ${String(value ?? "")}`)
    .filter((field) => !field.endsWith(": "));
  return fields.join("; ");
}

function hashJson(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function readArray(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (Array.isArray(raw)) {
      return raw.filter(isRecord);
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter(isRecord);
        }
      } catch {
        continue;
      }
    }
  }
  return [];
}

function readStringArray(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (Array.isArray(raw)) {
      return raw.filter((item): item is string => typeof item === "string");
    }
  }
  return [];
}

function readString(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "string") {
      return raw;
    }
  }
  return null;
}

function readNumber(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return null;
}

function readProbability(value: Record<string, unknown>) {
  return readNumber(value, "probability");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeDomain(urlValue: string) {
  try {
    return new URL(urlValue).hostname;
  } catch {
    return null;
  }
}

function parseOptionalDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
