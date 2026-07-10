import { resolve } from "node:path";
import { listFilesNamed, readJsonRecord, readNumber, readRecord, readRecordArray, readString, readStringArray, timestampValue, type JsonRecord } from "./json-artifacts";

export type ForecastAttentionBacklogArtifact = {
  reportPath: string;
  generatedAt: string | null;
  filters: {
    statuses: string[];
    batchIds: string[];
  };
  counts: {
    items: number | null;
    open: number | null;
    deferred: number | null;
    reviewed: number | null;
    high: number | null;
    medium: number | null;
    low: number | null;
  };
  items: ForecastAttentionBacklogItem[];
  paths: {
    reviews: string | null;
    batchIndexDir: string | null;
    validationReportDir: string | null;
    defaultPlanReportDir: string | null;
  };
};

export type ForecastAttentionBacklogItem = {
  batchId: string | null;
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
  sourcePath: string | null;
};

export async function readForecastAttentionBacklogArtifacts(root: string, input: { reportRoot?: string } = {}): Promise<ForecastAttentionBacklogArtifact[]> {
  const reportRoot = input.reportRoot ?? resolve(root, "data/reports/forecast-attention-backlog");
  const reportPaths = await listFilesNamed(reportRoot, "attention-backlog.json");
  const artifacts: ForecastAttentionBacklogArtifact[] = [];
  for (const reportPath of reportPaths) {
    const payload = await readJsonRecord(reportPath);
    if (!payload) {
      continue;
    }
    artifacts.push(readForecastAttentionBacklogArtifact(reportPath, payload));
  }
  return artifacts.sort((left, right) =>
    timestampValue(left.generatedAt) - timestampValue(right.generatedAt)
    || left.reportPath.localeCompare(right.reportPath)
  );
}

function readForecastAttentionBacklogArtifact(reportPath: string, payload: JsonRecord): ForecastAttentionBacklogArtifact {
  const filters = readRecord(payload, "filters");
  const counts = readRecord(payload, "counts");
  const paths = readRecord(payload, "paths");
  return {
    reportPath,
    generatedAt: readString(payload, "generatedAt"),
    filters: {
      statuses: readStringArray(filters, "statuses"),
      batchIds: readStringArray(filters, "batchIds"),
    },
    counts: {
      items: readNumber(counts, "items"),
      open: readNumber(counts, "open"),
      deferred: readNumber(counts, "deferred"),
      reviewed: readNumber(counts, "reviewed"),
      high: readNumber(counts, "high"),
      medium: readNumber(counts, "medium"),
      low: readNumber(counts, "low"),
    },
    items: readRecordArray(payload, "items").map((item) => ({
      batchId: readString(item, "batchId"),
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
      sourcePath: readString(item, "sourcePath"),
    })),
    paths: {
      reviews: readString(paths, "reviews"),
      batchIndexDir: readString(paths, "batchIndexDir"),
      validationReportDir: readString(paths, "validationReportDir"),
      defaultPlanReportDir: readString(paths, "defaultPlanReportDir"),
    },
  };
}
