export type ComponentExposureReport = {
  roleId: string;
  usedDisallowedEvidence: boolean;
  calibrationWarnings?: string[];
};

export type ComponentEvidenceIsolationReport = ComponentExposureReport & {
  round?: number;
  rationale?: string;
  evidenceFor?: string[];
  evidenceAgainst?: string[];
  strongestYes?: string;
  strongestNo?: string;
  keyUncertainties?: string[];
  premortem?: string;
  wildcards?: string[];
  feedbackAddressed?: string[];
  citedSources?: Array<{
    title?: string;
    url?: string;
    sourceType?: string;
    claim: string;
    publishedAt?: string;
  }>;
};

const humanForecastSource = String.raw`(?:metaculus|manifold|polymarket|kalshi|predictit|good[\s-]+judgment[\s-]+open|gjopen|prediction[\s-]+markets?|forecast[\s-]+markets?|bookmakers?|betting[\s-]+odds|analyst[\s-]+probabilit(?:y|ies)|crowd[\s-]+forecasts?|market[\s-]+implied[\s-]+probabilit(?:y|ies)|consensus[\s-]+probabilit(?:y|ies)|experts?\s+(?:put|assign|estimate|forecast)(?:s|ed)?|forecasters?\s+(?:put|assign|estimate|forecast)(?:s|ed)?|markets?\s+prices?\s+(?:yes|no)?\s*at)`;
const humanForecastSourcePattern = new RegExp(String.raw`\b${humanForecastSource}\b`, "i");
const explicitHumanForecastValuePattern = new RegExp(
  String.raw`(?:\b${humanForecastSource}\b[^.!?;\n]{0,96}\b\d{1,3}(?:\.\d+)?\s*%|\b\d{1,3}(?:\.\d+)?\s*%[^.!?;\n]{0,96}\b${humanForecastSource}\b)`,
  "i",
);
const explicitNonUsePatterns = [
  new RegExp(String.raw`\b(?:do|did|must|should|will)\s+not\s+(?:use|seek|consult|consider|include|rely\s+on)\b[^.!?;\n]{0,96}\b${humanForecastSource}\b`, "i"),
  new RegExp(String.raw`\b(?:not|never)\s+(?:use(?:d|ing)?|seek(?:ing)?|sought|consult(?:ed|ing)?|consider(?:ed|ing)?|include(?:d|ing)?|rely(?:ing)?\s+on)\b[^.!?;\n]{0,192}\b${humanForecastSource}\b`, "i"),
  new RegExp(String.raw`\bby\s+not\s+(?:using|seeking|consulting|considering|including|relying\s+on)\b[^.!?;\n]{0,192}\b${humanForecastSource}\b`, "i"),
  new RegExp(String.raw`\b(?:used|sought|consulted|considered|included|relied\s+on)\s+(?:absolutely\s+)?no\b[^.!?;\n]{0,192}\b${humanForecastSource}\b`, "i"),
  new RegExp(String.raw`\b(?:avoid|avoided|forbid|forbidden|prohibit|prohibited)\b[^.!?;\n]{0,96}\b${humanForecastSource}\b`, "i"),
  new RegExp(String.raw`\bwithout\s+(?:(?:using|seeking|consulting|considering|including|relying\s+on)\s+)?(?:any\s+)?${humanForecastSource}\b`, "i"),
  new RegExp(String.raw`\bno\s+${humanForecastSource}(?:\s+(?:evidence|data|prices?|odds|forecasts?|probabilities))?\s+(?:was|were|is|are|has\s+been|have\s+been)?\s*(?:used|sought|consulted|considered|included|relied\s+on)\b`, "i"),
  new RegExp(String.raw`\bno\b[^.!?;\n]{0,192}\b${humanForecastSource}\b[^.!?;\n]{0,192}\b(?:was|were|is|are|has\s+been|have\s+been)?\s*(?:used|sought|consulted|considered|included|relied\s+on)\b`, "i"),
  new RegExp(String.raw`\b${humanForecastSource}(?:\s+(?:evidence|data|prices?|odds|forecasts?|probabilities))?\s+(?:was|were|is|are|has\s+been|have\s+been)\s+not\s+(?:used|sought|consulted|considered|included|relied\s+on)\b`, "i"),
  new RegExp(String.raw`\b${humanForecastSource}\b[^.!?;\n]{0,192}\b(?:was|were|is|are|has\s+been|have\s+been)?\s*(?:not|never)\s+(?:used|sought|consulted|considered|included|relied\s+on|inferred)\b`, "i"),
];

/**
 * Only a structured exposure admission changes the autonomous-track status.
 * Calibration warnings are free text and often contain negative assertions
 * such as "No prediction-market evidence was used"; keyword matching those
 * sentences creates false contamination and silently removes valid forecasts
 * from autonomous evaluation.
 */
export function componentHumanForecastExposureFlags(attempts: ComponentExposureReport[]) {
  return attempts
    .filter((attempt) => attempt.usedDisallowedEvidence)
    .map((attempt) => `component_used_disallowed_evidence:${attempt.roleId}`);
}

export function componentEvidenceIsolationFlags(
  attempts: ComponentEvidenceIsolationReport[],
  boundary: { cutoffDate?: string; evidenceAsOf?: string } = {},
) {
  return attempts.flatMap((attempt, attemptIndex) => {
    const attemptIdentity = `${attempt.roleId}:round-${attempt.round ?? "unknown"}:attempt-${attemptIndex}`;
    const reportedContent = [
      attempt.rationale,
      ...(attempt.evidenceFor ?? []),
      ...(attempt.evidenceAgainst ?? []),
      attempt.strongestYes,
      attempt.strongestNo,
      ...(attempt.keyUncertainties ?? []),
      attempt.premortem,
      ...(attempt.wildcards ?? []),
      ...(attempt.feedbackAddressed ?? []),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const contentFlags = reportedContent.some(textReportsPossibleHumanForecastExposure)
      ? [`component_reported_human_forecast_content:${attemptIdentity}`]
      : [];
    const sourceFlags = (attempt.citedSources ?? []).flatMap((source, sourceIndex) => {
    const identity = `${attempt.roleId}:round-${attempt.round ?? "unknown"}:attempt-${attemptIndex}:source-${sourceIndex}`;
    const sourceText = [source.title, source.url, source.sourceType, source.claim].filter(Boolean).join(" ");
    return [
      ...(textReportsPossibleHumanForecastExposure(sourceText)
        ? [`component_human_forecast_source:${identity}`]
        : []),
      ...(isAfterBoundary(source.publishedAt, boundary.cutoffDate)
        ? [`component_post_cutoff_source:${identity}`]
        : []),
      ...(isAfterBoundary(source.publishedAt, boundary.evidenceAsOf)
        ? [`component_source_after_evidence_as_of:${identity}`]
        : []),
    ];
    });
    return [...contentFlags, ...sourceFlags];
  });
}

export function textReportsPossibleHumanForecastExposure(value: string) {
  if (!humanForecastSourcePattern.test(value)) {
    return false;
  }
  return splitExposureClauses(value).some((clause) =>
    humanForecastSourcePattern.test(clause) &&
    (explicitHumanForecastValuePattern.test(clause) ||
      !explicitNonUsePatterns.some((pattern) => pattern.test(clause))));
}

/**
 * Remove explicit human-forecast context before it reaches an autonomous model
 * while retaining negative policy instructions such as "do not use markets".
 * The caller should preserve the raw input separately for audit.
 */
export function sanitizeAutonomousContextText(value: string) {
  return splitExposureClauses(value)
    .map((clause) => textReportsPossibleHumanForecastExposure(clause)
      ? " [REDACTED: explicit human forecast removed from autonomous context] "
      : clause)
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function splitExposureClauses(value: string) {
  return value.split(/(?<=[.!?;\n])|(\b(?:but|however|yet|nevertheless|because|although|whereas)\b)/i);
}

function isAfterBoundary(value?: string, boundary?: string) {
  if (!value || !boundary) {
    return false;
  }
  const valueTimestamp = parseTemporal(value, false);
  const boundaryTimestamp = parseTemporal(boundary, true);
  return valueTimestamp !== null && boundaryTimestamp !== null && valueTimestamp > boundaryTimestamp;
}

function parseTemporal(value: string, endOfDay: boolean) {
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : trimmed;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
