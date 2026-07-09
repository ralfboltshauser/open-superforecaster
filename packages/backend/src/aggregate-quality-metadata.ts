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
  return {
    convergenceStatus,
    qualityApproved: readBoolean(aggregateQuality, "qualityApproved", "quality_approved"),
    maxIterationsReached: readBoolean(aggregateQuality, "maxIterationsReached", "max_iterations_reached"),
    roundsUsed: readNumber(aggregateQuality, "roundsUsed", "rounds_used"),
    forecasterCount: readNumber(aggregateQuality, "forecasterCount", "forecaster_count"),
    complexityScore: readNumber(aggregateQuality, "complexityScore", "complexity_score"),
    researchDepth: readString(aggregateQuality, "researchDepth", "research_depth"),
    roleIds: readStringArray(aggregateQuality, "roleIds", "role_ids"),
    qualityIssueCount:
      readNumber(aggregateQuality, "qualityIssueCount", "quality_issue_count") ??
      readStringArray(aggregateQuality, "qualityIssues", "quality_issues").length,
    finalReviewRationale: readString(aggregateQuality, "finalReviewRationale", "final_review_rationale") ?? "",
  };
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
