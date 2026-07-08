/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import { codexResearchAgent } from "./agents";

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  claim: z.string(),
  publishedAt: z.string().optional(),
  sourceType: z.string().optional(),
});

const agenticPastcastingAttempt = z.object({
  forecasterLabel: z.string(),
  probability: z.number().min(0).max(100),
  rationale: z.string(),
  strongestYes: z.string(),
  strongestNo: z.string(),
  keyUncertainties: z.array(z.string()).default([]),
  premortem: z.string().default(""),
  wildcards: z.array(z.string()).default([]),
  searchQueries: z.array(z.string()).default([]),
  pagesRead: z.array(citedSource).default([]),
  citedSources: z.array(citedSource).default([]),
  cutoffComplianceNotes: z.string(),
  possibleLeakage: z.array(z.string()).default([]),
  humanForecastSourcesRead: z.array(citedSource).default([]),
  explicitProbabilityQuotes: z.array(z.string()).default([]),
  traceNotes: z.string(),
});

const agenticPastcastingAggregate = z.object({
  forecastType: z.literal("binary"),
  probability: z.number().min(0).max(100),
  method: z.string(),
  attemptCount: z.number().int(),
  rationale: z.string(),
  componentProbabilities: z.array(z.object({
    forecasterLabel: z.string(),
    probability: z.number(),
  })),
  citedSources: z.array(citedSource).default([]),
  searchQueries: z.array(z.string()).default([]),
  pagesReadCount: z.number().int(),
  sourceCount: z.number().int(),
  corpusMode: z.string(),
  presentDate: z.string(),
  cutoffDate: z.string(),
  cutoffPolicy: z.string(),
  cutoffComplianceNotes: z.string(),
  leakageFlags: z.array(z.string()).default([]),
  informationAdvantage: z.enum(["none", "market_visible", "market_used"]),
  humanForecastSourcesRead: z.array(citedSource).default([]),
  explicitProbabilityQuotes: z.array(z.string()).default([]),
  sourceQualitySummary: z.string(),
  traceCompletenessScore: z.number().min(0).max(1),
  traceProvenance: z.enum(["agent_reported", "harness_observed"]),
  runtimeCostNotes: z.string(),
  failureModeCandidates: z.array(z.string()).default([]),
});

const { Workflow, smithers, outputs } = createSmithers({
  agenticPastcastingAttempt,
  agenticPastcastingAggregate,
});

const forecasterBriefs = [
  {
    id: "base-rate",
    label: "base-rate forecaster",
    focus: "Start from reference classes and historical frequencies available at the present date.",
  },
  {
    id: "inside-view",
    label: "inside-view forecaster",
    focus: "Research concrete mechanisms, timelines, incentives, and blockers visible at the present date.",
  },
  {
    id: "skeptic",
    label: "skeptical forecaster",
    focus: "Hunt for leakage, misleading current evidence, resolution ambiguity, and ways the obvious answer fails.",
  },
];

export default smithers((ctx) => {
  const input = (ctx.input ?? {}) as {
    question?: unknown;
    prompt?: unknown;
    resolutionCriteria?: unknown;
    background?: unknown;
    presentDate?: unknown;
    cutoffDate?: unknown;
    corpusMode?: unknown;
    allowedCorpus?: unknown;
    cutoffMetadata?: unknown;
  };
  const question = String(input.question ?? input.prompt ?? "");
  const resolutionCriteria = String(input.resolutionCriteria ?? "Resolve according to the plain-language question.");
  const background = String(input.background ?? "");
  const presentDate = String(input.presentDate ?? "unspecified");
  const cutoffDate = String(input.cutoffDate ?? presentDate);
  const corpusMode = String(input.corpusMode ?? input.allowedCorpus ?? "live_web_date_bounded");
  const cutoffMetadata = JSON.stringify(input.cutoffMetadata ?? {}, null, 2);
  const attemptIds = forecasterBriefs.map((brief) => `attempt-${brief.id}`);
  const attemptNeeds = Object.fromEntries(attemptIds.map((id) => [id, id]));
  const attempts = ctx.outputs.agenticPastcastingAttempt ?? [];
  const componentProbabilities = attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    probability: attempt.probability,
  }));
  const probability = attempts.length
    ? Math.round(mean(attempts.map((attempt) => attempt.probability)) * 10) / 10
    : 50;
  const citedSources = dedupeSources(attempts.flatMap((attempt) => [
    ...(attempt.citedSources ?? []),
    ...(attempt.pagesRead ?? []),
  ]));
  const searchQueries = uniqueStrings(attempts.flatMap((attempt) => attempt.searchQueries ?? []));
  const humanForecastSourcesRead = dedupeSources(attempts.flatMap((attempt) => attempt.humanForecastSourcesRead ?? []));
  const explicitProbabilityQuotes = uniqueStrings(attempts.flatMap((attempt) => attempt.explicitProbabilityQuotes ?? []));
  const leakageFlags = uniqueStrings([
    ...attempts.flatMap((attempt) => attempt.possibleLeakage ?? []),
    ...postCutoffSourceFlags(citedSources, cutoffDate),
  ]);
  const informationAdvantage =
    humanForecastSourcesRead.length > 0 || explicitProbabilityQuotes.length > 0
      ? "market_used"
      : citedSources.some((source) => isForecastSource(source.url ?? "") || isForecastSource(source.title ?? ""))
        ? "market_visible"
        : "none";
  const traceCompletenessScore = traceScore({
    attempts: attempts.length,
    sourceCount: citedSources.length,
    queryCount: searchQueries.length,
    leakageCount: leakageFlags.length,
  });
  const failureModeCandidates = [
    ...(leakageFlags.length ? ["source_leakage"] : []),
    ...(informationAdvantage !== "none" ? ["information_advantage"] : []),
    ...(traceCompletenessScore < 0.7 ? ["trace_incomplete"] : []),
    ...(corpusMode === "live_web_date_bounded" ? ["weak_live_web_cutoff"] : []),
  ];

  return (
    <Workflow name="agentic-pastcasting-eval">
      <Sequence>
        <Parallel maxConcurrency={3}>
          {forecasterBriefs.map((brief) => (
            <Task
              key={brief.id}
              id={`attempt-${brief.id}`}
              output={outputs.agenticPastcastingAttempt}
              agent={codexResearchAgent}
            >
              {`You are the ${brief.label} for Open Superforecaster's agentic pastcasting eval.

This is an end-to-end benchmark case. The resolution is hidden. Do not search for "resolution", "answer", or post-outcome summaries. Your job is to forecast from the perspective of the present date.

Question:
${question}

Resolution criteria:
${resolutionCriteria}

Background:
${background || "No extra background provided."}

Present date:
${presentDate}

Cutoff date:
${cutoffDate}

Allowed corpus mode:
${corpusMode}

Cutoff metadata:
${cutoffMetadata}

Focus:
${brief.focus}

If you use live web, this is a weak date-bounded approximation: prefer sources published on or before the cutoff, record every query in searchQueries, every page read in pagesRead, and flag any source that may include post-cutoff information in possibleLeakage. If you read market, Metaculus, Manifold, Polymarket, Kalshi, bookmaker, analyst-probability, or explicit human forecast sources, list them in humanForecastSourcesRead and explicitProbabilityQuotes so the benchmark can separate forecasting from retrieving other people's forecasts.

Return a binary probability from 0 to 100 plus source, cutoff, leakage, and trace notes. Set forecasterLabel to "${brief.label}".`}
            </Task>
          ))}
        </Parallel>

        <Task id="aggregate" output={outputs.agenticPastcastingAggregate} needs={attemptNeeds}>
          {{
            forecastType: "binary",
            probability,
            method: "mean_agentic_pastcasting_rollouts_v0",
            attemptCount: attempts.length,
            componentProbabilities,
            citedSources,
            searchQueries,
            pagesReadCount: attempts.reduce((sum, attempt) => sum + (attempt.pagesRead?.length ?? 0), 0),
            sourceCount: citedSources.length,
            corpusMode,
            presentDate,
            cutoffDate,
            cutoffPolicy:
              corpusMode === "live_web_date_bounded"
                ? "Prompt-level live-web date bounding. This is useful for plumbing but vulnerable to leakage."
                : `Corpus-restricted mode: ${corpusMode}.`,
            cutoffComplianceNotes:
              leakageFlags.length === 0
                ? "No cutoff leakage was reported by the agents, but v1 relies on agent-reported provenance."
                : `Agents reported ${leakageFlags.length} possible cutoff leakage issue(s).`,
            leakageFlags,
            informationAdvantage,
            humanForecastSourcesRead,
            explicitProbabilityQuotes,
            sourceQualitySummary:
              citedSources.length === 0
                ? "No sources were reported; trace completeness is weak."
                : `Agents reported ${citedSources.length} deduped sources and ${searchQueries.length} search queries.`,
            traceCompletenessScore,
            traceProvenance: "agent_reported",
            runtimeCostNotes:
              "V1 records Smithers run IDs and agent-reported source traces; token/cost extraction remains pending OTEL ingestion.",
            failureModeCandidates,
            rationale:
              attempts.length === 0
                ? "No attempts were available; this fallback should only appear in graph rendering."
                : `Averaged ${attempts.length} differentiated live-research pastcasting attempts. Mean probability is ${probability}%.`,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function dedupeSources(sources: Array<z.infer<typeof citedSource>>) {
  const seen = new Set<string>();
  const deduped = [];
  for (const source of sources) {
    const key = `${source.url ?? ""}::${source.claim}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(source);
  }
  return deduped;
}

function postCutoffSourceFlags(sources: Array<z.infer<typeof citedSource>>, cutoffDate: string) {
  const cutoff = Date.parse(cutoffDate);
  if (!Number.isFinite(cutoff)) {
    return [];
  }
  return sources.flatMap((source) => {
    const publishedAt = source.publishedAt ? Date.parse(source.publishedAt) : Number.NaN;
    return Number.isFinite(publishedAt) && publishedAt > cutoff
      ? [`post_cutoff_source:${source.title ?? source.url ?? "untitled"}`]
      : [];
  });
}

function isForecastSource(value: string) {
  return /\b(metaculus|manifold|polymarket|kalshi|prediction market|bookmaker|odds|forecast)\b/i.test(value);
}

function traceScore(input: { attempts: number; sourceCount: number; queryCount: number; leakageCount: number }) {
  const raw =
    0.2 +
    Math.min(input.attempts, 3) * 0.12 +
    Math.min(input.sourceCount, 8) * 0.035 +
    Math.min(input.queryCount, 6) * 0.025 -
    Math.min(input.leakageCount, 4) * 0.05;
  return Math.max(0, Math.min(1, Math.round(raw * 100) / 100));
}
