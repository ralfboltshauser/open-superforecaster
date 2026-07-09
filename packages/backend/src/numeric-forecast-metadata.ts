export type NumericForecastSnapshot = {
  unit: string | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  intervalWidth: number | null;
  intervalWidthBand: "narrow" | "moderate" | "wide" | "unknown";
  attemptCount: number | null;
};

export function readNumericForecastSnapshot(value: unknown): NumericForecastSnapshot | null {
  const record = asRecord(value);
  const numeric = asRecord(record?.numericForecast) ?? record;
  if (!numeric) {
    return null;
  }
  const distribution = asRecord(numeric.distribution);
  const p10 = readNumber(distribution, "p10", "low") ?? readNumber(numeric, "p10");
  const p50 = readNumber(distribution, "p50", "median") ?? readNumber(numeric, "value", "p50");
  const p90 = readNumber(distribution, "p90", "high") ?? readNumber(numeric, "p90");
  const unit = readString(numeric, "unit") ?? readString(distribution, "unit");
  const attemptCount = readNumber(numeric, "attemptCount", "attempt_count");
  if (unit === null && p10 === null && p50 === null && p90 === null && attemptCount === null) {
    return null;
  }
  const intervalWidth = p10 === null || p90 === null ? null : roundMetric(Math.abs(p90 - p10));
  return {
    unit,
    p10,
    p50,
    p90,
    intervalWidth,
    intervalWidthBand: numericIntervalWidthBand(intervalWidth, p50),
    attemptCount,
  };
}

export function numericIntervalWidthBand(width: number | null, center: number | null): NumericForecastSnapshot["intervalWidthBand"] {
  if (width === null || !Number.isFinite(width)) {
    return "unknown";
  }
  const scale = center === null || center === 0 ? Math.abs(width) : Math.abs(width / center);
  if (scale >= 0.75) {
    return "wide";
  }
  if (scale >= 0.25) {
    return "moderate";
  }
  return "narrow";
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

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
