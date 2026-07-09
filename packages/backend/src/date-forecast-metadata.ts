export type DateForecastSnapshot = {
  p10: string | null;
  p50: string | null;
  p90: string | null;
  intervalDays: number | null;
  intervalBand: "narrow" | "moderate" | "wide" | "unknown";
  neverProbability: number | null;
  neverProbabilityBand: "low" | "moderate" | "high" | "unknown";
  attemptCount: number | null;
};

export function readDateForecastSnapshot(value: unknown): DateForecastSnapshot | null {
  const record = asRecord(value);
  const dateForecast = asRecord(record?.dateForecast) ?? record;
  if (!dateForecast) {
    return null;
  }
  const distribution = asRecord(dateForecast.dateDistribution) ?? asRecord(dateForecast.distribution);
  const p10 = readString(distribution, "p10") ?? readString(dateForecast, "p10");
  const p50 = readString(distribution, "p50", "median") ?? readString(dateForecast, "targetDate", "target_date", "p50");
  const p90 = readString(distribution, "p90") ?? readString(dateForecast, "p90");
  const neverProbability = readNumber(dateForecast, "neverProbability", "never_probability");
  const attemptCount = readNumber(dateForecast, "attemptCount", "attempt_count");
  if (p10 === null && p50 === null && p90 === null && neverProbability === null && attemptCount === null) {
    return null;
  }
  const intervalDays = dateIntervalDays(p10, p90);
  return {
    p10,
    p50,
    p90,
    intervalDays,
    intervalBand: dateIntervalBand(intervalDays),
    neverProbability,
    neverProbabilityBand: neverBand(neverProbability),
    attemptCount,
  };
}

export function dateIntervalBand(days: number | null): DateForecastSnapshot["intervalBand"] {
  if (days === null || !Number.isFinite(days)) {
    return "unknown";
  }
  if (days >= 180) {
    return "wide";
  }
  if (days >= 45) {
    return "moderate";
  }
  return "narrow";
}

function neverBand(probability: number | null): DateForecastSnapshot["neverProbabilityBand"] {
  if (probability === null || !Number.isFinite(probability)) {
    return "unknown";
  }
  if (probability >= 30) {
    return "high";
  }
  if (probability >= 5) {
    return "moderate";
  }
  return "low";
}

function dateIntervalDays(p10: string | null, p90: string | null) {
  if (!p10 || !p90) {
    return null;
  }
  const start = Date.parse(p10);
  const end = Date.parse(p90);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return Math.round(Math.abs(end - start) / 86_400_000);
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
