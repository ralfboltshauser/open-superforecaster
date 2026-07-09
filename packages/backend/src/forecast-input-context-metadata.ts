import { normalizeForecastInputRow } from "@open-superforecaster/workflow-contracts";

export type ForecastInputContextSnapshot = {
  requestedForecastType: "binary" | "date" | "numeric" | "categorical" | "thresholded" | null;
  requestedForecastTypeBand: "specified" | "unspecified" | "unknown";
  questionLength: number | null;
  questionLengthBand: "short" | "standard" | "long" | "unknown";
  hasResolutionCriteria: boolean;
  hasResolutionDate: boolean;
  resolutionDate: string | null;
  evidenceAsOfDate: string | null;
  resolutionHorizonDays: number | null;
  resolutionHorizonBand: "elapsed" | "near" | "short" | "medium" | "long" | "unknown";
  hasBackground: boolean;
  backgroundLength: number | null;
  backgroundLengthBand: "absent" | "thin" | "adequate" | "detailed" | "unknown";
  hasMarketPrice: boolean;
  marketPriceBand: "low" | "balanced" | "high" | "unknown";
  marketPriceAsOfDate: string | null;
  marketPriceAgeDays: number | null;
  marketPriceAgeBand: "current" | "stale" | "old" | "unknown";
  marketPlatform: string | null;
  marketUrl: string | null;
  hasMarketUrl: boolean;
  marketCreationDate: string | null;
  marketCreationAgeDays: number | null;
  marketCreationAgeBand: "future" | "new" | "established" | "old" | "unknown";
  marketMetadataBand: "none" | "price_only" | "metadata_only" | "price_with_metadata" | "linked" | "unknown";
  categoryCount: number | null;
  categoryCountBand: "none" | "few" | "many" | "unknown";
  categoriesExhaustive: boolean | null;
  categoryCoverageBand: "none" | "open_set" | "closed_set" | "unknown";
  thresholdCount: number | null;
  thresholdCountBand: "none" | "single" | "curve" | "unknown";
  thresholdValueCount: number | null;
  thresholdValueCoverageBand: "none" | "missing" | "partial" | "complete" | "unknown";
  thresholdDirection: "at_least" | "at_most" | "mixed" | null;
  thresholdDirectionBand: "none" | "missing" | "at_least" | "at_most" | "mixed" | "unknown";
  hasCondition: boolean;
  hasConditionResolutionCriteria: boolean;
  conditionCriteriaBand: "none" | "condition_only" | "condition_with_criteria" | "unknown";
  hasUnit: boolean;
  unit: string | null;
  unitSpecificityBand: "missing" | "generic" | "specific" | "unknown";
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
  const requestedForecastType = normalized.forecastType ?? null;
  const questionLength = wordCount(normalized.question);
  const categoryCount = normalized.categories.length;
  const categoriesExhaustive = categoryCount > 0 ? normalized.categoriesExhaustive : null;
  const thresholdCount = normalized.thresholds.length;
  const thresholdValueCount = normalized.thresholds.filter((threshold) => typeof threshold.value === "number" && Number.isFinite(threshold.value)).length;
  const thresholdDirection = readInputThresholdDirection(normalized);
  const marketPlatform = normalized.market.marketPlatform?.trim() || null;
  const hasResolutionCriteria = Boolean(normalized.resolutionCriteria?.trim());
  const hasResolutionDate = Boolean(normalized.resolutionDate?.trim());
  const resolutionDate = readIsoDate(raw, "resolutionDate", "resolution_date");
  const evidenceAsOfDate = readIsoDate(raw, "presentDate", "present_date", "evidenceAsOfDate", "evidence_as_of_date", "asOfDate", "as_of_date", "cutoffDate", "cutoff_date", "cutoff");
  const resolutionHorizonDays = horizonDays(evidenceAsOfDate, resolutionDate);
  const hasBackground = Boolean(normalized.background?.trim());
  const backgroundLength = normalized.background?.trim() ? wordCount(normalized.background) : null;
  const hasMarketPrice = typeof normalized.market.marketPrice === "number";
  const rawMarket = asRecord(raw.market);
  const marketPriceAsOfDate = readIsoDate(raw, "marketPriceAsOf", "market_price_as_of")
    ?? readIsoDate(rawMarket, "marketPriceAsOf", "market_price_as_of", "priceAsOf", "price_as_of", "asOf", "as_of");
  const marketPriceAgeDays = hasMarketPrice ? horizonDays(marketPriceAsOfDate, evidenceAsOfDate) : null;
  const marketCreationDate = readIsoDate(raw, "marketCreationDate", "market_creation_date")
    ?? readIsoDate(rawMarket, "marketCreationDate", "market_creation_date", "creationDate", "creation_date");
  const marketCreationAgeDays = horizonDays(marketCreationDate, evidenceAsOfDate);
  const marketUrl = normalized.market.marketUrl?.trim() || null;
  const hasMarketUrl = marketUrl !== null;
  const hasCondition = Boolean(normalized.condition?.trim());
  const hasConditionResolutionCriteria = Boolean(normalized.conditionResolutionCriteria?.trim());
  const unit = normalized.unit?.trim() || null;
  const hasUnit = unit !== null;
  const contextCompleteness = [
    hasResolutionCriteria,
    hasResolutionDate,
    hasBackground,
    hasMarketPrice,
    categoryCount > 0,
    thresholdCount > 0,
    hasCondition,
    hasConditionResolutionCriteria,
    hasUnit,
  ].filter(Boolean).length;
  return {
    requestedForecastType,
    requestedForecastTypeBand: requestedForecastTypeBand(requestedForecastType),
    questionLength,
    questionLengthBand: questionLengthBand(questionLength),
    hasResolutionCriteria,
    hasResolutionDate,
    resolutionDate,
    evidenceAsOfDate,
    resolutionHorizonDays,
    resolutionHorizonBand: resolutionHorizonBand(resolutionHorizonDays),
    hasBackground,
    backgroundLength,
    backgroundLengthBand: backgroundLengthBand(backgroundLength),
    hasMarketPrice,
    marketPriceBand: marketPriceBand(normalized.market.marketPrice ?? null),
    marketPriceAsOfDate,
    marketPriceAgeDays,
    marketPriceAgeBand: marketPriceAgeBand(marketPriceAgeDays),
    marketPlatform,
    marketUrl,
    hasMarketUrl,
    marketCreationDate,
    marketCreationAgeDays,
    marketCreationAgeBand: marketCreationAgeBand(marketCreationAgeDays),
    marketMetadataBand: marketMetadataBand({ hasMarketPrice, marketPlatform, marketUrl, marketCreationDate }),
    categoryCount,
    categoryCountBand: categoryCountBand(categoryCount),
    categoriesExhaustive,
    categoryCoverageBand: inputCategoryCoverageBand({ categoryCount, categoriesExhaustive }),
    thresholdCount,
    thresholdCountBand: thresholdCountBand(thresholdCount),
    thresholdValueCount,
    thresholdValueCoverageBand: inputThresholdValueCoverageBand({ thresholdCount, thresholdValueCount }),
    thresholdDirection,
    thresholdDirectionBand: inputThresholdDirectionBand({ thresholdCount, thresholdDirection }),
    hasCondition,
    hasConditionResolutionCriteria,
    conditionCriteriaBand: conditionCriteriaBand({ hasCondition, hasConditionResolutionCriteria }),
    hasUnit,
    unit,
    unitSpecificityBand: unitSpecificityBand(unit),
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
  const requestedForecastType = readRequestedForecastType(value);
  const requestedForecastTypeBandValue = readString(value, "requestedForecastTypeBand");
  const categoryCount = readNumber(value, "categoryCount");
  const categoriesExhaustive = readBoolean(value, "categoriesExhaustive");
  const thresholdCount = readNumber(value, "thresholdCount");
  const thresholdValueCount = readNumber(value, "thresholdValueCount");
  const thresholdDirection = readInputThresholdDirectionValue(value);
  const resolutionHorizonDays = readNumber(value, "resolutionHorizonDays");
  const marketPriceAgeDays = readNumber(value, "marketPriceAgeDays");
  const marketCreationAgeDays = readNumber(value, "marketCreationAgeDays");
  const backgroundLength = readNumber(value, "backgroundLength");
  const marketPriceBandValue = readString(value, "marketPriceBand");
  const marketPriceAgeBandValue = readString(value, "marketPriceAgeBand");
  const marketCreationAgeBandValue = readString(value, "marketCreationAgeBand");
  const marketMetadataBandValue = readString(value, "marketMetadataBand");
  const contextCompletenessBandValue = readString(value, "contextCompletenessBand");
  const resolutionHorizonBandValue = readString(value, "resolutionHorizonBand");
  const backgroundLengthBandValue = readString(value, "backgroundLengthBand");
  const unit = readString(value, "unit");
  const unitSpecificityBandValue = readString(value, "unitSpecificityBand");
  const marketUrl = readString(value, "marketUrl");
  const categoryCoverageBandValue = readString(value, "categoryCoverageBand");
  const thresholdValueCoverageBandValue = readString(value, "thresholdValueCoverageBand");
  const thresholdDirectionBandValue = readString(value, "thresholdDirectionBand");
  return {
    requestedForecastType,
    requestedForecastTypeBand: isRequestedForecastTypeBand(requestedForecastTypeBandValue)
      ? requestedForecastTypeBandValue
      : requestedForecastTypeBand(requestedForecastType),
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
    backgroundLength,
    backgroundLengthBand: isBackgroundLengthBand(backgroundLengthBandValue)
      ? backgroundLengthBandValue
      : backgroundLengthBand(backgroundLength),
    hasMarketPrice: readBoolean(value, "hasMarketPrice") ?? false,
    marketPriceBand: isMarketPriceBand(marketPriceBandValue) ? marketPriceBandValue : "unknown",
    marketPriceAsOfDate: readString(value, "marketPriceAsOfDate"),
    marketPriceAgeDays,
    marketPriceAgeBand: isMarketPriceAgeBand(marketPriceAgeBandValue)
      ? marketPriceAgeBandValue
      : marketPriceAgeBand(marketPriceAgeDays),
    marketPlatform: readString(value, "marketPlatform"),
    marketUrl,
    hasMarketUrl: readBoolean(value, "hasMarketUrl") ?? Boolean(marketUrl),
    marketCreationDate: readString(value, "marketCreationDate"),
    marketCreationAgeDays,
    marketCreationAgeBand: isMarketCreationAgeBand(marketCreationAgeBandValue)
      ? marketCreationAgeBandValue
      : marketCreationAgeBand(marketCreationAgeDays),
    marketMetadataBand: isMarketMetadataBand(marketMetadataBandValue)
      ? marketMetadataBandValue
      : marketMetadataBand({
        hasMarketPrice: readBoolean(value, "hasMarketPrice") ?? false,
        marketPlatform: readString(value, "marketPlatform"),
        marketUrl: readString(value, "marketUrl"),
        marketCreationDate: readString(value, "marketCreationDate"),
      }),
    categoryCount,
    categoryCountBand: readCategoryCountBand(value) ?? categoryCountBand(categoryCount),
    categoriesExhaustive,
    categoryCoverageBand: isInputCategoryCoverageBand(categoryCoverageBandValue)
      ? categoryCoverageBandValue
      : inputCategoryCoverageBand({ categoryCount, categoriesExhaustive }),
    thresholdCount,
    thresholdCountBand: readThresholdCountBand(value) ?? thresholdCountBand(thresholdCount),
    thresholdValueCount,
    thresholdValueCoverageBand: isInputThresholdValueCoverageBand(thresholdValueCoverageBandValue)
      ? thresholdValueCoverageBandValue
      : inputThresholdValueCoverageBand({ thresholdCount, thresholdValueCount }),
    thresholdDirection,
    thresholdDirectionBand: isInputThresholdDirectionBand(thresholdDirectionBandValue)
      ? thresholdDirectionBandValue
      : inputThresholdDirectionBand({ thresholdCount, thresholdDirection }),
    hasCondition: readBoolean(value, "hasCondition") ?? false,
    hasConditionResolutionCriteria: readBoolean(value, "hasConditionResolutionCriteria") ?? false,
    conditionCriteriaBand: readConditionCriteriaBand(value) ?? conditionCriteriaBand({
      hasCondition: readBoolean(value, "hasCondition") ?? false,
      hasConditionResolutionCriteria: readBoolean(value, "hasConditionResolutionCriteria") ?? false,
    }),
    hasUnit: readBoolean(value, "hasUnit") ?? false,
    unit,
    unitSpecificityBand: isUnitSpecificityBand(unitSpecificityBandValue)
      ? unitSpecificityBandValue
      : unitSpecificityBand(unit),
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

export function requestedForecastTypeBand(
  requestedForecastType: ForecastInputContextSnapshot["requestedForecastType"],
): ForecastInputContextSnapshot["requestedForecastTypeBand"] {
  return requestedForecastType ? "specified" : "unspecified";
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

export function marketPriceAgeBand(days: number | null): ForecastInputContextSnapshot["marketPriceAgeBand"] {
  if (days === null || !Number.isFinite(days) || days < 0) {
    return "unknown";
  }
  if (days <= 7) {
    return "current";
  }
  if (days <= 30) {
    return "stale";
  }
  return "old";
}

export function marketCreationAgeBand(days: number | null): ForecastInputContextSnapshot["marketCreationAgeBand"] {
  if (days === null || !Number.isFinite(days)) {
    return "unknown";
  }
  if (days < 0) {
    return "future";
  }
  if (days <= 30) {
    return "new";
  }
  if (days <= 365) {
    return "established";
  }
  return "old";
}

export function marketMetadataBand(input: {
  hasMarketPrice: boolean;
  marketPlatform: string | null;
  marketUrl: string | null;
  marketCreationDate: string | null;
}): ForecastInputContextSnapshot["marketMetadataBand"] {
  const hasMetadata = Boolean(input.marketPlatform || input.marketCreationDate);
  if (input.marketUrl) {
    return "linked";
  }
  if (input.hasMarketPrice && hasMetadata) {
    return "price_with_metadata";
  }
  if (input.hasMarketPrice) {
    return "price_only";
  }
  if (hasMetadata) {
    return "metadata_only";
  }
  return "none";
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

export function inputCategoryCoverageBand(input: {
  categoryCount: number | null;
  categoriesExhaustive: boolean | null;
}): ForecastInputContextSnapshot["categoryCoverageBand"] {
  if (input.categoryCount === null || !Number.isFinite(input.categoryCount)) {
    return "unknown";
  }
  if (input.categoryCount <= 0) {
    return "none";
  }
  if (input.categoriesExhaustive === null) {
    return "unknown";
  }
  return input.categoriesExhaustive ? "closed_set" : "open_set";
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

export function inputThresholdDirectionBand(input: {
  thresholdCount: number | null;
  thresholdDirection: ForecastInputContextSnapshot["thresholdDirection"];
}): ForecastInputContextSnapshot["thresholdDirectionBand"] {
  if (input.thresholdCount === null || !Number.isFinite(input.thresholdCount)) {
    return "unknown";
  }
  if (input.thresholdCount <= 0) {
    return "none";
  }
  return input.thresholdDirection ?? "missing";
}

export function inputThresholdValueCoverageBand(input: {
  thresholdCount: number | null;
  thresholdValueCount: number | null;
}): ForecastInputContextSnapshot["thresholdValueCoverageBand"] {
  if (
    input.thresholdCount === null ||
    input.thresholdValueCount === null ||
    !Number.isFinite(input.thresholdCount) ||
    !Number.isFinite(input.thresholdValueCount)
  ) {
    return "unknown";
  }
  if (input.thresholdCount <= 0) {
    return "none";
  }
  if (input.thresholdValueCount <= 0) {
    return "missing";
  }
  if (input.thresholdValueCount < input.thresholdCount) {
    return "partial";
  }
  return "complete";
}

export function conditionCriteriaBand(input: {
  hasCondition: boolean;
  hasConditionResolutionCriteria: boolean;
}): ForecastInputContextSnapshot["conditionCriteriaBand"] {
  if (!input.hasCondition) {
    return "none";
  }
  return input.hasConditionResolutionCriteria ? "condition_with_criteria" : "condition_only";
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

export function backgroundLengthBand(count: number | null): ForecastInputContextSnapshot["backgroundLengthBand"] {
  if (count === null) {
    return "absent";
  }
  if (!Number.isFinite(count)) {
    return "unknown";
  }
  if (count < 15) {
    return "thin";
  }
  if (count <= 80) {
    return "adequate";
  }
  return "detailed";
}

export function unitSpecificityBand(unit: string | null): ForecastInputContextSnapshot["unitSpecificityBand"] {
  if (unit === null) {
    return "missing";
  }
  const normalized = unit.trim().toLowerCase();
  if (!normalized) {
    return "missing";
  }
  if (normalized === "unit" || normalized === "units" || normalized === "item" || normalized === "items") {
    return "generic";
  }
  return "specific";
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function readInputThresholdDirection(input: {
  thresholdDirection?: "at_least" | "at_most";
  thresholds: Array<{ direction?: "at_least" | "at_most" }>;
}): ForecastInputContextSnapshot["thresholdDirection"] {
  const directions = new Set<"at_least" | "at_most">();
  if (input.thresholdDirection) {
    directions.add(input.thresholdDirection);
  }
  for (const threshold of input.thresholds) {
    if (threshold.direction) {
      directions.add(threshold.direction);
    }
  }
  if (directions.size === 0) {
    return null;
  }
  if (directions.size > 1) {
    return "mixed";
  }
  return directions.values().next().value ?? null;
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

function readRequestedForecastType(value: Record<string, unknown>): ForecastInputContextSnapshot["requestedForecastType"] {
  const raw = readString(value, "requestedForecastType");
  return raw === "binary" || raw === "date" || raw === "numeric" || raw === "categorical" || raw === "thresholded" ? raw : null;
}

function isRequestedForecastTypeBand(value: string | null): value is ForecastInputContextSnapshot["requestedForecastTypeBand"] {
  return value === "specified" || value === "unspecified" || value === "unknown";
}

function readCategoryCountBand(value: Record<string, unknown>) {
  const raw = readString(value, "categoryCountBand");
  return raw === "none" || raw === "few" || raw === "many" || raw === "unknown" ? raw : null;
}

function isInputCategoryCoverageBand(value: string | null): value is ForecastInputContextSnapshot["categoryCoverageBand"] {
  return value === "none" || value === "open_set" || value === "closed_set" || value === "unknown";
}

function readThresholdCountBand(value: Record<string, unknown>) {
  const raw = readString(value, "thresholdCountBand");
  return raw === "none" || raw === "single" || raw === "curve" || raw === "unknown" ? raw : null;
}

function readInputThresholdDirectionValue(value: Record<string, unknown>): ForecastInputContextSnapshot["thresholdDirection"] {
  const raw = readString(value, "thresholdDirection");
  return raw === "at_least" || raw === "at_most" || raw === "mixed" ? raw : null;
}

function isInputThresholdDirectionBand(value: string | null): value is ForecastInputContextSnapshot["thresholdDirectionBand"] {
  return value === "none" || value === "missing" || value === "at_least" || value === "at_most" || value === "mixed" || value === "unknown";
}

function isInputThresholdValueCoverageBand(value: string | null): value is ForecastInputContextSnapshot["thresholdValueCoverageBand"] {
  return value === "none" || value === "missing" || value === "partial" || value === "complete" || value === "unknown";
}

function readConditionCriteriaBand(value: Record<string, unknown>) {
  const raw = readString(value, "conditionCriteriaBand");
  return raw === "none" || raw === "condition_only" || raw === "condition_with_criteria" || raw === "unknown" ? raw : null;
}

function isMarketPriceBand(value: string | null): value is ForecastInputContextSnapshot["marketPriceBand"] {
  return value === "low" || value === "balanced" || value === "high" || value === "unknown";
}

function isMarketPriceAgeBand(value: string | null): value is ForecastInputContextSnapshot["marketPriceAgeBand"] {
  return value === "current" || value === "stale" || value === "old" || value === "unknown";
}

function isMarketCreationAgeBand(value: string | null): value is ForecastInputContextSnapshot["marketCreationAgeBand"] {
  return value === "future" || value === "new" || value === "established" || value === "old" || value === "unknown";
}

function isMarketMetadataBand(value: string | null): value is ForecastInputContextSnapshot["marketMetadataBand"] {
  return value === "none" || value === "price_only" || value === "metadata_only" || value === "price_with_metadata" || value === "linked" || value === "unknown";
}

function isContextCompletenessBand(value: string | null): value is ForecastInputContextSnapshot["contextCompletenessBand"] {
  return value === "sparse" || value === "partial" || value === "rich";
}

function isResolutionHorizonBand(value: string | null): value is ForecastInputContextSnapshot["resolutionHorizonBand"] {
  return value === "elapsed" || value === "near" || value === "short" || value === "medium" || value === "long" || value === "unknown";
}

function isBackgroundLengthBand(value: string | null): value is ForecastInputContextSnapshot["backgroundLengthBand"] {
  return value === "absent" || value === "thin" || value === "adequate" || value === "detailed" || value === "unknown";
}

function isUnitSpecificityBand(value: string | null): value is ForecastInputContextSnapshot["unitSpecificityBand"] {
  return value === "missing" || value === "generic" || value === "specific" || value === "unknown";
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
