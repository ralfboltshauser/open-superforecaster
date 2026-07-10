export type AggregateQualitySnapshot = {
  convergenceStatus: "approved" | "max_iterations_return_last";
  qualityApproved: boolean | null;
  maxIterationsReached: boolean | null;
  roundsUsed: number | null;
  forecasterCount: number | null;
  complexityScore: number | null;
  researchDepth: string | null;
  roleIds: string[];
  qualityIssueCount: number;
  qualityIssueCountBand: "none" | "some_issues" | "many_issues" | "unknown";
  roundsUsedBand: "single_round" | "few_rounds" | "many_rounds" | "unknown";
  finalReviewRationale: string;
};

const convergenceStatuses = new Set(["approved", "max_iterations_return_last"]);

export function readAggregateQualitySnapshot(value: unknown): AggregateQualitySnapshot | null {
  const record = asRecord(value);
  const aggregateQuality = asRecord(record?.aggregateQuality) ?? record;
  if (!aggregateQuality) {
    return null;
  }
  const convergenceStatus = readConvergenceStatus(aggregateQuality);
  if (!convergenceStatus) {
    return null;
  }
  const roundsUsed = readNumber(aggregateQuality, "roundsUsed", "rounds_used");
  const qualityIssueCount =
    readNumber(aggregateQuality, "qualityIssueCount", "quality_issue_count") ??
    readStringArray(aggregateQuality, "qualityIssues", "quality_issues").length;
  return {
    convergenceStatus,
    qualityApproved: readBoolean(aggregateQuality, "qualityApproved", "quality_approved"),
    maxIterationsReached: readBoolean(aggregateQuality, "maxIterationsReached", "max_iterations_reached"),
    roundsUsed,
    forecasterCount: readNumber(aggregateQuality, "forecasterCount", "forecaster_count"),
    complexityScore: readNumber(aggregateQuality, "complexityScore", "complexity_score"),
    researchDepth: readString(aggregateQuality, "researchDepth", "research_depth"),
    roleIds: readStringArray(aggregateQuality, "roleIds", "role_ids"),
    qualityIssueCount,
    qualityIssueCountBand: qualityIssueCountBand(qualityIssueCount),
    roundsUsedBand: roundsUsedBand(roundsUsed),
    finalReviewRationale: readString(aggregateQuality, "finalReviewRationale", "final_review_rationale") ?? "",
  };
}

export function qualityIssueCountBand(qualityIssueCount: number | null): AggregateQualitySnapshot["qualityIssueCountBand"] {
  if (qualityIssueCount === null || !Number.isFinite(qualityIssueCount)) {
    return "unknown";
  }
  if (qualityIssueCount >= 3) {
    return "many_issues";
  }
  if (qualityIssueCount >= 1) {
    return "some_issues";
  }
  return "none";
}

export function roundsUsedBand(roundsUsed: number | null): AggregateQualitySnapshot["roundsUsedBand"] {
  if (roundsUsed === null || !Number.isFinite(roundsUsed)) {
    return "unknown";
  }
  if (roundsUsed >= 4) {
    return "many_rounds";
  }
  if (roundsUsed >= 2) {
    return "few_rounds";
  }
  return "single_round";
}

function readConvergenceStatus(value: unknown): AggregateQualitySnapshot["convergenceStatus"] | null {
  const status = readString(value, "convergenceStatus", "convergence_status");
  return status && convergenceStatuses.has(status)
    ? status as AggregateQualitySnapshot["convergenceStatus"]
    : null;
}

function readString(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

function readNumber(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return null;
}

function readBoolean(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "boolean") {
      return raw;
    }
  }
  return null;
}

function readStringArray(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  for (const key of keys) {
    const raw = record[key];
    if (Array.isArray(raw)) {
      return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
  }
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
