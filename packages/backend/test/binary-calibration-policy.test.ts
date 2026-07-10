import { describe, expect, test } from "bun:test";
import {
  BINARY_CALIBRATION_BUCKETS as leafBuckets,
  BINARY_CALIBRATION_POLICY as leafPolicy,
} from "../src/binary-calibration-policy";
import {
  calibrationGuardRecommendationNeedsMoreEvidence,
  calibrationGuardRecommendationPromoteForDefault,
  calibrationGuardValidationModeHoldoutReplay,
  calibrationGuardValidationRecommendationFor,
} from "../src/calibration-guard-validation-policy";
import {
  BINARY_CALIBRATION_BUCKETS,
  BINARY_CALIBRATION_POLICY,
  buildBinaryCalibrationReport,
} from "../src/performance-calibration";

describe("binary calibration policy", () => {
  test("keeps the existing performance-calibration exports", () => {
    expect(BINARY_CALIBRATION_BUCKETS).toBe(leafBuckets);
    expect(BINARY_CALIBRATION_POLICY).toBe(leafPolicy);
  });

  test("keeps bucket boundaries and the inclusive 100% upper bound", () => {
    const report = buildBinaryCalibrationReport([
      { probability: 0, resolved: false, score: 0 },
      { probability: 19.99, resolved: false, score: 0.03996 },
      { probability: 20, resolved: true, score: 0.64 },
      { probability: 100, resolved: true, score: 0 },
    ], 4);

    expect(report.calibrationBuckets.map((bucket) => bucket.count)).toEqual([2, 1, 0, 0, 1]);
  });

  test("uses the shared minimum sample size for validation recommendations", () => {
    const evidence = {
      validationMode: calibrationGuardValidationModeHoldoutReplay,
      baselineMeanBrier: 0.2,
      candidateMeanBrier: 0.1,
      baselineCalibrationError: 20,
      candidateCalibrationError: 10,
    } as const;

    expect(calibrationGuardValidationRecommendationFor({
      ...evidence,
      matchedRows: BINARY_CALIBRATION_POLICY.minimumBucketSampleSize - 1,
    })).toBe(calibrationGuardRecommendationNeedsMoreEvidence);
    expect(calibrationGuardValidationRecommendationFor({
      ...evidence,
      matchedRows: BINARY_CALIBRATION_POLICY.minimumBucketSampleSize,
    })).toBe(calibrationGuardRecommendationPromoteForDefault);
  });
});
