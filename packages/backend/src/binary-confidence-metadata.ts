export type BinaryConfidenceSnapshot = {
  probability: number | null;
  forecastSide: "yes" | "no" | "even" | "unknown";
  distanceFromEven: number | null;
  confidenceBand: "near_even" | "leaning" | "likely" | "very_likely" | "extreme" | "unknown";
};

export function buildBinaryConfidenceSnapshot(probability: number | null): BinaryConfidenceSnapshot | null {
  if (probability === null || !Number.isFinite(probability)) {
    return null;
  }
  const normalized = normalizeProbability(probability);
  if (normalized === null) {
    return null;
  }
  const distanceFromEven = Math.abs(normalized - 50);
  return {
    probability: normalized,
    forecastSide: forecastSide(normalized),
    distanceFromEven,
    confidenceBand: binaryConfidenceBand(distanceFromEven),
  };
}

export function readBinaryConfidenceSnapshot(value: unknown): BinaryConfidenceSnapshot | null {
  const record = asRecord(value);
  const confidence = asRecord(record?.binaryConfidence) ?? record;
  if (!confidence) {
    return null;
  }
  const probability =
    readNumber(confidence, "probability", "probability_pct", "probabilityPct") ??
    readNumber(record, "probability", "probability_pct", "probabilityPct");
  const derived = buildBinaryConfidenceSnapshot(probability);
  if (!derived) {
    return null;
  }
  return {
    probability: derived.probability,
    forecastSide: readForecastSide(confidence) ?? derived.forecastSide,
    distanceFromEven: readNumber(confidence, "distanceFromEven", "distance_from_even") ?? derived.distanceFromEven,
    confidenceBand: readConfidenceBand(confidence) ?? derived.confidenceBand,
  };
}

export function binaryConfidenceBand(distanceFromEven: number | null): BinaryConfidenceSnapshot["confidenceBand"] {
  if (distanceFromEven === null || !Number.isFinite(distanceFromEven)) {
    return "unknown";
  }
  if (distanceFromEven >= 45) {
    return "extreme";
  }
  if (distanceFromEven >= 35) {
    return "very_likely";
  }
  if (distanceFromEven >= 20) {
    return "likely";
  }
  if (distanceFromEven >= 5) {
    return "leaning";
  }
  return "near_even";
}

function forecastSide(probability: number): BinaryConfidenceSnapshot["forecastSide"] {
  if (probability > 50) {
    return "yes";
  }
  if (probability < 50) {
    return "no";
  }
  return "even";
}

function normalizeProbability(probability: number) {
  const percent = probability >= 0 && probability <= 1 ? probability * 100 : probability;
  if (percent < 0 || percent > 100) {
    return null;
  }
  return Math.round(percent * 100) / 100;
}

function readConfidenceBand(value: unknown): BinaryConfidenceSnapshot["confidenceBand"] | null {
  const band = readString(value, "confidenceBand", "confidence_band");
  return band === "near_even" || band === "leaning" || band === "likely" || band === "very_likely" || band === "extreme" || band === "unknown"
    ? band
    : null;
}

function readForecastSide(value: unknown): BinaryConfidenceSnapshot["forecastSide"] | null {
  const side = readString(value, "forecastSide", "forecast_side");
  return side === "yes" || side === "no" || side === "even" || side === "unknown" ? side : null;
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
