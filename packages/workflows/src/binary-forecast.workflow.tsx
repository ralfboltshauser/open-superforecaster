/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import { codexResearchAgent, codexStructuredAgent } from "./agents";

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

const componentProbability = z.object({
  forecasterLabel: z.string(),
  probability: z.number().min(0).max(100),
  baseRateProbability: z.number().min(0).max(100).optional(),
  insideViewProbability: z.number().min(0).max(100).optional(),
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
  aggregationAnchor: z.enum(["mean", "median", "component", "adjusted"]),
  adjustmentFromMedian: z.number(),
  calibrationNotes: z.string(),
  calibrationWarnings: z.array(z.string()).default([]),
  componentProbabilities: z.array(componentProbability),
  componentAudits: z.array(z.object({
    forecasterLabel: z.string(),
    usefulContribution: z.string(),
    weakness: z.string(),
    calibrationRisk: z.string(),
    weight: z.enum(["downweight", "normal", "upweight"]),
  })).default([]),
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
    focus: "Run a calibrated premortem: look for resolution ambiguity, missing evidence, correlated assumptions, execution risk, and ways the obvious answer could fail. Do not be pessimistic by default.",
  },
];

function roundProbability(value: number) {
  return Math.round(value * 10) / 10;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 50;
}

function median(values: number[]) {
  if (values.length === 0) {
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
  const meanProbability = roundProbability(mean(probabilities));
  const medianProbability = roundProbability(median(probabilities));
  const aggregateDisagreement = roundProbability(disagreement(probabilities));
  const componentProbabilities = attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    probability: attempt.probability,
    baseRateProbability: attempt.baseRateProbability,
    insideViewProbability: attempt.insideViewProbability,
  }));
  const citedSources = attempts.flatMap((attempt) => attempt.citedSources ?? []);
  const attemptSummary = JSON.stringify(attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    probability: attempt.probability,
    baseRateProbability: attempt.baseRateProbability,
    insideViewProbability: attempt.insideViewProbability,
    probabilityRange: attempt.probabilityRange,
    referenceClass: attempt.referenceClass,
    resolutionBoundary: attempt.resolutionBoundary,
    evidenceFor: attempt.evidenceFor,
    evidenceAgainst: attempt.evidenceAgainst,
    strongestYes: attempt.strongestYes,
    strongestNo: attempt.strongestNo,
    keyUncertainties: attempt.keyUncertainties,
    premortem: attempt.premortem,
    wildcards: attempt.wildcards,
    calibrationWarnings: attempt.calibrationWarnings,
    rationale: attempt.rationale,
    citedSources: attempt.citedSources,
  })), null, 2);

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

Forecasting process:
1. Restate the resolution boundary before judging probability.
2. Pick a concrete reference class and estimate a base-rate probability.
3. Update from that base rate using case-specific evidence.
4. List the strongest yes and no arguments, then run a premortem.
5. Give a precise final probability from 0 to 100. Round sensibly; do not hide uncertainty at 50.
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

        <Task
          id="aggregate"
          output={outputs.binaryAggregate}
          needs={attemptNeeds}
          agent={codexStructuredAgent}
        >
          {`You are the constrained calibration evaluator for Open Superforecaster.

Your job is not to pick the most confident or most eloquent forecast. The three component forecasts are role-differentiated but correlated: they use the same model family, the same question, and substantially overlapping evidence. Treat their agreement as useful but not independent.

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

Use only the fixed evidence packet, background, question, resolution criteria, and component forecasts. Do not use web search, file reads, shell commands, memory, or external information.` : ""}

Computed aggregate anchors:
- attemptCount: ${attempts.length}
- meanProbability: ${meanProbability}
- medianProbability: ${medianProbability}
- disagreement: ${aggregateDisagreement}

Component forecasts:
${attemptSummary}

Evaluation rules:
1. Start from the median and mean as anchors. If disagreement is small and no component has a named defect, stay close to the median/mean.
2. Do not reward confidence, length, or rhetorical strength. Reward resolution-boundary correctness, base-rate quality, evidence quality, and calibrated uncertainty.
3. Downweight a component only for a specific defect: wrong resolution boundary, unsupported base rate, double-counted evidence, ignored decisive counterevidence, disallowed evidence, numeric inconsistency, or missing major failure mode.
4. You may select one component or adjust away from mean/median only when you name the defect or decisive insight causing the adjustment.
5. Avoid extreme probabilities unless the evidence directly supports them. If evidence is thin, ambiguous, or mostly execution-risk, shrink toward the better-supported base rate or 50.
6. Keep the rule general for future real forecasts; do not optimize for any benchmark case.
7. Preserve cited sources from component forecasts when useful; do not invent new sources.

Return the final binary aggregate. Set method exactly to "constrained_agentic_calibration_evaluator_v1". Set attemptCount to ${attempts.length}. Include componentProbabilities for every component, componentAudits for every component, meanProbability, medianProbability, disagreement, aggregationAnchor, adjustmentFromMedian, calibrationNotes, calibrationWarnings, method, rationale, citedSources, and final probability.`}
        </Task>
      </Sequence>
    </Workflow>
  );
});
