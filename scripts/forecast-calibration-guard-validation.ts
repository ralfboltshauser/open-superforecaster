import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  readCalibrationGuardProposalArtifacts,
  type CalibrationGuardProposalArtifact,
  type CalibrationGuardProposalDraft,
} from "../packages/backend/src/calibration-guard-proposal-artifacts";
import {
  readForecastPerformanceArtifacts,
  type ForecastPerformanceArtifact,
  type ForecastPerformanceCalibrationReplayRow,
} from "../packages/backend/src/forecast-performance-artifacts";
import { BINARY_CALIBRATION_POLICY } from "../packages/backend/src/performance-calibration";
import {
  readArgValue,
  writeJson,
} from "./lib/forecast-script-utils";

type ReplayRow = {
  id: string | null;
  taskId: string | null;
  probability: number;
  resolved: boolean;
  score: number | null;
};

type ProposalDraft = {
  id: string;
  sourceCandidateGuardId: string;
  targetWorkflowId: string;
  calibrationEvidence: {
    bucketLabel: string;
    suggestedAdjustment: number | null;
  };
};

type ValidationMode = "source_replay" | "holdout_replay";
type ValidationRecommendation = "promote_for_holdout" | "promote_for_default" | "needs_more_evidence" | "reject";

type ValidationRow = {
  validationMode: ValidationMode;
  proposalId: string;
  sourceCandidateGuardId: string;
  bucketLabel: string;
  suggestedAdjustment: number;
  matchedRows: number;
  baselineMeanBrier: number | null;
  candidateMeanBrier: number | null;
  brierDelta: number | null;
  baselineCalibrationError: number | null;
  candidateCalibrationError: number | null;
  calibrationErrorDelta: number | null;
  recommendation: ValidationRecommendation;
};

type ValidationReport = {
  reportType: "forecast_calibration_guard_validation";
  generatedAt: string;
  summary: {
    proposalDrafts: number;
    replayRows: number;
    holdoutReplayRows: number;
    validations: number;
    promoteForHoldout: number;
    promoteForDefault: number;
    needsMoreEvidence: number;
    rejected: number;
  };
  validations: ValidationRow[];
  paths: {
    json: string;
    markdown: string;
    proposals: string | null;
    performanceReport: string | null;
    holdoutPerformanceReport: string | null;
  };
};

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const proposalsPath = resolve(
  root,
  readArgValue(args, "--proposals") ?? "data/reports/forecast-calibration-guard-proposals/calibration-guard-proposals.json",
);
const performanceReportPath = readArgValue(args, "--performance-report")
  ? resolve(root, readArgValue(args, "--performance-report") ?? "")
  : await latestPerformanceReportPath(resolve(root, readArgValue(args, "--performance-dir") ?? "data/reports/forecast-performance"));
const holdoutPerformanceReportPath = readArgValue(args, "--holdout-performance-report")
  ? resolve(root, readArgValue(args, "--holdout-performance-report") ?? "")
  : null;
const outputDir = resolve(root, readArgValue(args, "--out-dir") ?? "data/reports/forecast-calibration-guard-validation");
const jsonPath = resolve(outputDir, "calibration-guard-validation.json");
const markdownPath = resolve(outputDir, "calibration-guard-validation.md");

const proposalsArtifact = await readExplicitProposalArtifact(proposalsPath);
const performanceArtifact = performanceReportPath ? await readExplicitPerformanceArtifact(performanceReportPath) : null;
const holdoutPerformanceArtifact = holdoutPerformanceReportPath ? await readExplicitPerformanceArtifact(holdoutPerformanceReportPath) : null;
const report = buildValidationReport({
  proposalsPath,
  performanceReportPath,
  holdoutPerformanceReportPath,
  proposalsArtifact,
  performanceArtifact,
  holdoutPerformanceArtifact,
  jsonPath,
  markdownPath,
});

await mkdir(outputDir, { recursive: true });
await writeJson(jsonPath, report);
await writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(`Calibration guard validations: ${report.summary.validations}`);
console.log(`Promote for holdout: ${report.summary.promoteForHoldout}`);
console.log(`Promote for default: ${report.summary.promoteForDefault}`);
console.log(`Output: ${jsonPath}`);

async function latestPerformanceReportPath(performanceRoot: string) {
  const artifacts = await readForecastPerformanceArtifacts(root, { reportRoot: performanceRoot });
  const latest = artifacts[artifacts.length - 1] ?? null;
  return latest?.reportPath ?? null;
}

async function readExplicitProposalArtifact(path: string) {
  const artifacts = await readCalibrationGuardProposalArtifacts(root, { reportRoot: path });
  return artifacts[artifacts.length - 1] ?? null;
}

async function readExplicitPerformanceArtifact(path: string) {
  const artifacts = await readForecastPerformanceArtifacts(root, { reportRoot: path });
  return artifacts[artifacts.length - 1] ?? null;
}

function buildValidationReport(input: {
  proposalsPath: string;
  performanceReportPath: string | null;
  holdoutPerformanceReportPath: string | null;
  proposalsArtifact: CalibrationGuardProposalArtifact | null;
  performanceArtifact: ForecastPerformanceArtifact | null;
  holdoutPerformanceArtifact: ForecastPerformanceArtifact | null;
  jsonPath: string;
  markdownPath: string;
}): ValidationReport {
  const proposals = (input.proposalsArtifact?.proposalDrafts ?? []).flatMap(readProposalDraft);
  const sourceReplayRows = (input.performanceArtifact?.calibrationReplayRows ?? []).flatMap(readReplayRow);
  const holdoutReplayRows = (input.holdoutPerformanceArtifact?.calibrationReplayRows ?? []).flatMap(readReplayRow);
  const validationMode: ValidationMode = input.holdoutPerformanceArtifact ? "holdout_replay" : "source_replay";
  const replayRows = validationMode === "holdout_replay" ? holdoutReplayRows : sourceReplayRows;
  const validations = proposals.flatMap((proposal) => validateProposal(proposal, replayRows, validationMode));
  return {
    reportType: "forecast_calibration_guard_validation",
    generatedAt: new Date().toISOString(),
    summary: {
      proposalDrafts: proposals.length,
      replayRows: replayRows.length,
      holdoutReplayRows: holdoutReplayRows.length,
      validations: validations.length,
      promoteForHoldout: validations.filter((row) => row.recommendation === "promote_for_holdout").length,
      promoteForDefault: validations.filter((row) => row.recommendation === "promote_for_default").length,
      needsMoreEvidence: validations.filter((row) => row.recommendation === "needs_more_evidence").length,
      rejected: validations.filter((row) => row.recommendation === "reject").length,
    },
    validations,
    paths: {
      json: input.jsonPath,
      markdown: input.markdownPath,
      proposals: input.proposalsArtifact ? input.proposalsPath : null,
      performanceReport: input.performanceArtifact ? input.performanceReportPath : null,
      holdoutPerformanceReport: input.holdoutPerformanceArtifact ? input.holdoutPerformanceReportPath : null,
    },
  };
}

function validateProposal(proposal: ProposalDraft, replayRows: ReplayRow[], validationMode: ValidationMode): ValidationRow[] {
  const bucket = parseBucketLabel(proposal.calibrationEvidence.bucketLabel);
  const adjustment = proposal.calibrationEvidence.suggestedAdjustment;
  if (!bucket || adjustment === null) {
    return [];
  }
  const matchedRows = replayRows.filter((row) =>
    bucket.max === 100
      ? row.probability >= bucket.min && row.probability <= bucket.max
      : row.probability >= bucket.min && row.probability < bucket.max
  );
  const baselineMeanBrier = mean(matchedRows.map((row) => brier(row.probability, row.resolved)));
  const candidateMeanBrier = mean(matchedRows.map((row) => brier(clampProbability(row.probability + adjustment), row.resolved)));
  const baselineCalibrationError = calibrationError(matchedRows.map((row) => row.probability), matchedRows.map((row) => row.resolved));
  const candidateCalibrationError = calibrationError(
    matchedRows.map((row) => clampProbability(row.probability + adjustment)),
    matchedRows.map((row) => row.resolved),
  );
  return [{
    validationMode,
    proposalId: proposal.id,
    sourceCandidateGuardId: proposal.sourceCandidateGuardId,
    bucketLabel: proposal.calibrationEvidence.bucketLabel,
    suggestedAdjustment: adjustment,
    matchedRows: matchedRows.length,
    baselineMeanBrier,
    candidateMeanBrier,
    brierDelta: delta(candidateMeanBrier, baselineMeanBrier),
    baselineCalibrationError,
    candidateCalibrationError,
    calibrationErrorDelta: delta(candidateCalibrationError, baselineCalibrationError),
    recommendation: recommendationFor({ validationMode, matchedRows: matchedRows.length, baselineMeanBrier, candidateMeanBrier, baselineCalibrationError, candidateCalibrationError }),
  }];
}

function recommendationFor(input: {
  validationMode: ValidationMode;
  matchedRows: number;
  baselineMeanBrier: number | null;
  candidateMeanBrier: number | null;
  baselineCalibrationError: number | null;
  candidateCalibrationError: number | null;
}): ValidationRecommendation {
  if (
    input.matchedRows < BINARY_CALIBRATION_POLICY.minimumBucketSampleSize ||
    input.baselineMeanBrier === null ||
    input.candidateMeanBrier === null
  ) {
    return "needs_more_evidence";
  }
  if (
    input.candidateMeanBrier < input.baselineMeanBrier &&
    input.candidateCalibrationError !== null &&
    input.baselineCalibrationError !== null &&
    input.candidateCalibrationError <= input.baselineCalibrationError
  ) {
    return input.validationMode === "holdout_replay" ? "promote_for_default" : "promote_for_holdout";
  }
  return "reject";
}

function renderMarkdown(report: ValidationReport) {
  const lines = [
    "# Calibration Guard Validation",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Proposal drafts: ${report.summary.proposalDrafts}`,
    `- Replay rows: ${report.summary.replayRows}`,
    `- Holdout replay rows: ${report.summary.holdoutReplayRows}`,
    `- Validations: ${report.summary.validations}`,
    `- Promote for holdout: ${report.summary.promoteForHoldout}`,
    `- Promote for default: ${report.summary.promoteForDefault}`,
    `- Needs more evidence: ${report.summary.needsMoreEvidence}`,
    `- Rejected: ${report.summary.rejected}`,
    "",
    "## Validations",
    "",
    ...renderValidationTable(report.validations),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderValidationTable(rows: ValidationRow[]) {
  if (rows.length === 0) {
    return ["No calibration guard validations found."];
  }
  return [
    "| Proposal | Mode | Bucket | Rows | Adjustment | Brier delta | Calibration error delta | Recommendation |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) =>
      `| ${escapeMarkdownCell(row.proposalId)} | ${row.validationMode} | ${escapeMarkdownCell(row.bucketLabel)} | ${row.matchedRows} | ${
        formatSignedNumber(row.suggestedAdjustment)
      } | ${formatNullableSigned(row.brierDelta)} | ${formatNullableSigned(row.calibrationErrorDelta)} | ${row.recommendation} |`,
    ),
  ];
}

function readProposalDraft(value: CalibrationGuardProposalDraft): ProposalDraft[] {
  if (!value.id || !value.sourceCandidateGuardId || !value.targetWorkflowId) {
    return [];
  }
  return [{
    id: value.id,
    sourceCandidateGuardId: value.sourceCandidateGuardId,
    targetWorkflowId: value.targetWorkflowId,
    calibrationEvidence: {
      bucketLabel: value.calibrationEvidence.bucketLabel ?? "",
      suggestedAdjustment: value.calibrationEvidence.suggestedAdjustment,
    },
  }];
}

function readReplayRow(value: ForecastPerformanceCalibrationReplayRow): ReplayRow[] {
  if (value.probability === null || value.resolved === null) {
    return [];
  }
  return [{
    id: value.id,
    taskId: value.taskId,
    probability: value.probability,
    resolved: value.resolved,
    score: value.score,
  }];
}

function parseBucketLabel(label: string) {
  const match = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%$/.exec(label);
  if (!match) {
    return null;
  }
  const min = Number(match[1]);
  const max = Number(match[2]);
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function calibrationError(probabilities: number[], resolved: boolean[]) {
  if (probabilities.length === 0 || probabilities.length !== resolved.length) {
    return null;
  }
  const meanForecast = mean(probabilities);
  const observedRate = mean(resolved.map((value) => (value ? 100 : 0)));
  return meanForecast === null || observedRate === null ? null : roundMetric(Math.abs(meanForecast - observedRate));
}

function brier(probability: number, resolved: boolean) {
  const forecast = probability / 100;
  const actual = resolved ? 1 : 0;
  return roundMetric((forecast - actual) ** 2);
}

function mean(values: number[]) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? roundMetric(finite.reduce((sum, value) => sum + value, 0) / finite.length) : null;
}

function delta(candidate: number | null, baseline: number | null) {
  return candidate === null || baseline === null ? null : roundMetric(candidate - baseline);
}

function clampProbability(value: number) {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}

function roundMetric(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatNullableSigned(value: number | null) {
  return value === null ? "" : formatSignedNumber(value);
}

function formatSignedNumber(value: number) {
  return value > 0 ? `+${roundMetric(value)}` : String(roundMetric(value));
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
