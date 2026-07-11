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
  "insufficient_statistical_promotion_evidence",
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
  blockerInsufficientStatisticalPromotionEvidence,
] = benchmarkPromotionGateBlockerIds;

export const benchmarkPromotionSourceRiskBlockerIds = [
  blockerSourceCutoffLeakage,
  blockerHumanForecastLeakage,
  blockerSourceConcentration,
  blockerLowQualitySources,
] as const;

export const benchmarkHoldoutSplitIds = ["holdout", "test", "validation", "eval", "evaluation"] as const;

export const benchmarkEvidenceTierIds = [
  "smoke",
  "pilot",
  "large_effect",
  "statistical_promotion",
  "small_effect",
] as const;

export type BenchmarkEvidenceTierId = typeof benchmarkEvidenceTierIds[number];

export type BenchmarkEvidenceTierDefinition = {
  id: BenchmarkEvidenceTierId;
  minimumResultCases: number;
  minimumPairedCases: number;
  minimumHoldoutCases: number;
  minimumIndependentEventFamilies: number | null;
  minimumEventFamilyMetadataCoverage: number;
  statisticallyPromotable: boolean;
  intendedUse: string;
  approximateDetectableBrierEffect: number | null;
};

/**
 * Count thresholds are deliberately conservative planning tiers, not a power
 * calculation. A real experiment must estimate paired variance and cluster
 * correlation, preregister its effect size, and use chronological/prospective
 * evidence. In particular, the historical 10-case gate is smoke-only.
 */
export const benchmarkEvidenceTiers: readonly BenchmarkEvidenceTierDefinition[] = [
  {
    id: "smoke",
    minimumResultCases: 10,
    minimumPairedCases: 10,
    minimumHoldoutCases: 10,
    minimumIndependentEventFamilies: null,
    minimumEventFamilyMetadataCoverage: 0,
    statisticallyPromotable: false,
    intendedUse: "Plumbing, schema, trace, and gross-regression checks only; never a quality promotion claim.",
    approximateDetectableBrierEffect: null,
  },
  {
    id: "pilot",
    minimumResultCases: 60,
    minimumPairedCases: 60,
    minimumHoldoutCases: 30,
    minimumIndependentEventFamilies: null,
    minimumEventFamilyMetadataCoverage: 0,
    statisticallyPromotable: false,
    intendedUse: "Estimate paired-score variance and find large implementation failures.",
    approximateDetectableBrierEffect: null,
  },
  {
    id: "large_effect",
    minimumResultCases: 200,
    minimumPairedCases: 200,
    minimumHoldoutCases: 100,
    minimumIndependentEventFamilies: 100,
    minimumEventFamilyMetadataCoverage: 0.9,
    statisticallyPromotable: false,
    intendedUse: "Evidence for large effects; still insufficient for changing the default forecaster.",
    approximateDetectableBrierEffect: 0.02,
  },
  {
    id: "statistical_promotion",
    minimumResultCases: 500,
    minimumPairedCases: 500,
    minimumHoldoutCases: 250,
    minimumIndependentEventFamilies: 200,
    minimumEventFamilyMetadataCoverage: 0.95,
    statisticallyPromotable: true,
    intendedUse: "Candidate default promotion for roughly 0.01 Brier effects, subject to clustered confidence intervals and prospective confirmation.",
    approximateDetectableBrierEffect: 0.01,
  },
  {
    id: "small_effect",
    minimumResultCases: 1_500,
    minimumPairedCases: 1_500,
    minimumHoldoutCases: 750,
    minimumIndependentEventFamilies: 500,
    minimumEventFamilyMetadataCoverage: 0.95,
    statisticallyPromotable: true,
    intendedUse: "Small-effect evaluation; final sample size still depends on observed paired and intracluster variance.",
    approximateDetectableBrierEffect: 0.004,
  },
];

export const benchmarkSmokeEvidenceTier = benchmarkEvidenceTiers[0]!;
export const benchmarkStatisticalPromotionEvidenceTier = benchmarkEvidenceTiers[3]!;

// Compatibility aliases. These values are smoke thresholds, despite their
// historical names; use benchmarkStatisticalPromotionEvidenceTier for default
// promotion decisions.
export const minimumPromotionResultCases = benchmarkSmokeEvidenceTier.minimumResultCases;
export const minimumPromotionPairedCases = benchmarkSmokeEvidenceTier.minimumPairedCases;
export const minimumPromotionHoldoutCases = benchmarkSmokeEvidenceTier.minimumHoldoutCases;

export type BenchmarkEvidenceCounts = {
  resultCount: number;
  pairedCaseCount: number;
  holdoutCaseCount: number;
  independentEventFamilyCount: number | null;
  eventFamilyMetadataCoverage: number | null;
};

export function summarizeBenchmarkEvidenceTier(input: BenchmarkEvidenceCounts) {
  const achieved = benchmarkEvidenceTiers.filter((tier) => benchmarkEvidenceTierSatisfied(tier, input)).at(-1)
    ?? null;
  const achievedIndex = achieved ? benchmarkEvidenceTiers.findIndex((tier) => tier.id === achieved.id) : -1;
  const nextTier = benchmarkEvidenceTiers[achievedIndex + 1] ?? null;
  const statisticalPromotionReady = benchmarkEvidenceTierSatisfied(benchmarkStatisticalPromotionEvidenceTier, input);
  return {
    achievedTier: achieved?.id ?? "below_smoke",
    achievedTierMetadata: achieved,
    nextTier,
    counts: input,
    smokeOnly: !statisticalPromotionReady,
    statisticalPromotionReady,
    statisticalPromotionThresholds: benchmarkStatisticalPromotionEvidenceTier,
    note: statisticalPromotionReady
      ? "Count and event-family metadata floors for statistical promotion are met; confidence intervals, chronology, prospective evidence, trust, and cost gates still apply."
      : "Any passing 10-case gate is smoke evidence only. Do not use it to claim forecast-quality improvement or change the default forecaster.",
  };
}

export function benchmarkEvidenceTierSatisfied(
  tier: BenchmarkEvidenceTierDefinition,
  input: BenchmarkEvidenceCounts,
) {
  if (
    input.resultCount < tier.minimumResultCases ||
    input.pairedCaseCount < tier.minimumPairedCases ||
    input.holdoutCaseCount < tier.minimumHoldoutCases
  ) {
    return false;
  }
  if (tier.minimumIndependentEventFamilies !== null) {
    if (
      input.independentEventFamilyCount === null ||
      input.independentEventFamilyCount < tier.minimumIndependentEventFamilies
    ) {
      return false;
    }
    if (
      input.eventFamilyMetadataCoverage === null ||
      input.eventFamilyMetadataCoverage < tier.minimumEventFamilyMetadataCoverage
    ) {
      return false;
    }
  }
  return true;
}

export function benchmarkComparisonStatusBlocker(status: string): BenchmarkPromotionGateBlockerId {
  return `comparison_${status}`;
}
