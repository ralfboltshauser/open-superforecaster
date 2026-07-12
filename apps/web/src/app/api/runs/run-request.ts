import { classifyRunRequest } from "@open-superforecaster/backend";
import {
  normalizeForecastTemporalContext,
  type ForecastTemporalContext,
} from "@open-superforecaster/workflow-contracts";

type RunRequestBody = Record<string, unknown>;
type RunPlanOptions = {
  now?: Date | string;
};

export function createRunPlan(body: RunRequestBody, options: RunPlanOptions = {}) {
  const classification = classifyRunRequest({
    prompt: body.prompt,
    requestedMode: body.mode,
    forecastType: body.forecastType,
    workflow: body.workflow,
  });

  const workflow = classification.workflow;
  const isForecast = workflow.endsWith("-forecast");
  const isDeepResearch = workflow === "deep-research";
  const isAgentMap = workflow === "agent-map";
  const isRank = workflow === "rank";
  const isMerge = workflow === "merge";
  const isDedupe = workflow === "dedupe";
  const temporalContext = isForecast ? temporalContextForRunRequest(body, options.now) : undefined;
  const workflowPath = workflowPathFor({
    isAgentMap,
    isDeepResearch,
    isDedupe,
    isForecast,
    isMerge,
    isRank,
    workflow,
  });
  const rows = extractRows(body);
  const leftRows = extractObjectRows(body.leftRows ?? body.left);
  const rightRows = extractObjectRows(body.rightRows ?? body.right);
  const objectRows = extractObjectRows(body.rows);
  const rankRows = objectRows.length ? objectRows : rows;
  const independentTableRows = isAgentMap ? rows : isRank ? rankRows : [];
  const thresholds = extractThresholds(body);
  const categories = extractCategories(body, classification.forecastType);
  const prompt = String(body.prompt ?? "");
  const smithersInput = smithersInputFor({
    body,
    classification,
    isAgentMap,
    isDeepResearch,
    isDedupe,
    isForecast,
    isMerge,
    isRank,
    leftRows,
    objectRows,
    prompt,
    rankRows,
    rightRows,
    rows,
    temporalContext,
    thresholds,
    categories,
  });

  return {
    classification,
    configJson: {
      prompt: body.prompt,
      classification,
      ...(isForecast ? { forecastInput: smithersInput } : {}),
      ...(isAgentMap ? { rows } : {}),
      ...(isRank ? { rows: rankRows } : {}),
      ...(isMerge ? { leftRows, rightRows } : {}),
      ...(isDedupe ? { rows: objectRows } : {}),
    },
    independentTableRows,
    label: runLabel({
      forecastType: classification.forecastType,
      isAgentMap,
      isDeepResearch,
      isDedupe,
      isForecast,
      isMerge,
      isRank,
      mode: classification.mode,
    }),
    operationMode: classification.mode,
    operationSubmode: operationSubmodeFor({
      forecastType: classification.forecastType,
      isAgentMap,
      isDeepResearch,
      isDedupe,
      isForecast,
      isMerge,
      isRank,
      mode: classification.mode,
    }),
    schemaJson: schemaFor({
      forecastType: classification.forecastType,
      isAgentMap,
      isDeepResearch,
      isDedupe,
      isForecast,
      isMerge,
      isRank,
    }),
    smithersInput,
    workflow,
    workflowPath,
  };
}

function workflowPathFor(input: {
  isAgentMap: boolean;
  isDeepResearch: boolean;
  isDedupe: boolean;
  isForecast: boolean;
  isMerge: boolean;
  isRank: boolean;
  workflow: string;
}) {
  if (input.isForecast) {
    return `.smithers/workflows/${input.workflow}.tsx`;
  }
  if (input.isDeepResearch) {
    return ".smithers/workflows/deep-research.tsx";
  }
  if (input.isAgentMap) {
    return ".smithers/workflows/agent-map.tsx";
  }
  if (input.isRank) {
    return ".smithers/workflows/rank.tsx";
  }
  if (input.isMerge) {
    return ".smithers/workflows/merge.tsx";
  }
  if (input.isDedupe) {
    return ".smithers/workflows/dedupe.tsx";
  }
  return ".smithers/workflows/codex-smoke.tsx";
}

function operationSubmodeFor(input: {
  forecastType?: string;
  isAgentMap: boolean;
  isDeepResearch: boolean;
  isDedupe: boolean;
  isForecast: boolean;
  isMerge: boolean;
  isRank: boolean;
  mode: string;
}) {
  if (input.isForecast) {
    return `${input.forecastType ?? "binary"}_forecast`;
  }
  if (input.isDeepResearch) {
    return "deep_research";
  }
  if (input.isAgentMap) {
    return input.mode;
  }
  if (input.isRank) {
    return "rank";
  }
  if (input.isMerge || input.isDedupe) {
    return input.mode;
  }
  return `${input.mode}_placeholder`;
}

function runLabel(input: {
  forecastType?: string;
  isAgentMap: boolean;
  isDeepResearch: boolean;
  isDedupe: boolean;
  isForecast: boolean;
  isMerge: boolean;
  isRank: boolean;
  mode: string;
}) {
  if (input.isForecast) {
    return forecastLabel(input.forecastType);
  }
  if (input.isDeepResearch) {
    return "Deep research";
  }
  if (input.isAgentMap) {
    return `${input.mode} table run`;
  }
  if (input.isRank) {
    return "Rank table run";
  }
  if (input.isMerge || input.isDedupe) {
    return `${input.mode} table run`;
  }
  return `${input.mode} placeholder`;
}

function schemaFor(input: {
  forecastType?: string;
  isAgentMap: boolean;
  isDeepResearch: boolean;
  isDedupe: boolean;
  isForecast: boolean;
  isMerge: boolean;
  isRank: boolean;
}) {
  if (input.isForecast) {
    return forecastSchema(input.forecastType);
  }
  if (input.isDeepResearch) {
    return {
      type: "object",
      properties: {
        reportType: { const: "deep_research" },
        answer: { type: "string" },
      },
    };
  }
  if (input.isAgentMap) {
    return tableSchema("agent_map");
  }
  if (input.isRank) {
    return {
      type: "object",
      properties: {
        reportType: { const: "rank" },
        rowCount: { type: "number" },
        sortDirection: { enum: ["ascending", "descending"] },
        results: { type: "array" },
      },
    };
  }
  if (input.isMerge) {
    return {
      type: "object",
      properties: {
        reportType: { const: "merge" },
        rowCount: { type: "number" },
        mergeBreakdown: { type: "object" },
        results: { type: "array" },
      },
    };
  }
  if (input.isDedupe) {
    return {
      type: "object",
      properties: {
        reportType: { const: "dedupe" },
        rowCount: { type: "number" },
        classCount: { type: "number" },
        results: { type: "array" },
      },
    };
  }
  return undefined;
}

function tableSchema(reportType: string) {
  return {
    type: "object",
    properties: {
      reportType: { const: reportType },
      rowCount: { type: "number" },
      results: { type: "array" },
    },
  };
}

function smithersInputFor(input: {
  body: RunRequestBody;
  classification: ReturnType<typeof classifyRunRequest>;
  isAgentMap: boolean;
  isDeepResearch: boolean;
  isDedupe: boolean;
  isForecast: boolean;
  isMerge: boolean;
  isRank: boolean;
  leftRows: Array<Record<string, unknown>>;
  objectRows: Array<Record<string, unknown>>;
  prompt: string;
  rankRows: Array<Record<string, unknown>>;
  rightRows: Array<Record<string, unknown>>;
  rows: Array<Record<string, unknown>>;
  temporalContext: ForecastTemporalContext | undefined;
  thresholds: string[];
  categories: string[];
}) {
  if (input.isForecast) {
    return {
      source: "open-superforecaster-ui",
      question: input.prompt,
      resolutionCriteria: input.body.resolutionCriteria,
      resolutionDate: input.body.resolutionDate,
      forecastAsOf: input.temporalContext?.forecastAsOf,
      evidenceAsOf: input.temporalContext?.evidenceAsOf ?? null,
      cutoffDate: input.temporalContext?.cutoffDate ?? null,
      calibrationGuardVariant: input.body.calibrationGuardVariant,
      ...(input.classification.forecastType === "binary"
        ? { researchTreatment: normalizeResearchTreatment(input.body.researchTreatment) }
        : {}),
      background: input.body.background,
      marketPrice: input.body.marketPrice,
      marketPriceAsOf: input.body.marketPriceAsOf,
      marketCreationDate: input.body.marketCreationDate,
      marketPlatform: input.body.marketPlatform ?? input.body.platform,
      marketUrl: input.body.marketUrl,
      categories: input.categories,
      categoriesExhaustive: input.body.categoriesExhaustive,
      unit: input.body.unit ?? input.body.units,
      ...(input.classification.forecastType === "thresholded"
        ? {
            thresholds: input.thresholds,
            thresholdDirection: normalizeThresholdDirection(input.body.thresholdDirection, input.prompt),
            unit: typeof input.body.unit === "string" ? input.body.unit : typeof input.body.units === "string" ? input.body.units : undefined,
          }
        : {}),
      ...(input.classification.forecastType === "conditional"
        ? {
            condition: typeof input.body.condition === "string" ? input.body.condition : extractCondition(input.prompt),
            conditionResolutionCriteria:
              typeof input.body.conditionResolutionCriteria === "string" ? input.body.conditionResolutionCriteria : undefined,
          }
        : {}),
    };
  }
  if (input.isDeepResearch) {
    return {
      source: "open-superforecaster-ui",
      question: input.prompt,
      background: input.body.background,
    };
  }
  if (input.isAgentMap) {
    return {
      source: "open-superforecaster-ui",
      mode: input.classification.mode,
      prompt: input.prompt,
      objective: input.prompt || "Process each row.",
      rows: input.rows,
    };
  }
  if (input.isRank) {
    return {
      source: "open-superforecaster-ui",
      prompt: input.prompt,
      objective: input.prompt || "Rank rows by the requested criterion.",
      rows: input.rankRows,
      ascending: input.body.ascending,
      sortDirection: input.body.sortDirection,
      topN: input.body.topN,
    };
  }
  if (input.isMerge) {
    return {
      source: "open-superforecaster-ui",
      prompt: input.prompt,
      objective: input.prompt || "Merge left rows against right rows.",
      task: input.prompt || "Merge left rows against right rows.",
      leftRows: input.leftRows,
      rightRows: input.rightRows,
      leftKey: input.body.leftKey,
      rightKey: input.body.rightKey,
      relationshipType: input.body.relationshipType,
    };
  }
  if (input.isDedupe) {
    return {
      source: "open-superforecaster-ui",
      prompt: input.prompt,
      objective: input.prompt || "Find duplicate rows.",
      rows: input.objectRows.length ? input.objectRows : input.rows,
      equivalenceRelation: input.body.equivalenceRelation,
      strategy: input.body.strategy,
      strategyPrompt: input.body.strategyPrompt,
    };
  }
  return {
    source: "open-superforecaster-ui",
  };
}

function extractRows(body: RunRequestBody) {
  if (Array.isArray(body.rows)) {
    return body.rows
      .map((row, index) => normalizeInputRow(row, index))
      .filter((row) => row.input.trim().length > 0)
      .slice(0, 50);
  }

  const prompt = String(body.prompt ?? "");
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  const rows = lines.length > 1 ? lines : [prompt.trim()].filter(Boolean);
  return rows.slice(0, 50).map((line, index) => ({
    rowId: `row-${index + 1}`,
    input: line,
  }));
}

function normalizeInputRow(row: unknown, index: number) {
  if (typeof row === "string") {
    return { rowId: `row-${index + 1}`, input: row };
  }
  if (isRecord(row)) {
    return {
      rowId: String(row.rowId ?? row.id ?? `row-${index + 1}`),
      input: rowInput(row),
    };
  }
  return { rowId: `row-${index + 1}`, input: "" };
}

function rowInput(record: Record<string, unknown>) {
  const direct = record.input ?? record.value ?? record.text;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct;
  }
  const fields = Object.entries(record)
    .filter(([key]) => !["rowId", "row_id", "id"].includes(key))
    .map(([key, value]) => `${key}: ${String(value ?? "")}`)
    .filter((field) => !field.endsWith(": "));
  return fields.join("; ");
}

function extractObjectRows(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((row, index) => {
      if (typeof row === "string") {
        return { rowId: `row-${index + 1}`, input: row };
      }
      if (isRecord(row)) {
        return {
          ...row,
          rowId: String(row.rowId ?? row.id ?? `row-${index + 1}`),
          input: String(row.input ?? row.value ?? row.text ?? row.name ?? ""),
        };
      }
      return { rowId: `row-${index + 1}`, input: "" };
    })
    .filter((row) => String(row.input ?? "").trim().length > 0)
    .slice(0, 80);
}

function forecastLabel(forecastType: string | undefined) {
  if (forecastType === "date") {
    return "Date forecast";
  }
  if (forecastType === "numeric") {
    return "Numeric forecast";
  }
  if (forecastType === "categorical") {
    return "Categorical forecast";
  }
  if (forecastType === "thresholded") {
    return "Thresholded forecast";
  }
  if (forecastType === "conditional") {
    return "Conditional forecast";
  }
  return "Binary forecast";
}

function forecastSchema(forecastType: string | undefined) {
  const temporalProperties = {
    forecastAsOf: { type: "string" },
    evidenceAsOf: { type: "string" },
    cutoffDate: { type: "string" },
  };
  if (forecastType === "date") {
    return {
      type: "object",
      properties: {
        ...temporalProperties,
        forecastType: { const: "date" },
        targetDate: { type: "string" },
        dateDistribution: {
          type: "object",
          properties: {
            p10: { type: "string" },
            p25: { type: "string" },
            p50: { type: "string" },
            p75: { type: "string" },
            p90: { type: "string" },
          },
        },
      },
    };
  }
  if (forecastType === "numeric") {
    return {
      type: "object",
      properties: {
        ...temporalProperties,
        forecastType: { const: "numeric" },
        value: { type: "number" },
        distribution: {
          type: "object",
          properties: {
            p10: { type: "number" },
            p25: { type: "number" },
            p50: { type: "number" },
            p75: { type: "number" },
            p90: { type: "number" },
          },
        },
      },
    };
  }
  if (forecastType === "categorical") {
    return {
      type: "object",
      properties: {
        ...temporalProperties,
        forecastType: { const: "categorical" },
        topCategory: { type: "string" },
        categories: { type: "array" },
        probabilities: { type: "array" },
      },
    };
  }
  if (forecastType === "thresholded") {
    return {
      type: "object",
      properties: {
        ...temporalProperties,
        forecastType: { const: "thresholded" },
        thresholdDirection: { enum: ["at_least", "at_most"] },
        thresholdSource: { enum: ["caller", "question_extracted", "invalid"] },
        probabilities: { type: "array" },
      },
    };
  }
  if (forecastType === "conditional") {
    return {
      type: "object",
      properties: {
        ...temporalProperties,
        forecastType: { const: "conditional" },
        baseForecastType: { const: "binary" },
        probabilityGivenCondition: { type: "number" },
        probabilityGivenNotCondition: { type: "number" },
      },
    };
  }
  return {
    type: "object",
    properties: {
      ...temporalProperties,
      forecastType: { const: "binary" },
      probability: { type: "number" },
      rationale: { type: "string" },
      researchTreatment: {
        enum: ["no_external_research", "shared_frozen_dossier", "independent_research", "shared_plus_followup"],
      },
      forecastState: { type: "object" },
    },
  };
}

function temporalContextForRunRequest(body: RunRequestBody, now: Date | string | undefined): ForecastTemporalContext {
  const supplied = normalizeForecastTemporalContext(body);
  if (supplied.forecastAsOf) {
    return supplied;
  }
  const instant = now instanceof Date ? now : new Date(now ?? Date.now());
  if (!Number.isFinite(instant.getTime())) {
    throw new Error("Run-plan clock must be a valid date or ISO datetime.");
  }
  return {
    ...supplied,
    forecastAsOf: instant.toISOString(),
  };
}

function extractThresholds(body: RunRequestBody) {
  if (Array.isArray(body.thresholds)) {
    return body.thresholds.map((threshold) => String(threshold).trim()).filter(Boolean).slice(0, 50);
  }
  const prompt = String(body.prompt ?? "");
  // Resolution dates are context, not curve breakpoints. Remove common date
  // forms before extracting numeric thresholds so "July 31, 2026" cannot
  // silently add 31 and 2026 to a price curve.
  const withoutDates = prompt
    .replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b20\d{2}\b/g, " ");
  const matches = [...withoutDates.matchAll(/(?:[$€£]\s*)?\b\d+(?:\.\d+)?\s*(?:k|m|b|bn|million|billion|trillion|%|percent|launches|users|usd|dollars)?\b/gi)]
    .map((match) => match[0].trim())
    .filter((value, index, values) => values.indexOf(value) === index);
  return matches.slice(0, 50);
}

function extractCategories(body: RunRequestBody, forecastType: string | undefined) {
  if (Array.isArray(body.categories)) {
    return normalizeCategories(body.categories.map(String));
  }
  if (forecastType !== "categorical") {
    return [];
  }

  const prompt = String(body.prompt ?? "");
  const enumerated = prompt.match(/:\s*([^?]+)\?/)?.[1];
  if (!enumerated) {
    return [];
  }
  return normalizeCategories(enumerated.split(/\s*,\s*|\s+or\s+/i));
}

function normalizeCategories(values: string[]) {
  const categories = values
    .map((value) => value.trim().replace(/[.;:]$/, ""))
    .filter(Boolean)
    .map((value) => /^(?:or\s+)?(?:an?other|another)\b/i.test(value) ? "Other" : value);
  return [...new Map(categories.map((category) => [category.toLowerCase(), category])).values()].slice(0, 50);
}

function normalizeThresholdDirection(raw: unknown, prompt: string) {
  if (raw === "at_most") {
    return "at_most";
  }
  if (/\b(at most|no more than|under|below|before)\b/i.test(prompt)) {
    return "at_most";
  }
  return "at_least";
}

function normalizeResearchTreatment(raw: unknown) {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  if (
    raw === "no_external_research"
    || raw === "shared_frozen_dossier"
    || raw === "independent_research"
    || raw === "shared_plus_followup"
  ) {
    return raw;
  }
  throw new Error(`Unknown researchTreatment: ${String(raw)}`);
}

function extractCondition(prompt: string) {
  const match = prompt.match(/\b(?:if|conditional on|assuming|given that|provided that|conditioned on)\b\s+(.+?)(?:,|\bwhat\b|\bwill\b|\bhow\b|\bwhen\b)/i);
  return match?.[1]?.trim() || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
