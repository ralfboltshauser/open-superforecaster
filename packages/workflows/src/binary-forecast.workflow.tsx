/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import { codexResearchAgent } from "./agents";

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  claim: z.string(),
});

const binaryAttempt = z.object({
  forecasterLabel: z.string(),
  probability: z.number().min(0).max(100),
  rationale: z.string(),
  strongestYes: z.string(),
  strongestNo: z.string(),
  keyUncertainties: z.array(z.string()).default([]),
  premortem: z.string().default(""),
  wildcards: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const binaryAggregate = z.object({
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
});

const { Workflow, smithers, outputs } = createSmithers({
  binaryAttempt,
  binaryAggregate,
});

const forecasterBriefs = [
  {
    id: "base-rate",
    label: "base-rate forecaster",
    focus: "Start from base rates, reference classes, and historical frequency before considering case-specific evidence.",
  },
  {
    id: "inside-view",
    label: "inside-view forecaster",
    focus: "Focus on the concrete mechanisms, current evidence, timelines, incentives, and blockers for this exact question.",
  },
  {
    id: "skeptic",
    label: "skeptical forecaster",
    focus: "Look for ways the obvious answer could be wrong, missing evidence, resolution ambiguity, and downside scenarios.",
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
  const attempts = ctx.outputs.binaryAttempt ?? [];
  const componentProbabilities = attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    probability: attempt.probability,
  }));
  const probability = attempts.length
    ? Math.round((attempts.reduce((sum, attempt) => sum + attempt.probability, 0) / attempts.length) * 10) / 10
    : 50;
  const citedSources = attempts.flatMap((attempt) => attempt.citedSources ?? []);

  return (
    <Workflow name="binary-forecast">
      <Sequence>
        <Parallel maxConcurrency={3}>
          {forecasterBriefs.map((brief) => (
            <Task
              key={brief.id}
              id={`attempt-${brief.id}`}
              output={outputs.binaryAttempt}
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

Return a binary forecast. Use probability as a number from 0 to 100. Include strongest yes/no arguments, key uncertainties, premortem, wildcards, and cited sources when available. Set forecasterLabel to "${brief.label}".`}
            </Task>
          ))}
        </Parallel>

        <Task id="aggregate" output={outputs.binaryAggregate} needs={attemptNeeds}>
          {{
            forecastType: "binary",
            probability,
            method: "mean_of_three_differentiated_forecasters_v0",
            attemptCount: attempts.length,
            componentProbabilities,
            citedSources,
            rationale:
              attempts.length === 0
                ? "No attempts were available; this fallback should only appear in graph rendering."
                : `Averaged ${attempts.length} differentiated forecaster probabilities. Review component attempts for disagreement and source quality.`,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});
