import { resolve } from "node:path";
import { listFilesNamed, readBoolean, readJsonRecord, readNumber, readRecordArray, readString, timestampValue, type JsonRecord } from "./json-artifacts";

export type ForecastPerformanceArtifact = {
  reportPath: string;
  generatedAt: string | null;
  batchId: string | null;
  phase: string | null;
  calibrationReplayRows: ForecastPerformanceCalibrationReplayRow[];
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

function readForecastPerformanceArtifact(reportPath: string, payload: JsonRecord): ForecastPerformanceArtifact {
  return {
    reportPath,
    generatedAt: readString(payload, "generatedAt"),
    batchId: readString(payload, "batchId"),
    phase: readString(payload, "phase"),
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
