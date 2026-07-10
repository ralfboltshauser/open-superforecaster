import {
  calibrationGuardDefaultPlanSkippedReasonNotHoldoutReplay,
  calibrationGuardDefaultPlanSkippedReasonNotPromotedForDefault,
  calibrationGuardRecommendationPromoteForDefault,
  calibrationGuardRecommendationPromoteForHoldout,
} from "./calibration-guard-validation-policy";
import { isProbabilityScoreMetric } from "./forecast-score-policy";

export type PerformanceAttentionKind =
  | "poor_resolved_forecast"
  | "worsening_trend"
  | "calibration_mismatch"
  | "calibration_guard_regression"
  | "baseline_sanity_miss"
  | "binary_confidence_miss"
  | "market_anchor_miss"
  | "resolution_boundary_miss"
  | "uncertainty_range_miss"
  | "component_weighting_miss"
  | "aggregate_quality_miss"
  | "aggregate_quality_rounds_miss"
  | "aggregate_quality_issues_miss"
  | "component_disagreement_miss"
  | "conditional_branch_miss"
  | "thresholded_curve_miss"
  | "numeric_distribution_miss"
  | "date_distribution_miss"
  | "categorical_distribution_miss"
  | "component_envelope_miss"
  | "aggregate_side_flip_miss"
  | "aggregate_panel_confidence_miss"
  | "aggregate_confidence_miss"
  | "median_adjustment_miss"
  | "inside_view_shift_miss"
  | "aggregate_adjustment_miss"
  | "aggregate_direction_miss"
  | "aggregate_attempt_miss"
  | "evidence_coverage_miss"
  | "input_context_miss"
  | "run_metadata_miss";

export const forecastAttentionSeverities = ["high", "medium", "low"] as const;

export type ForecastAttentionSeverity = typeof forecastAttentionSeverities[number];

export type PerformanceAttentionSeverity = Extract<ForecastAttentionSeverity, "high" | "medium">;

export type ForecastAttentionSeverityCounts = {
  high: number;
  medium: number;
  low: number;
};

export const forecastAttentionReviewStatuses = ["open", "reviewed", "deferred"] as const;

export type ForecastAttentionReviewStatus = typeof forecastAttentionReviewStatuses[number];

export const defaultForecastAttentionReviewStatus: ForecastAttentionReviewStatus = "open";

export type ForecastAttentionReviewStatusCounts = {
  items: number;
  open: number;
  deferred: number;
  reviewed: number;
  unresolved: number;
};

export type SupplementalForecastAttentionKind =
  | "candidate_calibration_guard"
  | "calibration_guard_default_candidate"
  | "calibration_guard_holdout_candidate"
  | "calibration_guard_needs_more_evidence"
  | `calibration_guard_default_plan_${string}`;

export function isForecastAttentionReviewStatus(value: string | null | undefined): value is ForecastAttentionReviewStatus {
  return forecastAttentionReviewStatuses.includes(value as ForecastAttentionReviewStatus);
}

export function normalizeForecastAttentionReviewStatus(value: string | null | undefined): ForecastAttentionReviewStatus {
  return isForecastAttentionReviewStatus(value) ? value : defaultForecastAttentionReviewStatus;
}

export function forecastAttentionReviewStatusRank(status: ForecastAttentionReviewStatus) {
  if (status === "open") {
    return 0;
  }
  if (status === "deferred") {
    return 1;
  }
  return 2;
}

export function isForecastAttentionReviewOpen(status: string | null | undefined) {
  return normalizeForecastAttentionReviewStatus(status) === "open";
}

export function isForecastAttentionReviewResolved(status: string | null | undefined) {
  return status === "reviewed";
}

export function isForecastAttentionReviewDeferred(status: string | null | undefined) {
  return normalizeForecastAttentionReviewStatus(status) === "deferred";
}

export function isForecastAttentionReviewUnresolved(status: string | null | undefined) {
  return normalizeForecastAttentionReviewStatus(status) !== "reviewed";
}

export function summarizeForecastAttentionReviewStatuses<T extends { reviewStatus: string | null | undefined }>(
  items: T[],
): ForecastAttentionReviewStatusCounts {
  const open = items.filter((item) => item.reviewStatus === "open").length;
  const deferred = items.filter((item) => item.reviewStatus === "deferred").length;
  return {
    items: items.length,
    open,
    deferred,
    reviewed: items.filter((item) => item.reviewStatus === "reviewed").length,
    unresolved: open + deferred,
  };
}

export function forecastAttentionSeveritySortRank(severity: string | null | undefined) {
  if (severity === "high") {
    return 0;
  }
  if (severity === "medium") {
    return 1;
  }
  if (severity === "low") {
    return 2;
  }
  return 3;
}

export function summarizeForecastAttentionSeverities<T extends { severity: string | null | undefined }>(
  items: T[],
): ForecastAttentionSeverityCounts {
  return {
    high: items.filter((item) => item.severity === "high").length,
    medium: items.filter((item) => item.severity === "medium").length,
    low: items.filter((item) => item.severity === "low").length,
  };
}

export function performanceAttentionSeverityRank(severity: PerformanceAttentionSeverity) {
  return severity === "high" ? 2 : 1;
}

export function attentionKindIdPrefix(kind: PerformanceAttentionKind) {
  return kind.replace(/_/g, "-");
}

export function calibrationValidationAttentionKind(recommendation: string): SupplementalForecastAttentionKind {
  if (recommendation === calibrationGuardRecommendationPromoteForDefault) {
    return "calibration_guard_default_candidate";
  }
  if (recommendation === calibrationGuardRecommendationPromoteForHoldout) {
    return "calibration_guard_holdout_candidate";
  }
  return "calibration_guard_needs_more_evidence";
}

export function recommendCalibrationValidationActions(input: {
  recommendation: string;
  bucketLabel: string;
}) {
  if (input.recommendation === calibrationGuardRecommendationPromoteForDefault) {
    return [`Run forecast:calibration-default-plan, then review this held-out ${input.bucketLabel} validation before enabling the calibration guard as a default.`];
  }
  if (input.recommendation === calibrationGuardRecommendationPromoteForHoldout) {
    return [`Run a held-out resolved batch before enabling this ${input.bucketLabel} calibration guard candidate.`];
  }
  return [`Collect more resolved binary forecasts before acting on this ${input.bucketLabel} calibration guard candidate.`];
}

export function calibrationDefaultPlanSkippedAttentionKind(reason: string): SupplementalForecastAttentionKind {
  return `calibration_guard_default_plan_${reason}`;
}

export function recommendCalibrationDefaultPlanSkippedActions(input: {
  reason: string;
  bucketLabel: string;
}) {
  if (input.reason === calibrationGuardDefaultPlanSkippedReasonNotHoldoutReplay) {
    return [`Run a held-out calibration validation before considering ${input.bucketLabel} as a default calibration guard.`];
  }
  if (input.reason === calibrationGuardDefaultPlanSkippedReasonNotPromotedForDefault) {
    return [`Keep ${input.bucketLabel} out of default calibration guards unless held-out validation improves both Brier score and calibration error.`];
  }
  return [`Review why ${input.bucketLabel} was skipped before changing calibration guard defaults.`];
}

export function recommendCandidateCalibrationGuardActions(input: {
  bucketLabel: string;
  suggestedAdjustment: number | null;
}) {
  const adjustment = input.suggestedAdjustment === null ? "" : ` (${formatSignedNumber(input.suggestedAdjustment)} pts)`;
  return [`Review candidate ${input.bucketLabel} guard${adjustment} before changing live calibration.`];
}

export function recommendPerformanceAttentionActions(input: {
  kind: PerformanceAttentionKind;
  metric: string;
  severity: PerformanceAttentionSeverity;
  forecastType: string | null;
}) {
  const actions = new Set<string>();
  if (input.kind === "poor_resolved_forecast") {
    actions.add("Open the run report and compare the final answer against the written resolution criteria.");
    actions.add("Inspect component disagreement and final calibration notes before changing prompts or defaults.");
  } else if (input.kind === "baseline_sanity_miss") {
    actions.add("Audit why the aggregate moved away from the component base-rate anchor before changing prompts or calibration defaults.");
    actions.add("Compare the component base-rate estimates, inside-view deltas, and final rationale against the resolved outcome.");
  } else if (input.kind === "market_anchor_miss") {
    actions.add("Audit whether the forecast had a valid evidence or resolution-boundary reason to diverge from the structured market-price anchor.");
    actions.add("Compare resolved outcomes for similar market-anchor divergence bands before turning this into a deterministic adjustment.");
  } else if (input.kind === "resolution_boundary_miss") {
    actions.add("Review whether the forecast should have widened uncertainty or changed probability because of resolution-boundary ambiguity.");
    actions.add("Tighten the question template or resolution criteria before using similar cases for calibration changes.");
  } else if (input.kind === "uncertainty_range_miss") {
    actions.add("Review whether component forecasts were overconfident; compare probability ranges against the actual resolved miss.");
    actions.add("Tighten prompts or review rules if narrow ranges repeatedly accompany poor resolved forecasts.");
  } else if (input.kind === "component_weighting_miss") {
    actions.add("Review whether the aggregate downweighted the component that best matched the resolved outcome.");
    actions.add("Compare component audits, aggregation anchor, and final rationale before changing role weights or prompts.");
  } else if (input.kind === "aggregate_quality_miss") {
    actions.add("Review the final quality issues and review rationale before changing prompts or defaults.");
    actions.add("Compare max-iteration cases against approved cases to decide whether the review loop needs another round or sharper rejection criteria.");
  } else if (input.kind === "aggregate_quality_rounds_miss") {
    actions.add("Audit why the aggregate needed many review rounds before finalizing.");
    actions.add("Compare rejected-round feedback against the final rationale before changing prompts or defaults.");
  } else if (input.kind === "aggregate_quality_issues_miss") {
    actions.add("Audit the final review issue list before treating the miss as a pure calibration failure.");
    actions.add("Compare repeated quality issues across resolved misses before changing reviewer thresholds.");
  } else if (input.kind === "binary_confidence_miss") {
    actions.add("Check whether the evidence justified the final probability distance from 50%.");
    actions.add("Compare the final side against base-rate, inside-view, and skeptical component probabilities.");
  } else if (input.kind === "component_disagreement_miss") {
    actions.add("Inspect component forecasts before changing aggregation defaults; identify whether one role captured the resolved signal or all roles missed different parts.");
    actions.add("Compare mean, median, aggregation anchor, and final rationale to see whether disagreement was explained or over-smoothed.");
  } else if (input.kind === "conditional_branch_miss") {
    actions.add("Separate condition resolution from outcome resolution and inspect which branch carried the resolved outcome.");
    actions.add("Compare branch probabilities, effect direction, and component disagreement before changing conditional prompts.");
  } else if (input.kind === "thresholded_curve_miss") {
    actions.add("Review threshold ordering, monotonicity, and curve steepness around the resolved value.");
    actions.add("Compare threshold points against the resolved numeric value before changing extraction or repair rules.");
  } else if (input.kind === "numeric_distribution_miss") {
    actions.add("Inspect numeric units, interval width, median error, and whether components disagreed on scale.");
    actions.add("Compare p10/p50/p90 against the resolved value before changing numeric distribution prompts.");
  } else if (input.kind === "date_distribution_miss") {
    actions.add("Inspect date parsing, interval width, never probability, and component timing disagreement.");
    actions.add("Compare p10/p50/p90 against the resolved date before changing date distribution prompts.");
  } else if (input.kind === "categorical_distribution_miss") {
    actions.add("Check whether the resolved category was absent, open-set, or assigned too little probability.");
    actions.add("Compare category coverage and component top-choice agreement before changing categorical prompts.");
  } else if (input.kind === "component_envelope_miss") {
    actions.add("Audit why the final probability moved outside every component forecast before changing calibration or role-weight defaults.");
    actions.add("Compare the final rationale, calibration guard, and component probabilities to decide whether the out-of-envelope move was justified.");
  } else if (input.kind === "aggregate_side_flip_miss") {
    actions.add("Audit why final aggregation crossed the component panel's mean side of 50%.");
    actions.add("Compare the component probabilities, aggregation anchor, and final rationale before changing aggregation defaults.");
  } else if (input.kind === "aggregate_panel_confidence_miss") {
    actions.add("Audit whether the component panel was collectively too far from 50% for the available evidence.");
    actions.add("Compare component probabilities, base rates, and cited uncertainty before changing confidence defaults.");
  } else if (input.kind === "aggregate_confidence_miss") {
    actions.add("Audit why final aggregation became more confident than the mean component forecast.");
    actions.add("Compare component probabilities, final rationale, and calibration guard before changing aggregation defaults.");
  } else if (input.kind === "median_adjustment_miss") {
    actions.add("Audit why final aggregation moved far away from the component median.");
    actions.add("Compare median, mean, aggregation anchor, and final rationale before changing aggregation defaults.");
  } else if (input.kind === "inside_view_shift_miss") {
    actions.add("Audit whether the inside-view evidence really justified moving far away from component base rates.");
    actions.add("Compare base-rate, inside-view, and final aggregate probabilities before changing prompts or calibration defaults.");
  } else if (input.kind === "aggregate_adjustment_miss") {
    actions.add("Audit why final aggregation moved far away from the mean inside-view estimate.");
    actions.add("Compare component rationales, aggregation anchor, and final probability before changing aggregation defaults.");
  } else if (input.kind === "aggregate_direction_miss") {
    actions.add("Audit whether final aggregation should have reversed or introduced movement beyond the inside-view estimate.");
    actions.add("Compare base-rate, inside-view, and final probability direction before changing aggregation defaults.");
  } else if (input.kind === "aggregate_attempt_miss") {
    actions.add("Audit why the aggregate needed many attempts before finalizing.");
    actions.add("Inspect repair traces, validation failures, and final rationale before changing prompts or defaults.");
  } else if (input.kind === "evidence_coverage_miss") {
    actions.add("Audit cited sources, dated-source coverage, uncertainty notes, and rationale depth before changing model or aggregation defaults.");
    actions.add("Add a benchmark case if sparse evidence repeatedly accompanies poor resolved forecasts in this forecast type.");
  } else if (input.kind === "input_context_miss") {
    actions.add("Tighten the input template before tuning prompts: require resolution criteria, resolution timing, and enough background for this forecast type.");
    actions.add("Compare misses with richer-context cases to separate weak input setup from model reasoning failure.");
  } else if (input.kind === "run_metadata_miss") {
    actions.add("Inspect the run trace for premature completion, tool failures, retries, or unusually long loops before changing forecast prompts.");
    actions.add("Compare duration bands against resolved score groups to decide whether runtime limits or workflow orchestration need adjustment.");
  } else if (input.kind === "worsening_trend") {
    actions.add("Review recent resolved runs in this metric before treating the trend as a workflow regression.");
    actions.add("Compare recent cases against older baseline cases for domain mix or resolution-source drift.");
  } else if (input.kind === "calibration_mismatch") {
    actions.add("Review the affected calibration bucket before changing prompts or defaults.");
    actions.add("Compare mean forecast probability against observed outcome rate for resolved binary aggregates.");
  } else {
    actions.add("Review guarded aggregate forecasts before adding or promoting more default calibration guard rules.");
    actions.add("Compare guarded cases against unguarded resolved cases for domain mix, sample size, and rule-specific failure patterns.");
    actions.add("Defer default guard promotion until the guarded-vs-unguarded Brier delta recovers on later resolved forecasts.");
  }

  if (isProbabilityScoreMetric(input.metric)) {
    actions.add("Check for overconfidence: compare predicted probability, resolved outcome, and calibration bucket.");
  }
  if (input.metric.includes("log")) {
    actions.add("Look for near-zero or near-one probabilities that made the log score fragile.");
  }
  if (input.metric.includes("absolute") || input.forecastType === "numeric" || input.forecastType === "date") {
    actions.add("Inspect units, target date/value parsing, and whether the forecast should have used a quantile distribution.");
  }
  if (input.forecastType === "categorical") {
    actions.add("Check whether the resolved category was present in the allowed option set and assigned non-trivial mass.");
  }
  if (input.forecastType === "thresholded") {
    actions.add("Review threshold ordering and whether the curve was monotonic around the resolved value.");
  }
  if (input.forecastType === "conditional") {
    actions.add("Separate condition resolution from outcome resolution before judging the conditional forecast.");
  }
  if (input.severity === "high") {
    actions.add("Add or update a benchmark case that captures this failure before promoting related workflow changes.");
  }
  return [...actions].slice(0, 5);
}

function formatSignedNumber(value: number) {
  const rounded = String(Math.round(value * 10_000) / 10_000);
  return value >= 0 ? `+${rounded}` : rounded;
}
