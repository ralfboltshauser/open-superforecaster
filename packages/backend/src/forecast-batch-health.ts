import { readFileSync } from "node:fs";

export const FORECAST_BATCH_HEALTH_REPORT_PATH = "data/reports/forecast-batch-health/batch-health.json";

export type ForecastBatchHealthSummary = {
  entries: number | null;
  forecastOps: number | null;
  resolutions: number | null;
  performanceReports: number | null;
  completedForecasts: number | null;
  failedForecasts: number | null;
  resolvedCases: number | null;
  failedResolutions: number | null;
  performanceScoreRows: number | null;
  attentionItems: number | null;
  openAttentionItems: number | null;
  deferredAttentionItems: number | null;
  reviewedAttentionItems: number | null;
  unresolvedAttentionItems: number | null;
  scoreRegressionItems: number | null;
  calibrationGuardRegressionItems: number | null;
  candidateCalibrationGuardRules: number | null;
  openCandidateCalibrationGuardRules: number | null;
  deferredCandidateCalibrationGuardRules: number | null;
  reviewedCandidateCalibrationGuardRules: number | null;
  unresolvedCandidateCalibrationGuardRules: number | null;
};

export type ForecastBatchHealthIssue = {
  severity: string;
  kind: string;
  message: string;
};

export type ForecastBatchHealthSnapshot = {
  path: string;
  exists: boolean;
  batchId: string | null;
  status: string;
  generatedAt: string | null;
  summary: ForecastBatchHealthSummary;
  missingPhases: string[];
  issues: ForecastBatchHealthIssue[];
};

const emptySummary: ForecastBatchHealthSummary = {
  entries: null,
  forecastOps: null,
  resolutions: null,
  performanceReports: null,
  completedForecasts: null,
  failedForecasts: null,
  resolvedCases: null,
  failedResolutions: null,
  performanceScoreRows: null,
  attentionItems: null,
  openAttentionItems: null,
  deferredAttentionItems: null,
  reviewedAttentionItems: null,
  unresolvedAttentionItems: null,
  scoreRegressionItems: null,
  calibrationGuardRegressionItems: null,
  candidateCalibrationGuardRules: null,
  openCandidateCalibrationGuardRules: null,
  deferredCandidateCalibrationGuardRules: null,
  reviewedCandidateCalibrationGuardRules: null,
  unresolvedCandidateCalibrationGuardRules: null,
};

export function readLatestForecastBatchHealth(root: string): ForecastBatchHealthSnapshot {
  const path = `${root}/${FORECAST_BATCH_HEALTH_REPORT_PATH}`;
  try {
    const payload = asRecord(JSON.parse(readFileSync(path, "utf8")));
    const summary = asRecord(payload?.summary);
    return {
      path,
      exists: true,
      batchId: readString(payload, "batchId"),
      status: readString(payload, "status") ?? "unknown",
      generatedAt: readString(payload, "generatedAt"),
      summary: readSummary(summary),
      missingPhases: readStringArray(payload, "missingPhases"),
      issues: readIssueArray(payload, "issues"),
    };
  } catch {
    return {
      path,
      exists: false,
      batchId: null,
      status: "missing",
      generatedAt: null,
      summary: { ...emptySummary },
      missingPhases: [],
      issues: [],
    };
  }
}

function readSummary(summary: Record<string, unknown> | null): ForecastBatchHealthSummary {
  return {
    entries: readNumber(summary, "entries"),
    forecastOps: readNumber(summary, "forecastOps"),
    resolutions: readNumber(summary, "resolutions"),
    performanceReports: readNumber(summary, "performanceReports"),
    completedForecasts: readNumber(summary, "completedForecasts"),
    failedForecasts: readNumber(summary, "failedForecasts"),
    resolvedCases: readNumber(summary, "resolvedCases"),
    failedResolutions: readNumber(summary, "failedResolutions"),
    performanceScoreRows: readNumber(summary, "performanceScoreRows"),
    attentionItems: readNumber(summary, "attentionItems"),
    openAttentionItems: readNumber(summary, "openAttentionItems"),
    deferredAttentionItems: readNumber(summary, "deferredAttentionItems"),
    reviewedAttentionItems: readNumber(summary, "reviewedAttentionItems"),
    unresolvedAttentionItems: readNumber(summary, "unresolvedAttentionItems"),
    scoreRegressionItems: readNumber(summary, "scoreRegressionItems"),
    calibrationGuardRegressionItems: readNumber(summary, "calibrationGuardRegressionItems"),
    candidateCalibrationGuardRules: readNumber(summary, "candidateCalibrationGuardRules"),
    openCandidateCalibrationGuardRules: readNumber(summary, "openCandidateCalibrationGuardRules"),
    deferredCandidateCalibrationGuardRules: readNumber(summary, "deferredCandidateCalibrationGuardRules"),
    reviewedCandidateCalibrationGuardRules: readNumber(summary, "reviewedCandidateCalibrationGuardRules"),
    unresolvedCandidateCalibrationGuardRules: readNumber(summary, "unresolvedCandidateCalibrationGuardRules"),
  };
}

function readIssueArray(value: Record<string, unknown> | null, key: string): ForecastBatchHealthIssue[] {
  const raw = value?.[key];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item) => {
    const record = asRecord(item);
    if (!record) {
      return [];
    }
    return [{
      severity: readString(record, "severity") ?? "unknown",
      kind: readString(record, "kind") ?? "unknown",
      message: readString(record, "message") ?? "",
    }];
  });
}

function readStringArray(value: Record<string, unknown> | null, key: string) {
  const raw = value?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

function readString(value: Record<string, unknown> | null, key: string) {
  const raw = value?.[key];
  return typeof raw === "string" ? raw : null;
}

function readNumber(value: Record<string, unknown> | null, key: string) {
  const raw = value?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
