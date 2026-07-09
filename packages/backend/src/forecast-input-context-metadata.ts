import { normalizeForecastInputRow } from "@open-superforecaster/workflow-contracts";

export type ForecastInputContextSnapshot = {
  questionLength: number | null;
  questionLengthBand: "short" | "standard" | "long" | "unknown";
  hasResolutionCriteria: boolean;
  hasResolutionDate: boolean;
  resolutionDate: string | null;
  evidenceAsOfDate: string | null;
  resolutionHorizonDays: number | null;
  resolutionHorizonBand: "elapsed" | "near" | "short" | "medium" | "long" | "unknown";
  hasBackground: boolean;
  hasMarketPrice: boolean;
  marketPriceBand: "low" | "balanced" | "high" | "unknown";
  marketPlatform: string | null;
  categoryCount: number | null;
  categoryCountBand: "none" | "few" | "many" | "unknown";
  thresholdCount: number | null;
  thresholdCountBand: "none" | "single" | "curve" | "unknown";
  hasCondition: boolean;
  hasUnit: boolean;
  contextCompleteness: number;
  contextCompletenessBand: "sparse" | "partial" | "rich";
};

export function readForecastInputContextSnapshot(value: unknown): ForecastInputContextSnapshot | null {
  const record = asRecord(value);
  const persisted = asRecord(record?.inputContext);
  if (persisted) {
    return readPersistedSnapshot(persisted);
  }
  const raw = asRecord(record?.forecastInput) ?? asRecord(record?.smithersInput) ?? record;
  if (!raw) {
    return null;
  }
  const normalized = normalizeForecastInputRow(raw);
  if (!normalized.question.trim()) {
    return null;
  }
  const questionLength = wordCount(normalized.question);
  const categoryCount = normalized.categories.length;
  const thresholdCount = normalized.thresholds.length;
  const marketPlatform = normalized.market.marketPlatform?.trim() || null;
  const hasResolutionCriteria = Boolean(normalized.resolutionCriteria?.trim());
  const hasResolutionDate = Boolean(normalized.resolutionDate?.trim());
  const resolutionDate = readIsoDate(raw, "resolutionDate", "resolution_date");
  const evidenceAsOfDate = readIsoDate(raw, "presentDate", "present_date", "evidenceAsOfDate", "evidence_as_of_date", "asOfDate", "as_of_date", "cutoffDate", "cutoff_date", "cutoff");
  const resolutionHorizonDays = horizonDays(evidenceAsOfDate, resolutionDate);
  const hasBackground = Boolean(normalized.background?.trim());
  const hasMarketPrice = typeof normalized.market.marketPrice === "number";
  const hasCondition = Boolean(normalized.condition?.trim());
  const hasUnit = Boolean(normalized.unit?.trim());
  const contextCompleteness = [
    hasResolutionCriteria,
    hasResolutionDate,
    hasBackground,
    hasMarketPrice,
    categoryCount > 0,
    thresholdCount > 0,
    hasCondition,
    hasUnit,
  ].filter(Boolean).length;
  return {
    questionLength,
    questionLengthBand: questionLengthBand(questionLength),
    hasResolutionCriteria,
    hasResolutionDate,
    resolutionDate,
    evidenceAsOfDate,
    resolutionHorizonDays,
    resolutionHorizonBand: resolutionHorizonBand(resolutionHorizonDays),
    hasBackground,
    hasMarketPrice,
    marketPriceBand: marketPriceBand(normalized.market.marketPrice ?? null),
    marketPlatform,
    categoryCount,
    categoryCountBand: categoryCountBand(categoryCount),
    thresholdCount,
    thresholdCountBand: thresholdCountBand(thresholdCount),
    hasCondition,
    hasUnit,
    contextCompleteness,
    contextCompletenessBand: contextCompletenessBand(contextCompleteness),
  };
}

function readPersistedSnapshot(value: Record<string, unknown>): ForecastInputContextSnapshot | null {
  const contextCompleteness = readNumber(value, "contextCompleteness");
  const questionLength = readNumber(value, "questionLength");
  if (contextCompleteness === null && questionLength === null) {
    return null;
  }
  const categoryCount = readNumber(value, "categoryCount");
  const thresholdCount = readNumber(value, "thresholdCount");
  const resolutionHorizonDays = readNumber(value, "resolutionHorizonDays");
  const marketPriceBandValue = readString(value, "marketPriceBand");
  const contextCompletenessBandValue = readString(value, "contextCompletenessBand");
  const resolutionHorizonBandValue = readString(value, "resolutionHorizonBand");
  return {
    questionLength,
    questionLengthBand: readQuestionLengthBand(value) ?? questionLengthBand(questionLength),
    hasResolutionCriteria: readBoolean(value, "hasResolutionCriteria") ?? false,
    hasResolutionDate: readBoolean(value, "hasResolutionDate") ?? false,
    resolutionDate: readString(value, "resolutionDate"),
    evidenceAsOfDate: readString(value, "evidenceAsOfDate"),
    resolutionHorizonDays,
    resolutionHorizonBand: isResolutionHorizonBand(resolutionHorizonBandValue)
      ? resolutionHorizonBandValue
      : resolutionHorizonBand(resolutionHorizonDays),
    hasBackground: readBoolean(value, "hasBackground") ?? false,
    hasMarketPrice: readBoolean(value, "hasMarketPrice") ?? false,
    marketPriceBand: isMarketPriceBand(marketPriceBandValue) ? marketPriceBandValue : "unknown",
    marketPlatform: readString(value, "marketPlatform"),
    categoryCount,
    categoryCountBand: readCategoryCountBand(value) ?? categoryCountBand(categoryCount),
    thresholdCount,
    thresholdCountBand: readThresholdCountBand(value) ?? thresholdCountBand(thresholdCount),
    hasCondition: readBoolean(value, "hasCondition") ?? false,
    hasUnit: readBoolean(value, "hasUnit") ?? false,
    contextCompleteness: contextCompleteness ?? 0,
    contextCompletenessBand: isContextCompletenessBand(contextCompletenessBandValue)
      ? contextCompletenessBandValue
      : contextCompletenessBand(contextCompleteness ?? 0),
  };
}

export function questionLengthBand(count: number | null): ForecastInputContextSnapshot["questionLengthBand"] {
  if (count === null || !Number.isFinite(count)) {
    return "unknown";
  }
  if (count < 12) {
    return "short";
  }
  if (count <= 35) {
    return "standard";
  }
  return "long";
}

export function marketPriceBand(price: number | null): ForecastInputContextSnapshot["marketPriceBand"] {
  if (price === null || !Number.isFinite(price)) {
    return "unknown";
  }
  if (price < 35) {
    return "low";
  }
  if (price <= 65) {
    return "balanced";
  }
  return "high";
}

export function categoryCountBand(count: number | null): ForecastInputContextSnapshot["categoryCountBand"] {
  if (count === null || !Number.isFinite(count)) {
    return "unknown";
  }
  if (count <= 0) {
    return "none";
  }
  if (count <= 5) {
    return "few";
  }
  return "many";
}

export function thresholdCountBand(count: number | null): ForecastInputContextSnapshot["thresholdCountBand"] {
  if (count === null || !Number.isFinite(count)) {
    return "unknown";
  }
  if (count <= 0) {
    return "none";
  }
  if (count === 1) {
    return "single";
  }
  return "curve";
}

export function contextCompletenessBand(count: number): ForecastInputContextSnapshot["contextCompletenessBand"] {
  if (count >= 4) {
    return "rich";
  }
  if (count >= 2) {
    return "partial";
  }
  return "sparse";
}

export function resolutionHorizonBand(days: number | null): ForecastInputContextSnapshot["resolutionHorizonBand"] {
  if (days === null || !Number.isFinite(days)) {
    return "unknown";
  }
  if (days < 0) {
    return "elapsed";
  }
  if (days <= 30) {
    return "near";
  }
  if (days <= 180) {
    return "short";
  }
  if (days <= 730) {
    return "medium";
  }
  return "long";
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function horizonDays(evidenceAsOfDate: string | null, resolutionDate: string | null) {
  const asOf = dateTime(evidenceAsOfDate);
  const resolution = dateTime(resolutionDate);
  if (asOf === null || resolution === null) {
    return null;
  }
  return Math.round((resolution - asOf) / 86_400_000);
}

function readIsoDate(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (raw instanceof Date && Number.isFinite(raw.getTime())) {
      return raw.toISOString().slice(0, 10);
    }
    if (typeof raw === "string") {
      const timestamp = Date.parse(raw);
      if (Number.isFinite(timestamp)) {
        return new Date(timestamp).toISOString().slice(0, 10);
      }
    }
  }
  return null;
}

function dateTime(value: string | null) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function readQuestionLengthBand(value: Record<string, unknown>) {
  const raw = readString(value, "questionLengthBand");
  return raw === "short" || raw === "standard" || raw === "long" || raw === "unknown" ? raw : null;
}

function readCategoryCountBand(value: Record<string, unknown>) {
  const raw = readString(value, "categoryCountBand");
  return raw === "none" || raw === "few" || raw === "many" || raw === "unknown" ? raw : null;
}

function readThresholdCountBand(value: Record<string, unknown>) {
  const raw = readString(value, "thresholdCountBand");
  return raw === "none" || raw === "single" || raw === "curve" || raw === "unknown" ? raw : null;
}

function isMarketPriceBand(value: string | null): value is ForecastInputContextSnapshot["marketPriceBand"] {
  return value === "low" || value === "balanced" || value === "high" || value === "unknown";
}

function isContextCompletenessBand(value: string | null): value is ForecastInputContextSnapshot["contextCompletenessBand"] {
  return value === "sparse" || value === "partial" || value === "rich";
}

function isResolutionHorizonBand(value: string | null): value is ForecastInputContextSnapshot["resolutionHorizonBand"] {
  return value === "elapsed" || value === "near" || value === "short" || value === "medium" || value === "long" || value === "unknown";
}

function readString(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function readNumber(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function readBoolean(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "boolean" ? raw : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
