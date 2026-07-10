export type ThresholdedForecastSnapshot = {
  thresholdDirection: "at_least" | "at_most" | "unknown";
  thresholdSource: "caller" | "question_extracted" | "invalid" | "unknown";
  thresholdCount: number;
  monotonicityRepaired: boolean | null;
  probabilitySpread: number | null;
  probabilitySpreadBand: "flat" | "moderate" | "steep" | "extreme" | "unknown";
  actualValue: number | null;
  nearestThresholdDistance: number | null;
  resolvedThresholdBand: "below_range" | "near_threshold" | "between_thresholds" | "above_range" | "unknown";
  attemptCount: number | null;
  componentCurveCount: number | null;
  componentProbabilityDisagreement: number | null;
  componentDisagreementBand: "tight" | "moderate" | "wide" | "unknown";
};

export function readThresholdedForecastSnapshot(value: unknown): ThresholdedForecastSnapshot | null {
  const record = asRecord(value);
  const thresholded = asRecord(record?.thresholdedForecast) ?? record;
  if (!thresholded) {
    return null;
  }
  const thresholds = readStringArray(thresholded, "thresholds");
  const probabilities = readRecordArray(thresholded, "probabilities");
  const probabilityValues = probabilities
    .map((item) => readNumber(item, "probability"))
    .filter((probability): probability is number => probability !== null);
  const thresholdDirection = readThresholdDirection(thresholded);
  const thresholdSource = readThresholdSource(thresholded);
  const monotonicityRepaired = readBoolean(thresholded, "monotonicityRepaired", "monotonicity_repaired");
  const actualValue = readNumber(thresholded, "actualValue", "actual_value", "actual", "resolvedNumeric", "resolved_numeric")
    ?? readNumber(record, "actualValue", "actual_value", "actual", "resolvedNumeric", "resolved_numeric");
  const attemptCount = readNumber(thresholded, "attemptCount", "attempt_count");
  const thresholdCount = thresholds.length || probabilities.length;
  const thresholdValues = readThresholdValues({ thresholds, probabilities });
  const nearestThresholdDistance = nearestDistance(actualValue, thresholdValues);
  const componentStats = readComponentCurveStats(thresholded, thresholds);
  const spread = probabilitySpread(probabilityValues);
  if (
    thresholdDirection === "unknown" &&
    thresholdSource === "unknown" &&
    thresholdCount === 0 &&
    monotonicityRepaired === null &&
    attemptCount === null &&
    componentStats.componentCurveCount === null
  ) {
    return null;
  }
  return {
    thresholdDirection,
    thresholdSource,
    thresholdCount,
    monotonicityRepaired,
    probabilitySpread: spread,
    probabilitySpreadBand: probabilitySpreadBand(spread),
    actualValue,
    nearestThresholdDistance,
    resolvedThresholdBand: resolvedThresholdBand({ actualValue, thresholdValues, nearestThresholdDistance }),
    attemptCount,
    ...componentStats,
  };
}

export function resolvedThresholdBand(input: {
  actualValue: number | null;
  thresholdValues: number[];
  nearestThresholdDistance: number | null;
}): ThresholdedForecastSnapshot["resolvedThresholdBand"] {
  if (
    input.actualValue === null ||
    !Number.isFinite(input.actualValue) ||
    input.thresholdValues.length === 0
  ) {
    return "unknown";
  }
  const values = [...input.thresholdValues].sort((left, right) => left - right);
  const min = values[0];
  const max = values.at(-1);
  if (min === undefined || max === undefined) {
    return "unknown";
  }
  if (input.nearestThresholdDistance !== null) {
    const range = max - min;
    if (input.nearestThresholdDistance === 0 || (range > 0 && input.nearestThresholdDistance / range <= 0.05)) {
      return "near_threshold";
    }
  }
  if (input.actualValue < min) {
    return "below_range";
  }
  if (input.actualValue > max) {
    return "above_range";
  }
  return "between_thresholds";
}

function readThresholdDirection(value: unknown): ThresholdedForecastSnapshot["thresholdDirection"] {
  const raw = readString(value, "thresholdDirection", "threshold_direction");
  return raw === "at_least" || raw === "at_most" ? raw : "unknown";
}

function readThresholdSource(value: unknown): ThresholdedForecastSnapshot["thresholdSource"] {
  const raw = readString(value, "thresholdSource", "threshold_source");
  return raw === "caller" || raw === "question_extracted" || raw === "invalid" ? raw : "unknown";
}

function probabilitySpread(values: number[]) {
  if (values.length < 2) {
    return null;
  }
  return Math.round((Math.max(...values) - Math.min(...values)) * 10) / 10;
}

export function probabilitySpreadBand(spread: number | null): ThresholdedForecastSnapshot["probabilitySpreadBand"] {
  if (spread === null || !Number.isFinite(spread)) {
    return "unknown";
  }
  if (spread >= 70) {
    return "extreme";
  }
  if (spread >= 35) {
    return "steep";
  }
  if (spread >= 10) {
    return "moderate";
  }
  return "flat";
}

function readComponentCurveStats(
  value: Record<string, unknown>,
  aggregateThresholds: string[],
): Pick<ThresholdedForecastSnapshot, "componentCurveCount" | "componentProbabilityDisagreement" | "componentDisagreementBand"> {
  const explicitComponentCurveCount = readNumber(value, "componentCurveCount", "component_curve_count");
  const explicitComponentProbabilityDisagreement = readNumber(value, "componentProbabilityDisagreement", "component_probability_disagreement");
  const explicitBand = readComponentDisagreementBand(value);
  const componentCurves = readRecordArray(value, "componentCurves", "component_curves");
  if (componentCurves.length === 0) {
    return {
      componentCurveCount: explicitComponentCurveCount,
      componentProbabilityDisagreement: explicitComponentProbabilityDisagreement,
      componentDisagreementBand: explicitBand ?? componentDisagreementBand(explicitComponentProbabilityDisagreement),
    };
  }
  const thresholds = aggregateThresholds.length ? aggregateThresholds : uniqueStrings(
    componentCurves.flatMap((curve) =>
      readRecordArray(curve, "probabilities").flatMap((item) => {
        const threshold = readString(item, "threshold");
        return threshold ? [threshold] : [];
      }),
    ),
  );
  const perThresholdSpreads = thresholds.flatMap((threshold) => {
    const values = componentCurves.flatMap((curve) => {
      const match = readRecordArray(curve, "probabilities").find((item) => readString(item, "threshold") === threshold);
      const probability = match ? readNumber(match, "probability") : null;
      return probability === null ? [] : [probability];
    });
    const spread = probabilitySpread(values);
    return spread === null ? [] : [spread];
  });
  const disagreement = perThresholdSpreads.length ? Math.max(...perThresholdSpreads) : null;
  return {
    componentCurveCount: componentCurves.length,
    componentProbabilityDisagreement: disagreement,
    componentDisagreementBand: componentDisagreementBand(disagreement),
  };
}

export function componentDisagreementBand(disagreement: number | null): ThresholdedForecastSnapshot["componentDisagreementBand"] {
  if (disagreement === null || !Number.isFinite(disagreement)) {
    return "unknown";
  }
  if (disagreement >= 40) {
    return "wide";
  }
  if (disagreement >= 15) {
    return "moderate";
  }
  return "tight";
}

function readComponentDisagreementBand(value: unknown): ThresholdedForecastSnapshot["componentDisagreementBand"] | null {
  const raw = readString(value, "componentDisagreementBand", "component_disagreement_band");
  return raw === "tight" || raw === "moderate" || raw === "wide" || raw === "unknown" ? raw : null;
}

function readThresholdValues(input: { thresholds: string[]; probabilities: Record<string, unknown>[] }) {
  const rawValues = input.thresholds.length
    ? input.thresholds
    : input.probabilities.flatMap((item) => {
        const threshold = readString(item, "threshold");
        return threshold ? [threshold] : [];
      });
  return uniqueNumbers(rawValues.flatMap((value) => {
    const parsed = parseFirstNumber(value);
    return parsed === null ? [] : [parsed];
  }));
}

function nearestDistance(actualValue: number | null, thresholdValues: number[]) {
  if (actualValue === null || !Number.isFinite(actualValue) || thresholdValues.length === 0) {
    return null;
  }
  return roundMetric(Math.min(...thresholdValues.map((threshold) => Math.abs(actualValue - threshold))));
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function parseFirstNumber(value: string) {
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function readRecordArray(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  for (const key of keys) {
    const raw = record[key];
    if (Array.isArray(raw)) {
      return raw.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
    }
  }
  return [];
}

function readStringArray(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  for (const key of keys) {
    const raw = record[key];
    if (Array.isArray(raw)) {
      return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
  }
  return [];
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

function readBoolean(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "boolean") {
      return raw;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
