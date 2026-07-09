export type ThresholdedForecastSnapshot = {
  thresholdDirection: "at_least" | "at_most" | "unknown";
  thresholdSource: "caller" | "question_extracted" | "invalid" | "unknown";
  thresholdCount: number;
  monotonicityRepaired: boolean | null;
  probabilitySpread: number | null;
  probabilitySpreadBand: "flat" | "moderate" | "steep" | "extreme" | "unknown";
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
  const attemptCount = readNumber(thresholded, "attemptCount", "attempt_count");
  const thresholdCount = thresholds.length || probabilities.length;
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
    attemptCount,
    ...componentStats,
  };
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

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
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
