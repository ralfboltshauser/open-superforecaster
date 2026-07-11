import { describe, expect, test } from "bun:test";
import {
  buildBinaryPlattCalibrationCandidate,
  type BinaryCalibrationObservation,
} from "@open-superforecaster/evals";
import { inactiveCalibrationModelValues } from "../src/binary-calibration-candidate-service";

describe("inactive calibration model persistence", () => {
  test("maps a validated candidate to an explicitly inactive audit row", () => {
    const candidate = buildBinaryPlattCalibrationCandidate({
      candidateVersion: "persistence-v1",
      createdAt: instant(300),
      observations: observations(),
    });
    expect(candidate.status).toBe("ready_for_explicit_promotion_review");

    const values = inactiveCalibrationModelValues(candidate, "geopolitics");
    expect(values).not.toBeNull();
    expect(values?.active).toBeFalse();
    expect(values?.forecastType).toBe("binary");
    expect(values?.method).toBe("platt-logit-l2/v1");
    expect(values?.domainFilter).toBe("geopolitics");
    expect(values?.parametersJson.activationContract).toEqual({
      active: false,
      requiresExplicitPromotion: true,
      automaticActivationSupported: false,
    });
    expect(values?.parametersJson.applicationContract).toMatchObject({
      rawProbabilityRetained: true,
      rawMeanMedianRetained: true,
      crowdAssistedTrackExcluded: true,
    });
    expect(values?.validationScores).not.toHaveProperty("training");
    expect(values?.validationScores).not.toHaveProperty("validation");
  });

  test("does not persist a model when data gates block fitting", () => {
    const candidate = buildBinaryPlattCalibrationCandidate({
      candidateVersion: "blocked-v1",
      createdAt: instant(20),
      observations: observations().slice(0, 10),
    });
    expect(inactiveCalibrationModelValues(candidate)).toBeNull();
  });
});

function observations(): BinaryCalibrationObservation[] {
  return Array.from({ length: 240 }, (_, index) => {
    const position = index % 10;
    const lowForecast = position < 5;
    return {
      id: `row-${index}`,
      probability: lowForecast ? 10 : 90,
      resolved: lowForecast ? position < 2 : position < 8,
      forecastAt: instant(index),
      resolvedAt: instant(index, 12),
      eventFamilyId: `event-${index}`,
    };
  });
}

function instant(day: number, hour = 0) {
  return new Date(Date.UTC(2025, 0, 1 + day, hour)).toISOString();
}
