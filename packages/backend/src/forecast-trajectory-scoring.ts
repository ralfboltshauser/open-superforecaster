import { scoreBinaryForecast } from "@open-superforecaster/evals";

export const forecastTrajectoryScoreTypes = ["brier", "log"] as const;
export type ForecastTrajectoryScoreType = typeof forecastTrajectoryScoreTypes[number];

export const forecastTrajectoryLeadTimeStatuses = [
  "before_resolution",
  "at_resolution",
  "after_resolution",
  "missing_forecast_as_of",
  "invalid_forecast_as_of",
] as const;
export type ForecastTrajectoryLeadTimeStatus = typeof forecastTrajectoryLeadTimeStatuses[number];
export type ForecastTrajectoryUpdateKind = "initial" | "scheduled" | "event_triggered" | "manual";

export type BinaryTrajectorySnapshot = {
  id: string;
  questionId: string;
  stateId: string;
  stateVersion: string;
  stateJson: Record<string, unknown>;
  previousSnapshotId: string | null;
  forecastAsOf: string | null;
  temporalTrustState: string;
  rawAutonomousProbability: number;
  selectedAutonomousProbability: number;
  updateKind: ForecastTrajectoryUpdateKind;
  probabilityDelta: number | null;
  workflowVersion: string;
  aggregatorVersion: string;
  calibratorVersion: string | null;
};

export type BinaryTrajectoryScoreRow = {
  snapshotId: string;
  questionId: string;
  resolutionId: string;
  forecastTrack: "autonomous";
  probabilitySource: "selected_autonomous_probability";
  scoreType: ForecastTrajectoryScoreType;
  scoreValue: number;
  probability: number;
  rawProbability: number;
  resolved: boolean;
  stateId: string;
  stateVersion: string;
  previousSnapshotId: string | null;
  forecastAsOf: string | null;
  updateKind: ForecastTrajectoryUpdateKind;
  probabilityDelta: number | null;
  leadTimeSeconds: number | null;
  leadTimeStatus: ForecastTrajectoryLeadTimeStatus;
  eligibleForUpdatePolicyEvaluation: boolean;
  temporalTrustState: string;
  metadataJson: Record<string, unknown>;
};

export type BinaryTrajectoryScoreSkip = {
  snapshotId: string;
  stateId: string;
  reason: "resolution_annulled" | "invalid_selected_probability" | "information_isolation_not_verified";
};

/**
 * Build proper-score rows for every immutable autonomous ForecastState snapshot.
 * Missing or post-resolution timing is retained and explicitly marked rather
 * than silently dropping a point from the trajectory.
 */
export function buildBinaryTrajectoryScoreRows(input: {
  snapshots: readonly BinaryTrajectorySnapshot[];
  resolutionId: string;
  resolved: boolean;
  resolvedAt: Date;
  annulled?: boolean;
}) {
  if (!input.resolutionId.trim()) {
    throw new Error("resolutionId must not be empty.");
  }
  if (!Number.isFinite(input.resolvedAt.getTime())) {
    throw new Error("resolvedAt must be a valid date.");
  }
  if (input.annulled) {
    return {
      rows: [] as BinaryTrajectoryScoreRow[],
      skipped: input.snapshots.map((snapshot) => ({
        snapshotId: snapshot.id,
        stateId: snapshot.stateId,
        reason: "resolution_annulled" as const,
      })),
    };
  }

  const rows: BinaryTrajectoryScoreRow[] = [];
  const skipped: BinaryTrajectoryScoreSkip[] = [];
  for (const snapshot of input.snapshots) {
    const informationIsolationStatus = readInformationIsolationStatus(snapshot.stateJson);
    if (informationIsolationStatus !== "isolated") {
      skipped.push({
        snapshotId: snapshot.id,
        stateId: snapshot.stateId,
        reason: "information_isolation_not_verified",
      });
      continue;
    }
    const probability = snapshot.selectedAutonomousProbability;
    if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
      skipped.push({
        snapshotId: snapshot.id,
        stateId: snapshot.stateId,
        reason: "invalid_selected_probability",
      });
      continue;
    }
    const leadTime = trajectoryLeadTime(snapshot.forecastAsOf, input.resolvedAt);
    const scores = scoreBinaryForecast({ probability, resolved: input.resolved });
    for (const scoreType of forecastTrajectoryScoreTypes) {
      rows.push({
        snapshotId: snapshot.id,
        questionId: snapshot.questionId,
        resolutionId: input.resolutionId,
        forecastTrack: "autonomous",
        probabilitySource: "selected_autonomous_probability",
        scoreType,
        scoreValue: scores[scoreType],
        probability,
        rawProbability: snapshot.rawAutonomousProbability,
        resolved: input.resolved,
        stateId: snapshot.stateId,
        stateVersion: snapshot.stateVersion,
        previousSnapshotId: snapshot.previousSnapshotId,
        forecastAsOf: snapshot.forecastAsOf,
        updateKind: snapshot.updateKind,
        probabilityDelta: snapshot.probabilityDelta,
        leadTimeSeconds: leadTime.seconds,
        leadTimeStatus: leadTime.status,
        eligibleForUpdatePolicyEvaluation:
          leadTime.status === "before_resolution" && snapshot.temporalTrustState !== "inconsistent",
        temporalTrustState: snapshot.temporalTrustState,
        metadataJson: {
          workflowVersion: snapshot.workflowVersion,
          aggregatorVersion: snapshot.aggregatorVersion,
          calibratorVersion: snapshot.calibratorVersion,
          informationIsolationStatus,
          resolutionAt: input.resolvedAt.toISOString(),
        },
      });
    }
  }
  return { rows, skipped };
}

function readInformationIsolationStatus(state: Record<string, unknown>) {
  const outputs = recordValue(state.outputs);
  const autonomous = recordValue(outputs?.autonomous);
  const isolation = recordValue(autonomous?.informationIsolation ?? autonomous?.information_isolation);
  return typeof isolation?.status === "string" ? isolation.status : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function trajectoryLeadTime(forecastAsOf: string | null, resolvedAt: Date): {
  seconds: number | null;
  status: ForecastTrajectoryLeadTimeStatus;
} {
  if (!forecastAsOf?.trim()) {
    return { seconds: null, status: "missing_forecast_as_of" };
  }
  const forecastTimestamp = parseForecastAsOf(forecastAsOf);
  if (forecastTimestamp === null) {
    return { seconds: null, status: "invalid_forecast_as_of" };
  }
  const seconds = (resolvedAt.getTime() - forecastTimestamp) / 1000;
  return {
    seconds,
    status: seconds > 0
      ? "before_resolution"
      : seconds === 0
        ? "at_resolution"
        : "after_resolution",
  };
}

function parseForecastAsOf(raw: string) {
  const value = raw.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
      ? timestamp
      : null;
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}
