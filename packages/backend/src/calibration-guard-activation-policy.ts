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
