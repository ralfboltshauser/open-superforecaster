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

type SelectedAttentionBacklog = {
  path: string;
  payload: JsonRecord;
  generatedAt: string | null;
};

type AttentionKindBreakdown = {
  kind: string;
  items: number;
  open: number;
  deferred: number;
  reviewed: number;
  high: number;
  medium: number;
  low: number;
};

type AttentionSeverityBreakdown = {
  severity: string;
  items: number;
  open: number;
  deferred: number;
  reviewed: number;
};

type AttentionForecastTypeBreakdown = {
  forecastType: string;
  items: number;
  open: number;
  deferred: number;
  reviewed: number;
  high: number;
  medium: number;
  low: number;
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
    calibrationGuardRegressionItems: number;
    candidateCalibrationGuardRules: number;
    openCandidateCalibrationGuardRules: number;
    deferredCandidateCalibrationGuardRules: number;
    reviewedCandidateCalibrationGuardRules: number;
    unresolvedCandidateCalibrationGuardRules: number;
  };
  missingPhases: BatchPhase[];
  issues: HealthIssue[];
  attentionByKind: AttentionKindBreakdown[];
  attentionBySeverity: AttentionSeverityBreakdown[];
  attentionByForecastType: AttentionForecastTypeBreakdown[];
  attentionItems: HealthAttentionItem[];
  candidateCalibrationGuardRules: HealthCandidateCalibrationGuardRule[];
  paths: {
    json: string;
    markdown: string;
    batchIndex: string | null;
    batchIndexDir: string;
    attentionBacklog: string | null;
    attentionBacklogDir: string;
  };
};

type HealthAttentionItem = {
  id: string;
  reviewStatus: ReviewStatus;
  severity: string;
  kind: string;
  reason: string;
  recommendedAction: string | null;
  reviewNote: string | null;
  reviewer: string | null;
  reviewedAt: string | null;
  metric: string;
  score: number | null;
  delta: number | null;
  forecastType: string;
  taskId: string | null;
  taskLabel: string | null;
  sourcePath: string | null;
};

type HealthCandidateCalibrationGuardRule = {
  id: string;
  reviewStatus: ReviewStatus;
  bucketLabel: string;
  direction: string;
  suggestedAdjustment: number | null;
  sampleSize: number | null;
  meanForecast: number | null;
  observedRate: number | null;
  calibrationError: number | null;
  activationStatus: string;
  rationale: string;
  reviewNote: string | null;
  reviewer: string | null;
  reviewedAt: string | null;
};

const expectedPhases: BatchPhase[] = ["forecast_ops", "forecast_resolution", "forecast_performance"];
const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const batchIndexDir = resolve(root, readArgValue(args, "--batch-index-dir") ?? "data/reports/forecast-batches");
const attentionBacklogDir = resolve(root, readArgValue(args, "--attention-backlog-dir") ?? "data/reports/forecast-attention-backlog");
const outputDir = resolve(root, readArgValue(args, "--out-dir") ?? "data/reports/forecast-batch-health");
const requestedBatchId = readArgValue(args, "--batch-id") ?? null;
const jsonPath = resolve(outputDir, "batch-health.json");
const markdownPath = resolve(outputDir, "batch-health.md");

const selected = await selectBatchIndex(batchIndexDir, requestedBatchId);
const selectedAttentionBacklog = await selectAttentionBacklog(attentionBacklogDir);
const report = selected
  ? buildHealthReport(selected.payload, selected.path, selectedAttentionBacklog, batchIndexDir, attentionBacklogDir, jsonPath, markdownPath)
  : buildEmptyReport(batchIndexDir, attentionBacklogDir, selectedAttentionBacklog?.path ?? null, jsonPath, markdownPath, requestedBatchId);

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

async function selectAttentionBacklog(backlogRoot: string): Promise<SelectedAttentionBacklog | null> {
  const paths = await listFilesNamed(backlogRoot, "attention-backlog.json");
  const candidates: { path: string; payload: JsonRecord; generatedAt: string | null }[] = [];
  for (const path of paths) {
    const payload = readRecord(await readJson(path));
    if (!payload) {
      continue;
    }
    candidates.push({
      path,
      payload,
      generatedAt: readString(payload, "generatedAt"),
    });
  }
  candidates.sort((left, right) =>
    timestampValue(right.generatedAt) - timestampValue(left.generatedAt)
    || right.path.localeCompare(left.path)
  );
  return candidates[0] ?? null;
}

function buildHealthReport(
  batchIndex: JsonRecord,
  batchIndexPath: string,
  attentionBacklog: SelectedAttentionBacklog | null,
  sourceDir: string,
  backlogDir: string,
  reportJsonPath: string,
  reportMarkdownPath: string,
): HealthReport {
  const batchId = readString(batchIndex, "batchId");
  const counts = readRecord(batchIndex, "counts") ?? {};
  const batchAttentionItems = readRecordArray(batchIndex, "attentionItems").flatMap((item) => readHealthAttentionItem(item, batchIndexPath));
  const candidateCalibrationGuardRules = readRecordArray(batchIndex, "candidateCalibrationGuardRules").flatMap(readHealthCandidateCalibrationGuardRule);
  const batchIndexGeneratedAt = readString(batchIndex, "generatedAt");
  const attentionBacklogIssues = attentionBacklog ? attentionBacklogCompatibilityIssues(attentionBacklog, batchId, batchIndexGeneratedAt) : [];
  const compatibleAttentionBacklog = attentionBacklog && attentionBacklogIssues.length === 0 ? attentionBacklog : null;
  const attentionItems = mergeSupplementalAttentionItems(
    batchAttentionItems,
    candidateCalibrationGuardRules,
    readSupplementalAttentionItems(compatibleAttentionBacklog, batchId),
  );
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
    attentionItems: attentionItems.length,
    openAttentionItems: countStatus(attentionItems, "open"),
    deferredAttentionItems: countStatus(attentionItems, "deferred"),
    reviewedAttentionItems: countStatus(attentionItems, "reviewed"),
    unresolvedAttentionItems: 0,
    scoreRegressionItems: countScoreRegressions(attentionItems),
    calibrationGuardRegressionItems: countCalibrationGuardRegressions(attentionItems),
    candidateCalibrationGuardRules: readNumber(counts, "candidateCalibrationGuardRules") ?? candidateCalibrationGuardRules.length,
    openCandidateCalibrationGuardRules: readNumber(counts, "openCandidateCalibrationGuardRules") ?? countCandidateRuleStatus(candidateCalibrationGuardRules, "open"),
    deferredCandidateCalibrationGuardRules: readNumber(counts, "deferredCandidateCalibrationGuardRules") ?? countCandidateRuleStatus(candidateCalibrationGuardRules, "deferred"),
    reviewedCandidateCalibrationGuardRules: readNumber(counts, "reviewedCandidateCalibrationGuardRules") ?? countCandidateRuleStatus(candidateCalibrationGuardRules, "reviewed"),
    unresolvedCandidateCalibrationGuardRules: 0,
  };
  summary.unresolvedAttentionItems = summary.openAttentionItems + summary.deferredAttentionItems;
  summary.unresolvedCandidateCalibrationGuardRules = summary.openCandidateCalibrationGuardRules + summary.deferredCandidateCalibrationGuardRules;
  const missingPhases = expectedPhases.filter((phase) => countPhase(summary, phase) === 0);
  const attentionByKind = summarizeAttentionByKind(attentionItems);
  const attentionBySeverity = summarizeAttentionBySeverity(attentionItems);
  const attentionByForecastType = summarizeAttentionByForecastType(attentionItems);
  const issues = buildIssues(summary, missingPhases, attentionByKind, attentionBacklogIssues);
  return {
    reportType: "forecast_batch_health",
    generatedAt: new Date().toISOString(),
    batchId,
    status: healthStatus(issues),
    summary,
    missingPhases,
    issues,
    attentionByKind,
    attentionBySeverity,
    attentionByForecastType,
    attentionItems: sortAttentionItems(attentionItems),
    candidateCalibrationGuardRules: sortCandidateCalibrationGuardRules(candidateCalibrationGuardRules),
    paths: {
      json: reportJsonPath,
      markdown: reportMarkdownPath,
      batchIndex: batchIndexPath,
      batchIndexDir: sourceDir,
      attentionBacklog: attentionBacklog?.path ?? null,
      attentionBacklogDir: backlogDir,
    },
  };
}

function buildEmptyReport(
  sourceDir: string,
  backlogDir: string,
  attentionBacklogPath: string | null,
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
      calibrationGuardRegressionItems: 0,
      candidateCalibrationGuardRules: 0,
      openCandidateCalibrationGuardRules: 0,
      deferredCandidateCalibrationGuardRules: 0,
      reviewedCandidateCalibrationGuardRules: 0,
      unresolvedCandidateCalibrationGuardRules: 0,
    },
    missingPhases: expectedPhases,
    issues: [{ severity: "high", kind: "missing_batch_index", message: issueMessage }],
    attentionByKind: [],
    attentionBySeverity: [],
    attentionByForecastType: [],
    attentionItems: [],
    candidateCalibrationGuardRules: [],
    paths: {
      json: reportJsonPath,
      markdown: reportMarkdownPath,
      batchIndex: null,
      batchIndexDir: sourceDir,
      attentionBacklog: attentionBacklogPath,
      attentionBacklogDir: backlogDir,
    },
  };
}

function buildIssues(
  summary: HealthReport["summary"],
  missingPhases: BatchPhase[],
  attentionByKind: AttentionKindBreakdown[],
  attentionBacklogIssues: HealthIssue[] = [],
): HealthIssue[] {
  const issues: HealthIssue[] = [...attentionBacklogIssues];
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
    const topKinds = attentionByKind
      .filter((row) => row.open + row.deferred > 0)
      .slice(0, 3)
      .map((row) => `${row.kind}=${row.open + row.deferred}`)
      .join(", ");
    issues.push({
      severity: summary.openAttentionItems > 0 ? "high" : "medium",
      kind: "unresolved_attention",
      message: `${summary.unresolvedAttentionItems} attention item(s) remain open or deferred${topKinds ? ` (${topKinds})` : ""}.`,
    });
  }
  if (summary.scoreRegressionItems > 0) {
    issues.push({
      severity: "medium",
      kind: "score_regression",
      message: `${summary.scoreRegressionItems} attention item(s) indicate worsening score trends.`,
    });
  }
  if (summary.calibrationGuardRegressionItems > 0) {
    issues.push({
      severity: "high",
      kind: "calibration_guard_regression",
      message: `${summary.calibrationGuardRegressionItems} attention item(s) indicate guarded forecasts are scoring worse than unguarded forecasts.`,
    });
  }
  if (summary.unresolvedCandidateCalibrationGuardRules > 0) {
    issues.push({
      severity: summary.openCandidateCalibrationGuardRules > 0 ? "high" : "medium",
      kind: "candidate_calibration_guard_review",
      message: `${summary.unresolvedCandidateCalibrationGuardRules} candidate calibration guard rule(s) remain open or deferred.`,
    });
  }
  if (summary.performanceReports > 0 && summary.performanceScoreRows === 0) {
    issues.push({ severity: "medium", kind: "empty_performance_report", message: "Performance report has zero score rows." });
  }
  return issues;
}

function attentionBacklogCompatibilityIssues(
  attentionBacklog: SelectedAttentionBacklog,
  batchId: string | null,
  batchIndexGeneratedAt: string | null,
): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const backlog = attentionBacklog.payload;
  const filters = readRecord(backlog, "filters");
  const statuses = readStringArray(filters, "statuses");
  const batchIds = readStringArray(filters, "batchIds");
  const batchTimestamp = timestampValue(batchIndexGeneratedAt);
  const backlogTimestamp = timestampValue(attentionBacklog.generatedAt);
  if (backlogTimestamp === 0) {
    issues.push({
      severity: "medium",
      kind: "attention_backlog_timestamp_missing",
      message: "Attention backlog has no parseable generatedAt timestamp and was not merged into health counts.",
    });
  }
  if (batchTimestamp > 0 && backlogTimestamp > 0 && backlogTimestamp < batchTimestamp) {
    issues.push({
      severity: "medium",
      kind: "attention_backlog_stale",
      message: `Attention backlog was generated before selected batch ${batchId ?? "unknown"} and was not merged into health counts.`,
    });
  }
  const missingStatuses = ["open", "deferred"].filter((status) => !statuses.includes(status));
  if (statuses.length > 0 && missingStatuses.length > 0) {
    issues.push({
      severity: "medium",
      kind: "attention_backlog_status_filter",
      message: `Attention backlog was generated without ${missingStatuses.join(" and ")} item(s), so supplemental unresolved attention was not merged.`,
    });
  }
  if (batchId && batchIds.length > 0 && !batchIds.includes(batchId)) {
    issues.push({
      severity: "medium",
      kind: "attention_backlog_batch_filter",
      message: `Attention backlog was generated for ${batchIds.join(", ")} and does not cover selected batch ${batchId}.`,
    });
  }
  return issues;
}

function readHealthAttentionItem(item: JsonRecord, fallbackSourcePath: string | null = null): HealthAttentionItem[] {
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
    reviewNote: readString(item, "reviewNote"),
    reviewer: readString(item, "reviewer"),
    reviewedAt: readString(item, "reviewedAt"),
    metric: readString(item, "metric") ?? "metric",
    score: readNumber(item, "score"),
    delta: readNumber(item, "delta"),
    forecastType: readString(item, "forecastType") ?? "unknown",
    taskId: readString(item, "taskId"),
    taskLabel: readString(item, "taskLabel"),
    sourcePath: readString(item, "sourcePath") ?? fallbackSourcePath,
  }];
}

function readSupplementalAttentionItems(
  attentionBacklog: { path: string; payload: JsonRecord } | null,
  batchId: string | null,
): HealthAttentionItem[] {
  if (!attentionBacklog || !batchId) {
    return [];
  }
  return readRecordArray(attentionBacklog.payload, "items")
    .filter((item) => readString(item, "batchId") === batchId)
    .flatMap((item) => readHealthAttentionItem(item, attentionBacklog.path));
}

function mergeSupplementalAttentionItems(
  baseItems: HealthAttentionItem[],
  candidateRules: HealthCandidateCalibrationGuardRule[],
  supplementalItems: HealthAttentionItem[],
) {
  const seen = new Set([
    ...baseItems.map((item) => item.id),
    ...candidateRules.map((rule) => rule.id),
  ]);
  const merged = [...baseItems];
  for (const item of supplementalItems) {
    if (item.kind === "candidate_calibration_guard" || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    merged.push(item);
  }
  return merged;
}

function readHealthCandidateCalibrationGuardRule(item: JsonRecord): HealthCandidateCalibrationGuardRule[] {
  const id = readString(item, "id");
  const reviewStatus = readString(item, "reviewStatus");
  if (!id || !isReviewStatus(reviewStatus)) {
    return [];
  }
  return [{
    id,
    reviewStatus,
    bucketLabel: readString(item, "bucketLabel") ?? "bucket",
    direction: readString(item, "direction") ?? "calibration_drift",
    suggestedAdjustment: readNumber(item, "suggestedAdjustment"),
    sampleSize: readNumber(item, "sampleSize"),
    meanForecast: readNumber(item, "meanForecast"),
    observedRate: readNumber(item, "observedRate"),
    calibrationError: readNumber(item, "calibrationError"),
    activationStatus: readString(item, "activationStatus") ?? "needs_review",
    rationale: readString(item, "rationale") ?? "",
    reviewNote: readString(item, "reviewNote"),
    reviewer: readString(item, "reviewer"),
    reviewedAt: readString(item, "reviewedAt"),
  }];
}

function renderMarkdown(report: HealthReport) {
  const lines = [
    `# Forecast Batch Health${report.batchId ? `: ${report.batchId}` : ""}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `Batch index: ${report.paths.batchIndex ?? "missing"}`,
    `Attention backlog: ${report.paths.attentionBacklog ?? "missing"}`,
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
    `- Calibration guard regression items: ${report.summary.calibrationGuardRegressionItems}`,
    `- Candidate calibration guard rules: ${report.summary.candidateCalibrationGuardRules}`,
    `- Unresolved candidate calibration guard rules: ${report.summary.unresolvedCandidateCalibrationGuardRules}`,
    "",
    "## Attention Breakdown",
    "",
    ...renderAttentionKindBreakdown(report.attentionByKind),
    "",
    "## Attention Severity",
    "",
    ...renderAttentionSeverityBreakdown(report.attentionBySeverity),
    "",
    "## Attention Forecast Types",
    "",
    ...renderAttentionForecastTypeBreakdown(report.attentionByForecastType),
    "",
    "## Issues",
    "",
    ...renderIssues(report.issues),
    "",
    "## Attention Items",
    "",
    ...renderAttentionTable(report.attentionItems),
    "",
    "## Candidate Calibration Guard Rules",
    "",
    ...renderCandidateCalibrationGuardTable(report.candidateCalibrationGuardRules),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderAttentionKindBreakdown(rows: AttentionKindBreakdown[]) {
  if (rows.length === 0) {
    return ["No attention kind breakdown available."];
  }
  return [
    "| Kind | Items | Open | Deferred | Reviewed | High | Medium | Low |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) =>
      `| ${escapeMarkdownCell(row.kind)} | ${row.items} | ${row.open} | ${row.deferred} | ${row.reviewed} | ${row.high} | ${row.medium} | ${row.low} |`,
    ),
  ];
}

function renderAttentionSeverityBreakdown(rows: AttentionSeverityBreakdown[]) {
  if (rows.length === 0) {
    return ["No attention severity breakdown available."];
  }
  return [
    "| Severity | Items | Open | Deferred | Reviewed |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...rows.map((row) =>
      `| ${escapeMarkdownCell(row.severity)} | ${row.items} | ${row.open} | ${row.deferred} | ${row.reviewed} |`,
    ),
  ];
}

function renderAttentionForecastTypeBreakdown(rows: AttentionForecastTypeBreakdown[]) {
  if (rows.length === 0) {
    return ["No attention forecast-type breakdown available."];
  }
  return [
    "| Forecast type | Items | Open | Deferred | Reviewed | High | Medium | Low |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) =>
      `| ${escapeMarkdownCell(row.forecastType)} | ${row.items} | ${row.open} | ${row.deferred} | ${row.reviewed} | ${row.high} | ${row.medium} | ${row.low} |`,
    ),
  ];
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
    "| Status | Severity | Kind | Forecast type | Metric | Score | Delta | Task | Recommended action | Review note | Source |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- |",
    ...items.map((item) =>
      `| ${item.reviewStatus} | ${item.severity} | ${item.kind} | ${item.forecastType} | ${item.metric} | ${formatNumber(item.score)} | ${
        formatNumber(item.delta)
      } | ${escapeMarkdownCell(item.taskLabel ?? item.taskId ?? "")} | ${escapeMarkdownCell(item.recommendedAction ?? "")} | ${
        escapeMarkdownCell(item.reviewNote ?? "")
      } | ${escapeMarkdownCell(item.sourcePath ?? "")} |`,
    ),
  ];
}

function renderCandidateCalibrationGuardTable(items: HealthCandidateCalibrationGuardRule[]) {
  if (items.length === 0) {
    return ["No candidate calibration guard rules found."];
  }
  return [
    "| Status | Bucket | Direction | Adjustment | Sample size | Forecast | Observed | Error | Activation | Review note |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...items.map((item) =>
      `| ${item.reviewStatus} | ${escapeMarkdownCell(item.bucketLabel)} | ${item.direction} | ${
        formatNumber(item.suggestedAdjustment)
      } | ${formatNumber(item.sampleSize)} | ${formatNumber(item.meanForecast)} | ${formatNumber(item.observedRate)} | ${
        formatNumber(item.calibrationError)
      } | ${escapeMarkdownCell(item.activationStatus)} | ${escapeMarkdownCell(item.reviewNote ?? "")} |`,
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

function sortCandidateCalibrationGuardRules(items: HealthCandidateCalibrationGuardRule[]) {
  return [...items].sort((left, right) =>
    statusRank(left.reviewStatus) - statusRank(right.reviewStatus)
    || severityRank(left.activationStatus === "ready_for_review" ? "high" : "medium") - severityRank(right.activationStatus === "ready_for_review" ? "high" : "medium")
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

function countCandidateRuleStatus(items: HealthCandidateCalibrationGuardRule[], status: ReviewStatus) {
  return items.filter((item) => item.reviewStatus === status).length;
}

function countScoreRegressions(items: HealthAttentionItem[]) {
  return items.filter((item) =>
    item.reviewStatus !== "reviewed" &&
    (item.kind === "forecast_score_regression" || item.kind === "worsening_trend")
  ).length;
}

function countCalibrationGuardRegressions(items: HealthAttentionItem[]) {
  return items.filter((item) => item.reviewStatus !== "reviewed" && item.kind === "calibration_guard_regression").length;
}

function summarizeAttentionByKind(items: HealthAttentionItem[]): AttentionKindBreakdown[] {
  return [...groupBy(items, (item) => item.kind).entries()]
    .map(([kind, rows]) => ({
      kind,
      items: rows.length,
      open: countStatus(rows, "open"),
      deferred: countStatus(rows, "deferred"),
      reviewed: countStatus(rows, "reviewed"),
      high: countSeverity(rows, "high"),
      medium: countSeverity(rows, "medium"),
      low: countSeverity(rows, "low"),
    }))
    .sort((left, right) =>
      (right.open + right.deferred) - (left.open + left.deferred)
      || severityRank(left.high > 0 ? "high" : left.medium > 0 ? "medium" : "low") - severityRank(right.high > 0 ? "high" : right.medium > 0 ? "medium" : "low")
      || left.kind.localeCompare(right.kind)
    );
}

function summarizeAttentionBySeverity(items: HealthAttentionItem[]): AttentionSeverityBreakdown[] {
  return [...groupBy(items, (item) => item.severity).entries()]
    .map(([severity, rows]) => ({
      severity,
      items: rows.length,
      open: countStatus(rows, "open"),
      deferred: countStatus(rows, "deferred"),
      reviewed: countStatus(rows, "reviewed"),
    }))
    .sort((left, right) => severityRank(left.severity) - severityRank(right.severity) || left.severity.localeCompare(right.severity));
}

function summarizeAttentionByForecastType(items: HealthAttentionItem[]): AttentionForecastTypeBreakdown[] {
  return [...groupBy(items, (item) => item.forecastType).entries()]
    .map(([forecastType, rows]) => ({
      forecastType,
      items: rows.length,
      open: countStatus(rows, "open"),
      deferred: countStatus(rows, "deferred"),
      reviewed: countStatus(rows, "reviewed"),
      high: countSeverity(rows, "high"),
      medium: countSeverity(rows, "medium"),
      low: countSeverity(rows, "low"),
    }))
    .sort((left, right) =>
      (right.open + right.deferred) - (left.open + left.deferred)
      || severityRank(left.high > 0 ? "high" : left.medium > 0 ? "medium" : "low") - severityRank(right.high > 0 ? "high" : right.medium > 0 ? "medium" : "low")
      || left.forecastType.localeCompare(right.forecastType)
    );
}

function countSeverity(items: HealthAttentionItem[], severity: string) {
  return items.filter((item) => item.severity === severity).length;
}

function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const rows = grouped.get(key) ?? [];
    rows.push(item);
    grouped.set(key, rows);
  }
  return grouped;
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
