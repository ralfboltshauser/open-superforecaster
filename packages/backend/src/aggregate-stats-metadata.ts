export type AggregateStatsSnapshot = {
  meanProbability: number | null;
  medianProbability: number | null;
  componentMinProbability: number | null;
  componentMaxProbability: number | null;
  finalComponentPositionBand: "below_components" | "inside_components" | "above_components" | "missing_components" | "unknown";
  meanBaseRateProbability: number | null;
  meanInsideViewProbability: number | null;
  insideViewDelta: number | null;
  insideViewDeltaBand: "near_base_rate" | "moderate_shift" | "large_shift" | "missing_components" | "unknown";
  finalInsideViewDelta: number | null;
  finalInsideViewDeltaBand: "near_inside_view" | "moderate_adjustment" | "large_adjustment" | "missing_components" | "unknown";
  finalAdjustmentDirection: "near_base_rate" | "keeps_inside_view" | "amplifies_inside_view" | "dampens_inside_view" | "reverses_inside_view" | "final_only_shift" | "missing_components" | "unknown";
  disagreement: number | null;
  disagreementBand: "low" | "moderate" | "high" | "extreme" | "unknown";
  aggregationAnchor: string | null;
  adjustmentFromMedian: number | null;
  attemptCount: number | null;
};

export function readAggregateStatsSnapshot(value: unknown): AggregateStatsSnapshot | null {
  const record = asRecord(value);
  const aggregateStats = asRecord(record?.aggregateStats) ?? record;
  if (!aggregateStats) {
    return null;
  }
  const meanProbability = readNumber(aggregateStats, "meanProbability", "mean_probability");
  const medianProbability = readNumber(aggregateStats, "medianProbability", "median_probability");
  const finalProbability = readNumber(aggregateStats, "probability", "finalProbability", "final_probability");
  const componentProbabilities = readComponentProbabilities(aggregateStats);
  const componentMinProbability = readNumber(aggregateStats, "componentMinProbability", "component_min_probability") ?? min(componentProbabilities);
  const componentMaxProbability = readNumber(aggregateStats, "componentMaxProbability", "component_max_probability") ?? max(componentProbabilities);
  const componentBaseRates = readComponentNumberArray(aggregateStats, "baseRateProbability", "base_rate_probability");
  const componentInsideViews = readComponentNumberArray(aggregateStats, "insideViewProbability", "inside_view_probability");
  const meanBaseRateProbability = readNumber(aggregateStats, "meanBaseRateProbability", "mean_base_rate_probability") ?? roundProbability(mean(componentBaseRates));
  const meanInsideViewProbability = readNumber(aggregateStats, "meanInsideViewProbability", "mean_inside_view_probability") ?? roundProbability(mean(componentInsideViews));
  const insideViewDelta = readNumber(aggregateStats, "insideViewDelta", "inside_view_delta") ?? delta(meanInsideViewProbability, meanBaseRateProbability);
  const explicitInsideViewDeltaBand = readInsideViewDeltaBand(aggregateStats);
  const finalInsideViewDelta = readNumber(aggregateStats, "finalInsideViewDelta", "final_inside_view_delta") ?? delta(finalProbability, meanInsideViewProbability);
  const explicitFinalInsideViewDeltaBand = readFinalInsideViewDeltaBand(aggregateStats);
  const explicitFinalAdjustmentDirection = readFinalAdjustmentDirection(aggregateStats);
  const disagreement = readNumber(aggregateStats, "disagreement");
  const aggregationAnchor = readString(aggregateStats, "aggregationAnchor", "aggregation_anchor");
  const adjustmentFromMedian = readNumber(aggregateStats, "adjustmentFromMedian", "adjustment_from_median");
  const attemptCount = readNumber(aggregateStats, "attemptCount", "attempt_count");
  if (
    meanProbability === null &&
    medianProbability === null &&
    componentMinProbability === null &&
    componentMaxProbability === null &&
    meanBaseRateProbability === null &&
    meanInsideViewProbability === null &&
    insideViewDelta === null &&
    finalInsideViewDelta === null &&
    disagreement === null &&
    aggregationAnchor === null &&
    adjustmentFromMedian === null &&
    attemptCount === null
  ) {
    return null;
  }
  return {
    meanProbability,
    medianProbability,
    componentMinProbability,
    componentMaxProbability,
    finalComponentPositionBand: finalComponentPositionBand({
      finalProbability,
      componentMinProbability,
      componentMaxProbability,
    }),
    meanBaseRateProbability,
    meanInsideViewProbability,
    insideViewDelta,
    insideViewDeltaBand: explicitInsideViewDeltaBand ?? insideViewDeltaBand(
      insideViewDelta,
      componentBaseRates.length || (meanBaseRateProbability === null ? 0 : 1),
      componentInsideViews.length || (meanInsideViewProbability === null ? 0 : 1),
    ),
    finalInsideViewDelta,
    finalInsideViewDeltaBand: explicitFinalInsideViewDeltaBand ?? finalInsideViewDeltaBand(
      finalInsideViewDelta,
      finalProbability === null && finalInsideViewDelta === null ? 0 : 1,
      componentInsideViews.length || (meanInsideViewProbability === null ? 0 : 1),
    ),
    finalAdjustmentDirection: explicitFinalAdjustmentDirection ?? finalAdjustmentDirection(insideViewDelta, finalInsideViewDelta),
    disagreement,
    disagreementBand: aggregateDisagreementBand(disagreement),
    aggregationAnchor,
    adjustmentFromMedian,
    attemptCount,
  };
}

export function insideViewDeltaBand(
  insideViewDelta: number | null,
  baseRateCount: number,
  insideViewCount: number,
): AggregateStatsSnapshot["insideViewDeltaBand"] {
  if (baseRateCount === 0 || insideViewCount === 0) {
    return "missing_components";
  }
  if (insideViewDelta === null || !Number.isFinite(insideViewDelta)) {
    return "unknown";
  }
  const absoluteDelta = Math.abs(insideViewDelta);
  if (absoluteDelta >= 25) {
    return "large_shift";
  }
  if (absoluteDelta >= 10) {
    return "moderate_shift";
  }
  return "near_base_rate";
}

export function finalInsideViewDeltaBand(
  finalInsideViewDelta: number | null,
  finalProbabilityCount: number,
  insideViewCount: number,
): AggregateStatsSnapshot["finalInsideViewDeltaBand"] {
  if (finalProbabilityCount === 0 || insideViewCount === 0) {
    return "missing_components";
  }
  if (finalInsideViewDelta === null || !Number.isFinite(finalInsideViewDelta)) {
    return "unknown";
  }
  const absoluteDelta = Math.abs(finalInsideViewDelta);
  if (absoluteDelta >= 20) {
    return "large_adjustment";
  }
  if (absoluteDelta >= 8) {
    return "moderate_adjustment";
  }
  return "near_inside_view";
}

export function finalAdjustmentDirection(
  insideViewDelta: number | null,
  finalInsideViewDelta: number | null,
): AggregateStatsSnapshot["finalAdjustmentDirection"] {
  if (insideViewDelta === null || finalInsideViewDelta === null) {
    return "missing_components";
  }
  if (!Number.isFinite(insideViewDelta) || !Number.isFinite(finalInsideViewDelta)) {
    return "unknown";
  }
  const materialThreshold = 3;
  const insideMagnitude = Math.abs(insideViewDelta);
  const adjustmentMagnitude = Math.abs(finalInsideViewDelta);
  if (insideMagnitude < materialThreshold && adjustmentMagnitude < materialThreshold) {
    return "near_base_rate";
  }
  if (insideMagnitude < materialThreshold) {
    return "final_only_shift";
  }
  if (adjustmentMagnitude < materialThreshold) {
    return "keeps_inside_view";
  }
  const insideDirection = Math.sign(insideViewDelta);
  const finalBaseRateDelta = insideViewDelta + finalInsideViewDelta;
  if (Math.sign(finalInsideViewDelta) === insideDirection) {
    return "amplifies_inside_view";
  }
  if (Math.abs(finalBaseRateDelta) >= materialThreshold && Math.sign(finalBaseRateDelta) !== insideDirection) {
    return "reverses_inside_view";
  }
  return "dampens_inside_view";
}

export function finalComponentPositionBand(input: {
  finalProbability: number | null;
  componentMinProbability: number | null;
  componentMaxProbability: number | null;
}): AggregateStatsSnapshot["finalComponentPositionBand"] {
  if (input.componentMinProbability === null || input.componentMaxProbability === null) {
    return "missing_components";
  }
  if (input.finalProbability === null || !Number.isFinite(input.finalProbability)) {
    return "unknown";
  }
  if (input.finalProbability < input.componentMinProbability) {
    return "below_components";
  }
  if (input.finalProbability > input.componentMaxProbability) {
    return "above_components";
  }
  return "inside_components";
}

export function aggregateDisagreementBand(disagreement: number | null): AggregateStatsSnapshot["disagreementBand"] {
  if (disagreement === null || !Number.isFinite(disagreement)) {
    return "unknown";
  }
  if (disagreement >= 30) {
    return "extreme";
  }
  if (disagreement >= 15) {
    return "high";
  }
  if (disagreement >= 5) {
    return "moderate";
  }
  return "low";
}

function readString(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

function readInsideViewDeltaBand(value: unknown): AggregateStatsSnapshot["insideViewDeltaBand"] | null {
  const band = readString(value, "insideViewDeltaBand", "inside_view_delta_band");
  if (
    band === "near_base_rate" ||
    band === "moderate_shift" ||
    band === "large_shift" ||
    band === "missing_components" ||
    band === "unknown"
  ) {
    return band;
  }
  return null;
}

function readFinalInsideViewDeltaBand(value: unknown): AggregateStatsSnapshot["finalInsideViewDeltaBand"] | null {
  const band = readString(value, "finalInsideViewDeltaBand", "final_inside_view_delta_band");
  if (
    band === "near_inside_view" ||
    band === "moderate_adjustment" ||
    band === "large_adjustment" ||
    band === "missing_components" ||
    band === "unknown"
  ) {
    return band;
  }
  return null;
}

function readFinalAdjustmentDirection(value: unknown): AggregateStatsSnapshot["finalAdjustmentDirection"] | null {
  const direction = readString(value, "finalAdjustmentDirection", "final_adjustment_direction");
  if (
    direction === "near_base_rate" ||
    direction === "keeps_inside_view" ||
    direction === "amplifies_inside_view" ||
    direction === "dampens_inside_view" ||
    direction === "reverses_inside_view" ||
    direction === "final_only_shift" ||
    direction === "missing_components" ||
    direction === "unknown"
  ) {
    return direction;
  }
  return null;
}

function readNumber(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return null;
}

function readComponentProbabilities(value: unknown) {
  return readComponentNumberArray(value, "probability");
}

function readComponentNumberArray(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  const raw = record?.componentProbabilities ?? record?.component_probabilities;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => readNumber(item, ...keys))
    .filter((probability): probability is number => probability !== null);
}

function min(values: number[]) {
  return values.length ? Math.min(...values) : null;
}

function max(values: number[]) {
  return values.length ? Math.max(...values) : null;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function delta(left: number | null, right: number | null) {
  if (left === null || right === null) {
    return null;
  }
  return roundProbability(left - right);
}

function roundProbability(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
