import { eq, inArray } from "drizzle-orm";
import {
  forecastAggregates,
  forecastAttempts,
  type createDb,
} from "@open-superforecaster/db";

type Db = ReturnType<typeof createDb>["db"];
type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbExecutor = Db | DbTransaction;
type ForecastType = typeof forecastAttempts.$inferSelect.forecastType;

export const supportedForecastLedgerVersion = "forecast-ledger-v1" as const;

export type ForecastLedgerManifest = {
  version: typeof supportedForecastLedgerVersion;
  inputDigest: string;
  smithersRunId: string;
  artifactId: string;
  artifactRowId: string | null;
  forecastType: ForecastType;
  aggregateId: string;
  snapshotId: string | null;
  stateId: string | null;
  componentAttemptIds: string[];
  sourceIds: string[];
  citationIds: string[];
};

export type ForecastLedgerIntegrityCode =
  | "uncommitted"
  | "incomplete_marker"
  | "unsupported_version"
  | "malformed_manifest"
  | "identity_mismatch"
  | "missing_rows"
  | "row_mismatch";

export class ForecastLedgerIntegrityError extends Error {
  readonly code: ForecastLedgerIntegrityCode;
  readonly taskId: string;

  constructor(code: ForecastLedgerIntegrityCode, taskId: string, message: string) {
    super(message);
    this.name = "ForecastLedgerIntegrityError";
    this.code = code;
    this.taskId = taskId;
  }
}

type ForecastLedgerTaskMarker = {
  id: string;
  operationMode: string;
  smithersRunId: string | null;
  outputArtifactId: string | null;
  forecastLedgerVersion: string | null;
  forecastLedgerCommittedAt: Date | null;
  forecastLedgerManifest: Record<string, unknown> | null;
};

/**
 * Read the durable commit marker without inferring completion from mutable run
 * identifiers or whatever attempt rows happen to exist.
 */
export function requireCommittedForecastLedgerManifest(
  task: ForecastLedgerTaskMarker,
  expectedForecastType: ForecastType,
): ForecastLedgerManifest {
  const markerParts = [
    task.forecastLedgerVersion,
    task.forecastLedgerCommittedAt,
    task.forecastLedgerManifest,
  ];
  if (markerParts.every((part) => part === null)) {
    throw integrityError(
      "uncommitted",
      task.id,
      "has no committed forecast ledger; unmarked legacy rows require explicit repair",
    );
  }
  if (markerParts.some((part) => part === null)) {
    throw integrityError(
      "incomplete_marker",
      task.id,
      "has an incomplete forecast-ledger commit marker and requires repair",
    );
  }
  if (
    !(task.forecastLedgerCommittedAt instanceof Date) ||
    !Number.isFinite(task.forecastLedgerCommittedAt.getTime())
  ) {
    throw integrityError(
      "incomplete_marker",
      task.id,
      "has an invalid forecast-ledger commit timestamp",
    );
  }
  if (task.forecastLedgerVersion !== supportedForecastLedgerVersion) {
    throw integrityError(
      "unsupported_version",
      task.id,
      `uses unsupported forecast-ledger version ${task.forecastLedgerVersion}`,
    );
  }

  let manifest: ForecastLedgerManifest;
  try {
    manifest = parseForecastLedgerManifest(task.id, task.forecastLedgerManifest);
  } catch (error) {
    if (error instanceof ForecastLedgerIntegrityError) {
      throw error;
    }
    throw integrityError(
      "malformed_manifest",
      task.id,
      error instanceof Error ? error.message : "forecast-ledger manifest is malformed",
    );
  }
  const mismatches = [
    manifest.version === task.forecastLedgerVersion ? null : "version",
    task.smithersRunId && manifest.smithersRunId === task.smithersRunId ? null : "smithersRunId",
    task.outputArtifactId && manifest.artifactId === task.outputArtifactId ? null : "artifactId",
    manifest.forecastType === expectedForecastType ? null : "forecastType",
  ].filter((value): value is string => value !== null);
  if (mismatches.length > 0) {
    throw integrityError(
      "identity_mismatch",
      task.id,
      `commit manifest does not match its task: ${mismatches.join(", ")}`,
    );
  }
  if (
    expectedForecastType === "binary" &&
    task.operationMode === "forecast" &&
    (!manifest.snapshotId || !manifest.stateId)
  ) {
    throw integrityError(
      "malformed_manifest",
      task.id,
      "binary ledger manifest is missing its committed ForecastState snapshot identity",
    );
  }
  return manifest;
}

/** Load only the rows named by the committed manifest and verify their lineage. */
export async function loadExactCommittedForecastLedgerRows(
  db: DbExecutor,
  input: {
    taskId: string;
    manifest: ForecastLedgerManifest;
  },
) {
  const attemptRows = await db
    .select()
    .from(forecastAttempts)
    .where(inArray(forecastAttempts.id, input.manifest.componentAttemptIds));
  const attemptsById = new Map(attemptRows.map((attempt) => [attempt.id, attempt]));
  const missingAttemptIds = input.manifest.componentAttemptIds.filter((id) => !attemptsById.has(id));
  if (missingAttemptIds.length > 0 || attemptRows.length !== input.manifest.componentAttemptIds.length) {
    throw integrityError(
      "missing_rows",
      input.taskId,
      `commit manifest references missing attempt rows: ${missingAttemptIds.join(", ") || "unknown"}`,
    );
  }
  const attempts = input.manifest.componentAttemptIds.map((id) => attemptsById.get(id)!);
  const invalidAttemptIds = attempts
    .filter(
      (attempt) =>
        attempt.forecastType !== input.manifest.forecastType ||
        attempt.researchPassId !== input.manifest.smithersRunId,
    )
    .map((attempt) => attempt.id);
  if (invalidAttemptIds.length > 0) {
    throw integrityError(
      "row_mismatch",
      input.taskId,
      `committed attempt rows have inconsistent type or run lineage: ${invalidAttemptIds.join(", ")}`,
    );
  }

  const [aggregate] = await db
    .select()
    .from(forecastAggregates)
    .where(eq(forecastAggregates.id, input.manifest.aggregateId))
    .limit(1);
  if (!aggregate) {
    throw integrityError(
      "missing_rows",
      input.taskId,
      `commit manifest references missing aggregate row ${input.manifest.aggregateId}`,
    );
  }
  if (
    aggregate.forecastType !== input.manifest.forecastType ||
    !sameOrderedStrings(aggregate.componentAttemptIds, input.manifest.componentAttemptIds)
  ) {
    throw integrityError(
      "row_mismatch",
      input.taskId,
      `committed aggregate row ${aggregate.id} does not match the manifest component set`,
    );
  }

  return { attempts, aggregate };
}

function parseForecastLedgerManifest(
  taskId: string,
  value: Record<string, unknown> | null,
): ForecastLedgerManifest {
  if (!value) {
    throw integrityError("malformed_manifest", taskId, "forecast-ledger manifest is missing");
  }
  const version = requiredString(value, "version");
  const inputDigest = requiredString(value, "inputDigest");
  const smithersRunId = requiredString(value, "smithersRunId");
  const artifactId = requiredString(value, "artifactId");
  const forecastType = requiredString(value, "forecastType");
  const aggregateId = requiredString(value, "aggregateId");
  const artifactRowId = nullableString(value, "artifactRowId");
  const snapshotId = nullableString(value, "snapshotId");
  const stateId = nullableString(value, "stateId");
  const componentAttemptIds = requiredStringArray(value, "componentAttemptIds", true);
  const sourceIds = requiredStringArray(value, "sourceIds", false);
  const citationIds = requiredStringArray(value, "citationIds", false);

  if (
    version !== supportedForecastLedgerVersion ||
    !isForecastType(forecastType) ||
    (snapshotId === null) !== (stateId === null)
  ) {
    throw integrityError("malformed_manifest", taskId, "forecast-ledger manifest is malformed");
  }
  return {
    version,
    inputDigest,
    smithersRunId,
    artifactId,
    artifactRowId,
    forecastType,
    aggregateId,
    snapshotId,
    stateId,
    componentAttemptIds,
    sourceIds,
    citationIds,
  };
}

function requiredString(value: Record<string, unknown>, key: string) {
  const candidate = value[key];
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error(`Expected non-empty string ${key}.`);
  }
  return candidate;
}

function nullableString(value: Record<string, unknown>, key: string): string | null {
  const candidate = value[key];
  if (candidate === null) {
    return null;
  }
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error(`Expected string or null ${key}.`);
  }
  return candidate;
}

function requiredStringArray(value: Record<string, unknown>, key: string, nonEmpty: boolean) {
  const candidate = value[key];
  if (
    !Array.isArray(candidate) ||
    (nonEmpty && candidate.length === 0) ||
    candidate.some((item) => typeof item !== "string" || !item.trim()) ||
    new Set(candidate).size !== candidate.length
  ) {
    throw new Error(`Expected ${nonEmpty ? "non-empty " : ""}unique string array ${key}.`);
  }
  return candidate as string[];
}

function isForecastType(value: string): value is ForecastType {
  return ["binary", "date", "numeric", "categorical", "thresholded", "conditional"].includes(value);
}

function sameOrderedStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function integrityError(code: ForecastLedgerIntegrityCode, taskId: string, detail: string) {
  return new ForecastLedgerIntegrityError(
    code,
    taskId,
    `Forecast task ${taskId} ${detail}.`,
  );
}
