/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Loop, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import {
  formatForecastContextForPrompt,
  normalizeForecastInputRow,
  planNextForecastReview,
} from "@open-superforecaster/workflow-contracts";
import { agents, codexStructuredAgent } from "./agents";
import { buildBinaryBaselineSanityAudit } from "./binary-baseline-sanity";
import {
  applyBinaryCalibrationGuard,
  binaryCalibrationGuardVariantNone,
  binaryCalibrationGuardVariantTopicalRegexExperimentalV1,
  readBinaryCalibrationGuardVariant,
} from "./binary-calibration-guard";
import { buildBinaryMarketAnchorAudit } from "./binary-market-anchor";
import { buildBinaryResolutionBoundaryAudit } from "./binary-resolution-boundary";
import { buildBinaryUncertaintyRangeAudit } from "./binary-uncertainty-range";
import { buildDisagreementAgenda, disagreementAgendaSchema } from "./forecast-disagreement";
import { buildEvidenceWorkspace, evidenceWorkspaceSchema } from "./forecast-evidence-workspace";
import { collectCitedSources, collectKeyUncertainties } from "./forecast-evidence";
import {
  componentEvidenceIsolationFlags,
  componentHumanForecastExposureFlags,
  sanitizeAutonomousContextText,
  textReportsPossibleHumanForecastExposure,
} from "./forecast-information-isolation";
import {
  readResearchTreatment,
  researchDossierAsEvidenceAttempt,
  researchDossierIsolationAuditSchema,
  researchDossierQueries,
  researchDossierSchema,
  sanitizeResearchDossierForJudgment,
  researchTreatmentSchema,
  treatmentNeedsSharedDossier,
  type ResearchDossier,
} from "./forecast-research-dossier";
import {
  buildForecastState,
  forecastStateSchema,
  type PreviousForecastSnapshot,
} from "./forecast-state";
import { forecastTimingArtifactFields, readForecastTiming } from "./forecast-timing";

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

const forecastAgentsByRole = Object.fromEntries(
  roleIdValues.map((roleId) => [roleId, agents.forecast(roleId)]),
) as Record<RoleId, ReturnType<typeof agents.forecast>>;
const sharedDossierAgent = agents.research("shared-dossier");

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
  publishedAt: z.string().optional(),
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
  keyUncertainties: z.array(z.string()).default([]),
  forecastAsOf: z.string().optional(),
  evidenceAsOf: z.string().optional(),
  cutoffDate: z.string().optional(),
  evidenceAsOfDate: z.string().optional(),
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

const calibrationGuardRule = z.object({
  id: z.string(),
  adjustment: z.number(),
  note: z.string(),
});

const baselineSanity = z.object({
  status: z.enum(["missing_component_base_rates", "near_baseline", "moderate_delta", "large_delta"]),
  baselineProbability: z.number().min(0).max(100).nullable(),
  finalProbability: z.number().min(0).max(100),
  baselineDelta: z.number().nullable(),
  componentBaseRateCount: z.number().int().min(0),
  componentBaseRateDisagreement: z.number().min(0).max(100).nullable(),
  note: z.string(),
});

const marketAnchor = z.object({
  status: z.enum(["missing_market_price", "near_market", "moderate_delta", "large_delta"]),
  marketPrice: z.number().min(0).max(100).nullable(),
  finalProbability: z.number().min(0).max(100),
  marketDelta: z.number().nullable(),
  marketPriceAsOf: z.string().nullable(),
  marketCreationDate: z.string().nullable(),
  marketPlatform: z.string().nullable(),
  marketUrl: z.string().nullable(),
  note: z.string(),
});

const resolutionBoundary = z.object({
  status: z.enum(["missing_boundary_review", "clear_boundary", "some_ambiguity", "material_ambiguity"]),
  componentBoundaryCount: z.number().int().min(0),
  ambiguityFlagCount: z.number().int().min(0),
  qualityIssueCount: z.number().int().min(0),
  plannerRiskCount: z.number().int().min(0),
  note: z.string(),
});

const uncertaintyRange = z.object({
  status: z.enum(["missing_ranges", "narrow", "moderate", "wide"]),
  componentRangeCount: z.number().int().min(0),
  medianRangeWidth: z.number().nullable(),
  meanRangeWidth: z.number().nullable(),
  widestRangeWidth: z.number().nullable(),
  narrowRangeCount: z.number().int().min(0),
  note: z.string(),
});

const binaryAggregate = aggregateCore.extend({
  rawProbability: z.number().min(0).max(100),
  calibratedProbability: z.number().min(0).max(100).nullable(),
  calibrationModelId: z.string().nullable(),
  agenticAggregateCandidateProbability: z.number().min(0).max(100),
  experimentalGuardedProbability: z.number().min(0).max(100).nullable(),
  forecastState: forecastStateSchema,
  disagreementAgenda: disagreementAgendaSchema,
  researchTreatment: researchTreatmentSchema,
  researchDossier: researchDossierSchema.nullable(),
  researchDossierIsolation: researchDossierIsolationAuditSchema.nullable(),
  calibrationGuard: z.object({
    variant: z.enum([
      binaryCalibrationGuardVariantNone,
      binaryCalibrationGuardVariantTopicalRegexExperimentalV1,
    ]),
    experimental: z.boolean(),
    rawProbability: z.number().min(0).max(100),
    guardedProbability: z.number().min(0).max(100),
    adjustment: z.number(),
    appliedRules: z.array(calibrationGuardRule).default([]),
  }),
  baselineSanity,
  marketAnchor,
  resolutionBoundary,
  uncertaintyRange,
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
  researchDossier: researchDossierSchema,
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
  const count = clampInteger(plan?.forecasterCount ?? 3, 2, roleIdValues.length - 1);
  const planned = (plan?.roleIds ?? []).filter(isRoleId).filter((roleId) => roleId !== "market-consensus");
  const merged = [...planned, ...defaultRoleOrder]
    .filter((roleId) => roleId !== "market-consensus")
    .filter((roleId, index, all) => all.indexOf(roleId) === index);
  return merged.slice(0, count).map((roleId) => roleCatalog[roleId]);
}

function selectMaxIterations(plan: ForecastPlan | undefined) {
  const fallback = (plan?.complexityScore ?? 3) >= 4 ? 3 : 2;
  return clampInteger(plan?.maxIterations ?? fallback, 1, 3);
}

function summarizeJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function readPreviousForecastSnapshot(
  state: Record<string, unknown> | null,
  cutoffDate?: string,
  evidenceAsOf?: string,
): PreviousForecastSnapshot | undefined {
  if (!state) {
    return undefined;
  }
  const stateId = typeof state.stateId === "string" ? state.stateId : null;
  const outputs = asRecord(state.outputs);
  const autonomous = asRecord(outputs?.autonomous);
  const probability = typeof autonomous?.selectedProbability === "number"
    ? autonomous.selectedProbability
    : null;
  const research = asRecord(state.research);
  const parsedResearch = evidenceWorkspaceSchema.safeParse(research);
  const autonomousResearch = parsedResearch.success && previousResearchIsAutonomousSafe(
      state,
      parsedResearch.data,
      cutoffDate,
      evidenceAsOf,
    )
    ? parsedResearch.data
    : undefined;
  const evidenceClaimIds = asRecordArray(autonomousResearch?.claims)
    .map((claim) => claim.id)
    .filter((id): id is string => typeof id === "string");
  if (!stateId || probability === null || !Number.isFinite(probability)) {
    return undefined;
  }
  return {
    stateId,
    probability,
    evidenceClaimIds,
    ...(autonomousResearch ? { research: autonomousResearch } : {}),
  };
}

function summarizePreviousForecastState(
  state: Record<string, unknown> | null,
  previous: PreviousForecastSnapshot | undefined,
) {
  if (!state) {
    return "No previous ForecastState exists; this is an initial forecast.";
  }
  const outputs = asRecord(state.outputs);
  const autonomous = asRecord(outputs?.autonomous);
  const update = asRecord(state.update);
  return summarizeJson({
    stateId: state.stateId ?? null,
    temporal: state.temporal ?? null,
    autonomousOutput: autonomous && previous?.research
      ? {
          rawProbability: autonomous.rawProbability ?? null,
          selectedProbability: autonomous.selectedProbability ?? null,
          aggregationMethod: autonomous.aggregationMethod ?? null,
          informationIsolation: autonomous.informationIsolation ?? null,
          calibration: autonomous.calibration ?? null,
        }
      : null,
    evidenceClaims: previous?.research?.claims.slice(0, 100) ?? [],
    priorUpdate: update
      ? {
          kind: update.kind ?? null,
          previousStateId: update.previousStateId ?? null,
          probabilityDelta: update.probabilityDelta ?? null,
          nextScheduledUpdate: update.nextScheduledUpdate ?? null,
        }
      : null,
    priorEvidenceQuarantined: Boolean(asRecord(state.research) && !previous?.research),
  });
}

function previousResearchIsAutonomousSafe(
  state: Record<string, unknown>,
  research: z.infer<typeof evidenceWorkspaceSchema>,
  cutoffDate?: string,
  evidenceAsOf?: string,
) {
  const autonomous = asRecord(asRecord(state.outputs)?.autonomous);
  const isolation = asRecord(autonomous?.informationIsolation);
  if (isolation?.status !== "isolated") {
    return false;
  }
  if (research.integrityFlags.some((flag) =>
    flag.startsWith("post_cutoff_source:") || flag.startsWith("source_after_evidence_as_of:"))) {
    return false;
  }
  if (research.sources.some((source) =>
    textReportsPossibleHumanForecastExposure([
      source.title,
      source.url,
      source.sourceType,
    ].filter(Boolean).join(" ")) ||
    isAfterBoundary(source.publishedAt, cutoffDate) ||
    isAfterBoundary(source.publishedAt, evidenceAsOf))) {
    return false;
  }
  return !research.claims.some((claim) => textReportsPossibleHumanForecastExposure(claim.text));
}

function isAfterBoundary(value: string | null, boundary?: string) {
  if (!value || !boundary) {
    return false;
  }
  const left = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00.000Z`
    : value);
  const right = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(boundary)
    ? `${boundary}T23:59:59.999Z`
    : boundary);
  return Number.isFinite(left) && Number.isFinite(right) && left > right;
}

function readUpdateKind(value: unknown, hasPrevious: boolean) {
  return value === "scheduled" || value === "event_triggered" || value === "manual"
    ? value
    : hasPrevious
      ? "manual" as const
      : "initial" as const;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => asRecord(item) !== null)
    : [];
}

export default smithers((ctx) => {
  const rawInput = (ctx.input ?? {}) as Record<string, unknown> & {
    question?: unknown;
    prompt?: unknown;
    resolutionCriteria?: unknown;
    background?: unknown;
    fixedEvidence?: unknown;
    cutoffDate?: unknown;
    calibrationGuardVariant?: unknown;
    researchTreatment?: unknown;
    previousForecastState?: unknown;
    updateKind?: unknown;
    updateReason?: unknown;
    nextScheduledUpdate?: unknown;
  };
  const forecastInput = normalizeForecastInputRow(rawInput);
  const question = forecastInput.question;
  const resolutionCriteria = forecastInput.resolutionCriteria ?? "Resolve according to the plain-language question.";
  const background = forecastInput.background ?? "";
  const autonomousBackground = sanitizeAutonomousContextText(background);
  const structuredContext = formatForecastContextForPrompt({ ...forecastInput, market: {} });
  const fixedEvidence = String(rawInput.fixedEvidence ?? "");
  const autonomousFixedEvidence = sanitizeAutonomousContextText(fixedEvidence);
  const researchTreatment = fixedEvidence
    ? "shared_frozen_dossier" as const
    : readResearchTreatment(rawInput.researchTreatment);
  const needsSharedDossier = !fixedEvidence && treatmentNeedsSharedDossier(researchTreatment);
  const calibrationGuardVariant = readBinaryCalibrationGuardVariant(rawInput.calibrationGuardVariant);
  const previousForecastState = asRecord(rawInput.previousForecastState);
  const timing = readForecastTiming(rawInput);
  const previousSnapshot = readPreviousForecastSnapshot(
    previousForecastState,
    timing.cutoffDate,
    timing.evidenceAsOf,
  );
  const updateKind = readUpdateKind(rawInput.updateKind, Boolean(previousSnapshot));
  const updateReason = typeof rawInput.updateReason === "string" && rawInput.updateReason.trim()
    ? rawInput.updateReason.trim()
    : previousSnapshot
      ? "Forecast reopened for new evidence."
      : "Initial forecast snapshot.";
  const requestedNextScheduledUpdate = typeof rawInput.nextScheduledUpdate === "string" && rawInput.nextScheduledUpdate.trim()
    ? rawInput.nextScheduledUpdate.trim()
    : undefined;
  const previousStateSummary = summarizePreviousForecastState(previousForecastState, previousSnapshot);
  const reviewPlan = timing.forecastAsOf
    ? planNextForecastReview({
      asOf: timing.forecastAsOf,
      resolutionDate: forecastInput.resolutionDate,
    })
    : null;
  const nextScheduledUpdate = requestedNextScheduledUpdate ?? reviewPlan?.nextReviewAt ?? undefined;
  const horizonStart = timing.forecastAsOf ?? timing.evidenceAsOf ?? "";
  const resolutionHorizonDays = daysBetween(horizonStart, forecastInput.resolutionDate ?? "");
  const resolutionHorizonText = resolutionHorizonDays === undefined
    ? "unknown"
    : `${resolutionHorizonDays} days from forecast as-of to resolution date`;

  const plan = ctx.latest(outputs.forecastPlan, "plan") as ForecastPlan | undefined;
  const latestQualityReview = ctx.latest(outputs.binaryQualityReview, "quality-review") as BinaryQualityReview | undefined;
  const latestCandidate = ctx.latest(
    outputs.binaryCandidateAggregate,
    "candidate-aggregate",
  ) as BinaryCandidateAggregate | undefined;
  const researchDossier = ctx.latest(outputs.researchDossier, "research-dossier") as ResearchDossier | undefined;
  const dossierJudgmentView = researchDossier
    ? sanitizeResearchDossierForJudgment(researchDossier, { cutoffDate: timing.cutoffDate })
    : null;
  const admissibleResearchDossier = dossierJudgmentView?.admissibleDossier;
  const researchDossierIsolation = dossierJudgmentView?.audit ?? null;
  const dossierEvidenceAttempt = admissibleResearchDossier
    ? researchDossierAsEvidenceAttempt(admissibleResearchDossier)
    : null;
  const evidenceAttemptsPrefix = dossierEvidenceAttempt ? [dossierEvidenceAttempt] : [];

  const selectedRoles = selectRoles(plan);
  const maxIterations = selectMaxIterations(plan);
  const dossierSearchBudget = clampInteger(2 + (plan?.complexityScore ?? 2) * 2, 4, 12);
  const perJudgeFollowupBudget = Math.max(1, Math.min(3, Math.ceil(dossierSearchBudget / Math.max(2, selectedRoles.length))));
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
  const currentEvidenceWorkspace = buildEvidenceWorkspace({
    attempts: [...evidenceAttemptsPrefix, ...currentAttempts],
    reportedSearchQueries: researchDossierQueries(admissibleResearchDossier),
    ...(timing.evidenceAsOf ? { evidenceAsOf: timing.evidenceAsOf } : {}),
    ...(timing.cutoffDate ? { cutoffDate: timing.cutoffDate } : {}),
  });
  const currentDisagreementAgenda = currentAttempts.length
    ? buildDisagreementAgenda(
      currentAttempts,
      plan?.qualityThresholds.maxUnexplainedDisagreement ?? 20,
    )
    : null;
  const evidenceWorkspaceSummary = summarizeJson(currentEvidenceWorkspace);
  const disagreementAgendaSummary = summarizeJson(currentDisagreementAgenda);
  const researchDossierSummary = summarizeJson(admissibleResearchDossier ?? null);
  const judgmentResearchInstructions = fixedEvidence
    ? "Use only the fixed evidence packet. External research is disallowed."
    : researchTreatment === "no_external_research"
      ? "Do not use external research or tool calls. Judge from the question, resolution criteria, and background only."
      : researchTreatment === "shared_frozen_dossier"
        ? "Use only the shared dossier below. Do not run independent searches or inspect other pages."
        : researchTreatment === "independent_research"
          ? `Conduct an independent search path with at most ${perJudgeFollowupBudget} focused queries. Preserve every source in citedSources.`
          : `Start from the shared dossier. You may run at most ${perJudgeFollowupBudget} targeted follow-up queries only for open questions or disputed facts, and must preserve every resulting source in citedSources.`;
  const latestQualitySummary = summarizeJson(latestQualityReview ?? null);
  const roleCatalogSummary = summarizeJson(defaultRoleOrder.map((roleId) => roleCatalog[roleId]));

  const finalComponentProbabilities = latestCandidate?.componentProbabilities ?? [];
  const finalProbabilities = finalComponentProbabilities
    .map((component) => component.probability)
    .filter((probability) => Number.isFinite(probability));
  const finalMeanProbability = roundProbability(mean(finalProbabilities));
  const finalMedianProbability = roundProbability(median(finalProbabilities));
  const finalDisagreement = roundProbability(disagreement(finalProbabilities));
  const allRoundAttempts = ctx.outputs.binaryAttempt ?? [];
  const finalRoundAttempts = allRoundAttempts
    .filter((attempt) => attempt.round === latestCandidate?.round);
  const finalStateAttempts = finalRoundAttempts.length
    ? finalRoundAttempts
    : finalComponentProbabilities.map((component, index) => ({
      roleId: component.roleId ?? `component-${index + 1}`,
      forecasterLabel: component.forecasterLabel,
      probability: component.probability,
      ...(component.baseRateProbability === undefined
        ? {}
        : { baseRateProbability: component.baseRateProbability }),
      ...(component.insideViewProbability === undefined
        ? {}
        : { insideViewProbability: component.insideViewProbability }),
    }));
  const roundsUsed = clampInteger(latestCandidate?.round ?? latestQualityReview?.round ?? 1, 1, maxIterations);
  const qualityApproved = latestQualityReview?.approved === true;
  const maxIterationsReached = !qualityApproved && roundsUsed >= maxIterations;
  const finalQualityIssues = (latestQualityReview?.issues ?? []).map((issue) => (
    `${issue.severity}: ${issue.issue} Next focus: ${issue.requiredNextFocus}`
  ));
  const finalInformationAdvantageFlags = [...new Set([
    ...(researchDossierIsolation?.contaminationFlags ?? []),
    ...componentHumanForecastExposureFlags(allRoundAttempts),
    ...componentEvidenceIsolationFlags(allRoundAttempts, {
      ...(timing.cutoffDate ? { cutoffDate: timing.cutoffDate } : {}),
      ...(timing.evidenceAsOf ? { evidenceAsOf: timing.evidenceAsOf } : {}),
    }),
  ])];
  const redactedInputFlags = [
    ...(textReportsPossibleHumanForecastExposure(fixedEvidence)
      ? ["fixed_evidence_human_forecast_redacted_before_autonomous_prompt"]
      : []),
    ...(textReportsPossibleHumanForecastExposure(background)
      ? ["background_human_forecast_redacted_before_autonomous_prompt"]
      : []),
  ];
  const finalForecastState = latestCandidate && finalStateAttempts.length
    ? buildForecastState({
      question,
      resolutionCriteria,
      ...(background ? { background } : {}),
      ...(forecastInput.resolutionDate ? { resolutionDate: forecastInput.resolutionDate } : {}),
      ...(forecastInput.condition ? { condition: forecastInput.condition } : {}),
      ...(timing.forecastAsOf ? { forecastAsOf: timing.forecastAsOf } : {}),
      ...(timing.evidenceAsOf ? { evidenceAsOf: timing.evidenceAsOf } : {}),
      ...(timing.cutoffDate ? { cutoffDate: timing.cutoffDate } : {}),
      attempts: finalStateAttempts,
      evidenceAttempts: [...evidenceAttemptsPrefix, ...finalStateAttempts],
      reportedSearchQueries: researchDossierQueries(admissibleResearchDossier),
      researchTreatment,
      informationAdvantageFlags: finalInformationAdvantageFlags,
      redactedInformationAdvantageFlags: redactedInputFlags,
      ...(previousSnapshot ? { previous: previousSnapshot } : {}),
      update: {
        kind: updateKind,
        reason: updateReason,
        invalidatedEvidenceClaimIds: admissibleResearchDossier?.invalidatedPreviousClaimIds ?? [],
        ...(nextScheduledUpdate ? { nextScheduledUpdate } : {}),
      },
      modelAggregateCandidate: {
        probability: latestCandidate.probability,
        method: latestCandidate.method,
      },
      ...(forecastInput.market.marketPrice === undefined
        ? {}
        : {
          market: {
            probability: forecastInput.market.marketPrice,
            ...(forecastInput.market.marketPriceAsOf
              ? { asOf: forecastInput.market.marketPriceAsOf }
              : {}),
          },
        }),
      provenance: {
        workflowVersion: "binary-forecast-stateful-v1",
        dossierVersion: fixedEvidence
          ? "fixed-evidence-input-v1"
          : researchDossier?.version ?? "independent-agent-reported-evidence-v1",
        ...(reviewPlan ? { schedulerVersion: reviewPlan.version } : {}),
      },
    })
    : null;
  const productionProbability = finalForecastState?.outputs.autonomous.selectedProbability
    ?? (finalProbabilities.length ? finalMeanProbability : 50);
  const finalCalibration = applyBinaryCalibrationGuard({
    probability: productionProbability,
    question,
    resolutionCriteria,
    background: autonomousBackground,
    fixedEvidence: autonomousFixedEvidence,
    cutoffHorizonDays: resolutionHorizonDays,
    variant: calibrationGuardVariant,
  });
  const finalDisagreementAgenda = buildDisagreementAgenda(
    finalStateAttempts.length
      ? finalStateAttempts
      : [{ roleId: "missing-component", probability: productionProbability }],
    plan?.qualityThresholds.maxUnexplainedDisagreement ?? 20,
  );
  const finalBaselineSanity = buildBinaryBaselineSanityAudit({
    finalProbability: productionProbability,
    components: finalComponentProbabilities,
  });
  const finalMarketAnchor = buildBinaryMarketAnchorAudit({
    finalProbability: productionProbability,
    market: forecastInput.market,
  });
  const finalResolutionBoundary = buildBinaryResolutionBoundaryAudit({
    components: finalRoundAttempts,
    qualityIssues: finalQualityIssues,
    plannerRisks: plan?.resolutionRisks ?? [],
    resolutionCriteria: forecastInput.resolutionCriteria,
  });
  const finalUncertaintyRange = buildBinaryUncertaintyRangeAudit({
    components: finalRoundAttempts,
  });

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
8. This panel produces the autonomous track. Do not select market-consensus and do not seek prediction-market, crowd-forecast, bookmaker, analyst-probability, or other explicit human probability sources.
9. Threshold questions with volatility, flow, momentum, pricing, or reflexivity mechanisms should usually include adversarial-tail and incentives-timing, using underlying facts rather than other forecasters' probabilities.
10. For timing questions, distinguish a near resolution deadline from a broad resolution horizon with many decision opportunities. Use actor incentives, institutional schedules, and primary evidence.
11. Structured market metadata is intentionally hidden from this panel. A separate crowd-assisted output is computed after the autonomous forecast, so the two tracks remain measurable.
12. If a fixed packet itself contains explicit human or market probabilities, flag possible information-advantage contamination rather than silently treating the result as autonomous.
13. Planning is not a research stage. Do not use web search, file reads, shell commands, memory, or any external information. Plan only from the question, resolution criteria, timing context, background, previous ForecastState, and fixed packet supplied below.

Question:
${question}

Resolution criteria:
${resolutionCriteria}

${structuredContext}

${timing.promptBlock}
Resolution horizon: ${resolutionHorizonText}

Background:
${autonomousBackground || "No extra background provided."}

Previous ForecastState:
${previousStateSummary}

${fixedEvidence ? `Fixed evidence packet (explicit human forecasts are deterministically redacted):
${autonomousFixedEvidence || "[All supplied fixed evidence was quarantined from the autonomous context.]"}` : "No fixed evidence packet was provided."}

Return a plan with questionType, complexityScore, complexityRationale, forecasterCount, roleIds, maxIterations, researchDepth, useFixedEvidenceOnly, expectedDisagreement, resolutionRisks, decisionRule, qualityThresholds, and plannerNotes.`}
        </Task>

        {plan && needsSharedDossier ? (
          <Task id="research-dossier" output={outputs.researchDossier} agent={sharedDossierAgent}>
            {`You are the bounded research harness for Open Superforecaster's autonomous track.

Build a shared, auditable dossier before any judge assigns a probability. Research facts and mechanisms, not other people's forecasts.

Question:
${question}

Resolution criteria:
${resolutionCriteria}

${structuredContext}

${timing.promptBlock}

Background:
${autonomousBackground || "No extra background provided."}

Previous ForecastState:
${previousStateSummary}

Research treatment: ${researchTreatment}
Search budget: at most ${dossierSearchBudget} distinct queries.

Rules:
1. Restate the exact YES/NO boundary internally and search first for authoritative resolution definitions, empirical base rates, current state, causal drivers, blockers, and scheduled signposts.
2. Prefer primary and dated sources. Distinguish multiple articles repeating one underlying report by assigning the same independenceGroup.
3. Record every query in queryHistory and every source actually inspected in sources. On each source include the query that surfaced it and its result rank when known. Never invent a URL, publication date, page read, query, rank, or source-quality observation.
4. Each source gets one atomic claim, stance, diagnosticity, a conservative qualityScore or null, independenceGroup, and cutoffStatus.
5. Check important claims across sources. Mark contradictions and dependence warnings in claimChecks.
6. Enforce cutoffDate as the hard admissibility boundary. A source after cutoffDate is not admissible and must be listed in possibleLeakage. If a source is newer than evidenceAsOf but still within cutoffDate, flag the evidence-recency mismatch separately rather than calling it cutoff leakage.
7. Do not seek or use prediction-market prices, Metaculus/Manifold/Polymarket/Kalshi probabilities, bookmaker odds, analyst probabilities, or other explicit human forecasts. If encountered accidentally, record the exposure in possibleLeakage and do not include its probability as evidence.
8. Stop when the evidence is sufficient, marginal queries repeat the same source chain, the budget is exhausted, or tools fail. Record the real stopReason.
9. This CLI research trace is not intercepted by the harness yet. Set provenance exactly to "agent_reported"; do not claim that queries or pages were harness-observed.
10. For an update, compare against previous evidence claim IDs. Put a prior claim ID in invalidatedPreviousClaimIds only when new evidence actually contradicts or supersedes it; absence of a new mention is not invalidation.

Return version "research-dossier-v1", treatment "${researchTreatment}", summary, queryHistory, sources, claimChecks, openQuestions, invalidatedPreviousClaimIds, searchesUsed, pagesInspected, searchBudget ${dossierSearchBudget}, stopReason, cutoffComplianceNotes, possibleLeakage, and provenance "agent_reported".`}
          </Task>
        ) : null}

        {plan && (!needsSharedDossier || researchDossier) ? (
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
                    agent={forecastAgentsByRole[role.id]}
                  >
                    {`You are the ${role.label} for Open Superforecaster.

This is round ${round} of at most ${maxIterations}. Your role id is "${role.id}".

Planner output:
${planSummary}

Research treatment: ${researchTreatment}
${judgmentResearchInstructions}

${researchDossier ? `Shared research dossier (all query/page provenance is agent-reported unless explicitly marked otherwise):
${researchDossierSummary}` : "No shared research dossier is available for this treatment."}

Previous ForecastState:
${previousStateSummary}

${latestQualityReview ? `Previous quality review:
${latestQualitySummary}

This is an improvement round. Directly address the requiredNextFocus items that apply to your role. Do not merely restate the prior forecast.` : "This is the first round. Produce an independent forecast from your assigned role."}

Forecasting process:
1. Restate the resolution boundary before judging probability.
2. For timing questions, compare the resolution horizon to the admissible evidence window and number of plausible decision opportunities. Do not treat the evidence cutoff as the event deadline.
3. Pick concrete reference classes and estimate a base-rate probability.
4. Update from that base rate using case-specific evidence.
5. Use underlying facts, primary sources, actor behavior, institutional schedules, and empirical reference classes.
5a. This is the autonomous track. Do not seek or use prediction-market prices, crowd forecasts, bookmaker odds, analyst probabilities, or other explicit human forecasts. If such information appears in a fixed packet or source, identify it in calibrationWarnings and set usedDisallowedEvidence true.
6. List the strongest yes and no arguments, then run a premortem.
7. Give a precise final probability from 0 to 100. Round sensibly; do not hide uncertainty at 50.
8. Flag overconfidence, missing base rates, weak evidence, disallowed evidence, correlated assumptions, or numeric inconsistency in calibrationWarnings.

Question:
${question}

Resolution criteria:
${resolutionCriteria}

${structuredContext}

${timing.promptBlock}
Resolution horizon: ${resolutionHorizonText}

Background:
${autonomousBackground || "No extra background provided."}

${fixedEvidence ? `Fixed evidence packet (explicit human forecasts are deterministically redacted):
${autonomousFixedEvidence || "[All supplied fixed evidence was quarantined from the autonomous context.]"}

Use only the fixed evidence packet, background, question, resolution criteria, planner output, and prior quality review. Do not use web search, file reads, shell commands, memory, or external information. If you rely on anything outside this packet, set usedDisallowedEvidence true.` : ""}

Role focus:
${role.focus}

Return a binary forecast. Set roleId to "${role.id}", round to ${round}, and forecasterLabel to "${role.label}". Provide probability, baseRateProbability, insideViewProbability, probabilityRange, referenceClass, resolutionBoundary, evidenceFor, evidenceAgainst, strongest yes/no arguments, key uncertainties, premortem, wildcards, feedbackAddressed, calibrationWarnings, usedDisallowedEvidence, and cited sources when available. For cited sources, include publishedAt as an ISO date when the source date is known; omit it when unknown.`}
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

${timing.promptBlock}
Resolution horizon: ${resolutionHorizonText}

Background:
${autonomousBackground || "No extra background provided."}

${fixedEvidence ? `Fixed evidence packet (explicit human forecasts are deterministically redacted):
${autonomousFixedEvidence || "[All supplied fixed evidence was quarantined from the autonomous context.]"}

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

Environment-owned evidence workspace:
${evidenceWorkspaceSummary}

Deterministic disagreement agenda:
${disagreementAgendaSummary}

Evaluation rules:
1. Start from the median, mean, and roleWeightedMeanProbability as anchors. Do not mechanically vote all roles equally: skeptic and resolution-boundary are mainly audit roles unless they find a concrete defect; base-rate, inside-view, reference-class, incentives-timing, market-consensus, and adversarial-tail are primary probability anchors.
2. Do not reward confidence, length, or rhetorical strength. Reward resolution-boundary correctness, base-rate quality, evidence quality, and calibrated uncertainty.
3. Downweight a component only for a specific defect: wrong resolution boundary, unsupported base rate, double-counted evidence, ignored decisive counterevidence, disallowed evidence, numeric inconsistency, or missing major failure mode.
4. You may select one component or adjust away from mean/median only when you name the defect or decisive insight causing the adjustment. A well-defended mechanism, timing trigger, or fat-tail threshold-touch path can justify moving toward the roleWeightedMeanProbability even if the unweighted median is lower.
5. Avoid extreme probabilities unless the evidence directly supports them. If evidence is thin, ambiguous, or mostly execution-risk, shrink toward the better-supported base rate or 50.
6. If this is a later round, state whether prior quality-review feedback changed the aggregate probability.
7. Keep the rule general for future real forecasts; do not optimize for any benchmark case.
8. Preserve cited sources from component forecasts when useful; do not invent new sources.
9. Do not downweight a higher inside-view, incentives-timing, or adversarial-tail estimate merely because it is above the median. Downweight it only when the component double-counts evidence, violates the resolution boundary, or makes an unsupported leap.
10. For timing questions, explicitly compare the resolution horizon to the evidence window and identify the actor decisions or scheduled opportunities that create the timing probability.
11. Reject or flag any component that used explicit human forecasts, market prices, crowd probabilities, bookmaker odds, or analyst probabilities. Those inputs belong only in the separately reported assisted track.
12. Treat sources labelled agent_reported as unverified provenance. Do not describe them as harness-observed or independently verified.
13. If the disagreement agenda requests reconciliation, use feedbackForNextRound to commission only the disputed fact, base-rate, or resolution-boundary checks. You may diagnose disagreement, but you may not resolve it by directly overriding the panel probability.
14. The unweighted mean and median are immutable controls. Your probability is an experimental agentic candidate that will be retained for evaluation; it is not automatically the production forecast.
15. Aggregation is not a research stage. Do not use web search, file reads, shell commands, memory, or any external information under any research treatment. Evaluate only the supplied dossier, ForecastState summary, component forecasts, and environment-owned diagnostics.

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

${timing.promptBlock}
Resolution horizon: ${resolutionHorizonText}

Planner output:
${planSummary}

Current round ${round} component forecasts:
${attemptSummary}

Environment-owned evidence workspace:
${evidenceWorkspaceSummary}

Deterministic disagreement agenda:
${disagreementAgendaSummary}

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
9. Reject if a threshold or macro-policy timing question ignores a provided catalyst, threshold-touch dynamic, institutional schedule, or timing trigger that could materially move probability.
10. Reject if a timing aggregate fails to distinguish a broad resolution horizon from a near resolution deadline. Treat cutoffDate only as the admissible-information boundary, especially when fixed evidence includes policymaker projections, market pricing, polling, or expert-consensus signals.
11. Reject if any autonomous component used explicit human forecast probabilities or structured market metadata. Those inputs are isolated to the crowd-assisted track.
12. When the deterministic disagreement agenda requests reconciliation, reject unless the disputed fact, base rate, or boundary has been checked or converted into concrete next-round work. The supervisor may not directly choose a replacement probability.
13. Sources marked agent_reported are not independently verified. Reject any claim of harness-observed provenance that the workspace does not support.
14. Quality review is not a research stage. Do not use web search, file reads, shell commands, memory, or any external information under any research treatment. Review only the supplied planner output, component forecasts, evidence workspace, disagreement agenda, and candidate aggregate.

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
              probability: productionProbability,
              rawProbability: productionProbability,
              calibratedProbability: null,
              calibrationModelId: null,
              agenticAggregateCandidateProbability: latestCandidate.probability,
              experimentalGuardedProbability: finalCalibration.experimental
                ? finalCalibration.probability
                : null,
              forecastState: finalForecastState!,
              disagreementAgenda: finalDisagreementAgenda,
              researchTreatment,
              // Preserve the raw model dossier for audit, but never place it in
              // a judgment-stage prompt or evidence workspace.
              researchDossier: researchDossier ?? null,
              researchDossierIsolation,
              method: "stateful_unweighted_arithmetic_mean_v1",
              attemptCount: finalComponentProbabilities.length || latestCandidate.attemptCount,
              rationale: `${latestCandidate.rationale}\n\nProduction selection: ${productionProbability}% from the unweighted arithmetic mean. The constrained agentic aggregate (${latestCandidate.probability}%) is retained as an experimental candidate until it wins paired out-of-time evaluation.${finalCalibration.notes.length ? ` The named topical guard produced another experimental candidate at ${finalCalibration.probability}% (${finalCalibration.variant}); it was not selected.` : ""}`,
              meanProbability: finalProbabilities.length ? finalMeanProbability : latestCandidate.meanProbability,
              medianProbability: finalProbabilities.length ? finalMedianProbability : latestCandidate.medianProbability,
              disagreement: finalProbabilities.length ? finalDisagreement : latestCandidate.disagreement,
              aggregationAnchor: "mean" as const,
              adjustmentFromMedian: roundProbability(
                productionProbability - (finalProbabilities.length ? finalMedianProbability : latestCandidate.medianProbability),
              ),
              calibrationNotes: `${latestCandidate.calibrationNotes}\n\nNo statistical calibration model was applied. Raw mean, median, logit-pool, prior-shrinkage, agentic-candidate, and assisted-track values remain inspectable in ForecastState.${finalCalibration.notes.length ? ` Named experimental topical guard (${finalCalibration.variant}) adjustment from the raw mean: ${finalCalibration.adjustment >= 0 ? "+" : ""}${finalCalibration.adjustment} points. This is not a fitted calibration model and was not selected. ${finalCalibration.notes.join(" ")}` : ""}`,
              calibrationWarnings: finalCalibration.notes.length
                ? [
                  ...latestCandidate.calibrationWarnings,
                  `Experimental topical guard ${finalCalibration.variant} was evaluated but not selected.`,
                  ...finalCalibration.notes,
                ]
                : latestCandidate.calibrationWarnings,
              citedSources: collectCitedSources(finalRoundAttempts),
              keyUncertainties: collectKeyUncertainties(finalRoundAttempts),
              ...forecastTimingArtifactFields(timing),
              calibrationGuard: {
                variant: finalCalibration.variant,
                experimental: finalCalibration.experimental,
                rawProbability: finalCalibration.rawProbability,
                guardedProbability: finalCalibration.probability,
                adjustment: finalCalibration.adjustment,
                appliedRules: finalCalibration.appliedRules,
              },
              baselineSanity: finalBaselineSanity,
              marketAnchor: finalMarketAnchor,
              resolutionBoundary: finalResolutionBoundary,
              uncertaintyRange: finalUncertaintyRange,
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
