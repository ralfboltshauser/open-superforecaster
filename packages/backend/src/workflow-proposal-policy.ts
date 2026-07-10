export const workflowChangeProposalStatuses = ["candidate", "accepted", "rejected", "implemented"] as const;

export type WorkflowChangeProposalStatus = typeof workflowChangeProposalStatuses[number];

export const workflowChangeProposalImplementationStatuses = ["not_started", "planned", "in_progress", "validated"] as const;

export type WorkflowChangeProposalImplementationStatus = typeof workflowChangeProposalImplementationStatuses[number];

export const workflowProposalValidationReadinessBlockerIds = [
  "validation_result_incomplete",
  "validation_gate_not_passing",
  "insufficient_validation_case_coverage",
  "validation_recommendation_not_candidate_better",
  "insufficient_primary_paired_cases",
  "insufficient_primary_paired_holdout_cases",
] as const;

export type WorkflowProposalValidationReadinessBlockerId =
  | typeof workflowProposalValidationReadinessBlockerIds[number]
  | string;

export const [
  blockerValidationResultIncomplete,
  blockerValidationGateNotPassing,
  blockerInsufficientValidationCaseCoverage,
  blockerValidationRecommendationNotCandidateBetter,
  blockerInsufficientPrimaryPairedCases,
  blockerInsufficientPrimaryPairedHoldoutCases,
] = workflowProposalValidationReadinessBlockerIds;
