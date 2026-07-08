/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import { codexResearchAgent } from "./agents";

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  claim: z.string(),
});

const dateAttempt = z.object({
  forecasterLabel: z.string(),
  targetDate: z.string(),
  earliestDate: z.string().optional(),
  latestDate: z.string().optional(),
  neverProbability: z.number().min(0).max(100).default(0),
  rationale: z.string(),
  keyUncertainties: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const dateAggregate = z.object({
  forecastType: z.literal("date"),
  targetDate: z.string(),
  dateDistribution: z.object({
    p10: z.string().optional(),
    p50: z.string(),
    p90: z.string().optional(),
  }),
  neverProbability: z.number().min(0).max(100),
  method: z.string(),
  attemptCount: z.number().int(),
  componentDates: z.array(z.object({
    forecasterLabel: z.string(),
    targetDate: z.string(),
    neverProbability: z.number().optional(),
  })),
  citedSources: z.array(citedSource).default([]),
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
  const attempts = ctx.outputs.dateAttempt ?? [];
  const sortedDates = attempts.map((attempt) => attempt.targetDate).filter(Boolean).sort();
  const p50 = sortedDates[Math.floor(sortedDates.length / 2)] ?? "unknown";
  const neverProbability = attempts.length
    ? Math.round((attempts.reduce((sum, attempt) => sum + (attempt.neverProbability ?? 0), 0) / attempts.length) * 10) / 10
    : 0;
  const componentDates = attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    targetDate: attempt.targetDate,
    neverProbability: attempt.neverProbability,
  }));
  const citedSources = attempts.flatMap((attempt) => attempt.citedSources ?? []);

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

Background:
${background || "No extra background provided."}

Focus:
${brief.focus}

Return a date forecast. Use ISO date strings like YYYY-MM-DD for targetDate, earliestDate, and latestDate when possible. Include neverProbability from 0 to 100, rationale, key uncertainties, and cited sources when available. Set forecasterLabel to "${brief.label}".`}
            </Task>
          ))}
        </Parallel>

        <Task id="aggregate" output={outputs.dateAggregate} needs={attemptNeeds}>
          {{
            forecastType: "date",
            targetDate: p50,
            dateDistribution: {
              p10: sortedDates[0],
              p50,
              p90: sortedDates[sortedDates.length - 1],
            },
            neverProbability,
            method: "median_of_three_differentiated_date_forecasters_v0",
            attemptCount: attempts.length,
            componentDates,
            citedSources,
            rationale:
              attempts.length === 0
                ? "No attempts were available; this fallback should only appear in graph rendering."
                : `Used the median target date from ${attempts.length} differentiated date forecasters and averaged never probabilities.`,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});
