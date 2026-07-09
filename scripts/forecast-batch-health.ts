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

type BatchPhase = "forecast_ops" | "forecast_resolution" | "forecast_performance";
type ReviewStatus = "open" | "reviewed" | "deferred";

type HealthStatus = "healthy" | "watch" | "needs_attention";

type HealthIssue = {
  severity: "high" | "medium" | "low";
  kind: string;
  message: string;
};

type HealthReport = {
  reportType: "forecast_batch_health";
  generatedAt: string;
  batchId: string | null;
  status: HealthStatus;
  summary: {
    entries: number;
    forecastOps: number;
    resolutions: number;
    performanceReports: number;
    completedForecasts: number;
    failedForecasts: number;
    resolvedCases: number;
    failedResolutions: number;
    performanceScoreRows: number | null;
    attentionItems: number;
    openAttentionItems: number;
    deferredAttentionItems: number;
    reviewedAttentionItems: number;
    unresolvedAttentionItems: number;
    scoreRegressionItems: number;
  };
  missingPhases: BatchPhase[];
  issues: HealthIssue[];
  attentionItems: HealthAttentionItem[];
  paths: {
    json: string;
    markdown: string;
    batchIndex: string | null;
    batchIndexDir: string;
  };
};

type HealthAttentionItem = {
  id: string;
  reviewStatus: ReviewStatus;
  severity: string;
  kind: string;
  reason: string;
  recommendedAction: string | null;
  metric: string;
  score: number | null;
  delta: number | null;
  taskId: string | null;
  taskLabel: string | null;
};

const expectedPhases: BatchPhase[] = ["forecast_ops", "forecast_resolution", "forecast_performance"];
const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const batchIndexDir = resolve(root, readArgValue(args, "--batch-index-dir") ?? "data/reports/forecast-batches");
const outputDir = resolve(root, readArgValue(args, "--out-dir") ?? "data/reports/forecast-batch-health");
const requestedBatchId = readArgValue(args, "--batch-id") ?? null;
const jsonPath = resolve(outputDir, "batch-health.json");
const markdownPath = resolve(outputDir, "batch-health.md");

const selected = await selectBatchIndex(batchIndexDir, requestedBatchId);
const report = selected
  ? buildHealthReport(selected.payload, selected.path, batchIndexDir, jsonPath, markdownPath)
  : buildEmptyReport(batchIndexDir, jsonPath, markdownPath, requestedBatchId);

await mkdir(outputDir, { recursive: true });
await writeJson(jsonPath, report);
await writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(`Batch health: ${report.status}`);
console.log(`Batch: ${report.batchId ?? "none"}`);
console.log(`Output: ${jsonPath}`);
if (report.missingPhases.length > 0) {
  console.log(`Missing phases: ${report.missingPhases.join(", ")}`);
}
console.log(
  `Attention: ${report.summary.unresolvedAttentionItems} unresolved (${report.summary.openAttentionItems} open, ${report.summary.deferredAttentionItems} deferred)`,
);
console.log(`Score regressions: ${report.summary.scoreRegressionItems}`);
for (const issue of report.issues) {
  console.log(`${issue.severity.toUpperCase()} ${issue.kind}: ${issue.message}`);
}

async function selectBatchIndex(batchRoot: string, batchId: string | null) {
  const paths = await listFilesNamed(batchRoot, "batch-index.json");
  const candidates: { path: string; payload: JsonRecord; batchId: string; generatedAt: string | null }[] = [];
  for (const path of paths) {
    const payload = readRecord(await readJson(path));
    const candidateBatchId = readString(payload, "batchId");
    if (!payload || !candidateBatchId || (batchId && candidateBatchId !== batchId)) {
      continue;
    }
    candidates.push({
      path,
      payload,
      batchId: candidateBatchId,
      generatedAt: readString(payload, "generatedAt"),
    });
  }
  candidates.sort((left, right) =>
    timestampValue(right.generatedAt) - timestampValue(left.generatedAt)
    || right.batchId.localeCompare(left.batchId)
    || right.path.localeCompare(left.path)
  );
  return candidates[0] ?? null;
}

function buildHealthReport(
  batchIndex: JsonRecord,
  batchIndexPath: string,
  sourceDir: string,
  reportJsonPath: string,
  reportMarkdownPath: string,
): HealthReport {
  const batchId = readString(batchIndex, "batchId");
  const counts = readRecord(batchIndex, "counts") ?? {};
  const attentionItems = readRecordArray(batchIndex, "attentionItems").flatMap(readHealthAttentionItem);
  const summary = {
    entries: readNumber(counts, "entries") ?? 0,
    forecastOps: readNumber(counts, "forecastOps") ?? 0,
    resolutions: readNumber(counts, "resolutions") ?? 0,
    performanceReports: readNumber(counts, "performanceReports") ?? 0,
    completedForecasts: readNumber(counts, "completedForecasts") ?? 0,
    failedForecasts: readNumber(counts, "failedForecasts") ?? 0,
    resolvedCases: readNumber(counts, "resolvedCases") ?? 0,
    failedResolutions: readNumber(counts, "failedResolutions") ?? 0,
    performanceScoreRows: readNumber(counts, "performanceScoreRows"),
    attentionItems: readNumber(counts, "attentionItems") ?? attentionItems.length,
    openAttentionItems: readNumber(counts, "openAttentionItems") ?? countStatus(attentionItems, "open"),
    deferredAttentionItems: readNumber(counts, "deferredAttentionItems") ?? countStatus(attentionItems, "deferred"),
    reviewedAttentionItems: readNumber(counts, "reviewedAttentionItems") ?? countStatus(attentionItems, "reviewed"),
    unresolvedAttentionItems: 0,
    scoreRegressionItems: countScoreRegressions(attentionItems),
  };
  summary.unresolvedAttentionItems = summary.openAttentionItems + summary.deferredAttentionItems;
  const missingPhases = expectedPhases.filter((phase) => countPhase(summary, phase) === 0);
  const issues = buildIssues(summary, missingPhases);
  return {
    reportType: "forecast_batch_health",
    generatedAt: new Date().toISOString(),
    batchId,
    status: healthStatus(issues),
    summary,
    missingPhases,
    issues,
    attentionItems: sortAttentionItems(attentionItems),
    paths: {
      json: reportJsonPath,
      markdown: reportMarkdownPath,
      batchIndex: batchIndexPath,
      batchIndexDir: sourceDir,
    },
  };
}

function buildEmptyReport(
  sourceDir: string,
  reportJsonPath: string,
  reportMarkdownPath: string,
  requestedBatchId: string | null,
): HealthReport {
  const issueMessage = requestedBatchId
    ? `No batch index found for batchId=${requestedBatchId}`
    : "No batch index files found";
  return {
    reportType: "forecast_batch_health",
    generatedAt: new Date().toISOString(),
    batchId: requestedBatchId,
    status: "needs_attention",
    summary: {
      entries: 0,
      forecastOps: 0,
      resolutions: 0,
      performanceReports: 0,
      completedForecasts: 0,
      failedForecasts: 0,
      resolvedCases: 0,
      failedResolutions: 0,
      performanceScoreRows: null,
      attentionItems: 0,
      openAttentionItems: 0,
      deferredAttentionItems: 0,
      reviewedAttentionItems: 0,
      unresolvedAttentionItems: 0,
      scoreRegressionItems: 0,
    },
    missingPhases: expectedPhases,
    issues: [{ severity: "high", kind: "missing_batch_index", message: issueMessage }],
    attentionItems: [],
    paths: {
      json: reportJsonPath,
      markdown: reportMarkdownPath,
      batchIndex: null,
      batchIndexDir: sourceDir,
    },
  };
}

function buildIssues(summary: HealthReport["summary"], missingPhases: BatchPhase[]): HealthIssue[] {
  const issues: HealthIssue[] = [];
  for (const phase of missingPhases) {
    issues.push({ severity: "high", kind: "missing_phase", message: `Missing ${phase} artifact in the batch index.` });
  }
  if (summary.failedForecasts > 0) {
    issues.push({ severity: "high", kind: "failed_forecasts", message: `${summary.failedForecasts} forecast run(s) failed.` });
  }
  if (summary.failedResolutions > 0) {
    issues.push({ severity: "high", kind: "failed_resolutions", message: `${summary.failedResolutions} resolution update(s) failed.` });
  }
  if (summary.unresolvedAttentionItems > 0) {
    issues.push({
      severity: summary.openAttentionItems > 0 ? "high" : "medium",
      kind: "unresolved_attention",
      message: `${summary.unresolvedAttentionItems} attention item(s) remain open or deferred.`,
    });
  }
  if (summary.scoreRegressionItems > 0) {
    issues.push({
      severity: "medium",
      kind: "score_regression",
      message: `${summary.scoreRegressionItems} attention item(s) indicate worsening score trends.`,
    });
  }
  if (summary.performanceReports > 0 && summary.performanceScoreRows === 0) {
    issues.push({ severity: "medium", kind: "empty_performance_report", message: "Performance report has zero score rows." });
  }
  return issues;
}

function readHealthAttentionItem(item: JsonRecord): HealthAttentionItem[] {
  const id = readString(item, "id");
  const reviewStatus = readString(item, "reviewStatus");
  if (!id || !isReviewStatus(reviewStatus)) {
    return [];
  }
  const actions = readStringArray(item, "recommendedActions");
  return [{
    id,
    reviewStatus,
    severity: readString(item, "severity") ?? "medium",
    kind: readString(item, "kind") ?? "attention_item",
    reason: readString(item, "reason") ?? "",
    recommendedAction: actions[0] ?? null,
    metric: readString(item, "metric") ?? "metric",
    score: readNumber(item, "score"),
    delta: readNumber(item, "delta"),
    taskId: readString(item, "taskId"),
    taskLabel: readString(item, "taskLabel"),
  }];
}

function renderMarkdown(report: HealthReport) {
  const lines = [
    `# Forecast Batch Health${report.batchId ? `: ${report.batchId}` : ""}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `Batch index: ${report.paths.batchIndex ?? "missing"}`,
    "",
    "## Summary",
    "",
    `- Entries: ${report.summary.entries}`,
    `- Forecast ops artifacts: ${report.summary.forecastOps}`,
    `- Resolution artifacts: ${report.summary.resolutions}`,
    `- Performance artifacts: ${report.summary.performanceReports}`,
    `- Completed forecasts: ${report.summary.completedForecasts}`,
    `- Failed forecasts: ${report.summary.failedForecasts}`,
    `- Resolved cases: ${report.summary.resolvedCases}`,
    `- Failed resolutions: ${report.summary.failedResolutions}`,
    `- Performance score rows: ${report.summary.performanceScoreRows ?? "unknown"}`,
    `- Unresolved attention items: ${report.summary.unresolvedAttentionItems}`,
    `- Score regression items: ${report.summary.scoreRegressionItems}`,
    "",
    "## Issues",
    "",
    ...renderIssues(report.issues),
    "",
    "## Attention Items",
    "",
    ...renderAttentionTable(report.attentionItems),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderIssues(issues: HealthIssue[]) {
  if (issues.length === 0) {
    return ["No health issues detected."];
  }
  return [
    "| Severity | Kind | Message |",
    "| --- | --- | --- |",
    ...issues.map((issue) => `| ${issue.severity} | ${issue.kind} | ${escapeMarkdownCell(issue.message)} |`),
  ];
}

function renderAttentionTable(items: HealthAttentionItem[]) {
  if (items.length === 0) {
    return ["No attention items found."];
  }
  return [
    "| Status | Severity | Kind | Metric | Score | Delta | Task | Recommended action |",
    "| --- | --- | --- | --- | ---: | ---: | --- | --- |",
    ...items.map((item) =>
      `| ${item.reviewStatus} | ${item.severity} | ${item.kind} | ${item.metric} | ${formatNumber(item.score)} | ${
        formatNumber(item.delta)
      } | ${escapeMarkdownCell(item.taskLabel ?? item.taskId ?? "")} | ${escapeMarkdownCell(item.recommendedAction ?? "")} |`,
    ),
  ];
}

function sortAttentionItems(items: HealthAttentionItem[]) {
  return [...items].sort((left, right) =>
    statusRank(left.reviewStatus) - statusRank(right.reviewStatus)
    || severityRank(left.severity) - severityRank(right.severity)
    || left.id.localeCompare(right.id)
  );
}

function countPhase(summary: HealthReport["summary"], phase: BatchPhase) {
  if (phase === "forecast_ops") {
    return summary.forecastOps;
  }
  if (phase === "forecast_resolution") {
    return summary.resolutions;
  }
  return summary.performanceReports;
}

function countStatus(items: HealthAttentionItem[], status: ReviewStatus) {
  return items.filter((item) => item.reviewStatus === status).length;
}

function countScoreRegressions(items: HealthAttentionItem[]) {
  return items.filter((item) => item.kind.includes("regression") || (item.delta ?? 0) > 0).length;
}

function readRecordArray(value: unknown, key: string) {
  const raw = readRecord(value)?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is JsonRecord => Boolean(readRecord(item))) : [];
}

function readStringArray(value: unknown, key: string) {
  const raw = readRecord(value)?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

function readNumber(value: unknown, key: string) {
  const raw = readRecord(value)?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function healthStatus(issues: HealthIssue[]): HealthStatus {
  if (issues.some((issue) => issue.severity === "high")) {
    return "needs_attention";
  }
  if (issues.length > 0) {
    return "watch";
  }
  return "healthy";
}

function statusRank(status: ReviewStatus) {
  if (status === "open") {
    return 0;
  }
  if (status === "deferred") {
    return 1;
  }
  return 2;
}

function severityRank(severity: string) {
  if (severity === "high") {
    return 0;
  }
  if (severity === "medium") {
    return 1;
  }
  if (severity === "low") {
    return 2;
  }
  return 3;
}

function timestampValue(value: string | null) {
  if (!value) {
    return 0;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number | null) {
  return value === null ? "" : String(Math.round(value * 10_000) / 10_000);
}

function isReviewStatus(value: string | undefined | null): value is ReviewStatus {
  return value === "open" || value === "reviewed" || value === "deferred";
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|");
}
