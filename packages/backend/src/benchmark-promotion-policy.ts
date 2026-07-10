export const benchmarkPromotionGateStatuses = ["review_for_promotion", "needs_more_evidence"] as const;

export type BenchmarkPromotionGateStatus = typeof benchmarkPromotionGateStatuses[number];

export const benchmarkPromotionGateStatusReview: BenchmarkPromotionGateStatus = "review_for_promotion";
export const benchmarkPromotionGateStatusNeedsMoreEvidence: BenchmarkPromotionGateStatus = "needs_more_evidence";

export const benchmarkPromotionGateBlockerIds = [
  "benchmark_still_running",
  "too_few_cases_for_promotion",
  "missing_trace_bundles",
  "failed_or_review_cases_present",
  "missing_comparison_report",
  "missing_baseline_sanity",
  "unexplained_component_disagreement",
  "large_probability_misses",
  "worse_than_baseline_cases",
  "insufficient_holdout_evidence",
  "source_cutoff_leakage",
  "human_forecast_leakage",
  "source_concentration",
  "low_quality_sources",
  "weak_trace_completeness",
  "schema_or_scoring_failures",
  "missing_aggregate_rationale",
] as const;

export type BenchmarkPromotionGateBlockerId = typeof benchmarkPromotionGateBlockerIds[number] | `comparison_${string}`;

export const [
  blockerBenchmarkStillRunning,
  blockerTooFewCasesForPromotion,
  blockerMissingTraceBundles,
  blockerFailedOrReviewCasesPresent,
  blockerMissingComparisonReport,
  blockerMissingBaselineSanity,
  blockerUnexplainedComponentDisagreement,
  blockerLargeProbabilityMisses,
  blockerWorseThanBaselineCases,
  blockerInsufficientHoldoutEvidence,
  blockerSourceCutoffLeakage,
  blockerHumanForecastLeakage,
  blockerSourceConcentration,
  blockerLowQualitySources,
  blockerWeakTraceCompleteness,
  blockerSchemaOrScoringFailures,
  blockerMissingAggregateRationale,
] = benchmarkPromotionGateBlockerIds;

export const benchmarkPromotionSourceRiskBlockerIds = [
  blockerSourceCutoffLeakage,
  blockerHumanForecastLeakage,
  blockerSourceConcentration,
  blockerLowQualitySources,
] as const;

export const benchmarkHoldoutSplitIds = ["holdout", "test", "validation", "eval", "evaluation"] as const;

export const minimumPromotionResultCases = 10;
export const minimumPromotionPairedCases = 10;
export const minimumPromotionHoldoutCases = 10;

export function benchmarkComparisonStatusBlocker(status: string): BenchmarkPromotionGateBlockerId {
  return `comparison_${status}`;
}
