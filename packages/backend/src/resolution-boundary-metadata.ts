export type ResolutionBoundarySnapshot = {
  status: "missing_boundary_review" | "clear_boundary" | "some_ambiguity" | "material_ambiguity";
  componentBoundaryCount: number | null;
  ambiguityFlagCount: number | null;
  qualityIssueCount: number | null;
  plannerRiskCount: number | null;
  note: string;
};

const resolutionBoundaryStatuses = new Set([
  "missing_boundary_review",
  "clear_boundary",
  "some_ambiguity",
  "material_ambiguity",
]);

export function readResolutionBoundarySnapshot(value: unknown): ResolutionBoundarySnapshot | null {
  const resolutionBoundary = asRecord(asRecord(value)?.resolutionBoundary);
  if (!resolutionBoundary) {
    return null;
  }
  const status = readStatus(resolutionBoundary);
  if (!status) {
    return null;
  }
  return {
    status,
    componentBoundaryCount: readNumber(resolutionBoundary, "componentBoundaryCount", "component_boundary_count"),
    ambiguityFlagCount: readNumber(resolutionBoundary, "ambiguityFlagCount", "ambiguity_flag_count"),
    qualityIssueCount: readNumber(resolutionBoundary, "qualityIssueCount", "quality_issue_count"),
    plannerRiskCount: readNumber(resolutionBoundary, "plannerRiskCount", "planner_risk_count"),
    note: readString(resolutionBoundary, "note") ?? "",
  };
}

function readStatus(value: unknown): ResolutionBoundarySnapshot["status"] | null {
  const status = readString(value, "status");
  return status && resolutionBoundaryStatuses.has(status)
    ? status as ResolutionBoundarySnapshot["status"]
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
