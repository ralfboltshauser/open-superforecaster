import { resolve } from "node:path";
import { listFilesNamed, readJsonRecord, readNumber, readRecord, readRecordArray, readString, timestampValue, type JsonRecord } from "./json-artifacts";

export type CalibrationGuardProposalArtifact = {
  reportPath: string;
  generatedAt: string | null;
  batchId: string | null;
  summary: {
    candidateCalibrationGuardRules: number | null;
    eligibleCandidateCalibrationGuardRules: number | null;
    proposalDrafts: number | null;
    skippedOpen: number | null;
    skippedDeferred: number | null;
    skippedNeedsMoreResolvedForecasts: number | null;
  };
  proposalDrafts: CalibrationGuardProposalDraft[];
  paths: {
    batchIndex: string | null;
    batchIndexDir: string | null;
  };
};

export type CalibrationGuardProposalDraft = {
  id: string | null;
  sourceBatchId: string | null;
  sourceCandidateGuardId: string | null;
  targetWorkflowId: string | null;
  status: string | null;
  reviewStatus: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  calibrationEvidence: {
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
};

export async function readCalibrationGuardProposalArtifacts(root: string, input: { reportRoot?: string } = {}): Promise<CalibrationGuardProposalArtifact[]> {
  const reportRoot = input.reportRoot ?? resolve(root, "data/reports/forecast-calibration-guard-proposals");
  const reportPaths = await listFilesNamed(reportRoot, "calibration-guard-proposals.json");
  const artifacts: CalibrationGuardProposalArtifact[] = [];
  for (const reportPath of reportPaths) {
    const payload = await readJsonRecord(reportPath);
    if (!payload) {
      continue;
    }
    artifacts.push(readCalibrationGuardProposalArtifact(reportPath, payload));
  }
  return artifacts.sort((left, right) =>
    timestampValue(left.generatedAt) - timestampValue(right.generatedAt)
    || left.reportPath.localeCompare(right.reportPath)
  );
}

function readCalibrationGuardProposalArtifact(reportPath: string, payload: JsonRecord): CalibrationGuardProposalArtifact {
  const summary = readRecord(payload, "summary");
  const paths = readRecord(payload, "paths");
  return {
    reportPath,
    generatedAt: readString(payload, "generatedAt"),
    batchId: readString(payload, "batchId"),
    summary: {
      candidateCalibrationGuardRules: readNumber(summary, "candidateCalibrationGuardRules"),
      eligibleCandidateCalibrationGuardRules: readNumber(summary, "eligibleCandidateCalibrationGuardRules"),
      proposalDrafts: readNumber(summary, "proposalDrafts"),
      skippedOpen: readNumber(summary, "skippedOpen"),
      skippedDeferred: readNumber(summary, "skippedDeferred"),
      skippedNeedsMoreResolvedForecasts: readNumber(summary, "skippedNeedsMoreResolvedForecasts"),
    },
    proposalDrafts: readRecordArray(payload, "proposalDrafts").map(readProposalDraft),
    paths: {
      batchIndex: readString(paths, "batchIndex"),
      batchIndexDir: readString(paths, "batchIndexDir"),
    },
  };
}

function readProposalDraft(proposal: JsonRecord): CalibrationGuardProposalDraft {
  const evidence = readRecord(proposal, "calibrationEvidence");
  return {
    id: readString(proposal, "id"),
    sourceBatchId: readString(proposal, "sourceBatchId"),
    sourceCandidateGuardId: readString(proposal, "sourceCandidateGuardId"),
    targetWorkflowId: readString(proposal, "targetWorkflowId"),
    status: readString(proposal, "status"),
    reviewStatus: readString(proposal, "reviewStatus"),
    reviewNote: readString(proposal, "reviewNote"),
    reviewedBy: readString(proposal, "reviewedBy"),
    reviewedAt: readString(proposal, "reviewedAt"),
    calibrationEvidence: {
      bucketLabel: readString(evidence, "bucketLabel"),
      direction: readString(evidence, "direction"),
      suggestedAdjustment: readNumber(evidence, "suggestedAdjustment"),
      sampleSize: readNumber(evidence, "sampleSize"),
      meanForecast: readNumber(evidence, "meanForecast"),
      observedRate: readNumber(evidence, "observedRate"),
      calibrationError: readNumber(evidence, "calibrationError"),
      activationStatus: readString(evidence, "activationStatus"),
      rationale: readString(evidence, "rationale"),
    },
  };
}
