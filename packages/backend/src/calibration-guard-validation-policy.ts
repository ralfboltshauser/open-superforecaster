import { BINARY_CALIBRATION_POLICY } from "./performance-calibration";

export const calibrationGuardValidationModeSourceReplay = "source_replay" as const;
export const calibrationGuardValidationModeHoldoutReplay = "holdout_replay" as const;

export const calibrationGuardValidationModes = [
  calibrationGuardValidationModeSourceReplay,
  calibrationGuardValidationModeHoldoutReplay,
] as const;

export type CalibrationGuardValidationMode = typeof calibrationGuardValidationModes[number];

export const calibrationGuardRecommendationPromoteForHoldout = "promote_for_holdout" as const;
export const calibrationGuardRecommendationPromoteForDefault = "promote_for_default" as const;
export const calibrationGuardRecommendationNeedsMoreEvidence = "needs_more_evidence" as const;
export const calibrationGuardRecommendationReject = "reject" as const;

export const calibrationGuardValidationRecommendations = [
  calibrationGuardRecommendationPromoteForHoldout,
  calibrationGuardRecommendationPromoteForDefault,
  calibrationGuardRecommendationNeedsMoreEvidence,
  calibrationGuardRecommendationReject,
] as const;

export type CalibrationGuardValidationRecommendation = typeof calibrationGuardValidationRecommendations[number];

export const calibrationGuardDefaultPlanSkippedReasonNotHoldoutReplay = "not_holdout_replay" as const;
export const calibrationGuardDefaultPlanSkippedReasonNotPromotedForDefault = "not_promoted_for_default" as const;

export const calibrationGuardDefaultPlanSkippedReasons = [
  calibrationGuardDefaultPlanSkippedReasonNotHoldoutReplay,
  calibrationGuardDefaultPlanSkippedReasonNotPromotedForDefault,
] as const;

export type CalibrationGuardDefaultPlanSkippedReason = typeof calibrationGuardDefaultPlanSkippedReasons[number];

export type CalibrationGuardValidationReplayRow = {
  id: string | null;
  taskId: string | null;
  probability: number;
  resolved: boolean;
  score: number | null;
};

export type CalibrationGuardValidationProposal = {
  id: string;
  sourceCandidateGuardId: string;
  targetWorkflowId: string;
  calibrationEvidence: {
    bucketLabel: string;
    suggestedAdjustment: number | null;
  };
};

export type CalibrationGuardValidationResult = {
  validationMode: CalibrationGuardValidationMode;
  proposalId: string;
  sourceCandidateGuardId: string;
  bucketLabel: string;
  suggestedAdjustment: number;
  matchedRows: number;
  baselineMeanBrier: number | null;
  candidateMeanBrier: number | null;
  brierDelta: number | null;
  baselineCalibrationError: number | null;
  candidateCalibrationError: number | null;
  calibrationErrorDelta: number | null;
  recommendation: CalibrationGuardValidationRecommendation;
};

export function isCalibrationGuardValidationRecommendation(
  value: string | null | undefined,
): value is CalibrationGuardValidationRecommendation {
  return calibrationGuardValidationRecommendations.includes(value as CalibrationGuardValidationRecommendation);
}

export function isCalibrationGuardPromotionRecommendation(value: string | null | undefined) {
  return value === calibrationGuardRecommendationPromoteForHoldout || value === calibrationGuardRecommendationPromoteForDefault;
}

export function isCalibrationGuardDefaultPromotionCandidate(input: {
  validationMode: string | null | undefined;
  recommendation: string | null | undefined;
}) {
  return input.validationMode === calibrationGuardValidationModeHoldoutReplay
    && input.recommendation === calibrationGuardRecommendationPromoteForDefault;
}

export function calibrationGuardDefaultPlanSkippedReasonForValidation(input: {
  validationMode: string | null | undefined;
}): CalibrationGuardDefaultPlanSkippedReason {
  return input.validationMode !== calibrationGuardValidationModeHoldoutReplay
    ? calibrationGuardDefaultPlanSkippedReasonNotHoldoutReplay
    : calibrationGuardDefaultPlanSkippedReasonNotPromotedForDefault;
}

export function validateCalibrationGuardProposal(
  proposal: CalibrationGuardValidationProposal,
  replayRows: CalibrationGuardValidationReplayRow[],
  validationMode: CalibrationGuardValidationMode,
): CalibrationGuardValidationResult[] {
  const bucket = parseCalibrationGuardBucketLabel(proposal.calibrationEvidence.bucketLabel);
  const adjustment = proposal.calibrationEvidence.suggestedAdjustment;
  if (!bucket || adjustment === null) {
    return [];
  }
  const matchedRows = replayRows.filter((row) =>
    bucket.max === 100
      ? row.probability >= bucket.min && row.probability <= bucket.max
      : row.probability >= bucket.min && row.probability < bucket.max
  );
  const baselineMeanBrier = meanMetric(matchedRows.map((row) => brierMetric(row.probability, row.resolved)));
  const candidateMeanBrier = meanMetric(matchedRows.map((row) => brierMetric(clampCalibrationGuardProbability(row.probability + adjustment), row.resolved)));
  const baselineCalibrationError = calibrationGuardReplayError(matchedRows.map((row) => row.probability), matchedRows.map((row) => row.resolved));
  const candidateCalibrationError = calibrationGuardReplayError(
    matchedRows.map((row) => clampCalibrationGuardProbability(row.probability + adjustment)),
    matchedRows.map((row) => row.resolved),
  );
  return [{
    validationMode,
    proposalId: proposal.id,
    sourceCandidateGuardId: proposal.sourceCandidateGuardId,
    bucketLabel: proposal.calibrationEvidence.bucketLabel,
    suggestedAdjustment: adjustment,
    matchedRows: matchedRows.length,
    baselineMeanBrier,
    candidateMeanBrier,
    brierDelta: metricDelta(candidateMeanBrier, baselineMeanBrier),
    baselineCalibrationError,
    candidateCalibrationError,
    calibrationErrorDelta: metricDelta(candidateCalibrationError, baselineCalibrationError),
    recommendation: calibrationGuardValidationRecommendationFor({
      validationMode,
      matchedRows: matchedRows.length,
      baselineMeanBrier,
      candidateMeanBrier,
      baselineCalibrationError,
      candidateCalibrationError,
    }),
  }];
}

export function calibrationGuardValidationRecommendationFor(input: {
  validationMode: CalibrationGuardValidationMode;
  matchedRows: number;
  baselineMeanBrier: number | null;
  candidateMeanBrier: number | null;
  baselineCalibrationError: number | null;
  candidateCalibrationError: number | null;
}): CalibrationGuardValidationRecommendation {
  if (
    input.matchedRows < BINARY_CALIBRATION_POLICY.minimumBucketSampleSize ||
    input.baselineMeanBrier === null ||
    input.candidateMeanBrier === null
  ) {
    return calibrationGuardRecommendationNeedsMoreEvidence;
  }
  if (
    input.candidateMeanBrier < input.baselineMeanBrier &&
    input.candidateCalibrationError !== null &&
    input.baselineCalibrationError !== null &&
    input.candidateCalibrationError <= input.baselineCalibrationError
  ) {
    return input.validationMode === calibrationGuardValidationModeHoldoutReplay
      ? calibrationGuardRecommendationPromoteForDefault
      : calibrationGuardRecommendationPromoteForHoldout;
  }
  return calibrationGuardRecommendationReject;
}

export function parseCalibrationGuardBucketLabel(label: string) {
  const match = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%$/.exec(label);
  if (!match) {
    return null;
  }
  const min = Number(match[1]);
  const max = Number(match[2]);
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function calibrationGuardReplayError(probabilities: number[], resolved: boolean[]) {
  if (probabilities.length === 0 || probabilities.length !== resolved.length) {
    return null;
  }
  const meanForecast = meanMetric(probabilities);
  const observedRate = meanMetric(resolved.map((value) => (value ? 100 : 0)));
  return meanForecast === null || observedRate === null ? null : roundMetric(Math.abs(meanForecast - observedRate));
}

function brierMetric(probability: number, resolved: boolean) {
  const forecast = probability / 100;
  const actual = resolved ? 1 : 0;
  return roundMetric((forecast - actual) ** 2);
}

function meanMetric(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? roundMetric(finite.reduce((sum, value) => sum + value, 0) / finite.length) : null;
}

function metricDelta(candidate: number | null, baseline: number | null) {
  return candidate === null || baseline === null ? null : roundMetric(candidate - baseline);
}

function clampCalibrationGuardProbability(value: number) {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

function roundMetric(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
