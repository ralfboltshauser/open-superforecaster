import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { forecastTrajectoryScores } from "@open-superforecaster/db";
import { scoreCanonicalBinaryForecastTrajectory } from "../src/forecast-trajectory-score-service";

describe("ForecastState trajectory score persistence", () => {
  test("uses a unique natural key for retry-safe score insertion", () => {
    const config = getTableConfig(forecastTrajectoryScores);
    const naturalKey = config.indexes.find((index) =>
      index.config.name === "forecast_trajectory_scores_snapshot_resolution_track_type_idx"
    );
    expect(naturalKey?.config.unique).toBeTrue();
    expect(naturalKey?.config.columns.map((column) => "name" in column ? column.name : null)).toEqual([
      "snapshot_id",
      "resolution_id",
      "forecast_track",
      "score_type",
    ]);
  });

  test("scores all snapshots on the canonical question and treats conflicts as existing rows", async () => {
    const db = fakeDb({
      selections: [
        [{ questionId: "question-1" }],
        [{ id: "question-1" }],
        [snapshot("snapshot-1", "state-1", 20), snapshot("snapshot-2", "state-2", 60)],
        [{ questionId: "question-1" }],
        [{ id: "question-1" }],
        [snapshot("snapshot-1", "state-1", 20), snapshot("snapshot-2", "state-2", 60)],
      ],
      insertResults: [[{ id: "score-1" }, { id: "score-2" }, { id: "score-3" }, { id: "score-4" }], []],
    });
    const input = {
      taskId: "task-1",
      resolutionId: "resolution-1",
      resolved: true,
      resolvedAt: new Date("2026-01-11T00:00:00Z"),
      annulled: false,
    };

    const first = await scoreCanonicalBinaryForecastTrajectory(db.value as never, input);
    const retry = await scoreCanonicalBinaryForecastTrajectory(db.value as never, input);

    expect(first).toMatchObject({
      status: "scored",
      snapshotCount: 2,
      proposedScoreRows: 4,
      insertedScoreRows: 4,
      existingScoreRows: 0,
    });
    expect(retry).toMatchObject({
      status: "scored",
      proposedScoreRows: 4,
      insertedScoreRows: 0,
      existingScoreRows: 4,
    });
    expect(db.onConflictCalls).toBe(2);
    expect(db.insertedRows).toHaveLength(8);
  });

  test("annulled resolutions perform no reads or writes", async () => {
    const db = fakeDb({ selections: [], insertResults: [] });
    const result = await scoreCanonicalBinaryForecastTrajectory(db.value as never, {
      taskId: "task-1",
      resolutionId: "resolution-1",
      resolved: true,
      resolvedAt: new Date("2026-01-11T00:00:00Z"),
      annulled: true,
    });
    expect(result).toMatchObject({ status: "skipped", reason: "resolution_annulled", insertedScoreRows: 0 });
    expect(db.selectCalls).toBe(0);
    expect(db.insertedRows).toEqual([]);
  });
});

function snapshot(id: string, stateId: string, probability: number) {
  return {
    id,
    questionId: "question-1",
    stateId,
    stateVersion: "forecast-state-v1",
    stateJson: {
      outputs: {
        autonomous: {
          informationIsolation: { status: "isolated" },
        },
      },
    },
    taskId: "task-1",
    taskRowId: null,
    forecastAggregateId: null,
    previousSnapshotId: null,
    forecastAsOf: "2026-01-01T00:00:00Z",
    evidenceAsOf: "2026-01-01T00:00:00Z",
    cutoffDate: "2026-01-01T00:00:00Z",
    temporalTrustState: "complete",
    rawAutonomousProbability: probability,
    selectedAutonomousProbability: probability,
    crowdAssistedProbability: null,
    marketProbability: null,
    calibrationModelId: null,
    updateKind: "initial" as const,
    updateReason: "Initial forecast.",
    probabilityDelta: null,
    newEvidenceClaimIds: [],
    invalidatedEvidenceClaimIds: [],
    nextScheduledUpdate: null,
    triggerConditions: [],
    componentAttemptIds: [],
    workflowVersion: "workflow-v1",
    aggregatorVersion: "mean-v1",
    calibratorVersion: null,
    dossierVersion: "dossier-v1",
    schedulerVersion: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function fakeDb(input: { selections: unknown[][]; insertResults: unknown[][] }) {
  let selectionIndex = 0;
  let insertIndex = 0;
  const state = {
    selectCalls: 0,
    onConflictCalls: 0,
    insertedRows: [] as unknown[],
  };
  const value = {
    select() {
      state.selectCalls += 1;
      const rows = input.selections[selectionIndex++] ?? [];
      return {
        from() {
          return {
            where() {
              return Promise.resolve(rows);
            },
          };
        },
      };
    },
    insert() {
      const returned = input.insertResults[insertIndex++] ?? [];
      return {
        values(rows: unknown[]) {
          state.insertedRows.push(...rows);
          return {
            onConflictDoNothing() {
              state.onConflictCalls += 1;
              return {
                returning() {
                  return Promise.resolve(returned);
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    value,
    get selectCalls() { return state.selectCalls; },
    get onConflictCalls() { return state.onConflictCalls; },
    get insertedRows() { return state.insertedRows; },
  };
}
