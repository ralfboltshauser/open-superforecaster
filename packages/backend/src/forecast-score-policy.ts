const primaryMetricPreference = [
  "brier",
  "categorical_brier",
  "thresholded_brier",
  "conditional_brier",
  "absolute_error",
  "absolute_days_error",
  "absolute_percentage_error",
] as const;

export function isProbabilityScoreMetric(metric: string) {
  return metric.includes("brier") || metric.includes("log") || metric === "condition_brier" || metric === "condition_log";
}

export function poorScoreThreshold(metric: string) {
  if (metric === "brier" || metric === "categorical_brier" || metric === "thresholded_brier" || metric === "conditional_brier") {
    return 0.25;
  }
  if (metric === "log" || metric === "categorical_log" || metric === "thresholded_log" || metric === "conditional_log") {
    return 0.69;
  }
  if (metric === "absolute_percentage_error") {
    return 0.25;
  }
  if (metric === "absolute_days_error") {
    return 30;
  }
  return null;
}

export function trendDeltaHighThreshold(metric: string) {
  const poorThreshold = poorScoreThreshold(metric);
  return poorThreshold ? poorThreshold / 2 : 0.1;
}

export function selectPrimaryScoreMetric(meanScores: Record<string, number>) {
  return primaryMetricPreference.find((metric) => metric in meanScores) ?? Object.keys(meanScores).sort()[0] ?? null;
}
