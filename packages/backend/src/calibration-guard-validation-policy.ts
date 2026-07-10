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
