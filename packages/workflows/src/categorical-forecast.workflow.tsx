/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import {
  formatForecastContextForPrompt,
  normalizeForecastInputRow,
} from "@open-superforecaster/workflow-contracts";
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
  categories: z.array(z.string()).default([]),
  categoriesExhaustive: z.boolean().default(false),
  categorySource: z.enum(["caller", "caller_with_other", "model_generated"]).default("model_generated"),
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
  const forecastInput = normalizeForecastInputRow((ctx.input ?? {}) as Record<string, unknown>);
  const question = forecastInput.question;
  const resolutionCriteria = forecastInput.resolutionCriteria ?? "Resolve according to the plain-language question.";
  const background = forecastInput.background ?? "";
  const structuredContext = formatForecastContextForPrompt(forecastInput);
  const categoryContract = normalizeCategoryContract(forecastInput.categories, forecastInput.categoriesExhaustive);
  const attemptIds = forecasterBriefs.map((brief) => `attempt-${brief.id}`);
  const attemptNeeds = Object.fromEntries(attemptIds.map((id) => [id, id]));
  const attempts = ctx.outputs.categoricalAttempt ?? [];
  const categoryTotals = new Map<string, number>();
  for (const attempt of attempts) {
    if (attempt.probabilities?.length) {
      for (const item of attempt.probabilities) {
        const category = canonicalCategory(item.category, categoryContract.categories);
        categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + item.probability);
      }
    } else {
      const category = canonicalCategory(attempt.topCategory, categoryContract.categories);
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + 100);
    }
  }
  const categories = categoryContract.categories.length ? categoryContract.categories : [...categoryTotals.keys()];
  for (const category of categories) {
    categoryTotals.set(category, categoryTotals.get(category) ?? 0);
  }
  const probabilities = normalizeProbabilityMass(categories.map((category) => ({
    category,
    probability: attempts.length ? categoryTotals.get(category)! / attempts.length : categoryTotals.get(category)!,
  }))).sort((left, right) => right.probability - left.probability);
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

${structuredContext}

Background:
${background || "No extra background provided."}

Category contract:
${categoryContract.categories.length
  ? `Use exactly these categories and no others. Put any probability mass outside the named set into "Other" when present.\n${categoryContract.categories.map((category, index) => `${index + 1}. ${category}`).join("\n")}`
  : "No caller-provided categories. Propose a mutually exclusive and collectively exhaustive probability distribution and include Other unless the answer space is truly closed."}

Focus:
${brief.focus}

Return a categorical forecast. Include topCategory and a probability distribution using percentages from 0 to 100. Probabilities should sum to 100 over the frozen category set when one is provided. Include rationale, key uncertainties, and cited sources when available. Set forecasterLabel to "${brief.label}".`}
            </Task>
          ))}
        </Parallel>

        <Task id="aggregate" output={outputs.categoricalAggregate} needs={attemptNeeds}>
          {{
            forecastType: "categorical",
            topCategory,
            categories,
            categoriesExhaustive: categoryContract.exhaustive,
            categorySource: categoryContract.source,
            probabilities,
            method: "frozen_option_mean_probability_distribution_v1",
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

function normalizeCategoryContract(categories: string[], exhaustive: boolean) {
  const deduped = [...new Set(categories.map((category) => category.trim()).filter(Boolean))];
  if (deduped.length === 0) {
    return { categories: [], exhaustive: false, source: "model_generated" as const };
  }
  if (exhaustive || deduped.some((category) => category.toLowerCase() === "other")) {
    return { categories: deduped, exhaustive, source: "caller" as const };
  }
  return { categories: [...deduped, "Other"], exhaustive: false, source: "caller_with_other" as const };
}

function canonicalCategory(category: string, categories: string[]) {
  if (categories.length === 0) {
    return category.trim() || "Other";
  }
  const exact = categories.find((candidate) => candidate === category);
  if (exact) {
    return exact;
  }
  const lower = category.toLowerCase();
  const caseInsensitive = categories.find((candidate) => candidate.toLowerCase() === lower);
  if (caseInsensitive) {
    return caseInsensitive;
  }
  return categories.find((candidate) => candidate.toLowerCase() === "other") ?? categories[categories.length - 1] ?? "Other";
}

function normalizeProbabilityMass(probabilities: Array<z.infer<typeof categoryProbability>>) {
  const total = probabilities.reduce((sum, item) => sum + item.probability, 0);
  if (!Number.isFinite(total) || total <= 0) {
    const evenProbability = probabilities.length ? 100 / probabilities.length : 0;
    return probabilities.map((item) => ({ ...item, probability: roundOne(evenProbability) }));
  }
  const normalized = probabilities.map((item) => ({
    ...item,
    probability: roundOne((item.probability / total) * 100),
  }));
  const delta = roundOne(100 - normalized.reduce((sum, item) => sum + item.probability, 0));
  if (normalized.length && delta !== 0) {
    normalized[0] = { ...normalized[0], probability: roundOne(normalized[0].probability + delta) };
  }
  return normalized;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
