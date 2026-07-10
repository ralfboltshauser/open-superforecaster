export type BinaryCalibrationBucketRange = Readonly<{
  min: number;
  max: number;
}>;

export const BINARY_CALIBRATION_BUCKETS = [
  { min: 0, max: 20 },
  { min: 20, max: 40 },
  { min: 40, max: 60 },
  { min: 60, max: 80 },
  { min: 80, max: 100 },
] as const satisfies readonly BinaryCalibrationBucketRange[];

export type BinaryCalibrationPolicy = Readonly<{
  minimumForFitting: number;
  minimumBucketSampleSize: number;
  diagnosticCalibrationErrorThreshold: number;
  highSeveritySampleSize: number;
  highSeverityCalibrationErrorThreshold: number;
  candidateAdjustmentDivisor: number;
  maxCandidateAdjustment: number;
}>;

export const BINARY_CALIBRATION_POLICY = {
  minimumForFitting: 25,
  minimumBucketSampleSize: 3,
  diagnosticCalibrationErrorThreshold: 20,
  highSeveritySampleSize: 5,
  highSeverityCalibrationErrorThreshold: 30,
  candidateAdjustmentDivisor: 2,
  maxCandidateAdjustment: 15,
} as const satisfies BinaryCalibrationPolicy;
