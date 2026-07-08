/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import { codexResearchAgent } from "./agents";

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  claim: z.string(),
});

const numericAttempt = z.object({
  forecasterLabel: z.string(),
  value: z.number(),
  unit: z.string().default("units"),
  lowerBound: z.number().optional(),
  upperBound: z.number().optional(),
  rationale: z.string(),
  keyUncertainties: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const numericAggregate = z.object({
  forecastType: z.literal("numeric"),
  value: z.number(),
  unit: z.string(),
  distribution: z.object({
    low: z.number().optional(),
    median: z.number(),
    high: z.number().optional(),
  }),
  method: z.string(),
  attemptCount: z.number().int(),
  componentValues: z.array(z.object({
    forecasterLabel: z.string(),
    value: z.number(),
    unit: z.string().optional(),
  })),
  citedSources: z.array(citedSource).default([]),
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
  const input = (ctx.input ?? {}) as {
    question?: unknown;
    prompt?: unknown;
    resolutionCriteria?: unknown;
    background?: unknown;
  };
  const question = String(input.question ?? input.prompt ?? "");
  const resolutionCriteria = String(input.resolutionCriteria ?? "Resolve according to the plain-language question.");
  const background = String(input.background ?? "");
  const attemptIds = forecasterBriefs.map((brief) => `attempt-${brief.id}`);
  const attemptNeeds = Object.fromEntries(attemptIds.map((id) => [id, id]));
  const attempts = ctx.outputs.numericAttempt ?? [];
  const values = attempts.map((attempt) => attempt.value).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const mean = values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : 0;
  const unit = attempts.find((attempt) => attempt.unit)?.unit ?? "units";
  const componentValues = attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    value: attempt.value,
    unit: attempt.unit,
  }));
  const citedSources = attempts.flatMap((attempt) => attempt.citedSources ?? []);

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

Background:
${background || "No extra background provided."}

Focus:
${brief.focus}

Return a numeric forecast. Use value as a number, include unit, lowerBound, upperBound, rationale, key uncertainties, and cited sources when available. Set forecasterLabel to "${brief.label}".`}
            </Task>
          ))}
        </Parallel>

        <Task id="aggregate" output={outputs.numericAggregate} needs={attemptNeeds}>
          {{
            forecastType: "numeric",
            value: mean,
            unit,
            distribution: {
              low: values[0],
              median: values[Math.floor(values.length / 2)] ?? mean,
              high: values[values.length - 1],
            },
            method: "mean_of_three_differentiated_numeric_forecasters_v0",
            attemptCount: attempts.length,
            componentValues,
            citedSources,
            rationale:
              attempts.length === 0
                ? "No attempts were available; this fallback should only appear in graph rendering."
                : `Averaged ${attempts.length} differentiated numeric forecaster values and retained min/median/max as a rough distribution.`,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});
