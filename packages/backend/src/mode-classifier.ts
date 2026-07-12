import type { OperationMode } from "@open-superforecaster/workflow-contracts";

export type RunClassification = {
  mode: OperationMode;
  forecastType?: "binary" | "date" | "numeric" | "categorical" | "thresholded" | "conditional";
  confidence: number;
  requiresTable: boolean;
  rationale: string;
  suggestedEffort: "low" | "medium" | "high";
  workflow:
    | "binary-forecast"
    | "date-forecast"
    | "numeric-forecast"
    | "categorical-forecast"
    | "thresholded-forecast"
    | "conditional-forecast"
    | "deep-research"
    | "agent-map"
    | "rank"
    | "merge"
    | "dedupe"
    | "codex-smoke";
};

const manualModes = new Set<OperationMode>([
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

export function classifyRunRequest(input: {
  prompt?: unknown;
  requestedMode?: unknown;
  forecastType?: unknown;
  workflow?: unknown;
}): RunClassification {
  const prompt = String(input.prompt ?? "").trim();
  const requestedMode = String(input.requestedMode ?? "auto");
  const workflow = String(input.workflow ?? "");
  const requestedForecastType = normalizeForecastType(input.forecastType);

  if (isForecastWorkflow(workflow)) {
    const forecastType = forecastTypeForWorkflow(workflow);
    return {
      mode: "forecast",
      forecastType,
      confidence: 1,
      requiresTable: false,
      rationale: "Explicit workflow request.",
      suggestedEffort: "medium",
      workflow,
    };
  }

  if (workflow === "codex-smoke") {
    return {
      mode: "fixed_evidence_eval",
      confidence: 1,
      requiresTable: false,
      rationale: "Explicit smoke workflow request.",
      suggestedEffort: "low",
      workflow: "codex-smoke",
    };
  }

  if (workflow === "deep-research") {
    return {
      mode: "multi_agent",
      confidence: 1,
      requiresTable: false,
      rationale: "Explicit deep-research workflow request.",
      suggestedEffort: "high",
      workflow: "deep-research",
    };
  }

  if (workflow === "agent-map") {
    return {
      mode: "agent_map",
      confidence: 1,
      requiresTable: true,
      rationale: "Explicit agent-map workflow request.",
      suggestedEffort: "medium",
      workflow: "agent-map",
    };
  }

  if (workflow === "rank") {
    return {
      mode: "rank",
      confidence: 1,
      requiresTable: true,
      rationale: "Explicit rank workflow request.",
      suggestedEffort: "medium",
      workflow: "rank",
    };
  }

  if (workflow === "merge" || workflow === "dedupe") {
    return {
      mode: workflow,
      confidence: 1,
      requiresTable: true,
      rationale: `Explicit ${workflow} workflow request.`,
      suggestedEffort: "medium",
      workflow,
    };
  }

  if (requestedMode === "forecast" || (requestedMode === "auto" && requestedForecastType)) {
    const forecastType = requestedForecastType ?? inferForecastType(prompt.toLowerCase());
    return {
      mode: "forecast",
      forecastType,
      confidence: 1,
      requiresTable: false,
      rationale: requestedMode === "forecast" ? "Manual mode override." : "Manual forecast type override.",
      suggestedEffort: "medium",
      workflow: workflowForForecastType(forecastType),
    };
  }

  if (manualModes.has(requestedMode as OperationMode)) {
    const mode = requestedMode as OperationMode;
    if (mode === "multi_agent") {
      return {
        mode,
        confidence: 1,
        requiresTable: false,
        rationale: "Manual mode override.",
        suggestedEffort: "high",
        workflow: "deep-research",
      };
    }
    if (mode === "rank") {
      return {
        mode,
        confidence: 1,
        requiresTable: true,
        rationale: "Manual mode override.",
        suggestedEffort: "medium",
        workflow: "rank",
      };
    }
    if (mode === "agent_map" || mode === "classify") {
      return {
        mode,
        confidence: 1,
        requiresTable: true,
        rationale: "Manual mode override.",
        suggestedEffort: "medium",
        workflow: "agent-map",
      };
    }
    if (mode === "merge" || mode === "dedupe") {
      return {
        mode,
        confidence: 1,
        requiresTable: true,
        rationale: "Manual mode override.",
        suggestedEffort: "medium",
        workflow: mode,
      };
    }

    return {
      mode,
      confidence: 1,
      requiresTable: ["agent_map", "rank", "classify", "merge", "dedupe"].includes(mode),
      rationale: "Manual eval/internal mode override; use Benchmark Lab for full eval workflows. The generic runs endpoint launches the smoke workflow for this mode.",
      suggestedEffort: "medium",
      workflow: "codex-smoke",
    };
  }

  const lower = prompt.toLowerCase();
  const tableIntent = /\b(csv|spreadsheet|table|each row|rows|dataset|list of)\b/.test(lower);

  if (/\b(dedupe|deduplicate|duplicates|near duplicates)\b/.test(lower)) {
    return routeNonForecast("dedupe", true, "Prompt asks for duplicate detection.");
  }

  if (/\b(merge|join|reconcile|match records|entity resolution)\b/.test(lower)) {
    return routeNonForecast("merge", true, "Prompt asks for record matching or merging.");
  }

  if (/\b(rank|ranking|top \d+|best|worst|order by|prioritize)\b/.test(lower)) {
    return routeNonForecast("rank", tableIntent, "Prompt asks for ranking.");
  }

  if (/\b(classify|classification|categorize|category|label|tag)\b/.test(lower)) {
    return routeNonForecast("classify", tableIntent, "Prompt asks for classification.");
  }

  if (tableIntent) {
    return routeNonForecast("agent_map", true, "Prompt appears to require row-wise table processing.");
  }

  if (looksLikeForecast(lower)) {
    const forecastType = inferForecastType(lower);
    return {
      mode: "forecast",
      forecastType,
      confidence: 0.74,
      requiresTable: false,
      rationale: "Prompt asks about an uncertain future outcome or probability.",
      suggestedEffort: "medium",
      workflow: workflowForForecastType(forecastType),
    };
  }

  return routeNonForecast("multi_agent", false, "Defaulting to deep research for open-ended non-table prompts.");
}

function routeNonForecast(mode: Exclude<OperationMode, "forecast">, requiresTable: boolean, rationale: string): RunClassification {
  if (mode === "multi_agent") {
    return {
      mode,
      confidence: 0.68,
      requiresTable,
      rationale,
      suggestedEffort: "high",
      workflow: "deep-research",
    };
  }

  if (mode === "rank") {
    return {
      mode,
      confidence: 0.68,
      requiresTable,
      rationale,
      suggestedEffort: "medium",
      workflow: "rank",
    };
  }

  if (mode === "agent_map" || mode === "classify") {
    return {
      mode,
      confidence: 0.68,
      requiresTable,
      rationale,
      suggestedEffort: "medium",
      workflow: "agent-map",
    };
  }

  if (mode === "merge" || mode === "dedupe") {
    return {
      mode,
      confidence: 0.68,
      requiresTable: true,
      rationale,
      suggestedEffort: "medium",
      workflow: mode,
    };
  }

  return {
    mode,
    confidence: 0.68,
    requiresTable,
    rationale: `${rationale} This mode is not a direct product run workflow in the generic runs endpoint; use Benchmark Lab or an explicit workflow entrypoint for eval modes. The generic endpoint queues the smoke workflow.`,
    suggestedEffort: "medium",
    workflow: "codex-smoke",
  };
}

function looksLikeForecast(lower: string) {
  return (
    /\b(will|by \d{4}|before \d{4}|in \d{4}|probability|chance|odds|forecast|predict|resolve|happen|achieve|reach)\b/.test(lower) ||
    /\?$/.test(lower)
  );
}

function inferForecastType(lower: string): RunClassification["forecastType"] {
  if (looksConditional(lower)) {
    return "conditional";
  }
  if (looksBinaryQuestion(lower)) {
    return "binary";
  }
  if (looksThresholded(lower)) {
    return "thresholded";
  }
  if (/\b(when|what (?:calendar )?date|by what (?:calendar )?date)\b/.test(lower)) {
    return "date";
  }
  if (/\b(how many|how much|what (?:will|is) (?:the )?(?:value|amount|level|price|count)|number|count|value|amount|level|price|revenue|temperature|index points|launches|users)\b/.test(lower)) {
    return "numeric";
  }
  if (/\b(which|who|winner|category)\b/.test(lower)) {
    return "categorical";
  }
  return "binary";
}

function normalizeForecastType(value: unknown): RunClassification["forecastType"] | null {
  const normalized = String(value ?? "").trim();
  if (["binary", "date", "numeric", "categorical", "thresholded", "conditional"].includes(normalized)) {
    return normalized as RunClassification["forecastType"];
  }
  return null;
}

function isForecastWorkflow(workflow: string): workflow is Extract<RunClassification["workflow"], `${string}-forecast`> {
  return ["binary-forecast", "date-forecast", "numeric-forecast", "categorical-forecast", "thresholded-forecast", "conditional-forecast"].includes(workflow);
}

function forecastTypeForWorkflow(workflow: Extract<RunClassification["workflow"], `${string}-forecast`>): NonNullable<RunClassification["forecastType"]> {
  if (workflow === "date-forecast") {
    return "date";
  }
  if (workflow === "numeric-forecast") {
    return "numeric";
  }
  if (workflow === "categorical-forecast") {
    return "categorical";
  }
  if (workflow === "thresholded-forecast") {
    return "thresholded";
  }
  if (workflow === "conditional-forecast") {
    return "conditional";
  }
  return "binary";
}

function workflowForForecastType(forecastType: RunClassification["forecastType"]): Extract<RunClassification["workflow"], `${string}-forecast`> {
  if (forecastType === "date") {
    return "date-forecast";
  }
  if (forecastType === "numeric") {
    return "numeric-forecast";
  }
  if (forecastType === "categorical") {
    return "categorical-forecast";
  }
  if (forecastType === "thresholded") {
    return "thresholded-forecast";
  }
  if (forecastType === "conditional") {
    return "conditional-forecast";
  }
  return "binary-forecast";
}

function looksConditional(lower: string) {
  if (/\b(conditional on|assuming|given that|provided that|conditioned on)\b/.test(lower)) {
    return true;
  }

  // A bare "if" in a resolution rule (for example, "Resolve Yes if...")
  // describes how a binary question resolves; it is not a conditional forecast.
  // Reserve bare-if detection for prompts whose question is explicitly conditioned
  // at the beginning of a sentence.
  return /(?:^|[.!?]\s+)if\b[^?]{1,300},\s*(?:what|when|which|who|will|would|is|are|how|estimate|forecast|predict)\b/.test(lower);
}

function looksBinaryQuestion(lower: string) {
  return /^\s*(will|did|does|do|is|are|was|were|has|have|had|can|could|should)\b/.test(lower);
}

function looksThresholded(lower: string) {
  const numericLikeCount = (lower.match(/\b\d+(?:\.\d+)?\s*(?:k|m|b|bn|million|billion|trillion|%|percent|launches|users)?\b/g) ?? []).length;
  const hasThresholdVocabulary = /\b(threshold|thresholds|cutoff|cutoffs|breakpoint|breakpoints|bins)\b/.test(lower);
  const asksForMultipleProbabilities = /\b(probabilities|chances|odds)\b/.test(lower);
  const hasComparativeThreshold = /\b(exceed|exceeds|exceeded|above|over|at least|at most|below|under)\b/.test(lower);
  return (
    numericLikeCount >= 2 &&
    (hasThresholdVocabulary || (asksForMultipleProbabilities && hasComparativeThreshold))
  );
}
