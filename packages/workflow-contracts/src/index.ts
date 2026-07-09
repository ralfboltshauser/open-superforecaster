import { z } from "zod";

export const operationModeSchema = z.enum([
  "forecast",
  "multi_agent",
  "agent_map",
  "rank",
  "classify",
  "merge",
  "dedupe",
  "benchmark_iteration",
  "fixed_evidence_eval",
  "agentic_pastcasting_eval",
]);

export const forecastTypeSchema = z.enum([
  "binary",
  "date",
  "numeric",
  "categorical",
  "thresholded",
  "conditional",
]);

export const taskStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "revoked",
  "cancelled",
  "partial_failure",
  "waiting_approval",
  "waiting_event",
  "waiting_timer",
  "waiting_quota",
  "needs_review",
]);

export const artifactTypeSchema = z.enum([
  "table",
  "scalar",
  "file",
  "report",
  "source_bundle",
  "trace_bundle",
]);

export const traceEventTypeSchema = z.enum([
  "trace_start",
  "trace_summary",
  "tool_call",
  "search",
  "page_read",
  "source_added",
  "parser_result",
  "validation_result",
  "row_completed",
  "row_failed",
  "synthesis",
  "done",
]);

export const sourceEntrySchema = z.object({
  title: z.string().optional(),
  url: z.string().url().optional(),
  claim: z.string().min(1),
  qualityScore: z.number().min(0).max(1).optional(),
});

export const forecastMarketMetadataSchema = z.object({
  marketPrice: z.number().min(0).max(100).optional(),
  marketPriceAsOf: z.string().optional(),
  marketCreationDate: z.string().optional(),
  marketPlatform: z.string().optional(),
  marketUrl: z.string().optional(),
});

export const thresholdDirectionSchema = z.enum(["at_least", "at_most"]);

export const thresholdDefinitionSchema = z.object({
  label: z.string().min(1),
  value: z.number().optional(),
  direction: thresholdDirectionSchema.optional(),
});

export const forecastInputRowSchema = z.object({
  rowId: z.string().optional(),
  question: z.string(),
  resolutionCriteria: z.string().optional(),
  resolutionDate: z.string().optional(),
  background: z.string().optional(),
  forecastType: forecastTypeSchema.exclude(["conditional"]).optional(),
  condition: z.string().optional(),
  conditionResolutionCriteria: z.string().optional(),
  categories: z.array(z.string().min(1)).default([]),
  categoriesExhaustive: z.boolean().default(false),
  thresholds: z.array(thresholdDefinitionSchema).default([]),
  thresholdDirection: thresholdDirectionSchema.optional(),
  unit: z.string().optional(),
  market: forecastMarketMetadataSchema.default({}),
});

export const numericQuantileDistributionSchema = z.object({
  p10: z.number(),
  p25: z.number(),
  p50: z.number(),
  p75: z.number(),
  p90: z.number(),
});

export const dateQuantileDistributionSchema = z.object({
  p10: z.string(),
  p25: z.string(),
  p50: z.string(),
  p75: z.string(),
  p90: z.string(),
});

export const binaryForecastAttemptSchema = z.object({
  probability: z.number().min(0).max(100),
  rationale: z.string().min(1),
  strongestYes: z.string().min(1),
  strongestNo: z.string().min(1),
  keyUncertainties: z.array(z.string()).default([]),
  premortem: z.string().default(""),
  wildcards: z.array(z.string()).default([]),
  citedSources: z.array(sourceEntrySchema).default([]),
  traceDigest: z
    .object({
      searchesRun: z.array(z.string()).default([]),
      pagesRead: z.array(z.string()).default([]),
      keyIntermediateJudgments: z.array(z.string()).default([]),
    })
    .default({ searchesRun: [], pagesRead: [], keyIntermediateJudgments: [] }),
});

export const routerDecisionSchema = z.object({
  mode: operationModeSchema,
  confidence: z.number().min(0).max(1),
  forecastType: forecastTypeSchema.optional(),
  requiresTable: z.boolean(),
  rationale: z.string(),
  suggestedEffort: z.enum(["low", "medium", "high"]),
});

export const healthSnapshotSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string(),
  service: z.string(),
  checks: z.record(
    z.string(),
    z.object({
      ok: z.boolean(),
      label: z.string(),
      detail: z.string().optional(),
    }),
  ),
});

export type OperationMode = z.infer<typeof operationModeSchema>;
export type ForecastType = z.infer<typeof forecastTypeSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type ArtifactType = z.infer<typeof artifactTypeSchema>;
export type TraceEventType = z.infer<typeof traceEventTypeSchema>;
export type ForecastMarketMetadata = z.infer<typeof forecastMarketMetadataSchema>;
export type ThresholdDirection = z.infer<typeof thresholdDirectionSchema>;
export type ThresholdDefinition = z.infer<typeof thresholdDefinitionSchema>;
export type ForecastInputRow = z.infer<typeof forecastInputRowSchema>;
export type NumericQuantileDistribution = z.infer<typeof numericQuantileDistributionSchema>;
export type DateQuantileDistribution = z.infer<typeof dateQuantileDistributionSchema>;
export type BinaryForecastAttempt = z.infer<typeof binaryForecastAttemptSchema>;
export type HealthSnapshot = z.infer<typeof healthSnapshotSchema>;

export type CanonicalCitedSource = {
  title?: string | null;
  url?: string | null;
  claim: string;
};

export function canonicalCitedSourceKey(source: CanonicalCitedSource) {
  const rawUrl = source.url?.trim();
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      url.hash = "";
      url.searchParams.sort();
      return `url:${url.toString().replace(/\/$/, "")}`;
    } catch {
      return `url:${rawUrl.replace(/\/$/, "").toLowerCase()}`;
    }
  }
  return `fallback:${(source.title ?? "").trim().toLowerCase()}::${source.claim.trim().toLowerCase()}`;
}

export function normalizeForecastInputRow(raw: Record<string, unknown>): ForecastInputRow {
  const question = readString(raw.question) ?? readString(raw.prompt) ?? "";
  const market = normalizeMarketMetadata(raw);
  return forecastInputRowSchema.parse({
    rowId: readString(raw.rowId) ?? readString(raw.row_id) ?? readString(raw.id),
    question,
    resolutionCriteria: readString(raw.resolutionCriteria) ?? readString(raw.resolution_criteria),
    resolutionDate: readString(raw.resolutionDate) ?? readString(raw.resolution_date),
    background: readString(raw.background),
    forecastType: normalizeForecastType(raw.forecastType ?? raw.forecast_type),
    condition: readString(raw.condition),
    conditionResolutionCriteria: readString(raw.conditionResolutionCriteria) ?? readString(raw.condition_resolution_criteria),
    categories: normalizeStringArray(raw.categories ?? raw.options),
    categoriesExhaustive: raw.categoriesExhaustive === true || raw.categories_exhaustive === true,
    thresholds: normalizeThresholdDefinitions(raw.thresholds),
    thresholdDirection: normalizeThresholdDirection(raw.thresholdDirection ?? raw.threshold_direction),
    unit: readString(raw.unit) ?? readString(raw.units),
    market,
  });
}

export function formatForecastContextForPrompt(input: ForecastInputRow) {
  const lines = [
    input.resolutionDate ? `Resolution date: ${input.resolutionDate}` : null,
    input.market.marketPrice !== undefined ? `Market price: ${input.market.marketPrice}%` : null,
    input.market.marketPriceAsOf ? `Market price as of: ${input.market.marketPriceAsOf}` : null,
    input.market.marketCreationDate ? `Market creation date: ${input.market.marketCreationDate}` : null,
    input.market.marketPlatform ? `Market platform: ${input.market.marketPlatform}` : null,
    input.market.marketUrl ? `Market URL: ${input.market.marketUrl}` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.length
    ? `Structured forecast context:\n${lines.join("\n")}`
    : "No structured forecast metadata was provided.";
}

function normalizeMarketMetadata(raw: Record<string, unknown>): ForecastMarketMetadata {
  const nested = isRecord(raw.market) ? raw.market : {};
  return forecastMarketMetadataSchema.parse({
    marketPrice: readNumber(raw.marketPrice) ?? readNumber(raw.market_price) ?? readNumber(nested.marketPrice) ?? readNumber(nested.price),
    marketPriceAsOf:
      readString(raw.marketPriceAsOf) ??
      readString(raw.market_price_as_of) ??
      readString(nested.marketPriceAsOf) ??
      readString(nested.priceAsOf),
    marketCreationDate:
      readString(raw.marketCreationDate) ??
      readString(raw.market_creation_date) ??
      readString(nested.marketCreationDate) ??
      readString(nested.creationDate),
    marketPlatform:
      readString(raw.marketPlatform) ??
      readString(raw.market_platform) ??
      readString(raw.platform) ??
      readString(nested.marketPlatform) ??
      readString(nested.platform),
    marketUrl: readString(raw.marketUrl) ?? readString(raw.market_url) ?? readString(nested.marketUrl) ?? readString(nested.url),
  });
}

function normalizeThresholdDefinitions(raw: unknown): ThresholdDefinition[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const thresholds: ThresholdDefinition[] = [];
  for (const item of raw) {
    const threshold = typeof item === "string"
      ? { label: item.trim() }
      : isRecord(item)
        ? {
            label: readString(item.label) ?? readString(item.threshold) ?? readString(item.name) ?? "",
            value: readNumber(item.value),
            direction: normalizeThresholdDirection(item.direction),
          }
        : { label: "" };
    if (!threshold.label || seen.has(threshold.label)) {
      continue;
    }
    seen.add(threshold.label);
    thresholds.push(thresholdDefinitionSchema.parse(threshold));
  }
  return thresholds.slice(0, 50);
}

function normalizeStringArray(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeForecastType(raw: unknown): ForecastInputRow["forecastType"] {
  const value = readString(raw);
  if (value === "binary" || value === "date" || value === "numeric" || value === "categorical" || value === "thresholded") {
    return value;
  }
  return undefined;
}

function normalizeThresholdDirection(raw: unknown): ThresholdDirection | undefined {
  const value = readString(raw);
  if (value === "at_least" || value === "at_most") {
    return value;
  }
  return undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
