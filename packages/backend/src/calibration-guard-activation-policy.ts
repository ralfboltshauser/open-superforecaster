import {
  isForecastAttentionReviewDeferred,
  isForecastAttentionReviewOpen,
  isForecastAttentionReviewResolved,
  normalizeForecastAttentionReviewStatus,
  summarizeForecastAttentionReviewStatuses,
} from "./forecast-attention-policy";

export const calibrationGuardActivationStatusNeedsMoreResolvedForecasts = "needs_more_resolved_forecasts" as const;
export const calibrationGuardActivationStatusReadyForReview = "ready_for_review" as const;

export const calibrationGuardActivationStatuses = [
  calibrationGuardActivationStatusNeedsMoreResolvedForecasts,
  calibrationGuardActivationStatusReadyForReview,
] as const;

export type CalibrationGuardActivationStatus = typeof calibrationGuardActivationStatuses[number];

export const defaultCalibrationGuardActivationStatus: CalibrationGuardActivationStatus = calibrationGuardActivationStatusNeedsMoreResolvedForecasts;

export function isCalibrationGuardActivationStatus(value: string | null | undefined): value is CalibrationGuardActivationStatus {
  return calibrationGuardActivationStatuses.includes(value as CalibrationGuardActivationStatus);
}

export function normalizeCalibrationGuardActivationStatus(value: string | null | undefined): CalibrationGuardActivationStatus {
  return isCalibrationGuardActivationStatus(value) ? value : defaultCalibrationGuardActivationStatus;
}

export function calibrationGuardActivationStatusForCandidateFitting(input: {
  readyForCandidateFitting: boolean;
}): CalibrationGuardActivationStatus {
  return input.readyForCandidateFitting
    ? calibrationGuardActivationStatusReadyForReview
    : calibrationGuardActivationStatusNeedsMoreResolvedForecasts;
}

export function isCalibrationGuardReadyForReview(value: string | null | undefined) {
  return normalizeCalibrationGuardActivationStatus(value) === calibrationGuardActivationStatusReadyForReview;
}

export function calibrationGuardActivationSeverity(value: string | null | undefined) {
  return isCalibrationGuardReadyForReview(value) ? "high" : "medium";
}

export type CalibrationGuardProposalEligibilityCounts = {
  candidates: number;
  eligible: number;
  skippedOpen: number;
  skippedDeferred: number;
  skippedNeedsMoreResolvedForecasts: number;
};

export type CalibrationGuardProposalEligibilityInput = {
  reviewStatus: string | null | undefined;
  activationStatus: string | null | undefined;
};

export function isCalibrationGuardProposalEligible(
  input: CalibrationGuardProposalEligibilityInput,
  options: { includeOpen?: boolean } = {},
) {
  if (!isCalibrationGuardReadyForReview(input.activationStatus)) {
    return false;
  }
  const reviewStatus = normalizeForecastAttentionReviewStatus(input.reviewStatus);
  if (isForecastAttentionReviewDeferred(reviewStatus)) {
    return false;
  }
  return options.includeOpen
    ? isForecastAttentionReviewOpen(reviewStatus) || isForecastAttentionReviewResolved(reviewStatus)
    : isForecastAttentionReviewResolved(reviewStatus);
}

export function summarizeCalibrationGuardProposalEligibility<T extends CalibrationGuardProposalEligibilityInput>(
  rules: T[],
  options: { includeOpen?: boolean } = {},
): CalibrationGuardProposalEligibilityCounts {
  const reviewCounts = summarizeForecastAttentionReviewStatuses(rules.map((rule) => ({
    reviewStatus: normalizeForecastAttentionReviewStatus(rule.reviewStatus),
  })));
  return {
    candidates: rules.length,
    eligible: rules.filter((rule) => isCalibrationGuardProposalEligible(rule, options)).length,
    skippedOpen: options.includeOpen ? 0 : reviewCounts.open,
    skippedDeferred: reviewCounts.deferred,
    skippedNeedsMoreResolvedForecasts: rules.filter((rule) => !isCalibrationGuardReadyForReview(rule.activationStatus)).length,
  };
}
