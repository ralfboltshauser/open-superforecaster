/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import {
  formatForecastContextForPrompt,
  normalizeForecastInputRow,
  numericQuantileDistributionSchema,
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

const numericAttempt = z.object({
  forecasterLabel: z.string(),
  unit: z.string().default("units"),
  quantiles: numericQuantileDistributionSchema,
  rationale: z.string(),
  keyUncertainties: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const numericAggregate = z.object({
  forecastType: z.literal("numeric"),
  value: z.number(),
  unit: z.string(),
  distribution: numericQuantileDistributionSchema.extend({
    low: z.number(),
    median: z.number(),
    high: z.number(),
  }),
  method: z.string(),
  attemptCount: z.number().int(),
  componentValues: z.array(z.object({
    forecasterLabel: z.string(),
    unit: z.string().optional(),
    quantiles: numericQuantileDistributionSchema,
    value: z.number(),
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
  numericAttempt,
  numericAggregate,
});

const forecasterBriefs = [
  {
    id: "base-rate",
    label: "base-rate numeric forecaster",
    focus: "Start from historical values, reference classes, and trend baselines before case-specific adjustments.",
  },
  {
    id: "inside-view",
    label: "inside-view numeric forecaster",
    focus: "Estimate from concrete drivers, constraints, current run rate, and known plans for this exact quantity.",
  },
  {
    id: "skeptic",
    label: "skeptical numeric forecaster",
    focus: "Look for caps, measurement ambiguity, downside cases, and reasons the apparent trend could fail.",
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
  const requestedUnit = forecastInput.unit;
  const attemptIds = forecasterBriefs.map((brief) => `attempt-${brief.id}`);
  const attemptNeeds = Object.fromEntries(attemptIds.map((id) => [id, id]));
  const attempts = ctx.outputs.numericAttempt ?? [];
  const unit = requestedUnit ?? attempts.find((attempt) => attempt.unit)?.unit ?? "units";
  const aggregateQuantiles = {
    p10: roundTwo(median(attempts.map((attempt) => attempt.quantiles.p10))),
    p25: roundTwo(median(attempts.map((attempt) => attempt.quantiles.p25))),
    p50: roundTwo(median(attempts.map((attempt) => attempt.quantiles.p50))),
    p75: roundTwo(median(attempts.map((attempt) => attempt.quantiles.p75))),
    p90: roundTwo(median(attempts.map((attempt) => attempt.quantiles.p90))),
  };
  const componentValues = attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    unit: attempt.unit,
    quantiles: attempt.quantiles,
    value: attempt.quantiles.p50,
  }));
  const citedSources = collectCitedSources(attempts);
  const keyUncertainties = collectKeyUncertainties(attempts);

  return (
    <Workflow name="numeric-forecast">
      <Sequence>
        <Parallel maxConcurrency={3}>
          {forecasterBriefs.map((brief) => (
            <Task
              key={brief.id}
              id={`attempt-${brief.id}`}
              output={outputs.numericAttempt}
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

${requestedUnit ? `Requested unit: ${requestedUnit}` : "No requested unit was provided; state the unit you use explicitly."}

Focus:
${brief.focus}

Return a numeric forecast as a calibrated distribution, not only a point estimate. Provide quantiles p10, p25, p50, p75, and p90 as numbers in one consistent unit. The quantiles must be monotonic: p10 <= p25 <= p50 <= p75 <= p90. Include unit, rationale, key uncertainties, and cited sources when available. For cited sources, include publishedAt as an ISO date when the source date is known; omit it when unknown. Set forecasterLabel to "${brief.label}".`}
            </Task>
          ))}
        </Parallel>

        <Task id="aggregate" output={outputs.numericAggregate} needs={attemptNeeds}>
          {{
            forecastType: "numeric",
            value: aggregateQuantiles.p50,
            unit,
            distribution: {
              ...aggregateQuantiles,
              low: aggregateQuantiles.p10,
              median: aggregateQuantiles.p50,
              high: aggregateQuantiles.p90,
            },
            method: "median_quantiles_of_three_differentiated_numeric_forecasters_v1",
            attemptCount: attempts.length,
            componentValues,
            citedSources,
            keyUncertainties,
            ...forecastTimingArtifactFields(timing),
            rationale:
              attempts.length === 0
                ? "No attempts were available; this fallback should only appear in graph rendering."
                : `Aggregated ${attempts.length} differentiated numeric forecaster distributions by taking the median of each requested quantile.`,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});

function median(values: number[]) {
  const finiteValues = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (finiteValues.length === 0) {
    return 0;
  }
  const middle = Math.floor(finiteValues.length / 2);
  return finiteValues.length % 2 === 0 ? (finiteValues[middle - 1] + finiteValues[middle]) / 2 : finiteValues[middle];
}

function roundTwo(value: number) {
  return Math.round(value * 100) / 100;
}
