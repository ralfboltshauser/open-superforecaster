import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  isAttentionReviewStatus,
  loadAttentionReviews,
  type AttentionReviewRecord,
  type AttentionReviewStatus,
} from "./lib/forecast-attention-reviews";
import {
  listFilesNamed,
  readArgValue,
  readArgValues,
  readJson,
  readRecord,
  readString,
  type JsonRecord,
  writeJson,
} from "./lib/forecast-script-utils";

type ReviewStatus = AttentionReviewStatus;

type AttentionReview = AttentionReviewRecord;

type BacklogItem = {
  batchId: string;
  id: string;
  reviewStatus: ReviewStatus;
  severity: string;
  kind: string;
  reason: string;
  recommendedActions: string[];
  metric: string;
  score: number | null;
  delta: number | null;
  taskId: string | null;
  taskLabel: string | null;
  forecastType: string | null;
  reviewNote?: string;
  reviewer?: string;
  reviewedAt?: string;
  sourcePath: string;
};

type BacklogBreakdownCounts = {
  items: number;
  open: number;
  deferred: number;
  reviewed: number;
  high: number;
  medium: number;
  low: number;
};

type ForecastTypeBreakdown = BacklogBreakdownCounts & {
  forecastType: string;
};

type KindBreakdown = BacklogBreakdownCounts & {
  kind: string;
};

type BacklogReport = {
  reportType: "forecast_attention_backlog";
  generatedAt: string;
  filters: {
    statuses: ReviewStatus[];
    batchIds: string[];
  };
  counts: {
    items: number;
    open: number;
    deferred: number;
    reviewed: number;
    high: number;
    medium: number;
    low: number;
  };
  byForecastType: ForecastTypeBreakdown[];
  byKind: KindBreakdown[];
  items: BacklogItem[];
  paths: {
    json: string;
    markdown: string;
    batchIndexDir: string;
    validationReportDir: string;
    defaultPlanReportDir: string;
    reviews: string;
  };
};

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const batchIndexDir = resolve(root, readArgValue(args, "--batch-index-dir") ?? "data/reports/forecast-batches");
const validationReportDir = resolve(root, readArgValue(args, "--validation-report-dir") ?? "data/reports/forecast-calibration-guard-validation");
const defaultPlanReportDir = resolve(root, readArgValue(args, "--default-plan-report-dir") ?? "data/reports/forecast-calibration-guard-default-plan");
const reviewsFile = resolve(root, readArgValue(args, "--reviews-file") ?? "data/reports/forecast-attention-reviews.json");
const outputDir = resolve(root, readArgValue(args, "--out-dir") ?? "data/reports/forecast-attention-backlog");
const requestedStatuses = readArgValues(args, "--status");
const statusFilters = requestedStatuses.length > 0 ? requestedStatuses : ["open", "deferred"];
const batchFilters = readArgValues(args, "--batch-id");
const statuses = statusFilters.map((status) => {
  if (!isReviewStatus(status)) {
    throw new Error(`Unsupported --status ${status}. Expected open, reviewed, or deferred.`);
  }
  return status;
});

const jsonPath = resolve(outputDir, "attention-backlog.json");
const markdownPath = resolve(outputDir, "attention-backlog.md");
const reviewsByItemId = await loadAttentionReviews(reviewsFile);
const items = await readBacklogItems(batchIndexDir, validationReportDir, defaultPlanReportDir, statuses, new Set(batchFilters), reviewsByItemId);
const report = buildReport(items, statuses, batchFilters, jsonPath, markdownPath, batchIndexDir, validationReportDir, defaultPlanReportDir, reviewsFile);

await mkdir(outputDir, { recursive: true });
await writeJson(jsonPath, report);
await writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(`Attention backlog: ${report.counts.items} item(s) written to ${jsonPath}`);
console.log(`Statuses: ${report.filters.statuses.join(", ")}`);
if (report.filters.batchIds.length > 0) {
  console.log(`Batches: ${report.filters.batchIds.join(", ")}`);
}
for (const item of report.items.slice(0, 20)) {
  const task = item.taskLabel ?? item.taskId ?? "unknown task";
  console.log(`${item.reviewStatus.toUpperCase()} ${item.severity} ${item.batchId} ${item.id}: ${task}`);
}
if (report.items.length > 20) {
  console.log(`... ${report.items.length - 20} more item(s)`);
}

async function readBacklogItems(
  batchRoot: string,
  validationRoot: string,
  defaultPlanRoot: string,
  statuses: ReviewStatus[],
  batchIds: Set<string>,
  reviewsByItemId: Map<string, AttentionReview>,
) {
  const paths = await listFilesNamed(batchRoot, "batch-index.json");
  const items: BacklogItem[] = [];
  for (const path of paths) {
    const payload = readRecord(await readJson(path));
    if (!payload) {
      continue;
    }
    const batchId = readString(payload, "batchId");
    if (!batchId || (batchIds.size > 0 && !batchIds.has(batchId))) {
      continue;
    }
    for (const item of readRecordArray(payload, "attentionItems")) {
      const rawBacklogItem = readBacklogItem(item, batchId, path);
      const backlogItem = rawBacklogItem ? withReview(rawBacklogItem, reviewsByItemId.get(rawBacklogItem.id)) : null;
      if (backlogItem && statuses.includes(backlogItem.reviewStatus)) {
        items.push(backlogItem);
      }
    }
    for (const rule of readRecordArray(payload, "candidateCalibrationGuardRules")) {
      const rawBacklogItem = readCandidateCalibrationGuardBacklogItem(rule, batchId, path);
      const backlogItem = rawBacklogItem ? withReview(rawBacklogItem, reviewsByItemId.get(rawBacklogItem.id)) : null;
      if (backlogItem && statuses.includes(backlogItem.reviewStatus)) {
        items.push(backlogItem);
      }
    }
  }
  const validationPaths = await listFilesNamed(validationRoot, "calibration-guard-validation.json");
  for (const path of validationPaths) {
    const payload = readRecord(await readJson(path));
    if (!payload) {
      continue;
    }
    for (const validation of readRecordArray(payload, "validations")) {
      const rawBacklogItem = readCalibrationGuardValidationBacklogItem(validation, path);
      const backlogItem = rawBacklogItem ? withReview(rawBacklogItem, reviewsByItemId.get(rawBacklogItem.id)) : null;
      if (backlogItem && statuses.includes(backlogItem.reviewStatus) && (batchIds.size === 0 || batchIds.has(backlogItem.batchId))) {
        items.push(backlogItem);
      }
    }
  }
  const defaultPlanPaths = await listFilesNamed(defaultPlanRoot, "calibration-guard-default-plan.json");
  for (const path of defaultPlanPaths) {
    const payload = readRecord(await readJson(path));
    if (!payload) {
      continue;
    }
    for (const skipped of readRecordArray(payload, "skippedRows")) {
      const rawBacklogItem = readCalibrationGuardDefaultPlanSkippedBacklogItem(skipped, path);
      const backlogItem = rawBacklogItem ? withReview(rawBacklogItem, reviewsByItemId.get(rawBacklogItem.id)) : null;
      if (backlogItem && statuses.includes(backlogItem.reviewStatus) && (batchIds.size === 0 || batchIds.has(backlogItem.batchId))) {
        items.push(backlogItem);
      }
    }
  }
  return sortBacklog(items);
}

function readBacklogItem(item: JsonRecord, batchId: string, sourcePath: string): BacklogItem | null {
  const id = readString(item, "id");
  const reviewStatus = readString(item, "reviewStatus");
  if (!id || !isReviewStatus(reviewStatus)) {
    return null;
  }
  return {
    batchId,
    id,
    reviewStatus,
    severity: readString(item, "severity") ?? "medium",
    kind: readString(item, "kind") ?? "attention_item",
    reason: readString(item, "reason") ?? "",
    recommendedActions: readStringArray(item, "recommendedActions"),
    metric: readString(item, "metric") ?? "metric",
    score: readNumber(item, "score"),
    delta: readNumber(item, "delta"),
    taskId: readString(item, "taskId"),
    taskLabel: readString(item, "taskLabel"),
    forecastType: readString(item, "forecastType"),
    reviewNote: readString(item, "reviewNote") ?? undefined,
    reviewer: readString(item, "reviewer") ?? undefined,
    reviewedAt: readString(item, "reviewedAt") ?? undefined,
    sourcePath,
  };
}

function withReview(item: BacklogItem, review: AttentionReview | undefined): BacklogItem {
  if (!review) {
    return item;
  }
  return {
    ...item,
    reviewStatus: review.status,
    reviewNote: review.note,
    reviewer: review.reviewer,
    reviewedAt: review.updatedAt,
  };
}

function readCandidateCalibrationGuardBacklogItem(item: JsonRecord, batchId: string, sourcePath: string): BacklogItem | null {
  const id = readString(item, "id");
  const reviewStatus = readString(item, "reviewStatus");
  if (!id || !isReviewStatus(reviewStatus)) {
    return null;
  }
  const bucketLabel = readString(item, "bucketLabel") ?? "calibration bucket";
  const direction = readString(item, "direction") ?? "calibration_drift";
  const activationStatus = readString(item, "activationStatus") ?? "needs_review";
  const suggestedAdjustment = readNumber(item, "suggestedAdjustment");
  return {
    batchId,
    id,
    reviewStatus,
    severity: activationStatus === "ready_for_review" ? "high" : "medium",
    kind: "candidate_calibration_guard",
    reason: readString(item, "rationale") ?? `${bucketLabel} has ${direction} and needs calibration guard review.`,
    recommendedActions: [
      `Review candidate ${bucketLabel} guard${suggestedAdjustment === null ? "" : ` (${formatSignedNumber(suggestedAdjustment)} pts)`} before changing live calibration.`,
    ],
    metric: "calibration_error",
    score: readNumber(item, "calibrationError"),
    delta: suggestedAdjustment,
    taskId: null,
    taskLabel: `${bucketLabel} candidate calibration guard`,
    forecastType: "binary",
    reviewNote: readString(item, "reviewNote") ?? undefined,
    reviewer: readString(item, "reviewer") ?? undefined,
    reviewedAt: readString(item, "reviewedAt") ?? undefined,
    sourcePath,
  };
}

function readCalibrationGuardValidationBacklogItem(item: JsonRecord, sourcePath: string): BacklogItem | null {
  const proposalId = readString(item, "proposalId");
  const recommendation = readString(item, "recommendation");
  if (!proposalId || !recommendation || recommendation === "reject") {
    return null;
  }
  const batchId = batchIdFromProposalId(proposalId) ?? "unknown-batch";
  const bucketLabel = readString(item, "bucketLabel") ?? "calibration bucket";
  const brierDelta = readNumber(item, "brierDelta");
  const calibrationErrorDelta = readNumber(item, "calibrationErrorDelta");
  const matchedRows = readNumber(item, "matchedRows");
  return {
    batchId,
    id: `calibration-validation:${proposalId}`,
    reviewStatus: "open",
    severity: recommendation === "promote_for_holdout" || recommendation === "promote_for_default" ? "high" : "medium",
    kind: kindForCalibrationValidationRecommendation(recommendation),
    reason: `${bucketLabel} calibration guard validation recommendation: ${recommendation}.`,
    recommendedActions: recommendedActionsForCalibrationValidation(recommendation, bucketLabel),
    metric: "validation_brier_delta",
    score: brierDelta,
    delta: calibrationErrorDelta,
    taskId: null,
    taskLabel: `${bucketLabel} validation (${matchedRows === null ? "unknown" : String(matchedRows)} rows)`,
    forecastType: "binary",
    sourcePath,
  };
}

function kindForCalibrationValidationRecommendation(recommendation: string) {
  if (recommendation === "promote_for_default") {
    return "calibration_guard_default_candidate";
  }
  if (recommendation === "promote_for_holdout") {
    return "calibration_guard_holdout_candidate";
  }
  return "calibration_guard_needs_more_evidence";
}

function recommendedActionsForCalibrationValidation(recommendation: string, bucketLabel: string) {
  if (recommendation === "promote_for_default") {
    return [`Run forecast:calibration-default-plan, then review this held-out ${bucketLabel} validation before enabling the calibration guard as a default.`];
  }
  if (recommendation === "promote_for_holdout") {
    return [`Run a held-out resolved batch before enabling this ${bucketLabel} calibration guard candidate.`];
  }
  return [`Collect more resolved binary forecasts before acting on this ${bucketLabel} calibration guard candidate.`];
}

function readCalibrationGuardDefaultPlanSkippedBacklogItem(item: JsonRecord, sourcePath: string): BacklogItem | null {
  const proposalId = readString(item, "proposalId");
  const reason = readString(item, "reason");
  if (!proposalId || !reason) {
    return null;
  }
  const batchId = batchIdFromProposalId(proposalId) ?? "unknown-batch";
  const bucketLabel = readString(item, "bucketLabel") ?? "calibration bucket";
  const recommendation = readString(item, "recommendation") ?? "unknown";
  const validationMode = readString(item, "validationMode") ?? "unknown";
  return {
    batchId,
    id: `calibration-default-plan-skipped:${proposalId}`,
    reviewStatus: "open",
    severity: reason === "not_holdout_replay" ? "low" : "medium",
    kind: `calibration_guard_default_plan_${reason}`,
    reason: `${bucketLabel} default-plan row skipped: ${reason} (${validationMode}, ${recommendation}).`,
    recommendedActions: recommendedActionsForDefaultPlanSkipped(reason, bucketLabel),
    metric: "default_plan_skip",
    score: null,
    delta: null,
    taskId: null,
    taskLabel: `${bucketLabel} default-plan skip`,
    forecastType: "binary",
    sourcePath,
  };
}

function recommendedActionsForDefaultPlanSkipped(reason: string, bucketLabel: string) {
  if (reason === "not_holdout_replay") {
    return [`Run a held-out calibration validation before considering ${bucketLabel} as a default calibration guard.`];
  }
  if (reason === "not_promoted_for_default") {
    return [`Keep ${bucketLabel} out of default calibration guards unless held-out validation improves both Brier score and calibration error.`];
  }
  return [`Review why ${bucketLabel} was skipped before changing calibration guard defaults.`];
}

function buildReport(
  items: BacklogItem[],
  statuses: ReviewStatus[],
  batchIds: string[],
  jsonPath: string,
  markdownPath: string,
  sourceDir: string,
  validationDir: string,
  defaultPlanDir: string,
  reviewPath: string,
): BacklogReport {
  return {
    reportType: "forecast_attention_backlog",
    generatedAt: new Date().toISOString(),
    filters: {
      statuses,
      batchIds,
    },
    counts: {
      items: items.length,
      open: countStatus(items, "open"),
      deferred: countStatus(items, "deferred"),
      reviewed: countStatus(items, "reviewed"),
      high: countSeverity(items, "high"),
      medium: countSeverity(items, "medium"),
      low: countSeverity(items, "low"),
    },
    byForecastType: summarizeByForecastType(items),
    byKind: summarizeByKind(items),
    items,
    paths: {
      json: jsonPath,
      markdown: markdownPath,
      batchIndexDir: sourceDir,
      validationReportDir: validationDir,
      defaultPlanReportDir: defaultPlanDir,
      reviews: reviewPath,
    },
  };
}

function renderMarkdown(report: BacklogReport) {
  const lines = [
    "# Forecast Attention Backlog",
    "",
    `Generated: ${report.generatedAt}`,
    `Statuses: ${report.filters.statuses.join(", ")}`,
    `Batches: ${report.filters.batchIds.length > 0 ? report.filters.batchIds.join(", ") : "all"}`,
    "",
    "## Counts",
    "",
    `- Items: ${report.counts.items}`,
    `- Open: ${report.counts.open}`,
    `- Deferred: ${report.counts.deferred}`,
    `- Reviewed: ${report.counts.reviewed}`,
    `- High severity: ${report.counts.high}`,
    `- Medium severity: ${report.counts.medium}`,
    `- Low severity: ${report.counts.low}`,
    "",
    "## Forecast Types",
    "",
    ...renderForecastTypeTable(report.byForecastType),
    "",
    "## Kinds",
    "",
    ...renderKindTable(report.byKind),
    "",
    "## Items",
    "",
    ...renderItemsTable(report.items),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderForecastTypeTable(rows: ForecastTypeBreakdown[]) {
  if (rows.length === 0) {
    return ["No forecast type counts matched the filters."];
  }
  return [
    "| Forecast type | Items | Open | Deferred | Reviewed | High | Medium | Low |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) =>
      `| ${escapeMarkdownCell(row.forecastType)} | ${row.items} | ${row.open} | ${row.deferred} | ${row.reviewed} | ${row.high} | ${row.medium} | ${row.low} |`,
    ),
  ];
}

function renderKindTable(rows: KindBreakdown[]) {
  if (rows.length === 0) {
    return ["No kind counts matched the filters."];
  }
  return [
    "| Kind | Items | Open | Deferred | Reviewed | High | Medium | Low |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) =>
      `| ${escapeMarkdownCell(row.kind)} | ${row.items} | ${row.open} | ${row.deferred} | ${row.reviewed} | ${row.high} | ${row.medium} | ${row.low} |`,
    ),
  ];
}

function renderItemsTable(items: BacklogItem[]) {
  if (items.length === 0) {
    return ["No attention items matched the filters."];
  }
  return [
    "| Status | Severity | Batch | Kind | Forecast type | Metric | Score | Delta | Task | Reason | Recommended action | Note | Source |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |",
    ...items.map((item) =>
      `| ${item.reviewStatus} | ${item.severity} | ${item.batchId} | ${item.kind} | ${item.forecastType ?? "unknown"} | ${item.metric} | ${formatNumber(item.score)} | ${
        formatNumber(item.delta)
      } | ${escapeMarkdownCell(item.taskLabel ?? item.taskId ?? "")} | ${escapeMarkdownCell(item.reason)} | ${escapeMarkdownCell(item.recommendedActions[0] ?? "")} | ${
        escapeMarkdownCell(item.reviewNote ?? "")
      } | ${escapeMarkdownCell(item.sourcePath)} |`,
    ),
  ];
}

function sortBacklog(items: BacklogItem[]) {
  return [...items].sort((left, right) =>
    statusRank(left.reviewStatus) - statusRank(right.reviewStatus)
    || severityRank(left.severity) - severityRank(right.severity)
    || left.batchId.localeCompare(right.batchId)
    || (left.taskLabel ?? left.taskId ?? "").localeCompare(right.taskLabel ?? right.taskId ?? "")
    || left.id.localeCompare(right.id)
  );
}

function readRecordArray(value: unknown, key: string) {
  const record = readRecord(value);
  const raw = record?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is JsonRecord => Boolean(readRecord(item))) : [];
}

function readStringArray(value: unknown, key: string) {
  const record = readRecord(value);
  const raw = record?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

function readNumber(value: unknown, key: string) {
  const raw = readRecord(value)?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function batchIdFromProposalId(proposalId: string) {
  const match = /^calibration-guard-proposal:([^:]+):/.exec(proposalId);
  return match?.[1] ?? null;
}

function countStatus(items: BacklogItem[], status: ReviewStatus) {
  return items.filter((item) => item.reviewStatus === status).length;
}

function countSeverity(items: BacklogItem[], severity: string) {
  return items.filter((item) => item.severity === severity).length;
}

function summarizeByForecastType(items: BacklogItem[]) {
  return summarizeBacklogGroups(items, (item) => item.forecastType ?? "unknown").map((row) => ({
    forecastType: row.key,
    ...row.counts,
  }));
}

function summarizeByKind(items: BacklogItem[]) {
  return summarizeBacklogGroups(items, (item) => item.kind || "unknown").map((row) => ({
    kind: row.key,
    ...row.counts,
  }));
}

function summarizeBacklogGroups(items: BacklogItem[], keyFor: (item: BacklogItem) => string) {
  const grouped = new Map<string, BacklogItem[]>();
  for (const item of items) {
    const key = keyFor(item);
    const rows = grouped.get(key);
    if (rows) {
      rows.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }
  return [...grouped.entries()]
    .map(([key, rows]) => ({
      key,
      counts: countBreakdown(rows),
    }))
    .sort(
      (left, right) =>
        right.counts.items - left.counts.items
        || right.counts.high - left.counts.high
        || right.counts.medium - left.counts.medium
        || left.key.localeCompare(right.key),
    );
}

function countBreakdown(items: BacklogItem[]): BacklogBreakdownCounts {
  return {
    items: items.length,
    open: countStatus(items, "open"),
    deferred: countStatus(items, "deferred"),
    reviewed: countStatus(items, "reviewed"),
    high: countSeverity(items, "high"),
    medium: countSeverity(items, "medium"),
    low: countSeverity(items, "low"),
  };
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

function formatNumber(value: number | null) {
  return value === null ? "" : String(Math.round(value * 10_000) / 10_000);
}

function formatSignedNumber(value: number) {
  const formatted = formatNumber(value);
  return value >= 0 ? `+${formatted}` : formatted;
}

function isReviewStatus(value: string | undefined | null): value is ReviewStatus {
  return isAttentionReviewStatus(value);
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|");
}
