import { z } from "zod";
import type { ResearchTreatment } from "./forecast-research-dossier";

export const forecastIndependenceDiagnosticsSchema = z.object({
  version: z.literal("forecast-independence-diagnostics-v1"),
  componentCount: z.number().int().positive(),
  distinctRoleCount: z.number().int().positive(),
  distinctProviderCount: z.number().int().nonnegative(),
  meanPairwiseClaimJaccard: z.number().min(0).max(1).nullable(),
  meanPairwiseSourceJaccard: z.number().min(0).max(1).nullable(),
  evidenceOverlapEffectiveSizeProxy: z.number().positive().nullable(),
  researchTreatment: z.string(),
  searchPathObservation: z.enum(["not_observed", "partially_observed", "observed"]),
  eligibleForAggregationWeighting: z.literal(false),
  warning: z.string(),
});

export type ForecastIndependenceDiagnostics = z.infer<typeof forecastIndependenceDiagnosticsSchema>;

export type IndependenceAttempt = {
  roleId?: string;
  forecasterLabel?: string;
  providerId?: string;
  evidenceFor?: string[];
  evidenceAgainst?: string[];
  citedSources?: Array<{ url?: string; title?: string; claim?: string }>;
};

export function buildForecastIndependenceDiagnostics(input: {
  attempts: IndependenceAttempt[];
  researchTreatment?: ResearchTreatment;
  harnessObservedSearchPathCount?: number;
}): ForecastIndependenceDiagnostics {
  if (input.attempts.length === 0) {
    throw new Error("Independence diagnostics require at least one forecast component.");
  }
  const claimSets = input.attempts.map((attempt) => new Set([
    ...(attempt.evidenceFor ?? []),
    ...(attempt.evidenceAgainst ?? []),
    ...(attempt.citedSources ?? []).map((source) => source.claim ?? ""),
  ].map(normalize).filter(Boolean)));
  const sourceSets = input.attempts.map((attempt) => new Set(
    (attempt.citedSources ?? []).map(sourceKey).filter(Boolean),
  ));
  const claimOverlap = meanPairwiseJaccard(claimSets);
  const sourceOverlap = meanPairwiseJaccard(sourceSets);
  const overlapValues = [claimOverlap, sourceOverlap].filter((value): value is number => value !== null);
  const overlap = overlapValues.length ? Math.max(...overlapValues) : null;
  const effectiveSize = overlap === null
    ? null
    : input.attempts.length / (1 + (input.attempts.length - 1) * overlap);
  const observedSearchPaths = Math.max(0, Math.floor(input.harnessObservedSearchPathCount ?? 0));
  const searchPathObservation = observedSearchPaths >= input.attempts.length
    ? "observed" as const
    : observedSearchPaths > 0
      ? "partially_observed" as const
      : "not_observed" as const;

  return forecastIndependenceDiagnosticsSchema.parse({
    version: "forecast-independence-diagnostics-v1",
    componentCount: input.attempts.length,
    distinctRoleCount: new Set(input.attempts.map((attempt, index) => (
      normalize(attempt.roleId ?? attempt.forecasterLabel ?? `component-${index + 1}`)
    ))).size,
    distinctProviderCount: new Set(input.attempts.map((attempt) => normalize(attempt.providerId ?? "")).filter(Boolean)).size,
    meanPairwiseClaimJaccard: roundNullable(claimOverlap),
    meanPairwiseSourceJaccard: roundNullable(sourceOverlap),
    evidenceOverlapEffectiveSizeProxy: roundNullable(effectiveSize),
    researchTreatment: input.researchTreatment ?? "unspecified",
    searchPathObservation,
    eligibleForAggregationWeighting: false,
    warning:
      "Evidence overlap is a within-run diversity diagnostic, not an estimate of forecast-error correlation. Learn ensemble weights only from resolved out-of-time cases.",
  });
}

function meanPairwiseJaccard(sets: Array<Set<string>>) {
  const values: number[] = [];
  for (let left = 0; left < sets.length; left += 1) {
    for (let right = left + 1; right < sets.length; right += 1) {
      const leftSet = sets[left];
      const rightSet = sets[right];
      const union = new Set([...leftSet, ...rightSet]);
      if (union.size === 0) {
        continue;
      }
      let intersection = 0;
      for (const value of leftSet) {
        if (rightSet.has(value)) {
          intersection += 1;
        }
      }
      values.push(intersection / union.size);
    }
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sourceKey(source: { url?: string; title?: string; claim?: string }) {
  const url = normalize(source.url ?? "");
  if (url) {
    return `url:${url}`;
  }
  const title = normalize(source.title ?? "");
  const claim = normalize(source.claim ?? "");
  return title || claim ? `reported:${title}:${claim}` : "";
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function roundNullable(value: number | null) {
  return value === null ? null : Math.round(value * 1_000) / 1_000;
}
