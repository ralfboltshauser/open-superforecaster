import { z } from "zod";

export const disagreementAgendaSchema = z.object({
  version: z.literal("disagreement-agenda-v1"),
  status: z.enum(["no_reconciliation_needed", "targeted_reconciliation_needed"]),
  spread: z.number().min(0).max(100),
  threshold: z.number().min(0).max(100),
  lowComponent: z.object({ roleId: z.string(), probability: z.number().min(0).max(100) }),
  highComponent: z.object({ roleId: z.string(), probability: z.number().min(0).max(100) }),
  disputedClaims: z.array(z.object({
    issue: z.string(),
    yesSide: z.array(z.string()),
    noSide: z.array(z.string()),
  })),
  researchQuestions: z.array(z.string()),
  reforecastRequired: z.boolean(),
  supervisorConstraint: z.literal(
    "The supervisor may commission evidence checks but may not directly choose or alter the final probability.",
  ),
});

export type DisagreementAgenda = z.infer<typeof disagreementAgendaSchema>;

export type DisagreementAttempt = {
  roleId?: string;
  forecasterLabel?: string;
  probability: number;
  baseRateProbability?: number;
  resolutionBoundary?: string;
  strongestYes?: string;
  strongestNo?: string;
  evidenceFor?: string[];
  evidenceAgainst?: string[];
  keyUncertainties?: string[];
};

/**
 * Turn component disagreement into a bounded research agenda. This helper never
 * assigns a new probability; judges must reforecast and a deterministic aggregator
 * must recombine their outputs after reconciliation.
 */
export function buildDisagreementAgenda(
  attempts: DisagreementAttempt[],
  threshold = 20,
): DisagreementAgenda {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error("Disagreement threshold must be between 0 and 100.");
  }
  if (attempts.length === 0) {
    throw new Error("A disagreement agenda requires at least one component forecast.");
  }
  const normalized = attempts.map((attempt, index) => ({
    ...attempt,
    probability: assertProbability(attempt.probability),
    roleId: clean(attempt.roleId) ?? clean(attempt.forecasterLabel) ?? `component-${index + 1}`,
  })).sort((left, right) => left.probability - right.probability);
  const low = normalized[0];
  const high = normalized[normalized.length - 1];
  const spread = roundProbability(high.probability - low.probability);
  const needsReconciliation = spread > threshold;
  const disputedClaims = needsReconciliation ? buildDisputedClaims(low, high) : [];
  const researchQuestions = needsReconciliation
    ? uniqueStrings([
      resolutionQuestion(low, high),
      baseRateQuestion(low, high),
      ...disputedClaims.map((claim) => `What dated primary evidence would resolve: ${claim.issue}`),
      ...(low.keyUncertainties ?? []),
      ...(high.keyUncertainties ?? []),
    ]).filter(Boolean)
    : [];

  return disagreementAgendaSchema.parse({
    version: "disagreement-agenda-v1",
    status: needsReconciliation ? "targeted_reconciliation_needed" : "no_reconciliation_needed",
    spread,
    threshold,
    lowComponent: { roleId: low.roleId, probability: low.probability },
    highComponent: { roleId: high.roleId, probability: high.probability },
    disputedClaims,
    researchQuestions,
    reforecastRequired: needsReconciliation,
    supervisorConstraint:
      "The supervisor may commission evidence checks but may not directly choose or alter the final probability.",
  });
}

function buildDisputedClaims(
  low: DisagreementAttempt & { roleId: string },
  high: DisagreementAttempt & { roleId: string },
) {
  const issues: Array<{ issue: string; yesSide: string[]; noSide: string[] }> = [];
  const yesSide = uniqueStrings([
    high.strongestYes ?? "",
    ...(high.evidenceFor ?? []),
    low.strongestYes ?? "",
  ]);
  const noSide = uniqueStrings([
    low.strongestNo ?? "",
    ...(low.evidenceAgainst ?? []),
    high.strongestNo ?? "",
  ]);
  if (yesSide.length || noSide.length) {
    issues.push({
      issue: `Why ${high.roleId} is at ${high.probability}% while ${low.roleId} is at ${low.probability}%`,
      yesSide,
      noSide,
    });
  }
  const lowBoundary = clean(low.resolutionBoundary);
  const highBoundary = clean(high.resolutionBoundary);
  if (lowBoundary && highBoundary && normalize(lowBoundary) !== normalize(highBoundary)) {
    issues.push({
      issue: "The components may be forecasting different resolution boundaries.",
      yesSide: [highBoundary],
      noSide: [lowBoundary],
    });
  }
  return issues;
}

function resolutionQuestion(
  low: DisagreementAttempt & { roleId: string },
  high: DisagreementAttempt & { roleId: string },
) {
  const lowBoundary = clean(low.resolutionBoundary);
  const highBoundary = clean(high.resolutionBoundary);
  if (!lowBoundary && !highBoundary) {
    return "What exact observation resolves YES, what resolves NO, and which boundary cases remain ambiguous?";
  }
  if (normalize(lowBoundary ?? "") !== normalize(highBoundary ?? "")) {
    return `Which resolution interpretation is correct: "${lowBoundary ?? "missing"}" or "${highBoundary ?? "missing"}"?`;
  }
  return "Verify the shared resolution boundary against the authoritative question rules.";
}

function baseRateQuestion(
  low: DisagreementAttempt & { roleId: string },
  high: DisagreementAttempt & { roleId: string },
) {
  const lowBaseRate = optionalProbability(low.baseRateProbability);
  const highBaseRate = optionalProbability(high.baseRateProbability);
  if (lowBaseRate === null || highBaseRate === null) {
    return "Which empirical reference class applies, and what is its observed base rate?";
  }
  if (Math.abs(highBaseRate - lowBaseRate) >= 10) {
    return `Why do the proposed base rates differ (${lowBaseRate}% versus ${highBaseRate}%), and which reference class is defensible?`;
  }
  return "Which case-specific likelihood ratios, rather than base-rate choice, explain the forecast gap?";
}

function assertProbability(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Invalid probability ${String(value)}. Expected a finite value from 0 to 100.`);
  }
  return value;
}

function optionalProbability(value?: number) {
  return value === undefined ? null : assertProbability(value);
}

function clean(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function roundProbability(value: number) {
  return Math.round(value * 10) / 10;
}
