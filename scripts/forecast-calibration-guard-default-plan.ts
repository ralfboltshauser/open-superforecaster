import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  listFilesNamed,
  readArgValue,
  readJson,
  readRecord,
  readString,
  type JsonRecord,
  writeJson,
} from "./lib/forecast-script-utils";

type ValidationRecommendation = "promote_for_holdout" | "promote_for_default" | "needs_more_evidence" | "reject";

type ValidationRow = {
  validationMode: string | null;
  proposalId: string;
  sourceCandidateGuardId: string;
  bucketLabel: string;
  suggestedAdjustment: number;
  matchedRows: number | null;
  brierDelta: number | null;
  calibrationErrorDelta: number | null;
  recommendation: ValidationRecommendation;
};

type DefaultPlanCandidate = {
  proposalId: string;
  sourceCandidateGuardId: string;
  bucketLabel: string;
  suggestedAdjustment: number;
  matchedRows: number | null;
  brierDelta: number | null;
  calibrationErrorDelta: number | null;
  targetWorkflowId: "binary-calibration-guard";
  targetFile: "packages/workflows/src/binary-calibration-guard.ts";
  implementationStatus: "manual_review_required";
  recommendedAction: string;
  acceptanceCriteria: string[];
};

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
    reason: "not_holdout_replay" | "not_promoted_for_default";
  }[];
  paths: {
    json: string;
    markdown: string;
    validationReport: string | null;
    validationReportDir: string | null;
  };
};

type DefaultPlanIssue = {
  severity: "medium";
  kind: "validation_report_timestamp_missing" | "validation_report_stale";
  message: string;
  validationReport: string | null;
  latestValidationReport: string | null;
};

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const validationReportArg = readArgValue(args, "--validation-report");
const validationReportDirArg = readArgValue(args, "--validation-report-dir") ?? "data/reports/forecast-calibration-guard-validation";
const validationReportDir = resolve(root, validationReportDirArg);
const latestValidationReport = await latestValidationReportCandidate(validationReportDir);
const validationReportPath = validationReportArg
  ? resolve(root, validationReportArg)
  : latestValidationReport?.path ?? null;
const outputDir = resolve(root, readArgValue(args, "--out-dir") ?? "data/reports/forecast-calibration-guard-default-plan");
const jsonPath = resolve(outputDir, "calibration-guard-default-plan.json");
const markdownPath = resolve(outputDir, "calibration-guard-default-plan.md");

const validationPayload = validationReportPath ? await readOptionalRecord(validationReportPath) : null;
const report = buildDefaultPlanReport({
  validationReportPath,
  validationReportDir: validationReportArg ? null : validationReportDir,
  latestValidationReportPath: latestValidationReport?.path ?? null,
  latestValidationReportGeneratedAt: latestValidationReport?.generatedAt ?? null,
  validationPayload,
  jsonPath,
  markdownPath,
});

await mkdir(outputDir, { recursive: true });
await writeJson(jsonPath, report);
await writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(`Calibration guard default candidates: ${report.summary.defaultCandidates}`);
console.log(`Validation report: ${report.paths.validationReport ?? "none"}`);
console.log(`Output: ${jsonPath}`);

async function latestValidationReportCandidate(validationRoot: string) {
  const paths = await listFilesNamed(validationRoot, "calibration-guard-validation.json");
  const candidates: { path: string; generatedAt: string | null }[] = [];
  for (const path of paths) {
    const payload = await readOptionalRecord(path);
    if (!payload) {
      continue;
    }
    candidates.push({ path, generatedAt: readString(payload, "generatedAt") });
  }
  candidates.sort((left, right) => timestampValue(right.generatedAt) - timestampValue(left.generatedAt) || right.path.localeCompare(left.path));
  return candidates[0] ?? null;
}

async function readOptionalRecord(path: string) {
  try {
    return readRecord(await readJson(path));
  } catch {
    return null;
  }
}

function buildDefaultPlanReport(input: {
  validationReportPath: string | null;
  validationReportDir: string | null;
  latestValidationReportPath: string | null;
  latestValidationReportGeneratedAt: string | null;
  validationPayload: JsonRecord | null;
  jsonPath: string;
  markdownPath: string;
}): DefaultPlanReport {
  const validationRows = readRecordArray(input.validationPayload, "validations").flatMap(readValidationRow);
  const issues = defaultPlanIssues(input);
  const defaultCandidates = validationRows
    .filter((row) => row.validationMode === "holdout_replay" && row.recommendation === "promote_for_default")
    .map(buildDefaultCandidate);
  const skippedRows = validationRows
    .filter((row) => row.validationMode !== "holdout_replay" || row.recommendation !== "promote_for_default")
    .map((row) => ({
      proposalId: row.proposalId,
      bucketLabel: row.bucketLabel,
      recommendation: row.recommendation,
      validationMode: row.validationMode,
      reason: row.validationMode !== "holdout_replay" ? "not_holdout_replay" as const : "not_promoted_for_default" as const,
    }));
  return {
    reportType: "forecast_calibration_guard_default_plan",
    generatedAt: new Date().toISOString(),
    summary: {
      validationRows: validationRows.length,
      defaultCandidates: defaultCandidates.length,
      skippedNonHoldout: skippedRows.filter((row) => row.reason === "not_holdout_replay").length,
      skippedNotPromoted: skippedRows.filter((row) => row.reason === "not_promoted_for_default").length,
      issues: issues.length,
    },
    issues,
    defaultCandidates,
    skippedRows,
    paths: {
      json: input.jsonPath,
      markdown: input.markdownPath,
      validationReport: input.validationPayload ? input.validationReportPath : null,
      validationReportDir: input.validationReportDir,
    },
  };
}

function defaultPlanIssues(input: {
  validationReportPath: string | null;
  latestValidationReportPath: string | null;
  latestValidationReportGeneratedAt: string | null;
  validationPayload: JsonRecord | null;
}): DefaultPlanIssue[] {
  if (!input.validationPayload) {
    return [];
  }
  const issues: DefaultPlanIssue[] = [];
  const validationGeneratedAt = readString(input.validationPayload, "generatedAt");
  const validationTimestamp = timestampValue(validationGeneratedAt);
  const latestTimestamp = timestampValue(input.latestValidationReportGeneratedAt);
  if (validationTimestamp === 0) {
    issues.push({
      severity: "medium",
      kind: "validation_report_timestamp_missing",
      message: "Selected calibration validation report has no parseable generatedAt timestamp; review before using default-plan output.",
      validationReport: input.validationReportPath,
      latestValidationReport: input.latestValidationReportPath,
    });
  }
  if (validationTimestamp > 0 && latestTimestamp > 0 && latestTimestamp > validationTimestamp) {
    issues.push({
      severity: "medium",
      kind: "validation_report_stale",
      message: "Selected calibration validation report is older than the latest validation report in the configured directory.",
      validationReport: input.validationReportPath,
      latestValidationReport: input.latestValidationReportPath,
    });
  }
  return issues;
}

function buildDefaultCandidate(row: ValidationRow): DefaultPlanCandidate {
  const adjustment = formatSignedNumber(row.suggestedAdjustment);
  return {
    proposalId: row.proposalId,
    sourceCandidateGuardId: row.sourceCandidateGuardId,
    bucketLabel: row.bucketLabel,
    suggestedAdjustment: row.suggestedAdjustment,
    matchedRows: row.matchedRows,
    brierDelta: row.brierDelta,
    calibrationErrorDelta: row.calibrationErrorDelta,
    targetWorkflowId: "binary-calibration-guard",
    targetFile: "packages/workflows/src/binary-calibration-guard.ts",
    implementationStatus: "manual_review_required",
    recommendedAction:
      `Review and, if still appropriate, add a deterministic ${row.bucketLabel} calibration guard with a ${adjustment} percentage-point adjustment.`,
    acceptanceCriteria: [
      "Validation row came from a held-out replay.",
      "Held-out Brier score improved versus the baseline aggregate.",
      "Held-out bucket calibration error did not regress.",
      "Runtime guard tests cover the exact bucket boundary and adjustment.",
      "The rule can be disabled or revised if later resolved batches regress.",
    ],
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

function readValidationRow(value: JsonRecord): ValidationRow[] {
  const proposalId = readString(value, "proposalId");
  const sourceCandidateGuardId = readString(value, "sourceCandidateGuardId");
  const bucketLabel = readString(value, "bucketLabel");
  const suggestedAdjustment = readNumber(value, "suggestedAdjustment");
  const recommendation = readString(value, "recommendation");
  if (
    !proposalId ||
    !sourceCandidateGuardId ||
    !bucketLabel ||
    suggestedAdjustment === null ||
    !isValidationRecommendation(recommendation)
  ) {
    return [];
  }
  return [{
    validationMode: readString(value, "validationMode"),
    proposalId,
    sourceCandidateGuardId,
    bucketLabel,
    suggestedAdjustment,
    matchedRows: readNumber(value, "matchedRows"),
    brierDelta: readNumber(value, "brierDelta"),
    calibrationErrorDelta: readNumber(value, "calibrationErrorDelta"),
    recommendation,
  }];
}

function isValidationRecommendation(value: string | null): value is ValidationRecommendation {
  return value === "promote_for_holdout" || value === "promote_for_default" || value === "needs_more_evidence" || value === "reject";
}

function readRecordArray(value: unknown, key: string) {
  const record = readRecord(value);
  const raw = record?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is JsonRecord => Boolean(readRecord(item))) : [];
}

function readNumber(value: unknown, key: string) {
  const raw = readRecord(value)?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function timestampValue(value: string | null) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
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
