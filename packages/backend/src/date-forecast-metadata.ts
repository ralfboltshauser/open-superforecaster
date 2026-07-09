export type DateForecastSnapshot = {
  p10: string | null;
  p50: string | null;
  p90: string | null;
  intervalDays: number | null;
  intervalBand: "narrow" | "moderate" | "wide" | "unknown";
  actualDate: string | null;
  p50ErrorDays: number | null;
  absoluteP50ErrorDays: number | null;
  p50ErrorBand: "near" | "moderate" | "large" | "extreme" | "unknown";
  resolvedPositionBand: "before_p10" | "p10_to_p50" | "p50_to_p90" | "after_p90" | "unknown";
  neverProbability: number | null;
  neverProbabilityBand: "low" | "moderate" | "high" | "unknown";
  attemptCount: number | null;
  componentDateCount: number | null;
  p50DisagreementDays: number | null;
  p50DisagreementBand: "tight" | "moderate" | "wide" | "unknown";
  neverProbabilityDisagreement: number | null;
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
  const actualDate = readString(dateForecast, "actualDate", "actual_date", "resolvedDate", "resolved_date", "date")
    ?? readString(record, "actualDate", "actual_date", "resolvedDate", "resolved_date", "date");
  const neverProbability = readNumber(dateForecast, "neverProbability", "never_probability");
  const attemptCount = readNumber(dateForecast, "attemptCount", "attempt_count");
  const componentStats = readComponentDateStats(dateForecast);
  if (
    p10 === null &&
    p50 === null &&
    p90 === null &&
    neverProbability === null &&
    attemptCount === null &&
    componentStats.componentDateCount === null
  ) {
    return null;
  }
  const intervalDays = dateIntervalDays(p10, p90);
  const p50ErrorDays = dateP50ErrorDays({ actualDate, p50 });
  const absoluteP50ErrorDays = p50ErrorDays === null ? null : Math.abs(p50ErrorDays);
  return {
    p10,
    p50,
    p90,
    intervalDays,
    intervalBand: dateIntervalBand(intervalDays),
    actualDate,
    p50ErrorDays,
    absoluteP50ErrorDays,
    p50ErrorBand: dateP50ErrorBand(absoluteP50ErrorDays, intervalDays),
    resolvedPositionBand: dateResolvedPositionBand({ actualDate, p10, p50, p90 }),
    neverProbability,
    neverProbabilityBand: neverBand(neverProbability),
    attemptCount,
    ...componentStats,
  };
}

export function dateP50ErrorDays(input: {
  actualDate: string | null;
  p50: string | null;
}) {
  const actual = dateTime(input.actualDate);
  const p50 = dateTime(input.p50);
  if (actual === null || p50 === null) {
    return null;
  }
  return Math.round((p50 - actual) / 86_400_000);
}

export function dateP50ErrorBand(
  absoluteErrorDays: number | null,
  intervalDays: number | null,
): DateForecastSnapshot["p50ErrorBand"] {
  if (absoluteErrorDays === null || !Number.isFinite(absoluteErrorDays)) {
    return "unknown";
  }
  const scale = intervalDays !== null && Number.isFinite(intervalDays) && intervalDays > 0
    ? absoluteErrorDays / intervalDays
    : absoluteErrorDays;
  if (scale >= 2) {
    return "extreme";
  }
  if (scale >= 1) {
    return "large";
  }
  if (scale >= 0.25) {
    return "moderate";
  }
  return "near";
}

export function dateResolvedPositionBand(input: {
  actualDate: string | null;
  p10: string | null;
  p50: string | null;
  p90: string | null;
}): DateForecastSnapshot["resolvedPositionBand"] {
  const actual = dateTime(input.actualDate);
  const p10 = dateTime(input.p10);
  const p50 = dateTime(input.p50);
  const p90 = dateTime(input.p90);
  if (
    actual === null ||
    p10 === null ||
    p50 === null ||
    p90 === null ||
    p10 > p50 ||
    p50 > p90
  ) {
    return "unknown";
  }
  if (actual < p10) {
    return "before_p10";
  }
  if (actual <= p50) {
    return "p10_to_p50";
  }
  if (actual <= p90) {
    return "p50_to_p90";
  }
  return "after_p90";
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

function readComponentDateStats(value: Record<string, unknown>): Pick<
  DateForecastSnapshot,
  "componentDateCount" | "p50DisagreementDays" | "p50DisagreementBand" | "neverProbabilityDisagreement"
> {
  const explicitComponentDateCount = readNumber(value, "componentDateCount", "component_date_count");
  const explicitP50DisagreementDays = readNumber(value, "p50DisagreementDays", "p50_disagreement_days");
  const explicitNeverProbabilityDisagreement = readNumber(value, "neverProbabilityDisagreement", "never_probability_disagreement");
  const explicitBand = readP50DisagreementBand(value);
  const components = readRecordArray(value, "componentDates", "component_dates");
  if (components.length === 0) {
    return {
      componentDateCount: explicitComponentDateCount,
      p50DisagreementDays: explicitP50DisagreementDays,
      p50DisagreementBand: explicitBand ?? p50DisagreementBand(explicitP50DisagreementDays),
      neverProbabilityDisagreement: explicitNeverProbabilityDisagreement,
    };
  }
  const p50Dates = components.flatMap((component) => {
    const distribution = asRecord(component.dateDistribution) ?? asRecord(component.distribution);
    const date = readString(distribution, "p50", "median") ?? readString(component, "targetDate", "target_date", "p50");
    return date ? [date] : [];
  });
  const neverProbabilities = components
    .map((component) => readNumber(component, "neverProbability", "never_probability"))
    .filter((probability): probability is number => probability !== null);
  const p50DisagreementDays = dateSpreadDays(p50Dates);
  return {
    componentDateCount: components.length,
    p50DisagreementDays,
    p50DisagreementBand: p50DisagreementBand(p50DisagreementDays),
    neverProbabilityDisagreement: numericSpread(neverProbabilities),
  };
}

export function p50DisagreementBand(days: number | null): DateForecastSnapshot["p50DisagreementBand"] {
  if (days === null || !Number.isFinite(days)) {
    return "unknown";
  }
  if (days >= 120) {
    return "wide";
  }
  if (days >= 30) {
    return "moderate";
  }
  return "tight";
}

function dateSpreadDays(values: string[]) {
  const timestamps = values.map((value) => Date.parse(value)).filter(Number.isFinite);
  if (timestamps.length === 0) {
    return null;
  }
  return Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 86_400_000);
}

function numericSpread(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return Math.round((Math.max(...values) - Math.min(...values)) * 10) / 10;
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

function dateTime(value: string | null) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function readRecordArray(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (Array.isArray(raw)) {
      return raw.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
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

function readP50DisagreementBand(value: unknown): DateForecastSnapshot["p50DisagreementBand"] | null {
  const raw = readString(value, "p50DisagreementBand", "p50_disagreement_band");
  return raw === "tight" || raw === "moderate" || raw === "wide" || raw === "unknown" ? raw : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
