export type BinaryResolutionBoundaryAudit = {
  status: "missing_boundary_review" | "clear_boundary" | "some_ambiguity" | "material_ambiguity";
  componentBoundaryCount: number;
  ambiguityFlagCount: number;
  qualityIssueCount: number;
  plannerRiskCount: number;
  note: string;
};

export function buildBinaryResolutionBoundaryAudit(input: {
  components: Array<{ resolutionBoundary?: string | null }>;
  qualityIssues?: string[];
  plannerRisks?: string[];
  resolutionCriteria?: string | null;
}): BinaryResolutionBoundaryAudit {
  const boundaryNotes = input.components
    .map((component) => normalizeText(component.resolutionBoundary))
    .filter((note): note is string => Boolean(note));
  const qualityIssues = (input.qualityIssues ?? []).filter((issue) => boundaryRiskPattern.test(issue));
  const plannerRisks = (input.plannerRisks ?? []).filter((risk) => boundaryRiskPattern.test(risk));
  const ambiguityFlagCount = boundaryNotes.filter((note) => boundaryRiskPattern.test(note)).length;
  const hasResolutionCriteria = Boolean(normalizeText(input.resolutionCriteria));

  if (boundaryNotes.length === 0) {
    return {
      status: "missing_boundary_review",
      componentBoundaryCount: 0,
      ambiguityFlagCount: 0,
      qualityIssueCount: qualityIssues.length,
      plannerRiskCount: plannerRisks.length,
      note: "No component resolution-boundary review was recorded.",
    };
  }

  const status = qualityIssues.length > 0 || ambiguityFlagCount >= 2 || (!hasResolutionCriteria && ambiguityFlagCount > 0)
    ? "material_ambiguity"
    : ambiguityFlagCount > 0 || plannerRisks.length > 0 || !hasResolutionCriteria
      ? "some_ambiguity"
      : "clear_boundary";

  return {
    status,
    componentBoundaryCount: boundaryNotes.length,
    ambiguityFlagCount,
    qualityIssueCount: qualityIssues.length,
    plannerRiskCount: plannerRisks.length,
    note: boundaryNote(status, { boundaryNotes: boundaryNotes.length, ambiguityFlagCount, qualityIssues: qualityIssues.length }),
  };
}

const boundaryRiskPattern =
  /\b(ambiguous|ambiguity|unclear|uncertain|dispute|disputed|edge case|borderline|subjective|annul|void|cancel|definition|criteria|resolution risk|could count|may count|might count|does not count|not count|boundary)\b/i;

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boundaryNote(
  status: BinaryResolutionBoundaryAudit["status"],
  counts: { boundaryNotes: number; ambiguityFlagCount: number; qualityIssues: number },
) {
  if (status === "clear_boundary") {
    return `${counts.boundaryNotes} component boundary review(s) recorded without deterministic ambiguity flags.`;
  }
  if (status === "some_ambiguity") {
    return `${counts.ambiguityFlagCount} component boundary ambiguity flag(s) recorded; review before using this case for calibration changes.`;
  }
  return `${counts.ambiguityFlagCount} component boundary ambiguity flag(s) and ${counts.qualityIssues} quality issue(s) suggest material resolution risk.`;
}
