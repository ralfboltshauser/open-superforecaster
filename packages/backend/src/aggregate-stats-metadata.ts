export type AggregateStatsSnapshot = {
  meanProbability: number | null;
  medianProbability: number | null;
  componentMinProbability: number | null;
  componentMaxProbability: number | null;
  finalComponentPositionBand: "below_components" | "inside_components" | "above_components" | "missing_components" | "unknown";
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
  const disagreement = readNumber(aggregateStats, "disagreement");
  const aggregationAnchor = readString(aggregateStats, "aggregationAnchor", "aggregation_anchor");
  const adjustmentFromMedian = readNumber(aggregateStats, "adjustmentFromMedian", "adjustment_from_median");
  const attemptCount = readNumber(aggregateStats, "attemptCount", "attempt_count");
  if (
    meanProbability === null &&
    medianProbability === null &&
    componentMinProbability === null &&
    componentMaxProbability === null &&
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
    disagreement,
    disagreementBand: aggregateDisagreementBand(disagreement),
    aggregationAnchor,
    adjustmentFromMedian,
    attemptCount,
  };
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
  const record = asRecord(value);
  const raw = record?.componentProbabilities ?? record?.component_probabilities;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => readNumber(item, "probability"))
    .filter((probability): probability is number => probability !== null);
}

function min(values: number[]) {
  return values.length ? Math.min(...values) : null;
}

function max(values: number[]) {
  return values.length ? Math.max(...values) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
