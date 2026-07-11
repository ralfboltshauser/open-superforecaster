import { describe, expect, test } from "bun:test";
import {
  ForecastLedgerIntegrityError,
  loadExactCommittedForecastLedgerRows,
  requireCommittedForecastLedgerManifest,
} from "../src/forecast-ledger-manifest";

describe("committed forecast ledger manifest", () => {
  test("accepts a complete binary marker and preserves its exact committed ids", () => {
    const manifest = requireCommittedForecastLedgerManifest(committedTask(), "binary");

    expect(manifest.aggregateId).toBe("aggregate-1");
    expect(manifest.componentAttemptIds).toEqual(["attempt-1", "attempt-2"]);
    expect(manifest.snapshotId).toBe("snapshot-1");
  });

  test("rejects an unmarked legacy task instead of inferring completion from its run id", () => {
    expect(() => requireCommittedForecastLedgerManifest({
      ...committedTask(),
      forecastLedgerVersion: null,
      forecastLedgerCommittedAt: null,
      forecastLedgerManifest: null,
    }, "binary")).toThrow(ForecastLedgerIntegrityError);

    try {
      requireCommittedForecastLedgerManifest({
        ...committedTask(),
        forecastLedgerVersion: null,
        forecastLedgerCommittedAt: null,
        forecastLedgerManifest: null,
      }, "binary");
    } catch (error) {
      expect(error).toBeInstanceOf(ForecastLedgerIntegrityError);
      expect((error as ForecastLedgerIntegrityError).code).toBe("uncommitted");
    }
  });

  test("rejects unsupported, mismatched, and structurally incomplete manifests", () => {
    expectIntegrityCode({
      ...committedTask(),
      forecastLedgerVersion: "forecast-ledger-v0",
    }, "unsupported_version");
    expectIntegrityCode({
      ...committedTask(),
      outputArtifactId: "artifact-other",
    }, "identity_mismatch");
    expectIntegrityCode({
      ...committedTask(),
      forecastLedgerManifest: {
        ...committedTask().forecastLedgerManifest,
        componentAttemptIds: ["attempt-1", "attempt-1"],
      },
    }, "malformed_manifest");
    expectIntegrityCode({
      ...committedTask(),
      forecastLedgerManifest: {
        ...committedTask().forecastLedgerManifest,
        snapshotId: null,
        stateId: null,
      },
    }, "malformed_manifest");
  });

  test("allows stateless binary evaluation ledgers while product forecasts require ForecastState", () => {
    const statelessManifest = {
      ...committedTask().forecastLedgerManifest,
      snapshotId: null,
      stateId: null,
    };
    expect(() => requireCommittedForecastLedgerManifest({
      ...committedTask(),
      operationMode: "fixed_evidence_eval",
      forecastLedgerManifest: statelessManifest,
    }, "binary")).not.toThrow();
    expect(() => requireCommittedForecastLedgerManifest({
      ...committedTask(),
      forecastLedgerManifest: statelessManifest,
    }, "binary")).toThrow(ForecastLedgerIntegrityError);
  });

  test("loads only committed rows and restores manifest attempt order", async () => {
    const manifest = requireCommittedForecastLedgerManifest(committedTask(), "binary");
    const db = fakeSelectionDb([
      [attempt("attempt-2"), attempt("attempt-1")],
      [aggregate(["attempt-1", "attempt-2"])],
    ]);

    const rows = await loadExactCommittedForecastLedgerRows(db as never, {
      taskId: "task-1",
      manifest,
    });

    expect(rows.attempts.map((row) => row.id)).toEqual(["attempt-1", "attempt-2"]);
    expect(rows.aggregate.id).toBe("aggregate-1");
    expect(db.selectionCount).toBe(2);
  });

  test("rejects an aggregate whose component identity differs from the manifest", async () => {
    const manifest = requireCommittedForecastLedgerManifest(committedTask(), "binary");
    const db = fakeSelectionDb([
      [attempt("attempt-1"), attempt("attempt-2")],
      [aggregate(["attempt-1", "attempt-other"])],
    ]);

    await expect(loadExactCommittedForecastLedgerRows(db as never, {
      taskId: "task-1",
      manifest,
    })).rejects.toMatchObject({ code: "row_mismatch" });
  });
});

function committedTask() {
  return {
    id: "task-1",
    operationMode: "forecast",
    smithersRunId: "run-1",
    outputArtifactId: "artifact-1",
    forecastLedgerVersion: "forecast-ledger-v1",
    forecastLedgerCommittedAt: new Date("2026-07-10T12:00:00Z"),
    forecastLedgerManifest: {
      version: "forecast-ledger-v1",
      inputDigest: "digest-1",
      smithersRunId: "run-1",
      artifactId: "artifact-1",
      artifactRowId: "artifact-row-1",
      forecastType: "binary",
      aggregateId: "aggregate-1",
      snapshotId: "snapshot-1",
      stateId: "state-1",
      componentAttemptIds: ["attempt-1", "attempt-2"],
      sourceIds: [],
      citationIds: [],
    },
  };
}

function expectIntegrityCode(
  task: Parameters<typeof requireCommittedForecastLedgerManifest>[0],
  code: ForecastLedgerIntegrityError["code"],
) {
  try {
    requireCommittedForecastLedgerManifest(task, "binary");
    throw new Error("Expected manifest validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ForecastLedgerIntegrityError);
    expect((error as ForecastLedgerIntegrityError).code).toBe(code);
  }
}

function attempt(id: string) {
  return {
    id,
    forecastType: "binary",
    researchPassId: "run-1",
  };
}

function aggregate(componentAttemptIds: string[]) {
  return {
    id: "aggregate-1",
    forecastType: "binary",
    componentAttemptIds,
  };
}

function fakeSelectionDb(selections: unknown[][]) {
  let selectionCount = 0;
  return {
    get selectionCount() {
      return selectionCount;
    },
    select() {
      const rows = selections[selectionCount++] ?? [];
      return {
        from() {
          return {
            where() {
              const promise = Promise.resolve(rows);
              return {
                then: promise.then.bind(promise),
                limit(limit: number) {
                  return Promise.resolve(rows.slice(0, limit));
                },
              };
            },
          };
        },
      };
    },
  };
}
