export type AggregateStatsSnapshot = {
  meanProbability: number | null;
  medianProbability: number | null;
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
  const disagreement = readNumber(aggregateStats, "disagreement");
  const aggregationAnchor = readString(aggregateStats, "aggregationAnchor", "aggregation_anchor");
  const adjustmentFromMedian = readNumber(aggregateStats, "adjustmentFromMedian", "adjustment_from_median");
  const attemptCount = readNumber(aggregateStats, "attemptCount", "attempt_count");
  if (
    meanProbability === null &&
    medianProbability === null &&
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
    disagreement,
    disagreementBand: aggregateDisagreementBand(disagreement),
    aggregationAnchor,
    adjustmentFromMedian,
    attemptCount,
  };
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
