import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  readCalibrationGuardProposalArtifacts,
  type CalibrationGuardProposalArtifact,
  type CalibrationGuardProposalDraft,
} from "../packages/backend/src/calibration-guard-proposal-artifacts";
import {
  calibrationGuardRecommendationNeedsMoreEvidence,
  calibrationGuardRecommendationPromoteForDefault,
  calibrationGuardRecommendationPromoteForHoldout,
  calibrationGuardRecommendationReject,
  calibrationGuardValidationModeHoldoutReplay,
  calibrationGuardValidationModeSourceReplay,
  validateCalibrationGuardProposal,
  type CalibrationGuardValidationMode,
  type CalibrationGuardValidationRecommendation,
  type CalibrationGuardValidationProposal,
  type CalibrationGuardValidationReplayRow,
  type CalibrationGuardValidationResult,
} from "../packages/backend/src/calibration-guard-validation-policy";
import {
  readForecastPerformanceArtifacts,
  type ForecastPerformanceArtifact,
  type ForecastPerformanceCalibrationReplayRow,
} from "../packages/backend/src/forecast-performance-artifacts";
import {
  readArgValue,
  writeJson,
} from "./lib/forecast-script-utils";

type ReplayRow = CalibrationGuardValidationReplayRow;
type ProposalDraft = CalibrationGuardValidationProposal;
type ValidationRow = CalibrationGuardValidationResult;

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
  const validationMode: CalibrationGuardValidationMode = input.holdoutPerformanceArtifact
    ? calibrationGuardValidationModeHoldoutReplay
    : calibrationGuardValidationModeSourceReplay;
  const replayRows = validationMode === calibrationGuardValidationModeHoldoutReplay ? holdoutReplayRows : sourceReplayRows;
  const validations = proposals.flatMap((proposal) => validateCalibrationGuardProposal(proposal, replayRows, validationMode));
  return {
    reportType: "forecast_calibration_guard_validation",
    generatedAt: new Date().toISOString(),
    summary: {
      proposalDrafts: proposals.length,
      replayRows: replayRows.length,
      holdoutReplayRows: holdoutReplayRows.length,
      validations: validations.length,
      promoteForHoldout: validations.filter((row) => row.recommendation === calibrationGuardRecommendationPromoteForHoldout).length,
      promoteForDefault: validations.filter((row) => row.recommendation === calibrationGuardRecommendationPromoteForDefault).length,
      needsMoreEvidence: validations.filter((row) => row.recommendation === calibrationGuardRecommendationNeedsMoreEvidence).length,
      rejected: validations.filter((row) => row.recommendation === calibrationGuardRecommendationReject).length,
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
