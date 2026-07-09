export type ThresholdedForecastSnapshot = {
  thresholdDirection: "at_least" | "at_most" | "unknown";
  thresholdSource: "caller" | "question_extracted" | "invalid" | "unknown";
  thresholdCount: number;
  monotonicityRepaired: boolean | null;
  probabilitySpread: number | null;
  attemptCount: number | null;
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
  if (
    thresholdDirection === "unknown" &&
    thresholdSource === "unknown" &&
    thresholdCount === 0 &&
    monotonicityRepaired === null &&
    attemptCount === null
  ) {
    return null;
  }
  return {
    thresholdDirection,
    thresholdSource,
    thresholdCount,
    monotonicityRepaired,
    probabilitySpread: probabilitySpread(probabilityValues),
    attemptCount,
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
