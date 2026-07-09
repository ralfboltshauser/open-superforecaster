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

export type ForecastBatchAttentionKindBreakdown = {
  kind: string;
  items: number | null;
  open: number | null;
  deferred: number | null;
  reviewed: number | null;
  high: number | null;
  medium: number | null;
  low: number | null;
};

export type ForecastBatchAttentionSeverityBreakdown = {
  severity: string;
  items: number | null;
  open: number | null;
  deferred: number | null;
  reviewed: number | null;
};

export type ForecastBatchAttentionItem = {
  id: string;
  reviewStatus: string;
  severity: string;
  kind: string;
  reason: string;
  recommendedAction: string | null;
  metric: string;
  score: number | null;
  delta: number | null;
  taskId: string | null;
  taskLabel: string | null;
};

export type ForecastBatchCandidateCalibrationGuardRule = {
  id: string;
  reviewStatus: string;
  bucketLabel: string;
  direction: string;
  suggestedAdjustment: number | null;
  sampleSize: number | null;
  meanForecast: number | null;
  observedRate: number | null;
  calibrationError: number | null;
  activationStatus: string;
  rationale: string;
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
  attentionByKind: ForecastBatchAttentionKindBreakdown[];
  attentionBySeverity: ForecastBatchAttentionSeverityBreakdown[];
  attentionItems: ForecastBatchAttentionItem[];
  candidateCalibrationGuardRules: ForecastBatchCandidateCalibrationGuardRule[];
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
      attentionByKind: readAttentionKindArray(payload, "attentionByKind"),
      attentionBySeverity: readAttentionSeverityArray(payload, "attentionBySeverity"),
      attentionItems: readAttentionItemArray(payload, "attentionItems"),
      candidateCalibrationGuardRules: readCandidateCalibrationGuardRuleArray(payload, "candidateCalibrationGuardRules"),
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
      attentionByKind: [],
      attentionBySeverity: [],
      attentionItems: [],
      candidateCalibrationGuardRules: [],
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

function readAttentionKindArray(value: Record<string, unknown> | null, key: string): ForecastBatchAttentionKindBreakdown[] {
  return readRecordArray(value, key).map((record) => ({
    kind: readString(record, "kind") ?? "unknown",
    items: readNumber(record, "items"),
    open: readNumber(record, "open"),
    deferred: readNumber(record, "deferred"),
    reviewed: readNumber(record, "reviewed"),
    high: readNumber(record, "high"),
    medium: readNumber(record, "medium"),
    low: readNumber(record, "low"),
  }));
}

function readAttentionSeverityArray(value: Record<string, unknown> | null, key: string): ForecastBatchAttentionSeverityBreakdown[] {
  return readRecordArray(value, key).map((record) => ({
    severity: readString(record, "severity") ?? "unknown",
    items: readNumber(record, "items"),
    open: readNumber(record, "open"),
    deferred: readNumber(record, "deferred"),
    reviewed: readNumber(record, "reviewed"),
  }));
}

function readAttentionItemArray(value: Record<string, unknown> | null, key: string): ForecastBatchAttentionItem[] {
  return readRecordArray(value, key).map((record) => ({
    id: readString(record, "id") ?? "unknown",
    reviewStatus: readString(record, "reviewStatus") ?? "unknown",
    severity: readString(record, "severity") ?? "unknown",
    kind: readString(record, "kind") ?? "attention_item",
    reason: readString(record, "reason") ?? "",
    recommendedAction: readString(record, "recommendedAction"),
    metric: readString(record, "metric") ?? "metric",
    score: readNumber(record, "score"),
    delta: readNumber(record, "delta"),
    taskId: readString(record, "taskId"),
    taskLabel: readString(record, "taskLabel"),
  }));
}

function readCandidateCalibrationGuardRuleArray(value: Record<string, unknown> | null, key: string): ForecastBatchCandidateCalibrationGuardRule[] {
  return readRecordArray(value, key).map((record) => ({
    id: readString(record, "id") ?? "unknown",
    reviewStatus: readString(record, "reviewStatus") ?? "unknown",
    bucketLabel: readString(record, "bucketLabel") ?? "bucket",
    direction: readString(record, "direction") ?? "calibration_drift",
    suggestedAdjustment: readNumber(record, "suggestedAdjustment"),
    sampleSize: readNumber(record, "sampleSize"),
    meanForecast: readNumber(record, "meanForecast"),
    observedRate: readNumber(record, "observedRate"),
    calibrationError: readNumber(record, "calibrationError"),
    activationStatus: readString(record, "activationStatus") ?? "needs_review",
    rationale: readString(record, "rationale") ?? "",
  }));
}

function readRecordArray(value: Record<string, unknown> | null, key: string) {
  const raw = value?.[key];
  return Array.isArray(raw) ? raw.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  }) : [];
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
