import { describe, expect, test } from "bun:test";
import {
  applyPlattCalibration,
  buildBinaryPlattCalibrationCandidate,
  chronologicalBinaryCalibrationSplit,
  defaultBinaryPlattCalibrationPolicy,
  evaluatePlattCalibration,
  fitPlattCalibration,
  type BinaryCalibrationObservation,
} from "../src";

describe("binary Platt calibration candidates", () => {
  test("identity Platt parameters preserve the raw probability", () => {
    const parameters = { intercept: 0, slope: 1, probabilityEpsilon: 1e-4 };
    expect(applyPlattCalibration(20, parameters)).toBeCloseTo(20, 6);
    expect(applyPlattCalibration(50, parameters)).toBeCloseTo(50, 6);
    expect(applyPlattCalibration(80, parameters)).toBeCloseTo(80, 6);
    expect(applyPlattCalibration(0, parameters)).toBe(0.01);
    expect(applyPlattCalibration(100, parameters)).toBe(99.99);
    const exactIdentityScores = evaluatePlattCalibration([
      { probability: 0, resolved: false },
      { probability: 100, resolved: true },
    ], parameters);
    expect(exactIdentityScores.brier.identity).toBe(0);
    expect(exactIdentityScores.brier.candidate).toBeGreaterThan(0);
  });

  test("weights and infers over event families rather than repeated snapshots", () => {
    const parameters = { intercept: 0, slope: 1, probabilityEpsilon: 1e-4 };
    const repeated = [
      { probability: 20, resolved: false, eventFamilyId: "event-a" },
      { probability: 30, resolved: false, eventFamilyId: "event-a" },
      { probability: 80, resolved: true, eventFamilyId: "event-b" },
      { probability: 70, resolved: true, eventFamilyId: "event-b" },
    ];
    const fit = fitPlattCalibration(repeated);
    const validation = evaluatePlattCalibration(repeated, parameters);
    expect(fit.trainingRows).toBe(4);
    expect(fit.independentUnits).toBe(2);
    expect(fit.weighting).toBe("equal_event_family");
    expect(validation.rows).toBe(4);
    expect(validation.independentUnits).toBe(2);
    expect(validation.inferenceUnit).toBe("event_family");
    expect(validation.brier.pairedConfidenceInterval.count).toBe(2);
  });

  test("fits on earlier labels and accepts a consistently better later calibration", () => {
    const candidate = buildBinaryPlattCalibrationCandidate({
      candidateVersion: "synthetic-overconfidence-v1",
      createdAt: instant(300),
      observations: observations("overconfident"),
    });

    expect(candidate.status).toBe("ready_for_explicit_promotion_review");
    expect(candidate.active).toBeFalse();
    expect(candidate.requiresExplicitPromotion).toBeTrue();
    expect(candidate.fit?.converged).toBeTrue();
    expect(candidate.split.training).toHaveLength(180);
    expect(candidate.split.validation).toHaveLength(60);
    expect(candidate.split.trainingOutcomesAvailableThrough! < candidate.split.validationForecastFrom!).toBeTrue();
    expect(candidate.validation?.brier.delta).toBeLessThan(0);
    expect(candidate.validation?.logLoss.delta).toBeLessThan(0);
    expect(candidate.validation?.brier.pairedConfidenceInterval.upper).toBeLessThan(0);
    expect(candidate.validation?.logLoss.pairedConfidenceInterval.upper).toBeLessThan(0);
    expect(candidate.applicationContract.rawMeanMedianRetained).toBeTrue();
    expect(candidate.applicationContract.crowdAssistedTrackExcluded).toBeTrue();
  });

  test("rejects a fitted candidate that does not beat identity out of time", () => {
    const candidate = buildBinaryPlattCalibrationCandidate({
      candidateVersion: "already-calibrated-v1",
      createdAt: instant(300),
      observations: observations("calibrated"),
    });

    expect(candidate.fit?.converged).toBeTrue();
    expect(candidate.status).toBe("rejected_on_holdout");
    expect(candidate.promotionRecommendation).toBe("reject");
    expect(candidate.active).toBeFalse();
    expect(candidate.validation?.passesHeldoutGate).toBeFalse();
  });

  test("embargoes earlier forecasts whose outcomes were unavailable when validation began", () => {
    const rows = observations("overconfident");
    rows[0] = { ...rows[0]!, resolvedAt: instant(220, 12) };
    const split = chronologicalBinaryCalibrationSplit(rows, {
      ...defaultBinaryPlattCalibrationPolicy,
      candidateCreatedAt: instant(300),
    });

    expect(split.valid).toBeTrue();
    expect(split.embargoed.map((row) => row.id)).toContain("row-0");
    expect(split.training.map((row) => row.id)).not.toContain("row-0");
    expect(split.trainingOutcomesAvailableThrough! <= split.validationForecastFrom!).toBeTrue();
  });

  test("blocks event-family leakage across the chronological boundary", () => {
    const rows = observations("overconfident");
    rows[rows.length - 1] = { ...rows[rows.length - 1]!, eventFamilyId: rows[0]!.eventFamilyId };
    const candidate = buildBinaryPlattCalibrationCandidate({
      candidateVersion: "family-leak-v1",
      createdAt: instant(300),
      observations: rows,
    });

    expect(candidate.status).toBe("blocked_by_data_gates");
    expect(candidate.split.familyOverlap).toEqual(["event-0"]);
    expect(candidate.split.gates.find((gate) => gate.id === "event_family_separation")?.passed).toBeFalse();
    expect(candidate.parameters).toBeNull();
  });

  test("blocks too-small or temporally invalid samples without fitting", () => {
    const tooSmall = buildBinaryPlattCalibrationCandidate({
      candidateVersion: "too-small-v1",
      createdAt: instant(30),
      observations: observations("overconfident").slice(0, 20),
    });
    expect(tooSmall.status).toBe("blocked_by_data_gates");
    expect(tooSmall.split.gates.find((gate) => gate.id === "minimum_total")?.passed).toBeFalse();

    const invalidRows = observations("overconfident");
    invalidRows[0] = {
      ...invalidRows[0]!,
      forecastAt: "2025-01-02T00:00:00",
    };
    const invalid = buildBinaryPlattCalibrationCandidate({
      candidateVersion: "invalid-time-v1",
      createdAt: instant(300),
      observations: invalidRows,
    });
    expect(invalid.status).toBe("blocked_by_data_gates");
    expect(invalid.split.issues.join(" ")).toContain("offset-qualified");
  });
});

function observations(kind: "overconfident" | "calibrated"): BinaryCalibrationObservation[] {
  return Array.from({ length: 240 }, (_, index) => {
    const position = index % 10;
    const lowForecast = position < 5;
    const probability = kind === "overconfident"
      ? lowForecast ? 10 : 90
      : lowForecast ? 20 : 80;
    const resolved = kind === "overconfident"
      ? lowForecast
        ? position < 2
        : position < 8
      : lowForecast
        ? position < 1
        : position < 9;
    return {
      id: `row-${index}`,
      probability,
      resolved,
      forecastAt: instant(index),
      resolvedAt: instant(index, 12),
      eventFamilyId: `event-${index}`,
    };
  });
}

function instant(day: number, hour = 0) {
  return new Date(Date.UTC(2025, 0, 1 + day, hour)).toISOString();
}
