import { resolve } from "node:path";
import { listFilesNamed, readJsonRecord, readNumber, readRecord, readRecordArray, readString, readStringArray, timestampValue, type JsonRecord } from "./json-artifacts";

export type ForecastBatchIndexArtifact = {
  reportPath: string;
  batchId: string;
  generatedAt: string | null;
  attentionItems: ForecastBatchIndexAttentionItem[];
  candidateCalibrationGuardRules: ForecastBatchIndexCandidateCalibrationGuardRule[];
  paths: {
    reviews: string | null;
  };
};

export type ForecastBatchIndexAttentionItem = {
  id: string | null;
  reviewStatus: string | null;
  severity: string | null;
  kind: string | null;
  reason: string | null;
  recommendedActions: string[];
  metric: string | null;
  score: number | null;
  delta: number | null;
  taskId: string | null;
  taskLabel: string | null;
  forecastType: string | null;
  reviewNote: string | null;
  reviewer: string | null;
  reviewedAt: string | null;
};

export type ForecastBatchIndexCandidateCalibrationGuardRule = {
  id: string | null;
  reviewStatus: string | null;
  reviewNote: string | null;
  reviewer: string | null;
  reviewedAt: string | null;
  bucketLabel: string | null;
  direction: string | null;
  suggestedAdjustment: number | null;
  sampleSize: number | null;
  meanForecast: number | null;
  observedRate: number | null;
  calibrationError: number | null;
  activationStatus: string | null;
  rationale: string | null;
};

export async function readForecastBatchIndexArtifacts(root: string, input: { reportRoot?: string } = {}): Promise<ForecastBatchIndexArtifact[]> {
  const reportRoot = input.reportRoot ?? resolve(root, "data/reports/forecast-batches");
  const reportPaths = await listFilesNamed(reportRoot, "batch-index.json");
  const artifacts: ForecastBatchIndexArtifact[] = [];
  for (const reportPath of reportPaths) {
    const payload = await readJsonRecord(reportPath);
    const artifact = payload ? readForecastBatchIndexArtifact(reportPath, payload) : null;
    if (artifact) {
      artifacts.push(artifact);
    }
  }
  return artifacts.sort((left, right) =>
    timestampValue(left.generatedAt) - timestampValue(right.generatedAt)
    || left.batchId.localeCompare(right.batchId)
    || left.reportPath.localeCompare(right.reportPath)
  );
}

function readForecastBatchIndexArtifact(reportPath: string, payload: JsonRecord): ForecastBatchIndexArtifact | null {
  const batchId = readString(payload, "batchId");
  if (!batchId) {
    return null;
  }
  const paths = readRecord(payload, "paths");
  return {
    reportPath,
    batchId,
    generatedAt: readString(payload, "generatedAt"),
    attentionItems: readRecordArray(payload, "attentionItems").map((item) => ({
      id: readString(item, "id"),
      reviewStatus: readString(item, "reviewStatus"),
      severity: readString(item, "severity"),
      kind: readString(item, "kind"),
      reason: readString(item, "reason"),
      recommendedActions: readStringArray(item, "recommendedActions"),
      metric: readString(item, "metric"),
      score: readNumber(item, "score"),
      delta: readNumber(item, "delta"),
      taskId: readString(item, "taskId"),
      taskLabel: readString(item, "taskLabel"),
      forecastType: readString(item, "forecastType"),
      reviewNote: readString(item, "reviewNote"),
      reviewer: readString(item, "reviewer"),
      reviewedAt: readString(item, "reviewedAt"),
    })),
    candidateCalibrationGuardRules: readRecordArray(payload, "candidateCalibrationGuardRules").map((rule) => ({
      id: readString(rule, "id"),
      reviewStatus: readString(rule, "reviewStatus"),
      reviewNote: readString(rule, "reviewNote"),
      reviewer: readString(rule, "reviewer"),
      reviewedAt: readString(rule, "reviewedAt"),
      bucketLabel: readString(rule, "bucketLabel"),
      direction: readString(rule, "direction"),
      suggestedAdjustment: readNumber(rule, "suggestedAdjustment"),
      sampleSize: readNumber(rule, "sampleSize"),
      meanForecast: readNumber(rule, "meanForecast"),
      observedRate: readNumber(rule, "observedRate"),
      calibrationError: readNumber(rule, "calibrationError"),
      activationStatus: readString(rule, "activationStatus"),
      rationale: readString(rule, "rationale"),
    })),
    paths: {
      reviews: readString(paths, "reviews"),
    },
  };
}
