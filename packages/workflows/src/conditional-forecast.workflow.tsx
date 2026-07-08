/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import { codexResearchAgent } from "./agents";

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  claim: z.string(),
});

const conditionalAttempt = z.object({
  forecasterLabel: z.string(),
  condition: z.string(),
  conditionProbability: z.number().min(0).max(100).optional(),
  probabilityGivenCondition: z.number().min(0).max(100),
  probabilityGivenNotCondition: z.number().min(0).max(100),
  rationaleGivenCondition: z.string(),
  rationaleGivenNotCondition: z.string(),
  branchRationale: z.string(),
  dependenceNotes: z.string(),
  conditionResolutionCriteria: z.string(),
  outcomeResolutionCriteria: z.string(),
  keyUncertainties: z.array(z.string()).default([]),
  premortem: z.string().default(""),
  wildcards: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const conditionalAggregate = z.object({
  forecastType: z.literal("conditional"),
  baseForecastType: z.literal("binary"),
  condition: z.string(),
  conditionProbability: z.number().min(0).max(100).optional(),
  probabilityGivenCondition: z.number().min(0).max(100),
  probabilityGivenNotCondition: z.number().min(0).max(100),
  probabilityDelta: z.number(),
  rationaleGivenCondition: z.string(),
  rationaleGivenNotCondition: z.string(),
  branchRationale: z.string(),
  dependenceNotes: z.string(),
  conditionResolutionCriteria: z.string(),
  outcomeResolutionCriteria: z.string(),
  method: z.string(),
  attemptCount: z.number().int(),
  componentBranches: z.array(z.object({
    forecasterLabel: z.string(),
    conditionProbability: z.number().optional(),
    probabilityGivenCondition: z.number(),
    probabilityGivenNotCondition: z.number(),
  })),
  citedSources: z.array(citedSource).default([]),
});

const { Workflow, smithers, outputs } = createSmithers({
  conditionalAttempt,
  conditionalAggregate,
});

const forecasterBriefs = [
  {
    id: "base-rate",
    label: "base-rate forecaster",
    focus: "Estimate how the condition changes the base rate and reference class for the outcome.",
  },
  {
    id: "inside-view",
    label: "inside-view forecaster",
    focus: "Reason through the causal mechanisms in the condition-true and condition-false worlds.",
  },
  {
    id: "skeptic",
    label: "skeptical forecaster",
    focus: "Look for cases where the condition is irrelevant, logically forcing, impossible, or misleadingly correlated.",
  },
];

export default smithers((ctx) => {
  const input = (ctx.input ?? {}) as {
    question?: unknown;
    prompt?: unknown;
    condition?: unknown;
    resolutionCriteria?: unknown;
    conditionResolutionCriteria?: unknown;
    background?: unknown;
  };
  const question = String(input.question ?? input.prompt ?? "");
  const condition = String(input.condition ?? inferCondition(question) ?? "the stated condition in the question");
  const conditionResolutionCriteria = String(input.conditionResolutionCriteria ?? `Resolve whether this condition occurred: ${condition}`);
  const outcomeResolutionCriteria = String(input.resolutionCriteria ?? "Resolve the outcome according to the plain-language question.");
  const background = String(input.background ?? "");
  const attemptIds = forecasterBriefs.map((brief) => `attempt-${brief.id}`);
  const attemptNeeds = Object.fromEntries(attemptIds.map((id) => [id, id]));
  const attempts = ctx.outputs.conditionalAttempt ?? [];
  const conditionProbabilities = attempts
    .map((attempt) => attempt.conditionProbability)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const probabilityGivenCondition = roundOne(median(attempts.map((attempt) => attempt.probabilityGivenCondition)));
  const probabilityGivenNotCondition = roundOne(median(attempts.map((attempt) => attempt.probabilityGivenNotCondition)));
  const conditionProbability = conditionProbabilities.length ? roundOne(median(conditionProbabilities)) : undefined;
  const componentBranches = attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    conditionProbability: attempt.conditionProbability,
    probabilityGivenCondition: attempt.probabilityGivenCondition,
    probabilityGivenNotCondition: attempt.probabilityGivenNotCondition,
  }));
  const citedSources = attempts.flatMap((attempt) => attempt.citedSources ?? []);

  return (
    <Workflow name="conditional-forecast">
      <Sequence>
        <Parallel maxConcurrency={3}>
          {forecasterBriefs.map((brief) => (
            <Task
              key={brief.id}
              id={`attempt-${brief.id}`}
              output={outputs.conditionalAttempt}
              agent={codexResearchAgent}
            >
              {`You are the ${brief.label} for Open Superforecaster.

Question:
${question}

Condition:
${condition}

Condition resolution criteria:
${conditionResolutionCriteria}

Outcome resolution criteria:
${outcomeResolutionCriteria}

Background:
${background || "No extra background provided."}

Focus:
${brief.focus}

Return a joint binary conditional forecast. Keep these quantities separate:
- P(condition), optional context only.
- P(outcome | condition): assume the condition is true; do not reforecast whether it occurs.
- P(outcome | not condition): assume the condition is false; do not reforecast whether it occurs.

Explain why the condition changes, or does not change, the outcome. Include branch rationales, dependence notes, uncertainties, premortem, wildcards, and cited sources when available. Set forecasterLabel to "${brief.label}".`}
            </Task>
          ))}
        </Parallel>

        <Task id="aggregate" output={outputs.conditionalAggregate} needs={attemptNeeds}>
          {{
            forecastType: "conditional",
            baseForecastType: "binary",
            condition,
            conditionProbability,
            probabilityGivenCondition,
            probabilityGivenNotCondition,
            probabilityDelta: roundOne(probabilityGivenCondition - probabilityGivenNotCondition),
            rationaleGivenCondition:
              attempts.length === 0
                ? "No branch attempts were available."
                : `Median P(outcome | condition) across ${attempts.length} forecasters is ${probabilityGivenCondition}%.`,
            rationaleGivenNotCondition:
              attempts.length === 0
                ? "No branch attempts were available."
                : `Median P(outcome | not condition) across ${attempts.length} forecasters is ${probabilityGivenNotCondition}%.`,
            branchRationale:
              attempts.length === 0
                ? "No attempts were available; this fallback should only appear in graph rendering."
                : "Branches were forecast jointly so evidence was shared and differences reflect the condition assumption.",
            dependenceNotes:
              Math.abs(probabilityGivenCondition - probabilityGivenNotCondition) < 5
                ? "Branches are close; the aggregate implies the condition has limited marginal effect or uncertainty dominates."
                : `Branches differ by ${roundOne(probabilityGivenCondition - probabilityGivenNotCondition)} percentage points.`,
            conditionResolutionCriteria,
            outcomeResolutionCriteria,
            method: "joint_binary_conditional_median_branches_v0",
            attemptCount: attempts.length,
            componentBranches,
            citedSources,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});

function inferCondition(question: string) {
  const match = question.match(/\b(?:if|conditional on|assuming|given that|provided that)\b\s+(.+?)(?:,|\bwhat\b|\bwill\b|\bhow\b|\bwhen\b)/i);
  return match?.[1]?.trim() || null;
}

function median(values: number[]) {
  if (values.length === 0) {
    return 50;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
