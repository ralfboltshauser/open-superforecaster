import { resolve } from "node:path";
import { normalizeCalibrationGuardActivationStatus, type CalibrationGuardActivationStatus } from "./calibration-guard-activation-policy";
import { listFilesNamed, readBoolean, readJsonRecord, readNumber, readRecordArray, readString, timestampValue, type JsonRecord } from "./json-artifacts";

export type ForecastPerformanceArtifact = {
  reportPath: string;
  generatedAt: string | null;
  batchId: string | null;
  phase: string | null;
  summary: ForecastPerformanceSummary;
  attentionItems: ForecastPerformanceAttentionItem[];
  candidateCalibrationGuardRules: ForecastPerformanceCandidateCalibrationGuardRule[];
  calibrationReplayRows: ForecastPerformanceCalibrationReplayRow[];
};

export type ForecastPerformanceSummary = {
  resolvedTasks: number | null;
  productScoreRows: number | null;
  aggregateScoreRows: number | null;
  attemptScoreRows: number | null;
};

export type ForecastPerformanceAttentionItem = {
  id: string | null;
  kind: string;
  severity: string;
  reason: string;
  recommendedActions: string[];
  metric: string;
  score: number | null;
  delta: number | null;
  taskId: string | null;
  taskLabel: string | null;
  forecastType: string | null;
};

export type ForecastPerformanceCandidateCalibrationGuardRule = {
  id: string | null;
  bucketLabel: string;
  direction: string;
  suggestedAdjustment: number | null;
  sampleSize: number | null;
  meanForecast: number | null;
  observedRate: number | null;
  calibrationError: number | null;
  activationStatus: CalibrationGuardActivationStatus;
  rationale: string;
};

export type ForecastPerformanceCalibrationReplayRow = {
  id: string | null;
  taskId: string | null;
  probability: number | null;
  resolved: boolean | null;
  score: number | null;
  createdAt: string | null;
};

export async function readForecastPerformanceArtifacts(root: string, input: { reportRoot?: string } = {}): Promise<ForecastPerformanceArtifact[]> {
  const reportRoot = input.reportRoot ?? resolve(root, "data/reports/forecast-performance");
  const reportPaths = await listFilesNamed(reportRoot, "forecast-performance.json");
  const artifacts: ForecastPerformanceArtifact[] = [];
  for (const reportPath of reportPaths) {
    const payload = await readJsonRecord(reportPath);
    if (!payload) {
      continue;
    }
    artifacts.push(readForecastPerformanceArtifact(reportPath, payload));
  }
  return artifacts.sort((left, right) =>
    timestampValue(left.generatedAt) - timestampValue(right.generatedAt)
    || left.reportPath.localeCompare(right.reportPath)
  );
}

export function readForecastPerformanceArtifact(reportPath: string, payload: JsonRecord): ForecastPerformanceArtifact {
  const summary = readSummary(payload);
  return {
    reportPath,
    generatedAt: readString(payload, "generatedAt"),
    batchId: readString(payload, "batchId"),
    phase: readString(payload, "phase"),
    summary,
    attentionItems: readAttentionItems(payload),
    candidateCalibrationGuardRules: readCandidateCalibrationGuardRules(payload),
    calibrationReplayRows: readRecordArray(payload, "calibrationReplayRows").map((row) => ({
      id: readString(row, "id"),
      taskId: readString(row, "taskId"),
      probability: readNumber(row, "probability"),
      resolved: readBoolean(row, "resolved"),
      score: readNumber(row, "score"),
      createdAt: readString(row, "createdAt"),
    })),
  };
}

function readSummary(payload: JsonRecord): ForecastPerformanceSummary {
  const summary = payload.summary && typeof payload.summary === "object" && !Array.isArray(payload.summary)
    ? payload.summary as JsonRecord
    : {};
  return {
    resolvedTasks: readNumber(summary, "resolvedTasks"),
    productScoreRows: readNumber(summary, "productScoreRows"),
    aggregateScoreRows: readNumber(summary, "aggregateScoreRows"),
    attemptScoreRows: readNumber(summary, "attemptScoreRows"),
  };
}

function readAttentionItems(payload: JsonRecord): ForecastPerformanceAttentionItem[] {
  return readRecordArray(payload, "needsAttention").map((item) => ({
    id: readString(item, "id"),
    kind: readString(item, "kind") ?? "attention_item",
    severity: readString(item, "severity") ?? "medium",
    reason: readString(item, "reason") ?? "",
    recommendedActions: readStringArray(item, "recommendedActions"),
    metric: readString(item, "metric") ?? "metric",
    score: readNumber(item, "score"),
    delta: readNumber(item, "delta"),
    taskId: readString(item, "taskId"),
    taskLabel: readString(item, "taskLabel"),
    forecastType: readString(item, "forecastType"),
  }));
}

function readCandidateCalibrationGuardRules(payload: JsonRecord): ForecastPerformanceCandidateCalibrationGuardRule[] {
  return readRecordArray(payload, "candidateCalibrationGuardRules").map((rule) => ({
    id: readString(rule, "id"),
    bucketLabel: readString(rule, "bucketLabel") ?? "bucket",
    direction: readString(rule, "direction") ?? "calibration_drift",
    suggestedAdjustment: readNumber(rule, "suggestedAdjustment"),
    sampleSize: readNumber(rule, "sampleSize"),
    meanForecast: readNumber(rule, "meanForecast"),
    observedRate: readNumber(rule, "observedRate"),
    calibrationError: readNumber(rule, "calibrationError"),
    activationStatus: normalizeCalibrationGuardActivationStatus(readString(rule, "activationStatus")),
    rationale: readString(rule, "rationale") ?? "",
  }));
}

function readStringArray(value: unknown, key: string) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
  const raw = record?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}
