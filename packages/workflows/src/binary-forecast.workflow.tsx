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
  baseRateProbability: z.number().min(0).max(100),
  insideViewProbability: z.number().min(0).max(100),
  probabilityRange: z.object({
    low: z.number().min(0).max(100),
    high: z.number().min(0).max(100),
  }),
  rationale: z.string(),
  referenceClass: z.string(),
  resolutionBoundary: z.string(),
  evidenceFor: z.array(z.string()).default([]),
  evidenceAgainst: z.array(z.string()).default([]),
  strongestYes: z.string(),
  strongestNo: z.string(),
  keyUncertainties: z.array(z.string()).default([]),
  premortem: z.string().default(""),
  wildcards: z.array(z.string()).default([]),
  calibrationWarnings: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const binaryAggregate = z.object({
  forecastType: z.literal("binary"),
  probability: z.number().min(0).max(100),
  method: z.string(),
  attemptCount: z.number().int(),
  rationale: z.string(),
  meanProbability: z.number().min(0).max(100),
  medianProbability: z.number().min(0).max(100),
  disagreement: z.number().min(0).max(100),
  calibrationNotes: z.string(),
  calibrationWarnings: z.array(z.string()).default([]),
  componentProbabilities: z.array(z.object({
    forecasterLabel: z.string(),
    probability: z.number(),
    baseRateProbability: z.number().optional(),
    insideViewProbability: z.number().optional(),
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
    focus: "Start from reference classes and historical frequency. Name the reference class, estimate its base rate, then make only evidence-supported adjustments.",
  },
  {
    id: "inside-view",
    label: "inside-view forecaster",
    focus: "Map the concrete mechanisms, timelines, incentives, blockers, and threshold distance for this exact question. Quantify how much each mechanism should move the base rate.",
  },
  {
    id: "skeptic",
    label: "skeptical forecaster",
    focus: "Run the premortem: look for resolution ambiguity, missing evidence, correlated assumptions, execution risk, and ways the obvious answer could fail. Do not be pessimistic by default; be calibrated.",
  },
];

function roundProbability(value: number) {
  return Math.round(value * 10) / 10;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 50;
}

function median(values: number[]) {
  if (!values.length) {
    return 50;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function disagreement(values: number[]) {
  return values.length ? Math.max(...values) - Math.min(...values) : 0;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export default smithers((ctx) => {
  const input = (ctx.input ?? {}) as {
    question?: unknown;
    prompt?: unknown;
    resolutionCriteria?: unknown;
    background?: unknown;
    fixedEvidence?: unknown;
    presentDate?: unknown;
    cutoffDate?: unknown;
  };
  const question = String(input.question ?? input.prompt ?? "");
  const resolutionCriteria = String(input.resolutionCriteria ?? "Resolve according to the plain-language question.");
  const background = String(input.background ?? "");
  const fixedEvidence = String(input.fixedEvidence ?? "");
  const presentDate = String(input.presentDate ?? "");
  const cutoffDate = String(input.cutoffDate ?? "");
  const attemptIds = forecasterBriefs.map((brief) => `attempt-${brief.id}`);
  const attemptNeeds = Object.fromEntries(attemptIds.map((id) => [id, id]));
  const attempts = ctx.outputs.binaryAttempt ?? [];
  const probabilities = attempts.map((attempt) => attempt.probability).filter((probability) => Number.isFinite(probability));
  const meanProbability = roundProbability(average(probabilities));
  const medianProbability = roundProbability(median(probabilities));
  const aggregateProbability = medianProbability;
  const aggregateDisagreement = roundProbability(disagreement(probabilities));
  const componentProbabilities = attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    probability: attempt.probability,
    baseRateProbability: attempt.baseRateProbability,
    insideViewProbability: attempt.insideViewProbability,
  }));
  const citedSources = attempts.flatMap((attempt) => attempt.citedSources ?? []);
  const calibrationWarnings = uniqueStrings(attempts.flatMap((attempt) => attempt.calibrationWarnings ?? []));
  const calibrationNotes = attempts.length === 0
    ? "No component attempts were available; this fallback should only appear in graph rendering."
    : "Used the median of differentiated component forecasts because the roles share the same model, question, and evidence, so their errors are likely correlated. The mean is retained for auditability but is not treated as three independent votes.";

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

Use this forecasting process:
1. Restate the resolution boundary before judging probability.
2. Pick a concrete reference class and estimate a base-rate probability.
3. Update from the base rate using the case-specific evidence.
4. List the strongest yes and no arguments, then run a premortem.
5. Give a precise final probability from 0 to 100. Avoid false precision only by rounding to a sensible tenth or integer, not by using 50 as a refuge.
6. Flag overconfidence, missing base rates, weak evidence, or correlated assumptions in calibrationWarnings.

Question:
${question}

Resolution criteria:
${resolutionCriteria}

${presentDate || cutoffDate ? `Timing context:
Present date: ${presentDate || "unspecified"}
Cutoff date: ${cutoffDate || "unspecified"}` : ""}

Background:
${background || "No extra background provided."}

${fixedEvidence ? `Fixed evidence packet:
${fixedEvidence}

Use only the fixed evidence packet, background, question, and resolution criteria. Do not use web search, file reads, shell commands, memory, or external information.` : ""}

Focus:
${brief.focus}

Return a binary forecast. Use probability as a number from 0 to 100. Also provide baseRateProbability, insideViewProbability, probabilityRange, referenceClass, resolutionBoundary, evidenceFor, evidenceAgainst, strongest yes/no arguments, key uncertainties, premortem, wildcards, calibrationWarnings, and cited sources when available. Set forecasterLabel to "${brief.label}".`}
            </Task>
          ))}
        </Parallel>

        <Task id="aggregate" output={outputs.binaryAggregate} needs={attemptNeeds}>
          {{
            forecastType: "binary",
            probability: aggregateProbability,
            method: "median_of_differentiated_correlated_forecasters_v1",
            attemptCount: attempts.length,
            meanProbability,
            medianProbability,
            disagreement: aggregateDisagreement,
            calibrationNotes,
            calibrationWarnings,
            componentProbabilities,
            citedSources,
            rationale:
              attempts.length === 0
                ? "No attempts were available; this fallback should only appear in graph rendering."
                : `Aggregated ${attempts.length} differentiated but correlated forecaster probabilities with a median. Mean=${meanProbability}, median=${medianProbability}, disagreement=${aggregateDisagreement}. Review component attempts for base-rate quality, resolution-boundary handling, and correlated calibration warnings.`,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});
