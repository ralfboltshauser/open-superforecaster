import { calibrationModels, type createDb } from "@open-superforecaster/db";
import {
  binaryPlattCalibrationMethodVersion,
  buildBinaryPlattCalibrationCandidate,
  type BinaryCalibrationObservation,
  type BinaryPlattCalibrationCandidate,
  type BinaryPlattCalibrationPolicy,
} from "@open-superforecaster/evals";

type Db = ReturnType<typeof createDb>["db"];

export type BinaryCalibrationCandidateProposalInput = {
  candidateVersion: string;
  createdAt: string;
  observations: readonly BinaryCalibrationObservation[];
  domainFilter?: string | null;
  policy?: Partial<BinaryPlattCalibrationPolicy>;
};

/**
 * Build and, when fitting succeeded, persist an inactive calibration candidate.
 * This service deliberately exposes no activation path and never modifies a
 * forecast aggregate or workflow default.
 */
export async function proposeInactiveBinaryCalibrationCandidate(
  db: Db,
  input: BinaryCalibrationCandidateProposalInput,
) {
  const candidate = buildBinaryPlattCalibrationCandidate(input);
  const values = inactiveCalibrationModelValues(candidate, input.domainFilter ?? null);
  if (!values) {
    return {
      candidate,
      persisted: false as const,
      calibrationModel: null,
      reason: "Candidate did not produce a converged monotonic fit with held-out scores, so no calibration model row was created.",
    };
  }
  const [calibrationModel] = await db
    .insert(calibrationModels)
    .values(values)
    .returning();
  return {
    candidate,
    persisted: true as const,
    calibrationModel,
    reason:
      candidate.status === "ready_for_explicit_promotion_review"
        ? "Held-out gates passed; candidate remains inactive pending an explicit, separately implemented promotion action."
        : "Candidate was retained for audit but remains inactive because held-out gates rejected it.",
  };
}

export function inactiveCalibrationModelValues(
  candidate: BinaryPlattCalibrationCandidate,
  domainFilter: string | null = null,
) {
  if (!candidate.fit?.converged || !candidate.parameters || !candidate.validation) {
    return null;
  }
  const split = candidate.split;
  return {
    forecastType: "binary" as const,
    method: binaryPlattCalibrationMethodVersion,
    trainingWindow: formatTrainingWindow(candidate),
    domainFilter,
    parametersJson: {
      schemaVersion: candidate.schemaVersion,
      methodVersion: candidate.methodVersion,
      candidateId: candidate.candidateId,
      candidateVersion: candidate.candidateVersion,
      createdAt: candidate.createdAt,
      parameters: candidate.parameters,
      policy: candidate.policy,
      applicationContract: candidate.applicationContract,
      activationContract: {
        active: false,
        requiresExplicitPromotion: true,
        automaticActivationSupported: false,
      },
    },
    validationScores: {
      status: candidate.status,
      promotionRecommendation: candidate.promotionRecommendation,
      split: {
        trainingRows: split.training.length,
        validationRows: split.validation.length,
        trainingEventFamilies: split.trainingEventFamilies,
        validationEventFamilies: split.validationEventFamilies,
        embargoedRows: split.embargoed.length,
        trainingForecastFrom: split.trainingForecastFrom,
        trainingForecastThrough: split.trainingForecastThrough,
        trainingOutcomesAvailableThrough: split.trainingOutcomesAvailableThrough,
        validationForecastFrom: split.validationForecastFrom,
        validationForecastThrough: split.validationForecastThrough,
        familyOverlap: split.familyOverlap,
        gates: split.gates,
      },
      fit: candidate.fit,
      heldout: candidate.validation,
    },
    active: false,
  };
}

function formatTrainingWindow(candidate: BinaryPlattCalibrationCandidate) {
  const split = candidate.split;
  return [
    `forecast:${split.trainingForecastFrom ?? "unknown"}..${split.trainingForecastThrough ?? "unknown"}`,
    `labels_available_through:${split.trainingOutcomesAvailableThrough ?? "unknown"}`,
    `validation_from:${split.validationForecastFrom ?? "unknown"}`,
  ].join(";");
}
