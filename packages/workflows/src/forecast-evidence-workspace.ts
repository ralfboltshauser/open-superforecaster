import { z } from "zod";

export const evidenceProvenanceSchema = z.enum(["agent_reported", "harness_observed"]);
export const evidenceCutoffStatusSchema = z.enum(["before_or_on_cutoff", "after_cutoff", "unknown"]);

export const evidenceSourceSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  domain: z.string().nullable(),
  publishedAt: z.string().nullable(),
  retrievedAt: z.string().nullable(),
  query: z.string().nullable(),
  rank: z.number().int().positive().nullable(),
  sourceType: z.string(),
  qualityScore: z.number().min(0).max(1).nullable(),
  archiveUri: z.string().nullable(),
  reportedIndependenceGroup: z.string().nullable(),
  provenance: evidenceProvenanceSchema,
  cutoffStatus: evidenceCutoffStatusSchema,
  usedInFinal: z.boolean(),
});

export const atomicEvidenceClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  stance: z.enum(["supports_yes", "supports_no", "context", "contested"]),
  sourceIds: z.array(z.string()),
  reportedBy: z.array(z.string()),
  dependenceKeys: z.array(z.string()),
  verificationStatus: z.enum([
    "unverified",
    "agent_reported_source",
    "source_observed",
    "contradicted",
  ]),
});

export const evidenceSearchObservationSchema = z.object({
  query: z.string(),
  observedAt: z.string().nullable(),
  resultCount: z.number().int().nonnegative().nullable(),
  provenance: evidenceProvenanceSchema,
});

export const evidenceWorkspaceSchema = z.object({
  version: z.literal("forecast-evidence-workspace-v1"),
  provenanceMode: z.enum([
    "harness_observed",
    "mixed",
    "agent_reported_only",
    "no_source_observations",
  ]),
  evidenceAsOf: z.string().nullable(),
  cutoffDate: z.string().nullable(),
  sources: z.array(evidenceSourceSchema),
  claims: z.array(atomicEvidenceClaimSchema),
  searchHistory: z.array(evidenceSearchObservationSchema),
  remainingInformationNeeds: z.array(z.string()),
  integrityFlags: z.array(z.string()),
  diagnostics: z.object({
    sourceCount: z.number().int().nonnegative(),
    claimCount: z.number().int().nonnegative(),
    harnessObservedSourceCount: z.number().int().nonnegative(),
    agentReportedSourceCount: z.number().int().nonnegative(),
    datedSourceCount: z.number().int().nonnegative(),
    postCutoffSourceCount: z.number().int().nonnegative(),
    postEvidenceAsOfSourceCount: z.number().int().nonnegative(),
    unsupportedClaimCount: z.number().int().nonnegative(),
    contestedClaimCount: z.number().int().nonnegative(),
    uniqueDomainCount: z.number().int().nonnegative(),
    maximumDomainShare: z.number().min(0).max(1),
    queriesUsed: z.number().int().nonnegative(),
    harnessObservedQueryCount: z.number().int().nonnegative(),
    pagesInspected: z.number().int().nonnegative(),
    maxQueries: z.number().int().positive().nullable(),
    maxPages: z.number().int().positive().nullable(),
  }),
});

export type EvidenceWorkspace = z.infer<typeof evidenceWorkspaceSchema>;

export type EvidenceAttempt = {
  roleId?: string;
  forecasterLabel?: string;
  evidenceFor?: string[];
  evidenceAgainst?: string[];
  keyUncertainties?: string[];
  citedSources?: Array<{
    title?: string;
    url?: string;
    publishedAt?: string;
    sourceType?: string;
    query?: string;
    rank?: number;
    qualityScore?: number | null;
    independenceGroup?: string;
    claim: string;
  }>;
};

export type ObservedEvidenceEvent = {
  kind: "search_result" | "page_inspected";
  observedAt: string;
  query?: string;
  resultCount?: number;
  rank?: number;
  title?: string;
  url?: string;
  publishedAt?: string;
  sourceType?: string;
  qualityScore?: number;
  archiveUri?: string;
};

export type EvidenceWorkspaceBudget = {
  maxQueries?: number;
  maxPages?: number;
};

export type BuildEvidenceWorkspaceInput = {
  attempts: EvidenceAttempt[];
  evidenceAsOf?: string;
  cutoffDate?: string;
  observedEvents?: ObservedEvidenceEvent[];
  reportedSearchQueries?: string[];
  budget?: EvidenceWorkspaceBudget;
};

type MutableSource = z.infer<typeof evidenceSourceSchema>;
type MutableClaim = {
  id: string;
  text: string;
  stances: Set<"supports_yes" | "supports_no" | "context">;
  sourceIds: Set<string>;
  reportedBy: Set<string>;
};

/**
 * Build environment-owned, deterministic evidence state from observed tool events
 * and model-reported evidence. Model-reported citations remain explicitly labelled
 * until a harness observation proves that the system actually inspected the page.
 */
export function buildEvidenceWorkspace(input: BuildEvidenceWorkspaceInput): EvidenceWorkspace {
  const observedEvents = input.observedEvents ?? [];
  const cutoffBoundary = input.cutoffDate;
  const sourceByKey = new Map<string, MutableSource>();
  const claimByKey = new Map<string, MutableClaim>();
  const observedUrlKeys = new Set<string>();

  for (const event of observedEvents) {
    // A URL appearing in search results proves only that the result was shown;
    // it does not prove that the page or the citation's claim was inspected.
    // Search events still populate searchHistory below.
    if (event.kind !== "page_inspected" || !event.url) {
      continue;
    }
    const key = sourceKey(event.url, event.title, "");
    observedUrlKeys.add(key);
    upsertSource(sourceByKey, key, {
      title: cleanOptional(event.title),
      url: cleanOptional(event.url),
      publishedAt: cleanOptional(event.publishedAt),
      retrievedAt: cleanOptional(event.observedAt),
      query: cleanOptional(event.query),
      rank: positiveIntegerOrNull(event.rank),
      sourceType: cleanOptional(event.sourceType) ?? "unknown",
      qualityScore: boundedScoreOrNull(event.qualityScore),
      archiveUri: cleanOptional(event.archiveUri),
      reportedIndependenceGroup: null,
      provenance: "harness_observed",
      usedInFinal: false,
      boundary: cutoffBoundary,
    });
  }

  for (const attempt of input.attempts) {
    const reporter = cleanOptional(attempt.roleId) ?? cleanOptional(attempt.forecasterLabel) ?? "unknown_forecaster";
    const citationClaimKeys: Array<{ claimKey: string; sourceId: string }> = [];

    for (const citation of attempt.citedSources ?? []) {
      const claim = cleanOptional(citation.claim);
      if (!claim) {
        continue;
      }
      const key = sourceKey(citation.url, citation.title, claim);
      const source = upsertSource(sourceByKey, key, {
        title: cleanOptional(citation.title),
        url: cleanOptional(citation.url),
        publishedAt: cleanOptional(citation.publishedAt),
        retrievedAt: null,
        query: cleanOptional(citation.query),
        rank: positiveIntegerOrNull(citation.rank),
        sourceType: cleanOptional(citation.sourceType) ?? "unknown",
        qualityScore: boundedScoreOrNull(citation.qualityScore ?? undefined),
        archiveUri: null,
        reportedIndependenceGroup: cleanOptional(citation.independenceGroup),
        provenance: observedUrlKeys.has(key) ? "harness_observed" : "agent_reported",
        usedInFinal: true,
        boundary: cutoffBoundary,
      });
      const normalizedClaim = normalizeText(claim);
      citationClaimKeys.push({ claimKey: normalizedClaim, sourceId: source.id });
      upsertClaim(claimByKey, claim, "context", reporter, [source.id]);
    }

    for (const claim of attempt.evidenceFor ?? []) {
      const sourceIds = matchingSourceIds(claim, citationClaimKeys);
      upsertClaim(claimByKey, claim, "supports_yes", reporter, sourceIds);
    }
    for (const claim of attempt.evidenceAgainst ?? []) {
      const sourceIds = matchingSourceIds(claim, citationClaimKeys);
      upsertClaim(claimByKey, claim, "supports_no", reporter, sourceIds);
    }
  }

  const sources = [...sourceByKey.values()].sort((left, right) => left.id.localeCompare(right.id));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const claims = [...claimByKey.values()]
    .map((claim) => finalizeClaim(claim, sourceById))
    .sort((left, right) => left.id.localeCompare(right.id));
  const searchHistory = buildSearchHistory(observedEvents, input.reportedSearchQueries ?? []);
  const remainingInformationNeeds = uniqueStrings(
    input.attempts.flatMap((attempt) => attempt.keyUncertainties ?? []),
  );
  const postEvidenceAsOfSourceIds = new Set(sources
    .filter((source) => isAfterTemporalBoundary(source.publishedAt, input.evidenceAsOf))
    .map((source) => source.id));
  const integrityFlags = buildIntegrityFlags(sources, claims, searchHistory, postEvidenceAsOfSourceIds);
  const domainCounts = countDomains(sources);
  const maximumDomainShare = sources.length === 0
    ? 0
    : Math.max(0, ...domainCounts.values()) / sources.length;

  const harnessObservedSourceCount = sources.filter((source) => source.provenance === "harness_observed").length;
  const agentReportedSourceCount = sources.length - harnessObservedSourceCount;
  const pagesInspected = observedEvents.filter((event) => event.kind === "page_inspected").length;

  return evidenceWorkspaceSchema.parse({
    version: "forecast-evidence-workspace-v1",
    provenanceMode: provenanceMode(sources),
    evidenceAsOf: cleanOptional(input.evidenceAsOf),
    cutoffDate: cleanOptional(input.cutoffDate),
    sources,
    claims,
    searchHistory,
    remainingInformationNeeds,
    integrityFlags,
    diagnostics: {
      sourceCount: sources.length,
      claimCount: claims.length,
      harnessObservedSourceCount,
      agentReportedSourceCount,
      datedSourceCount: sources.filter((source) => source.publishedAt).length,
      postCutoffSourceCount: sources.filter((source) => source.cutoffStatus === "after_cutoff").length,
      postEvidenceAsOfSourceCount: postEvidenceAsOfSourceIds.size,
      unsupportedClaimCount: claims.filter((claim) => claim.sourceIds.length === 0).length,
      contestedClaimCount: claims.filter((claim) => claim.stance === "contested").length,
      uniqueDomainCount: domainCounts.size,
      maximumDomainShare,
      queriesUsed: searchHistory.length,
      harnessObservedQueryCount: searchHistory.filter((query) => query.provenance === "harness_observed").length,
      pagesInspected,
      maxQueries: positiveIntegerOrNull(input.budget?.maxQueries),
      maxPages: positiveIntegerOrNull(input.budget?.maxPages),
    },
  });
}

/**
 * Carry forward typed evidence across forecast updates. Omission from a later
 * agent response is not evidence invalidation: a prior claim disappears only
 * when its stable claim ID is explicitly listed as invalidated.
 */
export function mergeEvidenceWorkspaces(input: {
  previous?: EvidenceWorkspace;
  current: EvidenceWorkspace;
  invalidatedClaimIds?: string[];
}): EvidenceWorkspace {
  if (!input.previous) {
    return input.current;
  }
  const invalidated = new Set(uniqueStrings(input.invalidatedClaimIds ?? []));
  const evidenceAsOf = input.current.evidenceAsOf ?? input.previous.evidenceAsOf;
  const cutoffDate = input.current.cutoffDate ?? input.previous.cutoffDate;
  const sourceById = new Map<string, MutableSource>();
  for (const source of [...input.previous.sources, ...input.current.sources]) {
    const existing = sourceById.get(source.id);
    const publishedAt = source.publishedAt ?? existing?.publishedAt ?? null;
    sourceById.set(source.id, {
      ...existing,
      ...source,
      title: source.title ?? existing?.title ?? null,
      url: source.url ?? existing?.url ?? null,
      domain: source.domain ?? existing?.domain ?? null,
      publishedAt,
      retrievedAt: source.retrievedAt ?? existing?.retrievedAt ?? null,
      query: source.query ?? existing?.query ?? null,
      rank: source.rank ?? existing?.rank ?? null,
      sourceType: source.sourceType === "unknown" ? existing?.sourceType ?? "unknown" : source.sourceType,
      qualityScore: source.qualityScore ?? existing?.qualityScore ?? null,
      archiveUri: source.archiveUri ?? existing?.archiveUri ?? null,
      reportedIndependenceGroup:
        source.reportedIndependenceGroup ?? existing?.reportedIndependenceGroup ?? null,
      provenance:
        source.provenance === "harness_observed" || existing?.provenance === "harness_observed"
          ? "harness_observed"
          : "agent_reported",
      cutoffStatus: cutoffStatus(publishedAt, cutoffDate ?? undefined),
      usedInFinal: source.usedInFinal || existing?.usedInFinal === true,
    });
  }
  const sources = [...sourceById.values()].sort((left, right) => left.id.localeCompare(right.id));
  const finalizedSourceById = new Map(sources.map((source) => [source.id, source]));
  const mutableClaims = new Map<string, MutableClaim>();
  for (const claim of [...input.previous.claims, ...input.current.claims]) {
    if (invalidated.has(claim.id)) {
      continue;
    }
    const existing = mutableClaims.get(claim.id) ?? {
      id: claim.id,
      text: claim.text,
      stances: new Set<"supports_yes" | "supports_no" | "context">(),
      sourceIds: new Set<string>(),
      reportedBy: new Set<string>(),
    };
    addFinalizedStance(existing.stances, claim.stance);
    claim.sourceIds.forEach((sourceId) => existing.sourceIds.add(sourceId));
    claim.reportedBy.forEach((reporter) => existing.reportedBy.add(reporter));
    mutableClaims.set(claim.id, existing);
  }
  const claims = [...mutableClaims.values()]
    .map((claim) => finalizeClaim(claim, finalizedSourceById))
    .sort((left, right) => left.id.localeCompare(right.id));
  const searchByKey = new Map<string, z.infer<typeof evidenceSearchObservationSchema>>();
  for (const observation of [...input.previous.searchHistory, ...input.current.searchHistory]) {
    const key = normalizeText(observation.query);
    const existing = searchByKey.get(key);
    searchByKey.set(key, {
      query: observation.query,
      observedAt: observation.observedAt ?? existing?.observedAt ?? null,
      resultCount: observation.resultCount ?? existing?.resultCount ?? null,
      provenance:
        observation.provenance === "harness_observed" || existing?.provenance === "harness_observed"
          ? "harness_observed"
          : "agent_reported",
    });
  }
  const searchHistory = [...searchByKey.values()].sort((left, right) => (
    (left.observedAt ?? "").localeCompare(right.observedAt ?? "") || left.query.localeCompare(right.query)
  ));
  const postEvidenceAsOfSourceIds = new Set(sources
    .filter((source) => isAfterTemporalBoundary(source.publishedAt, evidenceAsOf ?? undefined))
    .map((source) => source.id));
  const integrityFlags = buildIntegrityFlags(sources, claims, searchHistory, postEvidenceAsOfSourceIds);
  const domainCounts = countDomains(sources);
  const harnessObservedSourceCount = sources.filter((source) => source.provenance === "harness_observed").length;
  const pagesInspected = input.previous.diagnostics.pagesInspected + input.current.diagnostics.pagesInspected;

  return evidenceWorkspaceSchema.parse({
    version: "forecast-evidence-workspace-v1",
    provenanceMode: provenanceMode(sources),
    evidenceAsOf,
    cutoffDate,
    sources,
    claims,
    searchHistory,
    remainingInformationNeeds: uniqueStrings([
      ...input.previous.remainingInformationNeeds,
      ...input.current.remainingInformationNeeds,
    ]),
    integrityFlags,
    diagnostics: {
      sourceCount: sources.length,
      claimCount: claims.length,
      harnessObservedSourceCount,
      agentReportedSourceCount: sources.length - harnessObservedSourceCount,
      datedSourceCount: sources.filter((source) => source.publishedAt).length,
      postCutoffSourceCount: sources.filter((source) => source.cutoffStatus === "after_cutoff").length,
      postEvidenceAsOfSourceCount: postEvidenceAsOfSourceIds.size,
      unsupportedClaimCount: claims.filter((claim) => claim.sourceIds.length === 0).length,
      contestedClaimCount: claims.filter((claim) => claim.stance === "contested").length,
      uniqueDomainCount: domainCounts.size,
      maximumDomainShare: sources.length === 0
        ? 0
        : Math.max(0, ...domainCounts.values()) / sources.length,
      queriesUsed: searchHistory.length,
      harnessObservedQueryCount:
        searchHistory.filter((query) => query.provenance === "harness_observed").length,
      pagesInspected,
      maxQueries: input.current.diagnostics.maxQueries ?? input.previous.diagnostics.maxQueries,
      maxPages: input.current.diagnostics.maxPages ?? input.previous.diagnostics.maxPages,
    },
  });
}

function addFinalizedStance(
  stances: Set<"supports_yes" | "supports_no" | "context">,
  stance: "supports_yes" | "supports_no" | "context" | "contested",
) {
  if (stance === "contested") {
    stances.add("supports_yes");
    stances.add("supports_no");
  } else {
    stances.add(stance);
  }
}

function upsertSource(
  sourceByKey: Map<string, MutableSource>,
  key: string,
  input: Omit<MutableSource, "id" | "domain" | "cutoffStatus"> & { boundary?: string },
) {
  const existing = sourceByKey.get(key);
  const url = input.url ?? existing?.url ?? null;
  const provenance = existing?.provenance === "harness_observed" || input.provenance === "harness_observed"
    ? "harness_observed" as const
    : "agent_reported" as const;
  const merged: MutableSource = {
    id: existing?.id ?? stableId("source", key),
    title: input.title ?? existing?.title ?? null,
    url,
    domain: domainFromUrl(url),
    publishedAt: input.publishedAt ?? existing?.publishedAt ?? null,
    retrievedAt: input.retrievedAt ?? existing?.retrievedAt ?? null,
    query: input.query ?? existing?.query ?? null,
    rank: input.rank ?? existing?.rank ?? null,
    sourceType: input.sourceType === "unknown" ? existing?.sourceType ?? "unknown" : input.sourceType,
    qualityScore: input.qualityScore ?? existing?.qualityScore ?? null,
    archiveUri: input.archiveUri ?? existing?.archiveUri ?? null,
    reportedIndependenceGroup: input.reportedIndependenceGroup ?? existing?.reportedIndependenceGroup ?? null,
    provenance,
    cutoffStatus: cutoffStatus(input.publishedAt ?? existing?.publishedAt, input.boundary),
    usedInFinal: input.usedInFinal || existing?.usedInFinal === true,
  };
  sourceByKey.set(key, merged);
  return merged;
}

function upsertClaim(
  claimByKey: Map<string, MutableClaim>,
  rawText: string,
  stance: "supports_yes" | "supports_no" | "context",
  reporter: string,
  sourceIds: string[],
) {
  const text = rawText.trim();
  if (!text) {
    return;
  }
  const key = normalizeText(text);
  const existing = claimByKey.get(key) ?? {
    id: stableId("claim", key),
    text,
    stances: new Set<"supports_yes" | "supports_no" | "context">(),
    sourceIds: new Set<string>(),
    reportedBy: new Set<string>(),
  };
  existing.stances.add(stance);
  existing.reportedBy.add(reporter);
  sourceIds.forEach((sourceId) => existing.sourceIds.add(sourceId));
  claimByKey.set(key, existing);
}

function finalizeClaim(claim: MutableClaim, sourceById: Map<string, MutableSource>) {
  const sourceIds = [...claim.sourceIds].sort();
  const hasYes = claim.stances.has("supports_yes");
  const hasNo = claim.stances.has("supports_no");
  const stance = hasYes && hasNo
    ? "contested" as const
    : hasYes
      ? "supports_yes" as const
      : hasNo
        ? "supports_no" as const
        : "context" as const;
  const hasObservedSource = sourceIds.some((sourceId) => sourceById.get(sourceId)?.provenance === "harness_observed");
  const verificationStatus = stance === "contested"
    ? "contradicted" as const
    : hasObservedSource
      ? "source_observed" as const
      : sourceIds.length > 0
        ? "agent_reported_source" as const
        : "unverified" as const;
  const dependenceKeys = uniqueStrings(sourceIds.map((sourceId) => {
    const source = sourceById.get(sourceId);
    return source?.reportedIndependenceGroup
      ? `reported_group:${source.reportedIndependenceGroup}`
      : source?.domain
        ? `domain:${source.domain}`
        : `source:${sourceId}`;
  }));
  return atomicEvidenceClaimSchema.parse({
    id: claim.id,
    text: claim.text,
    stance,
    sourceIds,
    reportedBy: [...claim.reportedBy].sort(),
    dependenceKeys,
    verificationStatus,
  });
}

function matchingSourceIds(
  claim: string,
  candidates: Array<{ claimKey: string; sourceId: string }>,
) {
  const key = normalizeText(claim);
  return uniqueStrings(candidates
    .filter((candidate) => {
      if (key === candidate.claimKey) {
        return true;
      }
      const shorter = key.length <= candidate.claimKey.length ? key : candidate.claimKey;
      const longer = key.length > candidate.claimKey.length ? key : candidate.claimKey;
      return shorter.length >= 32 && longer.includes(shorter);
    })
    .map((candidate) => candidate.sourceId));
}

function buildSearchHistory(events: ObservedEvidenceEvent[], reportedQueries: string[]) {
  const byQuery = new Map<string, z.infer<typeof evidenceSearchObservationSchema>>();
  for (const rawQuery of reportedQueries) {
    const query = cleanOptional(rawQuery);
    if (!query) {
      continue;
    }
    byQuery.set(normalizeText(query), {
      query,
      observedAt: null,
      resultCount: null,
      provenance: "agent_reported",
    });
  }
  for (const event of events) {
    const query = cleanOptional(event.query);
    if (!query) {
      continue;
    }
    const key = normalizeText(query);
    const existing = byQuery.get(key);
    byQuery.set(key, {
      query,
      observedAt: event.observedAt,
      resultCount: Math.max(existing?.resultCount ?? 0, event.resultCount ?? (event.kind === "search_result" ? 1 : 0)),
      provenance: "harness_observed",
    });
  }
  return [...byQuery.values()].sort((left, right) => (
    (left.observedAt ?? "").localeCompare(right.observedAt ?? "") || left.query.localeCompare(right.query)
  ));
}

function buildIntegrityFlags(
  sources: MutableSource[],
  claims: Array<z.infer<typeof atomicEvidenceClaimSchema>>,
  searchHistory: Array<z.infer<typeof evidenceSearchObservationSchema>>,
  postEvidenceAsOfSourceIds: Set<string>,
) {
  const flags: string[] = [];
  for (const source of sources) {
    if (source.cutoffStatus === "after_cutoff") {
      flags.push(`post_cutoff_source:${source.id}`);
    }
    if (postEvidenceAsOfSourceIds.has(source.id)) {
      flags.push(`source_after_evidence_as_of:${source.id}`);
    }
    if (!source.publishedAt) {
      flags.push(`source_date_unknown:${source.id}`);
    }
    if (source.provenance === "agent_reported") {
      flags.push(`source_not_harness_observed:${source.id}`);
    }
  }
  for (const claim of claims) {
    if (claim.sourceIds.length === 0) {
      flags.push(`claim_without_source:${claim.id}`);
    }
    if (claim.stance === "contested") {
      flags.push(`contested_claim:${claim.id}`);
    }
  }
  for (const query of searchHistory) {
    if (query.provenance === "agent_reported") {
      flags.push(`query_not_harness_observed:${stableId("query", normalizeText(query.query))}`);
    }
  }
  return flags.sort();
}

function provenanceMode(sources: MutableSource[]) {
  if (sources.length === 0) {
    return "no_source_observations" as const;
  }
  const observedCount = sources.filter((source) => source.provenance === "harness_observed").length;
  if (observedCount === sources.length) {
    return "harness_observed" as const;
  }
  if (observedCount > 0) {
    return "mixed" as const;
  }
  return "agent_reported_only" as const;
}

function countDomains(sources: MutableSource[]) {
  const counts = new Map<string, number>();
  for (const source of sources) {
    if (!source.domain) {
      continue;
    }
    counts.set(source.domain, (counts.get(source.domain) ?? 0) + 1);
  }
  return counts;
}

function sourceKey(url?: string, title?: string, claim?: string) {
  const cleanUrl = cleanOptional(url);
  if (cleanUrl) {
    try {
      const parsed = new URL(cleanUrl);
      parsed.hash = "";
      for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
        parsed.searchParams.delete(key);
      }
      return `url:${parsed.toString()}`;
    } catch {
      return `url:${cleanUrl.toLowerCase()}`;
    }
  }
  return `reported:${normalizeText(title ?? "")}:${normalizeText(claim ?? "")}`;
}

function domainFromUrl(url: string | null) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function cutoffStatus(publishedAt?: string | null, boundary?: string) {
  if (!publishedAt || !boundary) {
    return "unknown" as const;
  }
  const publishedMs = Date.parse(publishedAt);
  const boundaryMs = temporalBoundaryTime(boundary);
  if (!Number.isFinite(publishedMs) || !Number.isFinite(boundaryMs)) {
    return "unknown" as const;
  }
  return publishedMs <= boundaryMs ? "before_or_on_cutoff" as const : "after_cutoff" as const;
}

function isAfterTemporalBoundary(value?: string | null, boundary?: string) {
  if (!value || !boundary) {
    return false;
  }
  const valueMs = Date.parse(value);
  const boundaryMs = temporalBoundaryTime(boundary);
  return Number.isFinite(valueMs) && Number.isFinite(boundaryMs) && valueMs > boundaryMs;
}

function temporalBoundaryTime(value: string) {
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
}

function stableId(prefix: string, value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N}%]+/gu, " ").trim();
}

function cleanOptional(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function positiveIntegerOrNull(value?: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function boundedScoreOrNull(value?: number) {
  return Number.isFinite(value) && Number(value) >= 0 && Number(value) <= 1 ? Number(value) : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
