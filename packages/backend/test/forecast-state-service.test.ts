import { describe, expect, test } from "bun:test";
import {
  assertCrossQuestionMemoryActivationEligible,
  assertForecastSnapshotChronology,
  assertPersistableForecastState,
  canonicalForecastQuestionKey,
  forecastUpdateLeaseExpiresAt,
  type PersistableForecastState,
} from "../src/forecast-state-service";

describe("forecast state persistence contracts", () => {
  test("canonicalizes harmless text differences but preserves the resolution contract", () => {
    const first = canonicalForecastQuestionKey({
      forecastType: "binary",
      question: " Will  ACME launch? ",
      resolutionCriteria: "YES if generally available.",
    });
    const same = canonicalForecastQuestionKey({
      forecastType: "binary",
      question: "will acme   launch?",
      resolutionCriteria: "yes if generally available.",
    });
    const differentContract = canonicalForecastQuestionKey({
      forecastType: "binary",
      question: "will acme launch?",
      resolutionCriteria: "YES if a public beta exists.",
    });

    expect(first).toBe(same);
    expect(first).not.toBe(differentContract);
  });

  test("requires resolved, out-of-time evidence before activating global memory", () => {
    expect(() => assertCrossQuestionMemoryActivationEligible({
      sourceQuestionIds: ["question-1"],
      sourceResolutionIds: ["resolution-1"],
      validationJson: { validatedOutOfTime: false, holdoutCaseCount: 20, primaryMetric: "brier" },
    })).toThrow("out-of-time");

    expect(() => assertCrossQuestionMemoryActivationEligible({
      sourceQuestionIds: ["question-1"],
      sourceResolutionIds: ["resolution-1"],
      validationJson: { validatedOutOfTime: true, holdoutCaseCount: 20, primaryMetric: "brier" },
    })).not.toThrow();
  });

  test("rejects malformed probability fields before database writes", () => {
    const state: PersistableForecastState = {
      version: "forecast-state-v1",
      stateId: "forecast_state_test",
      question: {
        question: "Will it happen?",
        resolutionCriteria: "Resolve YES if it happens.",
        resolutionDate: null,
        condition: null,
        background: null,
      },
      temporal: {
        forecastAsOf: null,
        evidenceAsOf: null,
        cutoffDate: null,
        trustState: "partial",
      },
      outputs: {
        autonomous: {
          rawProbability: 110,
          selectedProbability: 40,
          calibration: { status: "not_applied", modelId: null },
        },
        crowdAssisted: null,
      },
      update: {
        kind: "initial",
        reason: "Initial forecast.",
        previousStateId: null,
        probabilityDelta: null,
        newEvidenceClaimIds: [],
        invalidatedEvidenceClaimIds: [],
        nextScheduledUpdate: null,
        triggerConditions: [],
      },
      memory: {
        scope: "question_local",
        activeFactors: [],
        unresolvedInformationNeeds: [],
        transcriptStored: false,
      },
      provenance: {
        workflowVersion: "v1",
        aggregatorVersion: "v1",
        calibratorVersion: null,
        dossierVersion: "v1",
        schedulerVersion: null,
      },
    };

    expect(() => assertPersistableForecastState(state)).toThrow("rawAutonomousProbability");
  });

  test("enforces hard question-local memory and trigger cardinality limits", () => {
    const state = validPersistableState();
    state.memory.unresolvedInformationNeeds = Array.from({ length: 33 }, (_, index) => `need-${index}`);
    expect(() => assertPersistableForecastState(state)).toThrow("unresolvedInformationNeeds");

    const triggers = validPersistableState();
    triggers.update.triggerConditions = Array.from({ length: 33 }, (_, index) => `trigger-${index}`);
    expect(() => assertPersistableForecastState(triggers)).toThrow("triggerConditions");
  });

  test("rejects stale and backdated updates while allowing a forward successor", () => {
    const previousSnapshot = {
      id: "snapshot-1",
      questionId: "question-1",
      forecastAsOf: "2026-07-10T10:00:00Z",
    };
    const base = {
      questionId: "question-1",
      latestSnapshotId: "snapshot-1",
      previousStateId: "state-1",
      previousSnapshot,
      forecastAsOf: "2026-07-10T11:00:00Z",
    };

    expect(() => assertForecastSnapshotChronology(base)).not.toThrow();
    expect(() => assertForecastSnapshotChronology({
      ...base,
      latestSnapshotId: "snapshot-2",
    })).toThrow("not the question's latest snapshot");
    expect(() => assertForecastSnapshotChronology({
      ...base,
      forecastAsOf: "2026-07-10T10:00:00Z",
    })).toThrow("must be later");
    expect(() => assertForecastSnapshotChronology({
      ...base,
      forecastAsOf: "2026-07-09T23:59:59Z",
    })).toThrow("must be later");
  });

  test("computes finite recoverable update leases", () => {
    const asOf = new Date("2026-07-10T12:00:00Z");
    expect(forecastUpdateLeaseExpiresAt(asOf, 60_000).toISOString())
      .toBe("2026-07-10T12:01:00.000Z");
    expect(() => forecastUpdateLeaseExpiresAt(asOf, 0)).toThrow("must be positive");
  });
});

function validPersistableState(): PersistableForecastState {
  return {
    version: "forecast-state-v1",
    stateId: "forecast_state_valid",
    question: {
      question: "Will it happen?",
      resolutionCriteria: "Resolve YES if it happens.",
      resolutionDate: null,
      condition: null,
      background: null,
    },
    temporal: {
      forecastAsOf: null,
      evidenceAsOf: null,
      cutoffDate: null,
      trustState: "partial",
    },
    outputs: {
      autonomous: {
        rawProbability: 50,
        selectedProbability: 50,
        calibration: { status: "not_applied", modelId: null },
      },
      crowdAssisted: null,
    },
    update: {
      kind: "initial",
      reason: "Initial forecast.",
      previousStateId: null,
      probabilityDelta: null,
      newEvidenceClaimIds: [],
      invalidatedEvidenceClaimIds: [],
      nextScheduledUpdate: null,
      triggerConditions: [],
    },
    memory: {
      scope: "question_local",
      activeFactors: [],
      unresolvedInformationNeeds: [],
      transcriptStored: false,
    },
    provenance: {
      workflowVersion: "v1",
      aggregatorVersion: "v1",
      calibratorVersion: null,
      dossierVersion: "v1",
      schedulerVersion: null,
    },
  };
}
