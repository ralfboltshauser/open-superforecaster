import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import {
  artifactRows,
  artifacts,
  benchmarkCaseResults,
  citations,
  forecastAggregates,
  forecastAttempts,
  forecastMemoryEntries,
  forecastQuestions,
  forecastResolutions,
  forecastScores,
  forecastSnapshots,
  forecastTrajectoryScores,
  forecastUpdateTriggers,
  sourceBankEntries,
  tasks,
  traceEvents,
  type createDb,
} from "@open-superforecaster/db";
import type { ObjectStorageTarget } from "@open-superforecaster/artifact-store";
import { tryPutObject } from "./object-storage";
import { requireCommittedForecastLedgerManifest } from "./forecast-ledger-manifest";
import { readSmithersTokenUsage, summarizeSmithersTokenUsage } from "./smithers-usage";

type Db = ReturnType<typeof createDb>["db"];

export type TraceBundle = {
  manifest: {
    schemaVersion: 4;
    taskId: string;
    smithersRunId: string | null;
    exportedAt: string;
    scope: "ledger_commit_projection" | "task_history";
  };
  task: Record<string, unknown>;
  artifacts: Array<Record<string, unknown> & { rows: Array<Record<string, unknown>> }>;
  traceEvents: Array<Record<string, unknown>>;
  sourceBank: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
  forecastAttempts: Array<Record<string, unknown>>;
  forecastAggregates: Array<Record<string, unknown>>;
  forecastQuestions: Array<Record<string, unknown>>;
  forecastSnapshots: Array<Record<string, unknown>>;
  forecastTrajectoryScores: Array<Record<string, unknown>>;
  forecastUpdateTriggers: Array<Record<string, unknown>>;
  forecastMemoryEntries: Array<Record<string, unknown>>;
  forecastResolutions: Array<Record<string, unknown>>;
  forecastScores: Array<Record<string, unknown>>;
  benchmarkCaseResults: Array<Record<string, unknown>>;
  benchmarkScores: Array<Record<string, unknown>>;
  tokenUsage: {
    rows: Array<Record<string, unknown>>;
    summary: Record<string, unknown>;
  };
};

export async function exportTraceBundle(db: Db, input: {
  taskId: string;
  artifactsDir: string;
  root?: string;
  objectStorage?: ObjectStorageTarget;
}) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }

  const artifactRecords = await db.select().from(artifacts).where(eq(artifacts.taskId, input.taskId));
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

  const forecastTask = isForecastSubmode(task.operationSubmode);
  const ledgerManifest = task.forecastLedgerCommittedAt && forecastTask
    ? requireCommittedForecastLedgerManifest(
        task,
        forecastTypeFromSubmode(task.operationSubmode),
      )
    : null;
  const commitBoundary = task.forecastLedgerCommittedAt;
  const events = await db
    .select()
    .from(traceEvents)
    .where(and(
      eq(traceEvents.taskId, input.taskId),
      ...(commitBoundary ? [lte(traceEvents.createdAt, commitBoundary)] : []),
    ))
    .orderBy(asc(traceEvents.sequenceNumber));

  const sources = ledgerManifest
    ? ledgerManifest.sourceIds.length
      ? await db.select().from(sourceBankEntries).where(inArray(sourceBankEntries.id, ledgerManifest.sourceIds))
      : []
    : forecastTask
      ? []
      : await db.select().from(sourceBankEntries).where(eq(sourceBankEntries.taskId, input.taskId));
  const sourceIds = sources.map((source) => source.id);
  const citationRows = ledgerManifest
    ? ledgerManifest.citationIds.length
      ? await db.select().from(citations).where(inArray(citations.id, ledgerManifest.citationIds))
      : []
    : sourceIds.length
      ? await db.select().from(citations).where(inArray(citations.sourceId, sourceIds))
      : [];
  const attempts = ledgerManifest
    ? ledgerManifest.componentAttemptIds.length
      ? await db.select().from(forecastAttempts).where(inArray(forecastAttempts.id, ledgerManifest.componentAttemptIds))
      : []
    : !forecastTask && task.smithersRunId
      ? await db.select().from(forecastAttempts).where(eq(forecastAttempts.researchPassId, task.smithersRunId))
      : [];
  const attemptIds = attempts.map((attempt) => attempt.id);
  const aggregates = ledgerManifest
    ? await db.select().from(forecastAggregates).where(eq(forecastAggregates.id, ledgerManifest.aggregateId))
    : (await db.select().from(forecastAggregates)).filter((aggregate) =>
        aggregate.componentAttemptIds.some((attemptId) => attemptIds.includes(attemptId)),
      );
  const aggregateIds = aggregates.map((aggregate) => aggregate.id);
  const committedSnapshotId = ledgerManifest?.snapshotId ?? null;
  const snapshots = committedSnapshotId
    ? await db.select().from(forecastSnapshots).where(eq(forecastSnapshots.id, committedSnapshotId))
    : [];
  const questionIds = [...new Set(snapshots.map((snapshot) => snapshot.questionId))];
  const snapshotIds = snapshots.map((snapshot) => snapshot.id);
  const trajectoryScores = snapshotIds.length
    ? await db.select().from(forecastTrajectoryScores).where(inArray(forecastTrajectoryScores.snapshotId, snapshotIds))
    : [];
  const currentQuestions = questionIds.length
    ? await db.select().from(forecastQuestions).where(inArray(forecastQuestions.id, questionIds))
    : [];
  const snapshotIdByQuestion = new Map(snapshots.map((snapshot) => [snapshot.questionId, snapshot.id]));
  const questions = currentQuestions.map((question) => ({
    ...question,
    latestSnapshotIdAtExport: question.latestSnapshotId,
    statusAtExport: question.status,
    latestSnapshotId: snapshotIdByQuestion.get(question.id) ?? null,
    status: "open" as const,
    updateLeaseOwner: null,
    updateLeaseExpiresAt: null,
    updateLeaseTriggerId: null,
    replayProjection: "ledger_commit" as const,
  }));
  const updateTriggers = snapshotIds.length
    ? (await db
        .select()
        .from(forecastUpdateTriggers)
        .where(and(
          inArray(forecastUpdateTriggers.sourceSnapshotId, snapshotIds),
          ...(commitBoundary ? [lte(forecastUpdateTriggers.createdAt, commitBoundary)] : []),
        )))
        .map((trigger) => ({
          ...trigger,
          statusAtExport: trigger.status,
          status: "active" as const,
          replayProjection: "ledger_commit" as const,
        }))
    : [];
  const memoryEntries = snapshotIds.length
    ? (await db
        .select()
        .from(forecastMemoryEntries)
        .where(and(
          inArray(forecastMemoryEntries.sourceSnapshotId, snapshotIds),
          ...(commitBoundary ? [lte(forecastMemoryEntries.createdAt, commitBoundary)] : []),
        )))
        .map((entry) => ({
          ...entry,
          statusAtExport: entry.status,
          status: "active" as const,
          deprecatedAt: null,
          replayProjection: "ledger_commit" as const,
        }))
    : [];
  const scoreRows = [
    ...(attemptIds.length
      ? await db.select().from(forecastScores).where(inArray(forecastScores.forecastAttemptId, attemptIds))
      : []),
    ...(aggregateIds.length
      ? await db.select().from(forecastScores).where(inArray(forecastScores.forecastAggregateId, aggregateIds))
      : []),
  ];
  const resolutionIds = [
    ...new Set(scoreRows.map((score) => score.resolutionId).filter((id): id is string => typeof id === "string")),
  ];
  const resolutions = resolutionIds.length
    ? await db.select().from(forecastResolutions).where(inArray(forecastResolutions.id, resolutionIds))
    : [];
  const benchmarkResults = await db
    .select()
    .from(benchmarkCaseResults)
    .where(eq(benchmarkCaseResults.taskId, input.taskId));
  const benchmarkScores = benchmarkResults.flatMap((result) =>
    result.scoreRows.map((scoreRow) => ({
      ...scoreRow,
      benchmarkRunId: result.benchmarkRunId,
      benchmarkCaseId: result.benchmarkCaseId,
      benchmarkCaseResultId: result.id,
    })),
  );
  const tokenUsage = input.root && task.smithersRunId
    ? await readSmithersTokenUsage(input.root, task.smithersRunId)
    : [];

  if (ledgerManifest) {
    assertExactCommittedRows("forecast attempts", attempts, ledgerManifest.componentAttemptIds);
    assertExactCommittedRows("forecast aggregate", aggregates, [ledgerManifest.aggregateId]);
    assertExactCommittedRows("sources", sources, ledgerManifest.sourceIds);
    assertExactCommittedRows("citations", citationRows, ledgerManifest.citationIds);
    if (committedSnapshotId) {
      assertExactCommittedRows("forecast snapshot", snapshots, [committedSnapshotId]);
    }
  }

  const bundle: TraceBundle = {
    manifest: {
      schemaVersion: 4,
      taskId: input.taskId,
      smithersRunId: task.smithersRunId,
      exportedAt: new Date().toISOString(),
      scope: ledgerManifest ? "ledger_commit_projection" : "task_history",
    },
    task,
    artifacts: artifactsWithRows,
    traceEvents: events,
    sourceBank: sources,
    citations: citationRows,
    forecastAttempts: attempts,
    forecastAggregates: aggregates,
    forecastQuestions: questions,
    forecastSnapshots: snapshots,
    forecastTrajectoryScores: trajectoryScores,
    forecastUpdateTriggers: updateTriggers,
    forecastMemoryEntries: memoryEntries,
    forecastResolutions: resolutions,
    forecastScores: scoreRows,
    benchmarkCaseResults: benchmarkResults,
    benchmarkScores,
    tokenUsage: {
      rows: tokenUsage,
      summary: summarizeSmithersTokenUsage(tokenUsage),
    },
  };

  const dir = resolve(input.artifactsDir, "runs", input.taskId);
  const path = resolve(dir, "trace-bundle.json");
  const key = `runs/${input.taskId}/trace-bundle.json`;
  const body = `${JSON.stringify(bundle, null, 2)}\n`;
  await mkdir(dir, { recursive: true });
  await writeFile(path, body, "utf8");
  const objectUpload = await tryPutObject(input.objectStorage, {
    key,
    body,
    contentType: "application/json; charset=utf-8",
  });

  return {
    path,
    storageUri: objectUpload.storageUri ?? key,
    objectStorage: objectUpload,
    bundle,
  };
}

function assertExactCommittedRows(
  label: string,
  rows: Array<{ id: string }>,
  expectedIds: string[],
) {
  const actual = new Set(rows.map((row) => row.id));
  const expected = new Set(expectedIds);
  const missing = [...expected].filter((id) => !actual.has(id));
  const unexpected = [...actual].filter((id) => !expected.has(id));
  if (missing.length || unexpected.length || actual.size !== expected.size) {
    throw new Error(
      `Committed trace read set for ${label} is inconsistent (missing ${missing.length}, unexpected ${unexpected.length}).`,
    );
  }
}

function isForecastSubmode(operationSubmode: string | null) {
  return operationSubmode === "binary_forecast"
    || operationSubmode === "date_forecast"
    || operationSubmode === "numeric_forecast"
    || operationSubmode === "categorical_forecast"
    || operationSubmode === "thresholded_forecast"
    || operationSubmode === "conditional_forecast";
}

function forecastTypeFromSubmode(operationSubmode: string | null) {
  if (operationSubmode === "binary_forecast") return "binary" as const;
  if (operationSubmode === "date_forecast") return "date" as const;
  if (operationSubmode === "numeric_forecast") return "numeric" as const;
  if (operationSubmode === "thresholded_forecast") return "thresholded" as const;
  if (operationSubmode === "conditional_forecast") return "conditional" as const;
  return "categorical" as const;
}
