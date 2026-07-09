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

export type BinaryCalibrationReport = {
  calibrationBuckets: CalibrationBucket[];
  calibrationSummary: CalibrationSummary;
};

export function buildBinaryCalibrationReport(
  rows: BinaryCalibrationInput[],
  resolvedForecastCount: number,
): BinaryCalibrationReport {
  const calibrationBuckets = buildCalibrationBuckets(rows);
  return {
    calibrationBuckets,
    calibrationSummary: summarizeCalibration(calibrationBuckets, resolvedForecastCount),
  };
}

function buildCalibrationBuckets(rows: BinaryCalibrationInput[]): CalibrationBucket[] {
  const bucketDefs = [
    { min: 0, max: 20 },
    { min: 20, max: 40 },
    { min: 40, max: 60 },
    { min: 60, max: 80 },
    { min: 80, max: 100 },
  ];
  return bucketDefs.map((bucket) => {
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
  const minimumForFitting = 25;
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

function meanNumber(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
