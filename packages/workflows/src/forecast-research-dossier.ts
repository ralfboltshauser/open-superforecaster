import { z } from "zod";
import type { EvidenceAttempt } from "./forecast-evidence-workspace";

export const researchTreatmentSchema = z.enum([
  "no_external_research",
  "shared_frozen_dossier",
  "independent_research",
  "shared_plus_followup",
]);

export const researchDossierSourceSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  publishedAt: z.string().optional(),
  sourceType: z.string().default("unknown"),
  query: z.string().optional(),
  rank: z.number().int().positive().optional(),
  claim: z.string().min(1),
  stance: z.enum(["supports_yes", "supports_no", "context"]),
  diagnosticity: z.enum(["low", "medium", "high"]),
  qualityScore: z.number().min(0).max(1).nullable().default(null),
  independenceGroup: z.string().default("unknown"),
  cutoffStatus: z.enum(["before_or_on_cutoff", "after_cutoff", "unknown"]),
});

export const researchDossierSchema = z.object({
  version: z.literal("research-dossier-v1"),
  treatment: researchTreatmentSchema,
  summary: z.string(),
  queryHistory: z.array(z.object({
    query: z.string(),
    purpose: z.string(),
  })).default([]),
  sources: z.array(researchDossierSourceSchema).default([]),
  claimChecks: z.array(z.object({
    claim: z.string(),
    status: z.enum(["supported", "contradicted", "uncertain"]),
    supportingSourceUrls: z.array(z.string()).default([]),
    dependenceWarning: z.string().default(""),
  })).default([]),
  openQuestions: z.array(z.string()).default([]),
  invalidatedPreviousClaimIds: z.array(z.string()).default([]),
  searchesUsed: z.number().int().nonnegative(),
  pagesInspected: z.number().int().nonnegative(),
  searchBudget: z.number().int().positive(),
  stopReason: z.enum(["diminishing_returns", "budget_exhausted", "sufficient_evidence", "tool_failure"]),
  cutoffComplianceNotes: z.string(),
  possibleLeakage: z.array(z.string()).default([]),
  provenance: z.literal("agent_reported"),
}).superRefine((dossier, context) => {
  if (dossier.searchesUsed > dossier.searchBudget) {
    context.addIssue({
      code: "custom",
      path: ["searchesUsed"],
      message: "Reported searchesUsed exceeds the declared searchBudget.",
    });
  }
  if (dossier.queryHistory.length > dossier.searchBudget) {
    context.addIssue({
      code: "custom",
      path: ["queryHistory"],
      message: "Reported queryHistory exceeds the declared searchBudget.",
    });
  }
  if (dossier.searchesUsed !== dossier.queryHistory.length) {
    context.addIssue({
      code: "custom",
      path: ["searchesUsed"],
      message: "Reported searchesUsed must equal the recorded queryHistory length.",
    });
  }
});

const dossierQuarantineReasonSchema = z.enum([
  "post_cutoff",
  "explicit_human_forecast",
]);

export const researchDossierIsolationAuditSchema = z.object({
  version: z.literal("research-dossier-isolation-v1"),
  status: z.enum(["clean", "contaminated"]),
  summaryMethod: z.literal("deterministic_retained_atomic_claims_v1"),
  rawSourceCount: z.number().int().nonnegative(),
  admissibleSourceCount: z.number().int().nonnegative(),
  quarantinedSourceCount: z.number().int().nonnegative(),
  quarantinedSources: z.array(z.object({
    sourceIndex: z.number().int().nonnegative(),
    title: z.string().nullable(),
    url: z.string().nullable(),
    claim: z.string(),
    reasons: z.array(dossierQuarantineReasonSchema).min(1),
  })),
  contaminationFlags: z.array(z.string()),
});

export type ResearchTreatment = z.infer<typeof researchTreatmentSchema>;
export type ResearchDossier = z.infer<typeof researchDossierSchema>;
export type ResearchDossierIsolationAudit = z.infer<typeof researchDossierIsolationAuditSchema>;

const explicitHumanForecastPattern = /\b(metaculus|manifold|polymarket|kalshi|predictit|prediction market|forecast market|bookmaker|betting odds?|analyst probability|crowd forecast|market-implied probability|consensus probability)\b/i;

export function readResearchTreatment(
  value: unknown,
  fallback: ResearchTreatment = "shared_plus_followup",
): ResearchTreatment {
  const parsed = researchTreatmentSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

export function treatmentNeedsSharedDossier(treatment: ResearchTreatment) {
  return treatment === "shared_frozen_dossier" || treatment === "shared_plus_followup";
}

/**
 * Construct the only dossier view that judgment stages may see. The raw dossier
 * remains an audit artifact, but none of its free-form synthesis is trusted:
 * the admissible summary and query history are deterministically rebuilt from
 * retained atomic source claims.
 */
export function sanitizeResearchDossierForJudgment(
  dossier: ResearchDossier,
  input: { cutoffDate?: string } = {},
): { admissibleDossier: ResearchDossier; audit: ResearchDossierIsolationAudit } {
  const quarantinedSources: ResearchDossierIsolationAudit["quarantinedSources"] = [];
  const admissibleSources = dossier.sources.filter((source, sourceIndex) => {
    const reasons: Array<z.infer<typeof dossierQuarantineReasonSchema>> = [];
    if (source.cutoffStatus === "after_cutoff" || isAfterBoundary(source.publishedAt, input.cutoffDate)) {
      reasons.push("post_cutoff");
    }
    if (explicitHumanForecastPattern.test([
      source.title,
      source.url,
      source.sourceType,
      source.claim,
      source.independenceGroup,
    ].filter(Boolean).join(" "))) {
      reasons.push("explicit_human_forecast");
    }
    if (reasons.length === 0) {
      return true;
    }
    quarantinedSources.push({
      sourceIndex,
      title: source.title ?? null,
      url: source.url ?? null,
      claim: source.claim,
      reasons,
    });
    return false;
  });
  const contaminationFlags = uniqueStrings([
    ...quarantinedSources.flatMap((source) => source.reasons.map((reason) => (
      `research_dossier_source_${source.sourceIndex}:${reason}`
    ))),
    ...dossier.possibleLeakage.map((_, index) => `research_dossier_reported_possible_leakage:${index}`),
  ]);
  const queryHistory = uniqueStrings(admissibleSources.map((source) => source.query ?? ""))
    .map((query) => ({ query, purpose: "Surfaced a retained admissible atomic claim." }));
  const derivedSummary = admissibleSources.length === 0
    ? "No admissible atomic evidence claims remain after deterministic dossier quarantine."
    : [
      "Admissible atomic evidence claims retained after deterministic dossier quarantine:",
      ...admissibleSources.map((source) => `- ${source.stance}: ${source.claim}`),
    ].join("\n");
  const admissibleDossier = researchDossierSchema.parse({
    ...dossier,
    summary: derivedSummary,
    queryHistory,
    sources: admissibleSources,
    // These fields are free-form model synthesis produced after the model may
    // have seen forbidden evidence. They cannot enter the judgment context.
    claimChecks: [],
    openQuestions: [],
    // A model that saw quarantined evidence cannot be trusted to decide which
    // prior claim IDs to delete. Clean dossiers may still propose explicit
    // invalidations for the deterministic state merge to apply.
    invalidatedPreviousClaimIds: contaminationFlags.length
      ? []
      : dossier.invalidatedPreviousClaimIds,
    searchesUsed: queryHistory.length,
    pagesInspected: Math.min(dossier.pagesInspected, admissibleSources.length),
    cutoffComplianceNotes: quarantinedSources.length
      ? `${quarantinedSources.length} source(s) were deterministically quarantined before judgment.`
      : "No dossier source triggered deterministic quarantine.",
    possibleLeakage: [],
  });
  const audit = researchDossierIsolationAuditSchema.parse({
    version: "research-dossier-isolation-v1",
    status: contaminationFlags.length ? "contaminated" : "clean",
    summaryMethod: "deterministic_retained_atomic_claims_v1",
    rawSourceCount: dossier.sources.length,
    admissibleSourceCount: admissibleSources.length,
    quarantinedSourceCount: quarantinedSources.length,
    quarantinedSources,
    contaminationFlags,
  });
  return { admissibleDossier, audit };
}

export function researchDossierAsEvidenceAttempt(dossier: ResearchDossier): EvidenceAttempt {
  return {
    roleId: "shared-research-dossier",
    forecasterLabel: "shared research dossier",
    evidenceFor: dossier.sources
      .filter((source) => source.stance === "supports_yes")
      .map((source) => source.claim),
    evidenceAgainst: dossier.sources
      .filter((source) => source.stance === "supports_no")
      .map((source) => source.claim),
    keyUncertainties: dossier.openQuestions,
    citedSources: dossier.sources.map((source) => ({
      ...(source.title ? { title: source.title } : {}),
      ...(source.url ? { url: source.url } : {}),
      ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
      sourceType: source.sourceType,
      ...(source.query ? { query: source.query } : {}),
      ...(source.rank ? { rank: source.rank } : {}),
      qualityScore: source.qualityScore,
      diagnosticity: source.diagnosticity,
      independenceGroup: source.independenceGroup,
      claim: source.claim,
    })),
  };
}

export function researchDossierQueries(dossier: ResearchDossier | null | undefined) {
  return dossier?.queryHistory.map((query) => query.query) ?? [];
}

function isAfterBoundary(value?: string, boundary?: string) {
  if (!value || !boundary) {
    return false;
  }
  const valueMs = Date.parse(value);
  const boundaryMs = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(boundary)
    ? `${boundary}T23:59:59.999Z`
    : boundary);
  return Number.isFinite(valueMs) && Number.isFinite(boundaryMs) && valueMs > boundaryMs;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
