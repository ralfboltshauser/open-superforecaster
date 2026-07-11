import { describe, expect, test } from "bun:test";
import {
  buildBinaryTrajectoryScoreRows,
  trajectoryLeadTime,
  type BinaryTrajectorySnapshot,
} from "../src/forecast-trajectory-scoring";

describe("binary ForecastState trajectory scoring", () => {
  test("scores every immutable snapshot and retains update-policy metadata", () => {
    const result = buildBinaryTrajectoryScoreRows({
      snapshots: [
        snapshot({
          id: "snapshot-1",
          stateId: "state-1",
          probability: 20,
          forecastAsOf: "2026-01-01T00:00:00Z",
          updateKind: "initial",
          probabilityDelta: null,
        }),
        snapshot({
          id: "snapshot-2",
          stateId: "state-2",
          probability: 60,
          forecastAsOf: "2026-01-09T00:00:00Z",
          updateKind: "scheduled",
          probabilityDelta: 40,
          previousSnapshotId: "snapshot-1",
        }),
      ],
      resolutionId: "resolution-1",
      resolved: true,
      resolvedAt: new Date("2026-01-11T00:00:00Z"),
    });

    expect(result.skipped).toEqual([]);
    expect(result.rows).toHaveLength(4);
    const scores = Object.fromEntries(result.rows.map((row) => [`${row.stateId}:${row.scoreType}`, row.scoreValue]));
    expect(scores["state-1:brier"]).toBeCloseTo(0.64);
    expect(scores["state-2:brier"]).toBeCloseTo(0.16);
    const update = result.rows.find((row) => row.stateId === "state-2" && row.scoreType === "brier")!;
    expect(update).toMatchObject({
      snapshotId: "snapshot-2",
      questionId: "question-1",
      resolutionId: "resolution-1",
      forecastTrack: "autonomous",
      probabilitySource: "selected_autonomous_probability",
      forecastAsOf: "2026-01-09T00:00:00Z",
      updateKind: "scheduled",
      stateId: "state-2",
      previousSnapshotId: "snapshot-1",
      probabilityDelta: 40,
      leadTimeSeconds: 172_800,
      leadTimeStatus: "before_resolution",
      eligibleForUpdatePolicyEvaluation: true,
    });
  });

  test("scores but flags missing, invalid, and post-resolution timestamps", () => {
    const result = buildBinaryTrajectoryScoreRows({
      snapshots: [
        snapshot({ id: "missing", stateId: "missing", probability: 50, forecastAsOf: null }),
        snapshot({ id: "invalid", stateId: "invalid", probability: 50, forecastAsOf: "2026-01-02T00:00:00" }),
        snapshot({ id: "late", stateId: "late", probability: 100, forecastAsOf: "2026-01-12T00:00:00Z" }),
      ],
      resolutionId: "resolution-1",
      resolved: true,
      resolvedAt: new Date("2026-01-11T00:00:00Z"),
    });

    expect(result.rows).toHaveLength(6);
    const statuses = Object.fromEntries(result.rows
      .filter((row) => row.scoreType === "brier")
      .map((row) => [row.stateId, [row.leadTimeStatus, row.eligibleForUpdatePolicyEvaluation]]));
    expect(statuses).toEqual({
      missing: ["missing_forecast_as_of", false],
      invalid: ["invalid_forecast_as_of", false],
      late: ["after_resolution", false],
    });
  });

  test("never creates trajectory scores for an annulled resolution", () => {
    const result = buildBinaryTrajectoryScoreRows({
      snapshots: [snapshot({ id: "snapshot-1", stateId: "state-1", probability: 40 })],
      resolutionId: "resolution-1",
      resolved: false,
      resolvedAt: new Date("2026-01-11T00:00:00Z"),
      annulled: true,
    });
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([{
      snapshotId: "snapshot-1",
      stateId: "state-1",
      reason: "resolution_annulled",
    }]);
  });

  test("never scores a snapshot whose autonomous isolation was not verified", () => {
    const result = buildBinaryTrajectoryScoreRows({
      snapshots: [snapshot({
        id: "contaminated",
        stateId: "state-contaminated",
        probability: 70,
        informationIsolationStatus: "possible_human_forecast_exposure",
      })],
      resolutionId: "resolution-1",
      resolved: true,
      resolvedAt: new Date("2026-01-11T00:00:00Z"),
    });
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([{
      snapshotId: "contaminated",
      stateId: "state-contaminated",
      reason: "information_isolation_not_verified",
    }]);
  });

  test("uses inclusive UTC calendar dates for lead time", () => {
    expect(trajectoryLeadTime("2026-01-10", new Date("2026-01-11T00:00:00Z"))).toEqual({
      seconds: 86_400,
      status: "before_resolution",
    });
    expect(trajectoryLeadTime("2026-02-30", new Date("2026-03-01T00:00:00Z"))).toEqual({
      seconds: null,
      status: "invalid_forecast_as_of",
    });
  });
});

function snapshot(input: {
  id: string;
  stateId: string;
  probability: number;
  forecastAsOf?: string | null;
  updateKind?: "initial" | "scheduled" | "event_triggered" | "manual";
  probabilityDelta?: number | null;
  previousSnapshotId?: string | null;
  informationIsolationStatus?: string;
}): BinaryTrajectorySnapshot {
  return {
    id: input.id,
    questionId: "question-1",
    stateId: input.stateId,
    stateVersion: "forecast-state-v1",
    stateJson: {
      outputs: {
        autonomous: {
          informationIsolation: {
            status: input.informationIsolationStatus ?? "isolated",
          },
        },
      },
    },
    previousSnapshotId: input.previousSnapshotId ?? null,
    forecastAsOf: input.forecastAsOf === undefined ? "2026-01-01T00:00:00Z" : input.forecastAsOf,
    temporalTrustState: "complete",
    rawAutonomousProbability: input.probability,
    selectedAutonomousProbability: input.probability,
    updateKind: input.updateKind ?? "initial",
    probabilityDelta: input.probabilityDelta ?? null,
    workflowVersion: "workflow-v1",
    aggregatorVersion: "mean-v1",
    calibratorVersion: null,
  };
}
