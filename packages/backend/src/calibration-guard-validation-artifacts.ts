import { resolve } from "node:path";
import { listFilesNamed, readJsonRecord, readNumber, readRecord, readRecordArray, readString, timestampValue, type JsonRecord } from "./json-artifacts";

export type CalibrationGuardValidationArtifact = {
  reportPath: string;
  generatedAt: string | null;
  summary: {
    proposalDrafts: number | null;
    replayRows: number | null;
    holdoutReplayRows: number | null;
    validations: number | null;
    promoteForHoldout: number | null;
    promoteForDefault: number | null;
    needsMoreEvidence: number | null;
    rejected: number | null;
  };
  validations: CalibrationGuardValidationRow[];
  paths: {
    proposals: string | null;
    performanceReport: string | null;
    holdoutPerformanceReport: string | null;
  };
};

export type CalibrationGuardValidationRow = {
  validationMode: string | null;
  proposalId: string | null;
  sourceCandidateGuardId: string | null;
  bucketLabel: string | null;
  suggestedAdjustment: number | null;
  matchedRows: number | null;
  baselineMeanBrier: number | null;
  candidateMeanBrier: number | null;
  brierDelta: number | null;
  baselineCalibrationError: number | null;
  candidateCalibrationError: number | null;
  calibrationErrorDelta: number | null;
  recommendation: string | null;
};

export async function readCalibrationGuardValidationArtifacts(root: string, input: { reportRoot?: string } = {}): Promise<CalibrationGuardValidationArtifact[]> {
  const reportRoot = input.reportRoot ?? resolve(root, "data/reports/forecast-calibration-guard-validation");
  const reportPaths = await listFilesNamed(reportRoot, "calibration-guard-validation.json");
  const artifacts: CalibrationGuardValidationArtifact[] = [];
  for (const reportPath of reportPaths) {
    const payload = await readJsonRecord(reportPath);
    if (!payload) {
      continue;
    }
    artifacts.push(readCalibrationGuardValidationArtifact(reportPath, payload));
  }
  return artifacts.sort((left, right) =>
    timestampValue(left.generatedAt) - timestampValue(right.generatedAt)
    || left.reportPath.localeCompare(right.reportPath)
  );
}

function readCalibrationGuardValidationArtifact(reportPath: string, payload: JsonRecord): CalibrationGuardValidationArtifact {
  const summary = readRecord(payload, "summary");
  const paths = readRecord(payload, "paths");
  return {
    reportPath,
    generatedAt: readString(payload, "generatedAt"),
    summary: {
      proposalDrafts: readNumber(summary, "proposalDrafts"),
      replayRows: readNumber(summary, "replayRows"),
      holdoutReplayRows: readNumber(summary, "holdoutReplayRows"),
      validations: readNumber(summary, "validations"),
      promoteForHoldout: readNumber(summary, "promoteForHoldout"),
      promoteForDefault: readNumber(summary, "promoteForDefault"),
      needsMoreEvidence: readNumber(summary, "needsMoreEvidence"),
      rejected: readNumber(summary, "rejected"),
    },
    validations: readRecordArray(payload, "validations").map((validation) => ({
      validationMode: readString(validation, "validationMode"),
      proposalId: readString(validation, "proposalId"),
      sourceCandidateGuardId: readString(validation, "sourceCandidateGuardId"),
      bucketLabel: readString(validation, "bucketLabel"),
      suggestedAdjustment: readNumber(validation, "suggestedAdjustment"),
      matchedRows: readNumber(validation, "matchedRows"),
      baselineMeanBrier: readNumber(validation, "baselineMeanBrier"),
      candidateMeanBrier: readNumber(validation, "candidateMeanBrier"),
      brierDelta: readNumber(validation, "brierDelta"),
      baselineCalibrationError: readNumber(validation, "baselineCalibrationError"),
      candidateCalibrationError: readNumber(validation, "candidateCalibrationError"),
      calibrationErrorDelta: readNumber(validation, "calibrationErrorDelta"),
      recommendation: readString(validation, "recommendation"),
    })),
    paths: {
      proposals: readString(paths, "proposals"),
      performanceReport: readString(paths, "performanceReport"),
      holdoutPerformanceReport: readString(paths, "holdoutPerformanceReport"),
    },
  };
}
