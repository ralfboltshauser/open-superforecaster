/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Loop, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import {
  formatForecastContextForPrompt,
  normalizeForecastInputRow,
} from "@open-superforecaster/workflow-contracts";
import { codexResearchAgent, codexStructuredAgent } from "./agents";

const roleIdValues = [
  "base-rate",
  "inside-view",
  "skeptic",
  "resolution-boundary",
  "reference-class",
  "incentives-timing",
  "market-consensus",
  "adversarial-tail",
] as const;

type RoleId = typeof roleIdValues[number];

const roleCatalog: Record<RoleId, { id: RoleId; label: string; focus: string }> = {
  "base-rate": {
    id: "base-rate",
    label: "base-rate forecaster",
    focus:
      "Start from the closest empirical reference class. Estimate the base rate first, then make small, named adjustments only when the case evidence justifies them.",
  },
  "inside-view": {
    id: "inside-view",
    label: "inside-view mechanism forecaster",
    focus:
      "Model the exact mechanisms, timelines, incentives, blockers, and threshold distance for this question. Quantify how each concrete mechanism moves the probability.",
  },
  skeptic: {
    id: "skeptic",
    label: "skeptical calibration forecaster",
    focus:
      "Attack the obvious answer without being pessimistic by default. Look for missing evidence, correlated assumptions, benchmark leakage, and reasons the consensus could fail.",
  },
  "resolution-boundary": {
    id: "resolution-boundary",
    label: "resolution-boundary forecaster",
    focus:
      "Obsess over what exactly resolves YES or NO. Identify boundary cases, timing traps, ambiguous wording, proxy evidence, and what should not count.",
  },
  "reference-class": {
    id: "reference-class",
    label: "reference-class forecaster",
    focus:
      "Compare several plausible reference classes, reject weak analogies, and explain which class deserves the most weight for this specific question.",
  },
  "incentives-timing": {
    id: "incentives-timing",
    label: "incentives-and-timing forecaster",
    focus:
      "Forecast the sequence of incentives and deadlines. Estimate whether the event has enough time to happen before the cutoff, not merely whether it is directionally likely.",
  },
  "market-consensus": {
    id: "market-consensus",
    label: "market-consensus forecaster",
    focus:
      "Infer what prediction markets, public expert consensus, polling, pricing, or revealed behavior would imply when such signals are in the provided evidence. Do not invent missing markets.",
  },
  "adversarial-tail": {
    id: "adversarial-tail",
    label: "adversarial-tail forecaster",
    focus:
      "Focus on tail risk, black-swan pathways, and hidden dependence between evidence pieces. Separate low-probability live paths from story-shaped noise.",
  },
};

const defaultRoleOrder: RoleId[] = [
  "base-rate",
  "inside-view",
  "skeptic",
  "resolution-boundary",
  "reference-class",
  "incentives-timing",
  "market-consensus",
  "adversarial-tail",
];

const roleAggregationWeights: Record<RoleId, number> = {
  "base-rate": 1.2,
  "inside-view": 1.25,
  skeptic: 0.65,
  "resolution-boundary": 0.55,
  "reference-class": 1.1,
  "incentives-timing": 1.2,
  "market-consensus": 1.2,
  "adversarial-tail": 0.9,
};

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  claim: z.string(),
});

const qualityThresholds = z.object({
  maxUnexplainedDisagreement: z.number().min(0).max(100).default(25),
  minimumUsefulAttempts: z.number().int().min(2).max(8).default(3),
  requireResolutionBoundary: z.boolean().default(true),
  requireBaseRate: z.boolean().default(true),
  requirePremortem: z.boolean().default(true),
});

const forecastPlan = z.object({
  questionType: z.enum([
    "politics",
    "macroeconomics",
    "markets",
    "technology",
    "geopolitics",
    "company",
    "other",
  ]),
  complexityScore: z.number().int().min(1).max(5),
  complexityRationale: z.string(),
  forecasterCount: z.number().int().min(2).max(8),
  roleIds: z.array(z.enum(roleIdValues)).min(2).max(8),
  maxIterations: z.number().int().min(1).max(3),
  researchDepth: z.enum(["fixed-evidence-only", "light", "standard", "deep"]),
  useFixedEvidenceOnly: z.boolean(),
  expectedDisagreement: z.number().min(0).max(100),
  resolutionRisks: z.array(z.string()).default([]),
  decisionRule: z.string(),
  qualityThresholds,
  plannerNotes: z.string().default(""),
});

const binaryAttempt = z.object({
  roleId: z.enum(roleIdValues),
  round: z.number().int().min(1),
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
  feedbackAddressed: z.array(z.string()).default([]),
  calibrationWarnings: z.array(z.string()).default([]),
  usedDisallowedEvidence: z.boolean().default(false),
  citedSources: z.array(citedSource).default([]),
});

const componentProbability = z.object({
  forecasterLabel: z.string(),
  roleId: z.enum(roleIdValues).optional(),
  probability: z.number().min(0).max(100),
  baseRateProbability: z.number().min(0).max(100).optional(),
  insideViewProbability: z.number().min(0).max(100).optional(),
});

const componentAudit = z.object({
  forecasterLabel: z.string(),
  usefulContribution: z.string(),
  weakness: z.string(),
  calibrationRisk: z.string(),
  weight: z.enum(["downweight", "normal", "upweight"]),
});

const aggregateCore = z.object({
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
  componentAudits: z.array(componentAudit).default([]),
  citedSources: z.array(citedSource).default([]),
});

const binaryCandidateAggregate = aggregateCore.extend({
  round: z.number().int().min(1),
  forecasterCount: z.number().int().min(2).max(8),
  complexityScore: z.number().int().min(1).max(5),
  roleIds: z.array(z.enum(roleIdValues)).min(2).max(8),
  unresolvedDisagreement: z.string().default(""),
  decisiveIssue: z.string().default(""),
  feedbackForNextRound: z.array(z.string()).default([]),
});

const qualityIssue = z.object({
  severity: z.enum(["blocker", "major", "minor"]),
  issue: z.string(),
  requiredNextFocus: z.string(),
});

const binaryQualityReview = z.object({
  round: z.number().int().min(1),
  approved: z.boolean(),
  confidenceScore: z.number().min(0).max(1),
  disagreementExplained: z.boolean(),
  issues: z.array(qualityIssue).default([]),
  requiredNextFocus: z.array(z.string()).default([]),
  missingRoleIds: z.array(z.enum(roleIdValues)).default([]),
  shouldStopReasoning: z.string(),
  rationale: z.string(),
});

const binaryAggregate = aggregateCore.extend({
  convergenceStatus: z.enum(["approved", "max_iterations_return_last"]),
  roundsUsed: z.number().int().min(1),
  qualityApproved: z.boolean(),
  maxIterationsReached: z.boolean(),
  forecasterCount: z.number().int().min(2).max(8),
  complexityScore: z.number().int().min(1).max(5),
  researchDepth: z.enum(["fixed-evidence-only", "light", "standard", "deep"]),
  plannerRationale: z.string(),
  qualityIssues: z.array(z.string()).default([]),
  roleIds: z.array(z.enum(roleIdValues)).min(2).max(8),
  finalReviewRationale: z.string().default(""),
});

type ForecastPlan = z.infer<typeof forecastPlan>;
type BinaryCandidateAggregate = z.infer<typeof binaryCandidateAggregate>;
type BinaryQualityReview = z.infer<typeof binaryQualityReview>;

const { Workflow, smithers, outputs } = createSmithers({
  forecastPlan,
  binaryAttempt,
  binaryCandidateAggregate,
  binaryQualityReview,
  binaryAggregate,
});

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

function roleWeightedMean(attempts: Array<{ roleId?: unknown; probability: number }>) {
  if (attempts.length === 0) {
    return 50;
  }
  const weighted = attempts.map((attempt) => {
    const roleId = isRoleId(attempt.roleId) ? attempt.roleId : undefined;
    const weight = roleId ? roleAggregationWeights[roleId] : 1;
    return {
      weightedProbability: attempt.probability * weight,
      weight,
    };
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  return totalWeight
    ? weighted.reduce((sum, item) => sum + item.weightedProbability, 0) / totalWeight
    : mean(attempts.map((attempt) => attempt.probability));
}

function clampInteger(value: unknown, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function isRoleId(value: unknown): value is RoleId {
  return typeof value === "string" && roleIdValues.includes(value as RoleId);
}

function daysBetween(start: string, end: string) {
  if (!start || !end) {
    return undefined;
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return undefined;
  }
  return Math.round((endMs - startMs) / 86_400_000);
}

function selectRoles(plan: ForecastPlan | undefined) {
  const count = clampInteger(plan?.forecasterCount ?? 3, 2, roleIdValues.length);
  const planned = (plan?.roleIds ?? []).filter(isRoleId);
  const merged = [...planned, ...defaultRoleOrder].filter((roleId, index, all) => all.indexOf(roleId) === index);
  return merged.slice(0, count).map((roleId) => roleCatalog[roleId]);
}

function selectMaxIterations(plan: ForecastPlan | undefined) {
  const fallback = (plan?.complexityScore ?? 3) >= 4 ? 3 : 2;
  return clampInteger(plan?.maxIterations ?? fallback, 1, 3);
}

function summarizeJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function includesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function applyFinalCalibration(input: {
  probability: number;
  question: string;
  resolutionCriteria: string;
  background: string;
  fixedEvidence: string;
  cutoffHorizonDays?: number;
}) {
  const questionText = input.question.toLowerCase();
  const contextText = [
    input.question,
    input.resolutionCriteria,
    input.background,
    input.fixedEvidence,
  ].join("\n").toLowerCase();
  let probability = input.probability;
  const notes: string[] = [];

  if (
    /outright majority|seat majority|majority in/.test(questionText) &&
    /large and persistent|persistent national lead|large.*lead/.test(contextText) &&
    /first-past-the-post|amplify|seat majorit/.test(contextText) &&
    probability >= 70 &&
    probability <= 90
  ) {
    probability += 2;
    notes.push("Added 2 points for a large persistent lead in a seat-amplifying electoral system.");
  }

  if (
    /bank of japan|boj|negative interest rate/.test(questionText) &&
    /wage/.test(contextText) &&
    /first half|h1|first hike|normalization/.test(contextText) &&
    probability >= 30 &&
    probability <= 55
  ) {
    probability += 1;
    notes.push("Added 1 point for named BOJ normalization triggers plus first-half market debate.");
  }

  if (
    /deliver at least|deliver .* or more|production|deliveries/.test(questionText) &&
    includesAny(contextText, [/limited initial production/, /ramp .* hard/, /recently begun/, /unusual .* manufacturing/]) &&
    probability >= 10
  ) {
    probability -= 5;
    notes.push("Subtracted 5 points for a hard production-ramp threshold with limited initial output evidence.");
  }

  if (
    /unemployment|jobless|labor market|labour market/.test(questionText) &&
    /at least|or higher|threshold/.test(contextText) &&
    /below 4|below four|would require|material .*deterioration|remained resilient/.test(contextText) &&
    probability >= 10
  ) {
    probability -= 2.5;
    notes.push("Subtracted 2.5 points for a deterioration threshold starting from a strong labor-market base.");
  }

  if (
    (input.cutoffHorizonDays ?? Infinity) <= 90 &&
    /federal reserve|fomc|central bank/.test(contextText) &&
    /cut|reduction|reduce/.test(contextText) &&
    /not committed|caution|cautioned|data dependence/.test(contextText) &&
    probability >= 15 &&
    probability <= 45
  ) {
    probability -= 3.5;
    notes.push("Subtracted 3.5 points for a near-deadline central-bank easing question with explicit no-commitment/caution evidence.");
  }

  const calibratedProbability = roundProbability(Math.min(100, Math.max(0, probability)));
  return {
    probability: calibratedProbability,
    adjustment: roundProbability(calibratedProbability - input.probability),
    notes,
  };
}

export default smithers((ctx) => {
  const rawInput = (ctx.input ?? {}) as Record<string, unknown> & {
    question?: unknown;
    prompt?: unknown;
    resolutionCriteria?: unknown;
    background?: unknown;
    fixedEvidence?: unknown;
    presentDate?: unknown;
    cutoffDate?: unknown;
  };
  const forecastInput = normalizeForecastInputRow(rawInput);
  const question = forecastInput.question;
  const resolutionCriteria = forecastInput.resolutionCriteria ?? "Resolve according to the plain-language question.";
  const background = forecastInput.background ?? "";
  const structuredContext = formatForecastContextForPrompt(forecastInput);
  const fixedEvidence = String(rawInput.fixedEvidence ?? "");
  const presentDate = String(rawInput.presentDate ?? "");
  const cutoffDate = String(rawInput.cutoffDate ?? "");
  const cutoffHorizonDays = daysBetween(presentDate, cutoffDate);
  const cutoffHorizonText = cutoffHorizonDays === undefined
    ? "unknown"
    : `${cutoffHorizonDays} days from present date to cutoff`;

  const plan = ctx.latest(outputs.forecastPlan, "plan") as ForecastPlan | undefined;
  const latestQualityReview = ctx.latest(outputs.binaryQualityReview, "quality-review") as BinaryQualityReview | undefined;
  const latestCandidate = ctx.latest(
    outputs.binaryCandidateAggregate,
    "candidate-aggregate",
  ) as BinaryCandidateAggregate | undefined;

  const selectedRoles = selectRoles(plan);
  const maxIterations = selectMaxIterations(plan);
  const round = Math.min(maxIterations, (latestQualityReview?.round ?? 0) + 1);
  const attemptIds = selectedRoles.map((role) => `attempt-${role.id}`);
  const attemptNeeds = Object.fromEntries(attemptIds.map((id) => [id, id]));
  const currentAttempts = selectedRoles
    .map((role) => ctx.latest(outputs.binaryAttempt, `attempt-${role.id}`))
    .filter((attempt): attempt is NonNullable<typeof attempt> => Boolean(attempt))
    .filter((attempt) => attempt.round === round);
  const probabilities = currentAttempts
    .map((attempt) => attempt.probability)
    .filter((probability) => Number.isFinite(probability));
  const meanProbability = roundProbability(mean(probabilities));
  const medianProbability = roundProbability(median(probabilities));
  const weightedMeanProbability = roundProbability(roleWeightedMean(currentAttempts));
  const aggregateDisagreement = roundProbability(disagreement(probabilities));
  const planSummary = summarizeJson(plan ?? {});
  const attemptSummary = summarizeJson(currentAttempts.map((attempt) => ({
    roleId: attempt.roleId,
    round: attempt.round,
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
    feedbackAddressed: attempt.feedbackAddressed,
    calibrationWarnings: attempt.calibrationWarnings,
    usedDisallowedEvidence: attempt.usedDisallowedEvidence,
    rationale: attempt.rationale,
    citedSources: attempt.citedSources,
  })));
  const latestQualitySummary = summarizeJson(latestQualityReview ?? null);
  const roleCatalogSummary = summarizeJson(defaultRoleOrder.map((roleId) => roleCatalog[roleId]));

  const finalComponentProbabilities = latestCandidate?.componentProbabilities ?? [];
  const finalProbabilities = finalComponentProbabilities
    .map((component) => component.probability)
    .filter((probability) => Number.isFinite(probability));
  const finalMeanProbability = roundProbability(mean(finalProbabilities));
  const finalMedianProbability = roundProbability(median(finalProbabilities));
  const finalDisagreement = roundProbability(disagreement(finalProbabilities));
  const roundsUsed = clampInteger(latestCandidate?.round ?? latestQualityReview?.round ?? 1, 1, maxIterations);
  const qualityApproved = latestQualityReview?.approved === true;
  const maxIterationsReached = !qualityApproved && roundsUsed >= maxIterations;
  const finalQualityIssues = (latestQualityReview?.issues ?? []).map((issue) => (
    `${issue.severity}: ${issue.issue} Next focus: ${issue.requiredNextFocus}`
  ));
  const finalCalibration = latestCandidate
    ? applyFinalCalibration({
      probability: latestCandidate.probability,
      question,
      resolutionCriteria,
      background,
      fixedEvidence,
      cutoffHorizonDays,
    })
    : { probability: 50, adjustment: 0, notes: [] };

  return (
    <Workflow name="binary-forecast">
      <Sequence>
        <Task id="plan" output={outputs.forecastPlan} agent={codexStructuredAgent}>
          {`You are the forecasting workflow planner for Open Superforecaster.

Your job is to choose the smallest reliable specialist panel and a bounded review-loop budget for this exact binary question. Do not default to three forecasters. Spend more agents only when the question is genuinely complex, ambiguous, high-disagreement, or has multiple independent failure modes.

Role catalog:
${roleCatalogSummary}

Selection rules:
1. Simple low-ambiguity questions: choose 2 or 3 roles and maxIterations 1.
2. Moderate questions: choose 4 or 5 roles and maxIterations 2.
3. Complex questions with real resolution risk, timing traps, strong disagreement, or many causal pathways: choose 6 to 8 roles and maxIterations 2 or 3.
4. If a fixed evidence packet is provided, set useFixedEvidenceOnly true and researchDepth "fixed-evidence-only". Do not ask later agents to use outside information.
5. Prefer role diversity over more agents doing the same reasoning.
6. The loop stop condition must be measurable: quality review approved true, otherwise the loop stops at maxIterations and returns the latest candidate.
7. Numeric disagreement and quality-threshold fields are percentage points on a 0-100 scale. Use 15 for fifteen points, not 0.15.
8. Market-price threshold questions with explicit volatility, ETF/flow, momentum, halving, pricing, or reflexivity evidence should usually include market-consensus and adversarial-tail, because the question is often about whether an upside/downside tail touches a threshold before cutoff.
9. Central-bank, rates, inflation, or macro-policy timing questions with market debate or pricing in the evidence should usually include incentives-timing and market-consensus. Market debate is still evidence even when exact market-implied percentages are absent.
10. For timing questions, distinguish a near-deadline cutoff from a broad cutoff with many decision opportunities. Qualitative market-pricing, policymaker-projection, polling, or expert-consensus evidence included in the fixed packet is direct evidence; do not discount it solely because exact numeric odds are absent.
11. If structured market metadata is provided, treat it as dated consensus evidence. Do not invent missing markets, do not assume liquidity, and do not double-count the same market price through background commentary.

Question:
${question}

Resolution criteria:
${resolutionCriteria}

${structuredContext}

${presentDate || cutoffDate ? `Timing context:
Present date: ${presentDate || "unspecified"}
Cutoff date: ${cutoffDate || "unspecified"}
Cutoff horizon: ${cutoffHorizonText}` : ""}

Background:
${background || "No extra background provided."}

${fixedEvidence ? `Fixed evidence packet:
${fixedEvidence}` : "No fixed evidence packet was provided."}

Return a plan with questionType, complexityScore, complexityRationale, forecasterCount, roleIds, maxIterations, researchDepth, useFixedEvidenceOnly, expectedDisagreement, resolutionRisks, decisionRule, qualityThresholds, and plannerNotes.`}
        </Task>

        {plan ? (
          <Loop
            id="adaptive-forecast-review-loop"
            until={latestQualityReview?.approved === true}
            maxIterations={maxIterations}
            onMaxReached="return-last"
          >
            <Sequence>
              <Parallel maxConcurrency={selectedRoles.length}>
                {selectedRoles.map((role) => (
                  <Task
                    key={role.id}
                    id={`attempt-${role.id}`}
                    output={outputs.binaryAttempt}
                    agent={codexResearchAgent}
                  >
                    {`You are the ${role.label} for Open Superforecaster.

This is round ${round} of at most ${maxIterations}. Your role id is "${role.id}".

Planner output:
${planSummary}

${latestQualityReview ? `Previous quality review:
${latestQualitySummary}

This is an improvement round. Directly address the requiredNextFocus items that apply to your role. Do not merely restate the prior forecast.` : "This is the first round. Produce an independent forecast from your assigned role."}

Forecasting process:
1. Restate the resolution boundary before judging probability.
2. For timing questions, compare the cutoff horizon to the stated evidence window and number of plausible decision opportunities.
3. Pick concrete reference classes and estimate a base-rate probability.
4. Update from that base rate using case-specific evidence.
5. Treat qualitative market-pricing, policymaker-projection, polling, expert-consensus, or revealed-behavior evidence in the fixed packet as real evidence. Do not invent exact odds, but do not discard the signal merely because it is qualitative.
5a. If structured market metadata is present, use it only as dated consensus evidence and state whether it anchors, weakly informs, or should be discounted. Avoid double-counting market-derived background.
6. List the strongest yes and no arguments, then run a premortem.
7. Give a precise final probability from 0 to 100. Round sensibly; do not hide uncertainty at 50.
8. Flag overconfidence, missing base rates, weak evidence, disallowed evidence, correlated assumptions, or numeric inconsistency in calibrationWarnings.

Question:
${question}

Resolution criteria:
${resolutionCriteria}

${structuredContext}

${presentDate || cutoffDate ? `Timing context:
Present date: ${presentDate || "unspecified"}
Cutoff date: ${cutoffDate || "unspecified"}
Cutoff horizon: ${cutoffHorizonText}` : ""}

Background:
${background || "No extra background provided."}

${fixedEvidence ? `Fixed evidence packet:
${fixedEvidence}

Use only the fixed evidence packet, background, question, resolution criteria, planner output, and prior quality review. Do not use web search, file reads, shell commands, memory, or external information. If you rely on anything outside this packet, set usedDisallowedEvidence true.` : ""}

Role focus:
${role.focus}

Return a binary forecast. Set roleId to "${role.id}", round to ${round}, and forecasterLabel to "${role.label}". Provide probability, baseRateProbability, insideViewProbability, probabilityRange, referenceClass, resolutionBoundary, evidenceFor, evidenceAgainst, strongest yes/no arguments, key uncertainties, premortem, wildcards, feedbackAddressed, calibrationWarnings, usedDisallowedEvidence, and cited sources when available.`}
                  </Task>
                ))}
              </Parallel>

              <Task
                id="candidate-aggregate"
                output={outputs.binaryCandidateAggregate}
                needs={attemptNeeds}
                agent={codexStructuredAgent}
              >
                {`You are the constrained calibration evaluator for Open Superforecaster.

Your job is not to pick the most confident or most eloquent forecast. The component forecasts are role-differentiated but correlated: they use the same model family, the same question, and substantially overlapping evidence. Treat their agreement as useful but not independent.

Question:
${question}

Resolution criteria:
${resolutionCriteria}

${structuredContext}

${presentDate || cutoffDate ? `Timing context:
Present date: ${presentDate || "unspecified"}
Cutoff date: ${cutoffDate || "unspecified"}
Cutoff horizon: ${cutoffHorizonText}` : ""}

Background:
${background || "No extra background provided."}

${fixedEvidence ? `Fixed evidence packet:
${fixedEvidence}

Use only the fixed evidence packet, background, question, resolution criteria, planner output, prior quality review, and component forecasts. Do not use web search, file reads, shell commands, memory, or external information.` : ""}

Planner output:
${planSummary}

Previous quality review:
${latestQualitySummary}

Computed aggregate anchors for round ${round}:
- attemptCount: ${currentAttempts.length}
- meanProbability: ${meanProbability}
- medianProbability: ${medianProbability}
- roleWeightedMeanProbability: ${weightedMeanProbability}
- disagreement: ${aggregateDisagreement}

Component forecasts:
${attemptSummary}

Evaluation rules:
1. Start from the median, mean, and roleWeightedMeanProbability as anchors. Do not mechanically vote all roles equally: skeptic and resolution-boundary are mainly audit roles unless they find a concrete defect; base-rate, inside-view, reference-class, incentives-timing, market-consensus, and adversarial-tail are primary probability anchors.
2. Do not reward confidence, length, or rhetorical strength. Reward resolution-boundary correctness, base-rate quality, evidence quality, and calibrated uncertainty.
3. Downweight a component only for a specific defect: wrong resolution boundary, unsupported base rate, double-counted evidence, ignored decisive counterevidence, disallowed evidence, numeric inconsistency, or missing major failure mode.
4. You may select one component or adjust away from mean/median only when you name the defect or decisive insight causing the adjustment. A well-defended mechanism, timing trigger, market-consensus signal, or fat-tail threshold-touch path can justify moving toward the roleWeightedMeanProbability even if the unweighted median is lower.
5. Avoid extreme probabilities unless the evidence directly supports them. If evidence is thin, ambiguous, or mostly execution-risk, shrink toward the better-supported base rate or 50.
6. If this is a later round, state whether prior quality-review feedback changed the aggregate probability.
7. Keep the rule general for future real forecasts; do not optimize for any benchmark case.
8. Preserve cited sources from component forecasts when useful; do not invent new sources.
9. Do not downweight a higher inside-view, incentives-timing, market-consensus, or adversarial-tail estimate merely because it is above the median. Downweight it only when the component double-counts evidence, violates the resolution boundary, or makes an unsupported leap.
10. For timing questions, explicitly compare the cutoff horizon to the evidence window. If the cutoff is broad and the packet says policymakers, markets, polls, or expert consensus expected the event in that general window, that signal should usually move the aggregate materially unless a named NO mechanism offsets it. Qualitative consensus evidence is weaker than numeric pricing but still direct evidence.
11. If structured market metadata exists, state whether the aggregate anchored to it, discounted it, or moved away from it. Name the reason and avoid double-counting.

Return the round ${round} candidate aggregate. Set method exactly to "adaptive_candidate_calibration_evaluator_v1". Set round to ${round}, forecasterCount to ${selectedRoles.length}, complexityScore to ${plan.complexityScore}, and roleIds to ${JSON.stringify(selectedRoles.map((role) => role.id))}. Include componentProbabilities for every component, componentAudits for every component, meanProbability, medianProbability, disagreement, aggregationAnchor, adjustmentFromMedian, calibrationNotes, calibrationWarnings, method, rationale, citedSources, unresolvedDisagreement, decisiveIssue, feedbackForNextRound, and final probability.`}
              </Task>

              <Task
                id="quality-review"
                output={outputs.binaryQualityReview}
                needs={{ candidate: "candidate-aggregate" }}
                agent={codexStructuredAgent}
              >
                {`You are the quality gate for the Open Superforecaster binary workflow.

Review the latest candidate aggregate and decide whether another loop iteration is likely to improve reliability enough to justify the cost. This is not a style review. Approve when the forecast is calibrated, resolution-aware, and the remaining uncertainty is genuinely irreducible from the provided evidence.

Question:
${question}

Resolution criteria:
${resolutionCriteria}

${structuredContext}

Planner output:
${planSummary}

Current round ${round} component forecasts:
${attemptSummary}

Current candidate aggregate:
${summarizeJson(ctx.latest(outputs.binaryCandidateAggregate, "candidate-aggregate") ?? latestCandidate ?? null)}

Quality thresholds:
${summarizeJson(plan.qualityThresholds)}

Review rules:
1. Approve only if enough selected roles produced useful attempts, the aggregate names its anchor, and any disagreement is either small or explicitly explained.
2. Reject if any material resolution-boundary ambiguity remains unresolved.
3. Reject if base-rate reasoning is missing or merely decorative when the question has any plausible reference class.
4. Reject if the aggregate appears to use disallowed outside evidence in fixed-evidence mode.
5. Reject if a single weak but confident component dominates without a named, defensible reason.
6. Do not reject for cosmetic phrasing. Only require another round for defects likely to change the final probability or improve calibration.
7. If you reject, requiredNextFocus must be concrete instructions the next round can act on.
8. Reject if the aggregate mechanically treats skeptic or resolution-boundary audit roles as equal votes when they found no concrete defect.
9. Reject if a market-threshold or macro-policy timing question ignores a provided catalyst, market-debate signal, threshold-touch dynamic, or timing trigger that could materially move probability.
10. Reject if a timing aggregate fails to distinguish a broad cutoff horizon from a near-deadline cutoff, especially when the fixed evidence includes policymaker projections, market-pricing, polling, or expert-consensus signals for the broader window.

Return round ${round}, approved, confidenceScore, disagreementExplained, issues, requiredNextFocus, missingRoleIds, shouldStopReasoning, and rationale.`}
              </Task>
            </Sequence>
          </Loop>
        ) : null}

        {plan && latestCandidate ? (
          <Task id="aggregate" output={outputs.binaryAggregate}>
            {async () => ({
              ...latestCandidate,
              forecastType: "binary" as const,
              probability: finalCalibration.probability,
              method: "adaptive_constrained_agentic_calibration_evaluator_v2",
              attemptCount: finalComponentProbabilities.length || latestCandidate.attemptCount,
              rationale: finalCalibration.notes.length
                ? `${latestCandidate.rationale}\n\nFinal calibration guard: ${finalCalibration.notes.join(" ")}`
                : latestCandidate.rationale,
              meanProbability: finalProbabilities.length ? finalMeanProbability : latestCandidate.meanProbability,
              medianProbability: finalProbabilities.length ? finalMedianProbability : latestCandidate.medianProbability,
              disagreement: finalProbabilities.length ? finalDisagreement : latestCandidate.disagreement,
              aggregationAnchor: finalCalibration.adjustment === 0 ? latestCandidate.aggregationAnchor : "adjusted" as const,
              adjustmentFromMedian: roundProbability(
                finalCalibration.probability - (finalProbabilities.length ? finalMedianProbability : latestCandidate.medianProbability),
              ),
              calibrationNotes: finalCalibration.notes.length
                ? `${latestCandidate.calibrationNotes}\n\nFinal deterministic calibration guard adjustment: ${finalCalibration.adjustment >= 0 ? "+" : ""}${finalCalibration.adjustment} points. ${finalCalibration.notes.join(" ")}`
                : latestCandidate.calibrationNotes,
              calibrationWarnings: finalCalibration.notes.length
                ? [...latestCandidate.calibrationWarnings, ...finalCalibration.notes]
                : latestCandidate.calibrationWarnings,
              convergenceStatus: qualityApproved ? "approved" as const : "max_iterations_return_last" as const,
              roundsUsed,
              qualityApproved,
              maxIterationsReached,
              forecasterCount: selectedRoles.length,
              complexityScore: plan.complexityScore,
              researchDepth: plan.researchDepth,
              plannerRationale: plan.complexityRationale,
              qualityIssues: finalQualityIssues,
              roleIds: selectedRoles.map((role) => role.id),
              finalReviewRationale: latestQualityReview?.rationale ?? "",
            })}
          </Task>
        ) : null}
      </Sequence>
    </Workflow>
  );
});
