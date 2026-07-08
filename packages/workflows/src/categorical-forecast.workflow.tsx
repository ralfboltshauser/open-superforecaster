/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import { codexResearchAgent } from "./agents";

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  claim: z.string(),
});

const categoryProbability = z.object({
  category: z.string(),
  probability: z.number().min(0).max(100),
});

const categoricalAttempt = z.object({
  forecasterLabel: z.string(),
  topCategory: z.string(),
  probabilities: z.array(categoryProbability).default([]),
  rationale: z.string(),
  keyUncertainties: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const categoricalAggregate = z.object({
  forecastType: z.literal("categorical"),
  topCategory: z.string(),
  probabilities: z.array(categoryProbability).default([]),
  method: z.string(),
  attemptCount: z.number().int(),
  componentCategories: z.array(z.object({
    forecasterLabel: z.string(),
    topCategory: z.string(),
  })),
  citedSources: z.array(citedSource).default([]),
  rationale: z.string(),
});

const { Workflow, smithers, outputs } = createSmithers({
  categoricalAttempt,
  categoricalAggregate,
});

const forecasterBriefs = [
  {
    id: "base-rate",
    label: "base-rate categorical forecaster",
    focus: "Start from historical frequencies and base-rate category shares before considering case-specific evidence.",
  },
  {
    id: "inside-view",
    label: "inside-view categorical forecaster",
    focus: "Evaluate the concrete contenders/options and current evidence for this exact question.",
  },
  {
    id: "skeptic",
    label: "skeptical categorical forecaster",
    focus: "Look for overlooked categories, ambiguous category definitions, and ways the apparent favorite could be wrong.",
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
  const attempts = ctx.outputs.categoricalAttempt ?? [];
  const categoryTotals = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.probabilities?.length) {
      for (const item of attempt.probabilities) {
        categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + item.probability);
      }
    } else {
      categoryTotals.set(attempt.topCategory, (categoryTotals.get(attempt.topCategory) ?? 0) + 100);
    }
  }
  const probabilities = [...categoryTotals.entries()]
    .map(([category, total]) => ({
      category,
      probability: attempts.length ? Math.round((total / attempts.length) * 10) / 10 : total,
    }))
    .sort((left, right) => right.probability - left.probability);
  const topCategory = probabilities[0]?.category ?? attempts[0]?.topCategory ?? "unknown";
  const componentCategories = attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    topCategory: attempt.topCategory,
  }));
  const citedSources = attempts.flatMap((attempt) => attempt.citedSources ?? []);

  return (
    <Workflow name="categorical-forecast">
      <Sequence>
        <Parallel maxConcurrency={3}>
          {forecasterBriefs.map((brief) => (
            <Task
              key={brief.id}
              id={`attempt-${brief.id}`}
              output={outputs.categoricalAttempt}
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

Return a categorical forecast. Include topCategory, a probability distribution over plausible categories using percentages from 0 to 100, rationale, key uncertainties, and cited sources when available. Set forecasterLabel to "${brief.label}".`}
            </Task>
          ))}
        </Parallel>

        <Task id="aggregate" output={outputs.categoricalAggregate} needs={attemptNeeds}>
          {{
            forecastType: "categorical",
            topCategory,
            probabilities,
            method: "mean_probability_distribution_of_three_differentiated_categorical_forecasters_v0",
            attemptCount: attempts.length,
            componentCategories,
            citedSources,
            rationale:
              attempts.length === 0
                ? "No attempts were available; this fallback should only appear in graph rendering."
                : `Averaged category probability distributions from ${attempts.length} differentiated categorical forecasters.`,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});
