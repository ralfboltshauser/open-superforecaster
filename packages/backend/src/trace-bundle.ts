import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { asc, eq, inArray } from "drizzle-orm";
import {
  artifactRows,
  artifacts,
  benchmarkCaseResults,
  citations,
  forecastAggregates,
  forecastAttempts,
  forecastResolutions,
  forecastScores,
  sourceBankEntries,
  tasks,
  traceEvents,
  type createDb,
} from "@open-superforecaster/db";
import type { ObjectStorageTarget } from "@open-superforecaster/artifact-store";
import { tryPutObject } from "./object-storage";
import { readSmithersTokenUsage, summarizeSmithersTokenUsage } from "./smithers-usage";

type Db = ReturnType<typeof createDb>["db"];

export type TraceBundle = {
  manifest: {
    schemaVersion: 1;
    taskId: string;
    smithersRunId: string | null;
    exportedAt: string;
  };
  task: Record<string, unknown>;
  artifacts: Array<Record<string, unknown> & { rows: Array<Record<string, unknown>> }>;
  traceEvents: Array<Record<string, unknown>>;
  sourceBank: Array<Record<string, unknown>>;
  citations: Array<Record<string, unknown>>;
  forecastAttempts: Array<Record<string, unknown>>;
  forecastAggregates: Array<Record<string, unknown>>;
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

  const events = await db
    .select()
    .from(traceEvents)
    .where(eq(traceEvents.taskId, input.taskId))
    .orderBy(asc(traceEvents.sequenceNumber));

  const sources = await db.select().from(sourceBankEntries).where(eq(sourceBankEntries.taskId, input.taskId));
  const sourceIds = sources.map((source) => source.id);
  const citationRows = sourceIds.length
    ? await db.select().from(citations).where(inArray(citations.sourceId, sourceIds))
    : [];
  const attempts = task.smithersRunId
    ? await db.select().from(forecastAttempts).where(eq(forecastAttempts.researchPassId, task.smithersRunId))
    : [];
  const attemptIds = attempts.map((attempt) => attempt.id);
  const allAggregates = await db.select().from(forecastAggregates);
  const aggregates = allAggregates.filter((aggregate) =>
    aggregate.componentAttemptIds.some((attemptId) => attemptIds.includes(attemptId)),
  );
  const aggregateIds = aggregates.map((aggregate) => aggregate.id);
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

  const bundle: TraceBundle = {
    manifest: {
      schemaVersion: 1,
      taskId: input.taskId,
      smithersRunId: task.smithersRunId,
      exportedAt: new Date().toISOString(),
    },
    task,
    artifacts: artifactsWithRows,
    traceEvents: events,
    sourceBank: sources,
    citations: citationRows,
    forecastAttempts: attempts,
    forecastAggregates: aggregates,
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
