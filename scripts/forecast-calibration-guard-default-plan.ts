import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildCalibrationDefaultPlanArtifactIssues,
  type CalibrationDefaultPlanGeneratedIssue,
} from "../packages/backend/src/calibration-default-plan-artifacts";
import {
  readCalibrationGuardValidationArtifacts,
  type CalibrationGuardValidationArtifact,
  type CalibrationGuardValidationRow,
} from "../packages/backend/src/calibration-guard-validation-artifacts";
import {
  buildCalibrationGuardDefaultPlanCandidate,
  calibrationGuardDefaultPlanSkippedReasonForValidation,
  calibrationGuardDefaultPlanSkippedReasonNotHoldoutReplay,
  calibrationGuardDefaultPlanSkippedReasonNotPromotedForDefault,
  isCalibrationGuardDefaultPromotionCandidate,
  isCalibrationGuardValidationRecommendation,
  type CalibrationGuardDefaultPlanCandidatePlan,
  type CalibrationGuardDefaultPlanSkippedReason,
  type CalibrationGuardValidationRecommendation,
} from "../packages/backend/src/calibration-guard-validation-policy";
import { readArgValue, writeJson } from "./lib/forecast-script-utils";

type ValidationRow = {
  validationMode: string | null;
  proposalId: string;
  sourceCandidateGuardId: string;
  bucketLabel: string;
  suggestedAdjustment: number;
  matchedRows: number | null;
  brierDelta: number | null;
  calibrationErrorDelta: number | null;
  recommendation: CalibrationGuardValidationRecommendation;
};

type DefaultPlanCandidate = CalibrationGuardDefaultPlanCandidatePlan;

type DefaultPlanReport = {
  reportType: "forecast_calibration_guard_default_plan";
  generatedAt: string;
  summary: {
    validationRows: number;
    defaultCandidates: number;
    skippedNonHoldout: number;
    skippedNotPromoted: number;
    issues: number;
  };
  issues: DefaultPlanIssue[];
  defaultCandidates: DefaultPlanCandidate[];
  skippedRows: {
    proposalId: string;
    bucketLabel: string;
    recommendation: string;
    validationMode: string | null;
    reason: CalibrationGuardDefaultPlanSkippedReason;
  }[];
  paths: {
    json: string;
    markdown: string;
    validationReport: string | null;
    validationReportDir: string | null;
  };
};

type DefaultPlanIssue = CalibrationDefaultPlanGeneratedIssue;

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const validationReportArg = readArgValue(args, "--validation-report");
const validationReportDirArg = readArgValue(args, "--validation-report-dir") ?? "data/reports/forecast-calibration-guard-validation";
const validationReportDir = resolve(root, validationReportDirArg);
const validationReports = await readCalibrationGuardValidationArtifacts(root, { reportRoot: validationReportDir });
const latestValidationReport = validationReports[validationReports.length - 1] ?? null;
const selectedValidationReport = validationReportArg
  ? await readValidationReport(resolve(root, validationReportArg))
  : latestValidationReport;
const outputDir = resolve(root, readArgValue(args, "--out-dir") ?? "data/reports/forecast-calibration-guard-default-plan");
const jsonPath = resolve(outputDir, "calibration-guard-default-plan.json");
const markdownPath = resolve(outputDir, "calibration-guard-default-plan.md");

const report = buildDefaultPlanReport({
  validationReport: selectedValidationReport,
  validationReportDir: validationReportArg ? null : validationReportDir,
  latestValidationReportPath: latestValidationReport?.reportPath ?? null,
  latestValidationReportGeneratedAt: latestValidationReport?.generatedAt ?? null,
  jsonPath,
  markdownPath,
});

await mkdir(outputDir, { recursive: true });
await writeJson(jsonPath, report);
await writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(`Calibration guard default candidates: ${report.summary.defaultCandidates}`);
console.log(`Validation report: ${report.paths.validationReport ?? "none"}`);
console.log(`Output: ${jsonPath}`);

async function readValidationReport(path: string) {
  const reports = await readCalibrationGuardValidationArtifacts(root, { reportRoot: path });
  return reports[reports.length - 1] ?? null;
}

function buildDefaultPlanReport(input: {
  validationReport: CalibrationGuardValidationArtifact | null;
  validationReportDir: string | null;
  latestValidationReportPath: string | null;
  latestValidationReportGeneratedAt: string | null;
  jsonPath: string;
  markdownPath: string;
}): DefaultPlanReport {
  const validationRows = (input.validationReport?.validations ?? []).flatMap(readValidationRow);
  const issues = buildCalibrationDefaultPlanArtifactIssues({
    validationReportPath: input.validationReport?.reportPath ?? null,
    validationReportGeneratedAt: input.validationReport?.generatedAt ?? null,
    latestValidationReportPath: input.latestValidationReportPath,
    latestValidationReportGeneratedAt: input.latestValidationReportGeneratedAt,
  });
  const defaultCandidates = validationRows
    .filter(isCalibrationGuardDefaultPromotionCandidate)
    .map(buildCalibrationGuardDefaultPlanCandidate);
  const skippedRows = validationRows
    .filter((row) => !isCalibrationGuardDefaultPromotionCandidate(row))
    .map((row) => ({
      proposalId: row.proposalId,
      bucketLabel: row.bucketLabel,
      recommendation: row.recommendation,
      validationMode: row.validationMode,
      reason: calibrationGuardDefaultPlanSkippedReasonForValidation(row),
    }));
  return {
    reportType: "forecast_calibration_guard_default_plan",
    generatedAt: new Date().toISOString(),
    summary: {
      validationRows: validationRows.length,
      defaultCandidates: defaultCandidates.length,
      skippedNonHoldout: skippedRows.filter((row) => row.reason === calibrationGuardDefaultPlanSkippedReasonNotHoldoutReplay).length,
      skippedNotPromoted: skippedRows.filter((row) => row.reason === calibrationGuardDefaultPlanSkippedReasonNotPromotedForDefault).length,
      issues: issues.length,
    },
    issues,
    defaultCandidates,
    skippedRows,
    paths: {
      json: input.jsonPath,
      markdown: input.markdownPath,
      validationReport: input.validationReport?.reportPath ?? null,
      validationReportDir: input.validationReportDir,
    },
  };
}

function renderMarkdown(report: DefaultPlanReport) {
  const lines = [
    "# Calibration Guard Default Plan",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Summary",
    "",
    `- Validation rows: ${report.summary.validationRows}`,
    `- Default candidates: ${report.summary.defaultCandidates}`,
    `- Skipped non-holdout rows: ${report.summary.skippedNonHoldout}`,
    `- Skipped rows not promoted for default: ${report.summary.skippedNotPromoted}`,
    `- Issues: ${report.summary.issues}`,
    "",
    "## Issues",
    "",
    ...renderIssueTable(report.issues),
    "",
    "## Default Candidates",
    "",
    ...renderCandidateTable(report.defaultCandidates),
    "",
    "## Skipped Rows",
    "",
    ...renderSkippedTable(report.skippedRows),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderIssueTable(rows: DefaultPlanIssue[]) {
  if (rows.length === 0) {
    return ["No default-plan artifact issues found."];
  }
  return [
    "| Severity | Kind | Message | Validation report | Latest validation report |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) =>
      `| ${row.severity} | ${row.kind} | ${escapeMarkdownCell(row.message)} | ${escapeMarkdownCell(row.validationReport ?? "")} | ${
        escapeMarkdownCell(row.latestValidationReport ?? "")
      } |`,
    ),
  ];
}

function renderCandidateTable(rows: DefaultPlanCandidate[]) {
  if (rows.length === 0) {
    return ["No held-out default calibration guard candidates found."];
  }
  return [
    "| Proposal | Bucket | Rows | Adjustment | Brier delta | Calibration error delta | Target | Status |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
    ...rows.map((row) =>
      `| ${escapeMarkdownCell(row.proposalId)} | ${escapeMarkdownCell(row.bucketLabel)} | ${formatNullableNumber(row.matchedRows)} | ${
        formatSignedNumber(row.suggestedAdjustment)
      } | ${formatNullableSigned(row.brierDelta)} | ${formatNullableSigned(row.calibrationErrorDelta)} | ${row.targetFile} | ${row.implementationStatus} |`,
    ),
  ];
}

function renderSkippedTable(rows: DefaultPlanReport["skippedRows"]) {
  if (rows.length === 0) {
    return ["No skipped validation rows."];
  }
  return [
    "| Proposal | Mode | Bucket | Recommendation | Reason |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map((row) =>
      `| ${escapeMarkdownCell(row.proposalId)} | ${row.validationMode ?? ""} | ${escapeMarkdownCell(row.bucketLabel)} | ${
        escapeMarkdownCell(row.recommendation)
      } | ${row.reason} |`,
    ),
  ];
}

function readValidationRow(value: CalibrationGuardValidationRow): ValidationRow[] {
  const proposalId = value.proposalId;
  const sourceCandidateGuardId = value.sourceCandidateGuardId;
  const bucketLabel = value.bucketLabel;
  const suggestedAdjustment = value.suggestedAdjustment;
  const recommendation = value.recommendation;
  if (
    !proposalId ||
    !sourceCandidateGuardId ||
    !bucketLabel ||
    suggestedAdjustment === null ||
    !isCalibrationGuardValidationRecommendation(recommendation)
  ) {
    return [];
  }
  return [{
    validationMode: value.validationMode,
    proposalId,
    sourceCandidateGuardId,
    bucketLabel,
    suggestedAdjustment,
    matchedRows: value.matchedRows,
    brierDelta: value.brierDelta,
    calibrationErrorDelta: value.calibrationErrorDelta,
    recommendation,
  }];
}

function roundMetric(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatNullableNumber(value: number | null) {
  return value === null ? "" : String(value);
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
