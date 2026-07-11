/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import {
  dateQuantileDistributionSchema,
  formatForecastContextForPrompt,
  normalizeForecastInputRow,
} from "@open-superforecaster/workflow-contracts";
import { codexResearchAgent } from "./agents";
import { collectCitedSources, collectKeyUncertainties } from "./forecast-evidence";
import { forecastTimingArtifactFields, readForecastTiming } from "./forecast-timing";

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  publishedAt: z.string().optional(),
  claim: z.string(),
});

const dateAttempt = z.object({
  forecasterLabel: z.string(),
  dateDistribution: dateQuantileDistributionSchema,
  neverProbability: z.number().min(0).max(100).default(0),
  rationale: z.string(),
  keyUncertainties: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const dateAggregate = z.object({
  forecastType: z.literal("date"),
  targetDate: z.string(),
  dateDistribution: dateQuantileDistributionSchema,
  neverProbability: z.number().min(0).max(100),
  method: z.string(),
  attemptCount: z.number().int(),
  componentDates: z.array(z.object({
    forecasterLabel: z.string(),
    targetDate: z.string(),
    dateDistribution: dateQuantileDistributionSchema,
    neverProbability: z.number().optional(),
  })),
  citedSources: z.array(citedSource).default([]),
  keyUncertainties: z.array(z.string()).default([]),
  forecastAsOf: z.string().optional(),
  evidenceAsOf: z.string().optional(),
  cutoffDate: z.string().optional(),
  evidenceAsOfDate: z.string().optional(),
  rationale: z.string(),
});

const { Workflow, smithers, outputs } = createSmithers({
  dateAttempt,
  dateAggregate,
});

const forecasterBriefs = [
  {
    id: "base-rate",
    label: "base-rate date forecaster",
    focus: "Start from historical timelines and comparable events before case-specific evidence.",
  },
  {
    id: "inside-view",
    label: "inside-view date forecaster",
    focus: "Focus on concrete mechanisms, dependencies, blockers, and schedule evidence for this exact event.",
  },
  {
    id: "skeptic",
    label: "skeptical date forecaster",
    focus: "Look for reasons the event might be delayed, never happen, or have ambiguous resolution timing.",
  },
];

export default smithers((ctx) => {
  const rawInput = (ctx.input ?? {}) as Record<string, unknown>;
  const forecastInput = normalizeForecastInputRow(rawInput);
  const question = forecastInput.question;
  const resolutionCriteria = forecastInput.resolutionCriteria ?? "Resolve according to the plain-language question.";
  const background = forecastInput.background ?? "";
  const structuredContext = formatForecastContextForPrompt(forecastInput);
  const timing = readForecastTiming(rawInput);
  const attemptIds = forecasterBriefs.map((brief) => `attempt-${brief.id}`);
  const attemptNeeds = Object.fromEntries(attemptIds.map((id) => [id, id]));
  const attempts = ctx.outputs.dateAttempt ?? [];
  const aggregateDistribution = {
    p10: medianDate(attempts.map((attempt) => attempt.dateDistribution.p10)),
    p25: medianDate(attempts.map((attempt) => attempt.dateDistribution.p25)),
    p50: medianDate(attempts.map((attempt) => attempt.dateDistribution.p50)),
    p75: medianDate(attempts.map((attempt) => attempt.dateDistribution.p75)),
    p90: medianDate(attempts.map((attempt) => attempt.dateDistribution.p90)),
  };
  const neverProbability = attempts.length
    ? Math.round((attempts.reduce((sum, attempt) => sum + (attempt.neverProbability ?? 0), 0) / attempts.length) * 10) / 10
    : 0;
  const componentDates = attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    targetDate: attempt.dateDistribution.p50,
    dateDistribution: attempt.dateDistribution,
    neverProbability: attempt.neverProbability,
  }));
  const citedSources = collectCitedSources(attempts);
  const keyUncertainties = collectKeyUncertainties(attempts);

  return (
    <Workflow name="date-forecast">
      <Sequence>
        <Parallel maxConcurrency={3}>
          {forecasterBriefs.map((brief) => (
            <Task
              key={brief.id}
              id={`attempt-${brief.id}`}
              output={outputs.dateAttempt}
              agent={codexResearchAgent}
            >
              {`You are the ${brief.label} for Open Superforecaster.

Question:
${question}

Resolution criteria:
${resolutionCriteria}

${structuredContext}

${timing.promptBlock}

Background:
${background || "No extra background provided."}

Focus:
${brief.focus}

Return a date forecast as a calibrated date distribution. Provide dateDistribution with p10, p25, p50, p75, and p90 using ISO date strings like YYYY-MM-DD. Earlier quantiles should not come after later quantiles. Include neverProbability from 0 to 100, rationale, key uncertainties, and cited sources when available. For cited sources, include publishedAt as an ISO date when the source date is known; omit it when unknown. Set forecasterLabel to "${brief.label}".`}
            </Task>
          ))}
        </Parallel>

        <Task id="aggregate" output={outputs.dateAggregate} needs={attemptNeeds}>
          {{
            forecastType: "date",
            targetDate: aggregateDistribution.p50,
            dateDistribution: aggregateDistribution,
            neverProbability,
            method: "median_date_quantiles_of_three_differentiated_forecasters_v1",
            attemptCount: attempts.length,
            componentDates,
            citedSources,
            keyUncertainties,
            ...forecastTimingArtifactFields(timing),
            rationale:
              attempts.length === 0
                ? "No attempts were available; this fallback should only appear in graph rendering."
                : `Aggregated ${attempts.length} differentiated date distributions by taking the median date for each requested quantile and averaged never probabilities.`,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});

function medianDate(values: string[]) {
  const datedValues = values
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((item) => item.value && Number.isFinite(item.time))
    .sort((left, right) => left.time - right.time);
  if (datedValues.length === 0) {
    return "unknown";
  }
  return datedValues[Math.floor(datedValues.length / 2)]?.value ?? "unknown";
}
