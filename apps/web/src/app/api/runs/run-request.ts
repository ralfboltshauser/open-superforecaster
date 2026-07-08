import { classifyRunRequest } from "@open-superforecaster/backend";

type RunRequestBody = Record<string, unknown>;

export function createRunPlan(body: RunRequestBody) {
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
  const prompt = String(body.prompt ?? "");

  return {
    classification,
    configJson: {
      prompt: body.prompt,
      classification,
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
    smithersInput: smithersInputFor({
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
      thresholds,
    }),
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
  thresholds: string[];
}) {
  if (input.isForecast) {
    return {
      source: "open-superforecaster-ui",
      question: input.prompt,
      resolutionCriteria: input.body.resolutionCriteria,
      background: input.body.background,
      ...(input.classification.forecastType === "thresholded"
        ? {
            thresholds: input.thresholds,
            thresholdDirection: normalizeThresholdDirection(input.body.thresholdDirection, input.prompt),
            units: typeof input.body.units === "string" ? input.body.units : undefined,
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
  if (forecastType === "date") {
    return {
      type: "object",
      properties: {
        forecastType: { const: "date" },
        targetDate: { type: "string" },
        dateDistribution: { type: "object" },
      },
    };
  }
  if (forecastType === "numeric") {
    return {
      type: "object",
      properties: {
        forecastType: { const: "numeric" },
        value: { type: "number" },
        distribution: { type: "object" },
      },
    };
  }
  if (forecastType === "categorical") {
    return {
      type: "object",
      properties: {
        forecastType: { const: "categorical" },
        topCategory: { type: "string" },
        probabilities: { type: "array" },
      },
    };
  }
  if (forecastType === "thresholded") {
    return {
      type: "object",
      properties: {
        forecastType: { const: "thresholded" },
        thresholdDirection: { enum: ["at_least", "at_most"] },
        probabilities: { type: "array" },
      },
    };
  }
  if (forecastType === "conditional") {
    return {
      type: "object",
      properties: {
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
      forecastType: { const: "binary" },
      probability: { type: "number" },
      rationale: { type: "string" },
    },
  };
}

function extractThresholds(body: RunRequestBody) {
  if (Array.isArray(body.thresholds)) {
    return body.thresholds.map((threshold) => String(threshold).trim()).filter(Boolean).slice(0, 50);
  }
  const prompt = String(body.prompt ?? "");
  const matches = [...prompt.matchAll(/(?:[$€£]\s*)?\b\d+(?:\.\d+)?\s*(?:k|m|b|bn|million|billion|trillion|%|percent|launches|users|usd|dollars)?\b/gi)]
    .map((match) => match[0].trim())
    .filter((value, index, values) => values.indexOf(value) === index);
  return matches.slice(0, 50);
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

function extractCondition(prompt: string) {
  const match = prompt.match(/\b(?:if|conditional on|assuming|given that|provided that|conditioned on)\b\s+(.+?)(?:,|\bwhat\b|\bwill\b|\bhow\b|\bwhen\b)/i);
  return match?.[1]?.trim() || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
