import type { EvidenceWorkspace } from "./forecast-evidence-workspace";

export const EVIDENCE_WORKING_SET_VERSION = "forecast-evidence-working-set-v1" as const;
export const DEFAULT_EVIDENCE_WORKING_SET_LIMITS = {
  maxClaims: 24,
  maxSources: 24,
  maxSearchHistory: 10,
  maxInformationNeeds: 12,
  maxCharacters: 24_000,
} as const;

const MIN_WORKING_SET_CHARACTERS = 2_000;
const stanceCycle = [
  "contested",
  "supports_yes",
  "supports_no",
  "supports_yes",
  "supports_no",
  "context",
] as const;

export type EvidenceWorkingSetLimits = {
  maxClaims?: number;
  maxSources?: number;
  maxSearchHistory?: number;
  maxInformationNeeds?: number;
  maxCharacters?: number;
};

/**
 * Render a compact inner-tier view of the full evidence ledger. The ledger is
 * never mutated or truncated: this function only controls what is placed in a
 * model prompt. Model-reported diagnosticity supplies the semantic priority;
 * deterministic code owns capacity, stance balance, and the character budget.
 */
export function renderEvidenceWorkingSet(
  workspace: EvidenceWorkspace,
  requestedLimits: EvidenceWorkingSetLimits = {},
) {
  const limits = readLimits(requestedLimits);
  const sourceById = new Map(workspace.sources.map((source) => [source.id, source]));
  const claims = selectClaims(workspace, sourceById, limits.maxClaims).map((claim) => ({
    id: claim.id,
    text: clip(claim.text, 600),
    stance: claim.stance,
    sourceIds: claim.sourceIds.slice(0, 8),
    omittedSourceIdCount: Math.max(0, claim.sourceIds.length - 8),
    reportedBy: claim.reportedBy.slice(0, 8),
    omittedReporterCount: Math.max(0, claim.reportedBy.length - 8),
    dependenceKeys: claim.dependenceKeys.slice(0, 8),
    omittedDependenceKeyCount: Math.max(0, claim.dependenceKeys.length - 8),
    verificationStatus: claim.verificationStatus,
  }));
  const selectedClaimIds = new Map(claims.map((claim, index) => [claim.id, index]));
  const selectedSourceIds = new Map<string, number>();
  for (const claim of claims) {
    for (const sourceId of claim.sourceIds) {
      const current = selectedSourceIds.get(sourceId);
      const claimIndex = selectedClaimIds.get(claim.id) ?? Number.MAX_SAFE_INTEGER;
      selectedSourceIds.set(sourceId, Math.min(current ?? Number.MAX_SAFE_INTEGER, claimIndex));
    }
  }
  const sources = [...workspace.sources]
    .sort((left, right) => compareSources(left, right, selectedSourceIds))
    .slice(0, limits.maxSources)
    .map((source) => ({
      id: source.id,
      title: clipNullable(source.title, 240),
      url: clipNullable(source.url, 500),
      domain: source.domain,
      publishedAt: source.publishedAt,
      sourceType: clip(source.sourceType, 100),
      qualityScore: source.qualityScore,
      reportedDiagnosticity: source.reportedDiagnosticity,
      provenance: source.provenance,
      cutoffStatus: source.cutoffStatus,
      usedInFinal: source.usedInFinal,
    }));
  const searchHistory = workspace.searchHistory
    .slice(-limits.maxSearchHistory)
    .map((observation) => ({
      ...observation,
      query: clip(observation.query, 320),
    }));
  const remainingInformationNeeds = workspace.remainingInformationNeeds
    .slice(-limits.maxInformationNeeds)
    .map((need) => clip(need, 500));
  const integrityFlagCounts = countIntegrityFlags(workspace.integrityFlags);

  const view = {
    version: EVIDENCE_WORKING_SET_VERSION,
    outerLedgerVersion: workspace.version,
    selectionPolicy: "reported_diagnosticity_then_balanced_stance_and_stable_id_v1",
    outerLedgerCounts: {
      claims: workspace.claims.length,
      sources: workspace.sources.length,
      searches: workspace.searchHistory.length,
      remainingInformationNeeds: workspace.remainingInformationNeeds.length,
    },
    includedCounts: {
      claims: claims.length,
      sources: sources.length,
      searches: searchHistory.length,
      remainingInformationNeeds: remainingInformationNeeds.length,
    },
    omittedCounts: {
      claims: workspace.claims.length - claims.length,
      sources: workspace.sources.length - sources.length,
      searches: workspace.searchHistory.length - searchHistory.length,
      remainingInformationNeeds:
        workspace.remainingInformationNeeds.length - remainingInformationNeeds.length,
    },
    researchBudget: {
      queries: budgetProgress(workspace.diagnostics.queriesUsed, workspace.diagnostics.maxQueries),
      pages: budgetProgress(workspace.diagnostics.pagesInspected, workspace.diagnostics.maxPages),
    },
    provenanceMode: workspace.provenanceMode,
    evidenceAsOf: workspace.evidenceAsOf,
    cutoffDate: workspace.cutoffDate,
    claims,
    sources,
    searchHistory,
    remainingInformationNeeds,
    integrityFlagCounts,
    contextBudget: {
      unit: "characters",
      limit: limits.maxCharacters,
      rendered: 0,
      remaining: limits.maxCharacters,
    },
  };

  fitWithinCharacterBudget(view, limits.maxCharacters);
  let rendered = renderWithStableBudgetMarker(view);
  if (rendered.length > limits.maxCharacters) {
    fitWithinCharacterBudget(view, limits.maxCharacters);
    rendered = renderWithStableBudgetMarker(view);
  }
  if (rendered.length > limits.maxCharacters) {
    throw new Error(`Evidence working set exceeds ${limits.maxCharacters} characters after compaction.`);
  }
  return rendered;
}

type Source = EvidenceWorkspace["sources"][number];
type Claim = EvidenceWorkspace["claims"][number];

function selectClaims(
  workspace: EvidenceWorkspace,
  sourceById: Map<string, Source>,
  maxClaims: number,
) {
  const buckets = new Map<Claim["stance"], Claim[]>();
  for (const stance of ["contested", "supports_yes", "supports_no", "context"] as const) {
    buckets.set(stance, []);
  }
  for (const claim of workspace.claims) {
    buckets.get(claim.stance)?.push(claim);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => compareClaims(left, right, sourceById));
  }

  const selected: Claim[] = [];
  while (selected.length < maxClaims && [...buckets.values()].some((bucket) => bucket.length)) {
    for (const stance of stanceCycle) {
      if (selected.length >= maxClaims) {
        break;
      }
      const claim = buckets.get(stance)?.shift();
      if (claim) {
        selected.push(claim);
      }
    }
  }
  return selected;
}

function compareClaims(left: Claim, right: Claim, sourceById: Map<string, Source>) {
  const leftPriority = claimPriority(left, sourceById);
  const rightPriority = claimPriority(right, sourceById);
  for (let index = 0; index < leftPriority.length; index += 1) {
    const difference = (leftPriority[index] ?? 0) - (rightPriority[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.id.localeCompare(right.id);
}

function claimPriority(claim: Claim, sourceById: Map<string, Source>) {
  const sources = claim.sourceIds.flatMap((sourceId) => {
    const source = sourceById.get(sourceId);
    return source ? [source] : [];
  });
  return [
    Math.min(3, ...sources.map((source) => diagnosticityRank(source.reportedDiagnosticity))),
    claim.sourceIds.length === 0 ? 1 : 0,
    Math.min(1, ...sources.map((source) => source.provenance === "harness_observed" ? 0 : 1)),
    -Math.max(-1, ...sources.map((source) => source.qualityScore ?? -1)),
  ];
}

function compareSources(left: Source, right: Source, selectedSourceIds: Map<string, number>) {
  const leftPriority = [
    selectedSourceIds.has(left.id) ? 0 : 1,
    selectedSourceIds.get(left.id) ?? Number.MAX_SAFE_INTEGER,
    diagnosticityRank(left.reportedDiagnosticity),
    left.usedInFinal ? 0 : 1,
    left.provenance === "harness_observed" ? 0 : 1,
    -(left.qualityScore ?? -1),
  ];
  const rightPriority = [
    selectedSourceIds.has(right.id) ? 0 : 1,
    selectedSourceIds.get(right.id) ?? Number.MAX_SAFE_INTEGER,
    diagnosticityRank(right.reportedDiagnosticity),
    right.usedInFinal ? 0 : 1,
    right.provenance === "harness_observed" ? 0 : 1,
    -(right.qualityScore ?? -1),
  ];
  for (let index = 0; index < leftPriority.length; index += 1) {
    const difference = (leftPriority[index] ?? 0) - (rightPriority[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.id.localeCompare(right.id);
}

function diagnosticityRank(value: Source["reportedDiagnosticity"]) {
  return value === "high" ? 0 : value === "medium" ? 1 : value === "low" ? 2 : 3;
}

function budgetProgress(used: number, maximum: number | null) {
  return {
    used,
    maximum,
    remaining: maximum === null ? null : Math.max(0, maximum - used),
    exceeded: maximum === null ? null : used > maximum,
  };
}

function countIntegrityFlags(flags: string[]) {
  const counts: Record<string, number> = {};
  for (const flag of flags) {
    const kind = flag.split(":", 1)[0] || "unknown";
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function fitWithinCharacterBudget(
  view: ReturnType<typeof createViewShape>,
  maxCharacters: number,
) {
  const updateCounts = () => {
    view.includedCounts.claims = view.claims.length;
    view.includedCounts.sources = view.sources.length;
    view.includedCounts.searches = view.searchHistory.length;
    view.includedCounts.remainingInformationNeeds = view.remainingInformationNeeds.length;
    view.omittedCounts.claims = view.outerLedgerCounts.claims - view.claims.length;
    view.omittedCounts.sources = view.outerLedgerCounts.sources - view.sources.length;
    view.omittedCounts.searches = view.outerLedgerCounts.searches - view.searchHistory.length;
    view.omittedCounts.remainingInformationNeeds =
      view.outerLedgerCounts.remainingInformationNeeds - view.remainingInformationNeeds.length;
  };
  const tooLarge = () => JSON.stringify(view, null, 2).length > maxCharacters;
  const shrink = (items: unknown[], minimum = 0) => {
    while (items.length > minimum && tooLarge()) {
      items.pop();
      updateCounts();
    }
  };

  shrink(view.searchHistory);
  shrink(view.remainingInformationNeeds);
  while (tooLarge() && (view.claims.length > 0 || view.sources.length > 0)) {
    if (
      view.claims.length > 0 &&
      (view.claims.length >= view.sources.length || view.sources.length === 0)
    ) {
      view.claims.pop();
    } else {
      view.sources.pop();
    }
    updateCounts();
  }
  if (tooLarge()) {
    throw new Error(`Evidence working-set metadata exceeds ${maxCharacters} characters.`);
  }
}

function createViewShape() {
  return {
    includedCounts: { claims: 0, sources: 0, searches: 0, remainingInformationNeeds: 0 },
    omittedCounts: { claims: 0, sources: 0, searches: 0, remainingInformationNeeds: 0 },
    outerLedgerCounts: { claims: 0, sources: 0, searches: 0, remainingInformationNeeds: 0 },
    claims: [] as Array<Record<string, unknown>>,
    sources: [] as Array<Record<string, unknown>>,
    searchHistory: [] as Array<Record<string, unknown>>,
    remainingInformationNeeds: [] as string[],
    contextBudget: { unit: "characters", limit: 0, rendered: 0, remaining: 0 },
  };
}

function renderWithStableBudgetMarker(view: ReturnType<typeof createViewShape>) {
  let rendered = JSON.stringify(view, null, 2);
  for (let iteration = 0; iteration < 5; iteration += 1) {
    view.contextBudget.rendered = rendered.length;
    view.contextBudget.remaining = Math.max(0, view.contextBudget.limit - rendered.length);
    const next = JSON.stringify(view, null, 2);
    if (next.length === rendered.length) {
      return next;
    }
    rendered = next;
  }
  return rendered;
}

function readLimits(requested: EvidenceWorkingSetLimits) {
  const positiveInteger = (value: number | undefined, fallback: number) => (
    Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback
  );
  return {
    maxClaims: positiveInteger(requested.maxClaims, DEFAULT_EVIDENCE_WORKING_SET_LIMITS.maxClaims),
    maxSources: positiveInteger(requested.maxSources, DEFAULT_EVIDENCE_WORKING_SET_LIMITS.maxSources),
    maxSearchHistory: positiveInteger(
      requested.maxSearchHistory,
      DEFAULT_EVIDENCE_WORKING_SET_LIMITS.maxSearchHistory,
    ),
    maxInformationNeeds: positiveInteger(
      requested.maxInformationNeeds,
      DEFAULT_EVIDENCE_WORKING_SET_LIMITS.maxInformationNeeds,
    ),
    maxCharacters: Math.max(
      MIN_WORKING_SET_CHARACTERS,
      positiveInteger(requested.maxCharacters, DEFAULT_EVIDENCE_WORKING_SET_LIMITS.maxCharacters),
    ),
  };
}

function clip(value: string, maximum: number) {
  return value.length <= maximum ? value : `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

function clipNullable(value: string | null, maximum: number) {
  return value === null ? null : clip(value, maximum);
}
