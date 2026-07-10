import {
  calibrationGuardActivationStatusForCandidateFitting,
  type CalibrationGuardActivationStatus,
} from "./calibration-guard-activation-policy";
import {
  BINARY_CALIBRATION_BUCKETS,
  BINARY_CALIBRATION_POLICY,
} from "./binary-calibration-policy";

export {
  BINARY_CALIBRATION_BUCKETS,
  BINARY_CALIBRATION_POLICY,
  type BinaryCalibrationBucketRange,
  type BinaryCalibrationPolicy,
} from "./binary-calibration-policy";

export type BinaryCalibrationInput = {
  probability: number | null;
  resolved: boolean | null;
  score: number | null;
};

export type CalibrationBucket = {
  label: string;
  minProbability: number;
  maxProbability: number;
  count: number;
  meanForecast: number | null;
  observedRate: number | null;
  meanBrier: number | null;
  calibrationError: number | null;
};

export type CalibrationSummary = {
  sampleSize: number;
  resolvedForecastCount: number;
  expectedCalibrationError: number | null;
  maxBucketCalibrationError: number | null;
  minimumForFitting: number;
  status: "collecting_resolved_forecasts" | "ready_for_candidate_fitting";
};

export type CalibrationDiagnostic = {
  id: string;
  severity: "high" | "medium";
  bucketLabel: string;
  reason: string;
  recommendedActions: string[];
  metric: "calibration_error";
  score: number;
  delta: number;
  sampleSize: number;
  meanForecast: number;
  observedRate: number;
  direction: "overforecast" | "underforecast";
};

export type CandidateCalibrationGuardRule = {
  id: string;
  bucketLabel: string;
  minProbability: number;
  maxProbability: number;
  direction: CalibrationDiagnostic["direction"];
  suggestedAdjustment: number;
  sampleSize: number;
  meanForecast: number;
  observedRate: number;
  calibrationError: number;
  activationStatus: CalibrationGuardActivationStatus;
  rationale: string;
};

export type BinaryCalibrationReport = {
  calibrationBuckets: CalibrationBucket[];
  calibrationSummary: CalibrationSummary;
  calibrationDiagnostics: CalibrationDiagnostic[];
  candidateCalibrationGuardRules: CandidateCalibrationGuardRule[];
};

export function buildBinaryCalibrationReport(
  rows: BinaryCalibrationInput[],
  resolvedForecastCount: number,
): BinaryCalibrationReport {
  const calibrationBuckets = buildCalibrationBuckets(rows);
  const calibrationSummary = summarizeCalibration(calibrationBuckets, resolvedForecastCount);
  const calibrationDiagnostics = buildCalibrationDiagnostics(calibrationBuckets, calibrationSummary);
  return {
    calibrationBuckets,
    calibrationSummary,
    calibrationDiagnostics,
    candidateCalibrationGuardRules: buildCandidateCalibrationGuardRules(calibrationDiagnostics, calibrationSummary),
  };
}

function buildCalibrationBuckets(rows: BinaryCalibrationInput[]): CalibrationBucket[] {
  return BINARY_CALIBRATION_BUCKETS.map((bucket) => {
    const bucketRows = rows.filter((row) => {
      if (row.probability === null) {
        return false;
      }
      return bucket.max === 100
        ? row.probability >= bucket.min && row.probability <= bucket.max
        : row.probability >= bucket.min && row.probability < bucket.max;
    });
    const probabilities = bucketRows
      .map((row) => row.probability)
      .filter((value): value is number => value !== null);
    const resolvedValues = bucketRows
      .map((row) => row.resolved)
      .filter((value): value is boolean => value !== null);
    const scores = bucketRows
      .map((row) => row.score)
      .filter((value): value is number => value !== null);
    const observedRate = resolvedValues.length
      ? (resolvedValues.filter(Boolean).length / resolvedValues.length) * 100
      : null;
    const meanForecast = probabilities.length ? meanNumber(probabilities) : null;
    return {
      label: `${bucket.min}-${bucket.max}%`,
      minProbability: bucket.min,
      maxProbability: bucket.max,
      count: bucketRows.length,
      meanForecast,
      observedRate,
      meanBrier: scores.length ? meanNumber(scores) : null,
      calibrationError:
        meanForecast === null || observedRate === null
          ? null
          : Math.abs(meanForecast - observedRate),
    };
  });
}

function summarizeCalibration(buckets: CalibrationBucket[], resolvedForecastCount: number): CalibrationSummary {
  const sampleSize = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const weightedErrors = buckets.filter((bucket) => bucket.count > 0 && bucket.calibrationError !== null);
  const expectedCalibrationError = weightedErrors.length && sampleSize > 0
    ? weightedErrors.reduce((sum, bucket) => sum + bucket.count * (bucket.calibrationError ?? 0), 0) / sampleSize
    : null;
  const maxBucketCalibrationError = weightedErrors.length
    ? Math.max(...weightedErrors.map((bucket) => bucket.calibrationError ?? 0))
    : null;
  const minimumForFitting = BINARY_CALIBRATION_POLICY.minimumForFitting;
  return {
    sampleSize,
    resolvedForecastCount,
    expectedCalibrationError,
    maxBucketCalibrationError,
    minimumForFitting,
    status:
      resolvedForecastCount < minimumForFitting
        ? "collecting_resolved_forecasts"
        : "ready_for_candidate_fitting",
  };
}

function buildCalibrationDiagnostics(
  buckets: CalibrationBucket[],
  summary: CalibrationSummary,
): CalibrationDiagnostic[] {
  return buckets
    .flatMap((bucket): CalibrationDiagnostic[] => {
      if (
        bucket.meanForecast === null ||
        bucket.observedRate === null ||
        bucket.calibrationError === null ||
        bucket.count < BINARY_CALIBRATION_POLICY.minimumBucketSampleSize ||
        bucket.calibrationError < BINARY_CALIBRATION_POLICY.diagnosticCalibrationErrorThreshold
      ) {
        return [];
      }
      const delta = bucket.observedRate - bucket.meanForecast;
      const direction = delta < 0 ? "overforecast" : "underforecast";
      const severity =
        bucket.count >= BINARY_CALIBRATION_POLICY.highSeveritySampleSize &&
          bucket.calibrationError >= BINARY_CALIBRATION_POLICY.highSeverityCalibrationErrorThreshold
          ? "high"
          : "medium";
      return [{
        id: `calibration:${bucket.minProbability}-${bucket.maxProbability}`,
        severity,
        bucketLabel: bucket.label,
        reason: `${bucket.label} forecasts are ${direction === "overforecast" ? "over" : "under"}confident by ${roundMetric(bucket.calibrationError)} percentage points.`,
        recommendedActions: calibrationActions({
          direction,
          bucketLabel: bucket.label,
          status: summary.status,
        }),
        metric: "calibration_error",
        score: bucket.calibrationError,
        delta,
        sampleSize: bucket.count,
        meanForecast: bucket.meanForecast,
        observedRate: bucket.observedRate,
        direction,
      }];
    })
    .sort((left, right) => right.score - left.score || right.sampleSize - left.sampleSize);
}

function calibrationActions(input: {
  direction: CalibrationDiagnostic["direction"];
  bucketLabel: string;
  status: CalibrationSummary["status"];
}) {
  const actions = [
    `Review resolved binary aggregate forecasts in the ${input.bucketLabel} bucket before changing model prompts or calibration guards.`,
  ];
  if (input.direction === "overforecast") {
    actions.push("Look for overconfident yes forecasts, weak base rates, or evidence double-counting in the aggregate rationale.");
  } else {
    actions.push("Look for underweighted positive evidence or overly conservative base-rate anchors in the aggregate rationale.");
  }
  if (input.status === "collecting_resolved_forecasts") {
    actions.push("Treat this as an early warning until more resolved binary forecasts accumulate.");
  } else {
    actions.push("Use this bucket as a candidate calibration guard when fitting or tuning aggregate forecasts.");
  }
  return actions;
}

function buildCandidateCalibrationGuardRules(
  diagnostics: CalibrationDiagnostic[],
  summary: CalibrationSummary,
): CandidateCalibrationGuardRule[] {
  return diagnostics.map((diagnostic) => {
    const [minProbability, maxProbability] = diagnostic.bucketLabel
      .replace("%", "")
      .split("-")
      .map((value) => Number(value));
    const suggestedAdjustment = conservativeCalibrationAdjustment(diagnostic.delta);
    return {
      id: `candidate-guard:${diagnostic.bucketLabel}`,
      bucketLabel: diagnostic.bucketLabel,
      minProbability,
      maxProbability,
      direction: diagnostic.direction,
      suggestedAdjustment,
      sampleSize: diagnostic.sampleSize,
      meanForecast: diagnostic.meanForecast,
      observedRate: diagnostic.observedRate,
      calibrationError: diagnostic.score,
      activationStatus: calibrationGuardActivationStatusForCandidateFitting({
        readyForCandidateFitting: summary.status === "ready_for_candidate_fitting",
      }),
      rationale: `${diagnostic.bucketLabel} binary aggregates resolved at ${roundMetric(diagnostic.observedRate)}% versus ${roundMetric(diagnostic.meanForecast)}% mean forecast; review a ${formatSignedMetric(suggestedAdjustment)} point guard for this probability bucket.`,
    };
  });
}

function conservativeCalibrationAdjustment(delta: number) {
  const halfError = delta / BINARY_CALIBRATION_POLICY.candidateAdjustmentDivisor;
  const clipped = Math.max(
    -BINARY_CALIBRATION_POLICY.maxCandidateAdjustment,
    Math.min(BINARY_CALIBRATION_POLICY.maxCandidateAdjustment, halfError),
  );
  return roundMetric(clipped);
}

function meanNumber(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundMetric(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function formatSignedMetric(value: number) {
  return `${value >= 0 ? "+" : ""}${roundMetric(value)}`;
}
