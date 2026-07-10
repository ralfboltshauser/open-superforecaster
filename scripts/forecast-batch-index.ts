import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { loadAttentionReviews, type AttentionReviewRecord } from "./lib/forecast-attention-reviews";
import {
  defaultForecastAttentionReviewStatus,
  summarizeForecastAttentionReviewStatuses,
} from "../packages/backend/src/forecast-attention-policy";
import {
  readForecastPerformanceArtifact,
  type ForecastPerformanceAttentionItem,
  type ForecastPerformanceCandidateCalibrationGuardRule,
  type ForecastPerformanceSummary,
} from "../packages/backend/src/forecast-performance-artifacts";
import {
  readArgValue,
  readJson,
  readRecord,
  readString,
  safeSegment,
  type JsonRecord,
  writeJson,
} from "./lib/forecast-script-utils";

type BatchPhase = "forecast_ops" | "forecast_resolution" | "forecast_performance" | "unknown";

type BatchEntry = {
  batchId: string;
  phase: BatchPhase;
  path: string;
  reportType?: string;
  createdAt?: string;
  summary: JsonRecord;
  attentionItems: AttentionItem[];
  candidateCalibrationGuardRules: CandidateCalibrationGuardRule[];
};

type AttentionItem = ForecastPerformanceAttentionItem & { id: string };

type AttentionReview = AttentionReviewRecord;

type ReviewedAttentionItem = AttentionItem & {
  reviewStatus: AttentionReview["status"];
  reviewNote?: string;
  reviewer?: string;
  reviewedAt?: string;
};

type CandidateCalibrationGuardRule = ForecastPerformanceCandidateCalibrationGuardRule & { id: string };

type ReviewedCandidateCalibrationGuardRule = CandidateCalibrationGuardRule & {
  reviewStatus: AttentionReview["status"];
  reviewNote?: string;
  reviewer?: string;
  reviewedAt?: string;
};

type BatchAudit = {
  batchId: string;
  generatedAt: string;
  entries: BatchEntry[];
  counts: {
    entries: number;
    forecastOps: number;
    resolutions: number;
    performanceReports: number;
    plannedForecasts: number;
    completedForecasts: number;
    failedForecasts: number;
    plannedResolutions: number;
    resolvedCases: number;
    failedResolutions: number;
    performanceScoreRows: number | null;
    attentionItems: number;
    openAttentionItems: number;
    reviewedAttentionItems: number;
    deferredAttentionItems: number;
    unresolvedAttentionItems: number;
    candidateCalibrationGuardRules: number;
    openCandidateCalibrationGuardRules: number;
    reviewedCandidateCalibrationGuardRules: number;
    deferredCandidateCalibrationGuardRules: number;
    unresolvedCandidateCalibrationGuardRules: number;
  };
  attentionItems: ReviewedAttentionItem[];
  candidateCalibrationGuardRules: ReviewedCandidateCalibrationGuardRule[];
  paths: {
    json: string;
    markdown: string;
    reviews: string;
  };
};

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const requestedBatchId = readArgValue(args, "--batch-id") ?? null;
const outputRoot = resolve(root, readArgValue(args, "--out-dir") ?? "data/reports/forecast-batches");
const reviewsPath = resolve(root, readArgValue(args, "--reviews-file") ?? "data/reports/forecast-attention-reviews.json");
const scanRoots = [
  resolve(root, readArgValue(args, "--ops-dir") ?? "data/forecast-ops"),
  resolve(root, readArgValue(args, "--resolutions-dir") ?? "data/resolutions"),
  resolve(root, readArgValue(args, "--performance-dir") ?? "data/reports/forecast-performance"),
];

const discoveredEntries = await discoverEntries(scanRoots);
const reviewsByItemId = await loadAttentionReviews(reviewsPath);
const entriesByBatch = groupEntries(discoveredEntries);
const selectedBatchIds = requestedBatchId ? [requestedBatchId] : [...entriesByBatch.keys()].sort();

if (selectedBatchIds.length === 0) {
  throw new Error("No forecast batch manifests found.");
}

const audits: BatchAudit[] = [];
for (const batchId of selectedBatchIds) {
  const entries = entriesByBatch.get(batchId) ?? [];
  if (entries.length === 0) {
    throw new Error(`No forecast batch entries found for batchId=${batchId}`);
  }
  const batchDir = resolve(outputRoot, safeSegment(batchId));
  await mkdir(batchDir, { recursive: true });
  const jsonPath = resolve(batchDir, "batch-index.json");
  const markdownPath = resolve(batchDir, "batch-index.md");
  const audit = buildAudit(batchId, entries, jsonPath, markdownPath, reviewsPath, reviewsByItemId);
  await writeJson(jsonPath, audit);
  await writeFile(markdownPath, renderMarkdown(audit), "utf8");
  audits.push(audit);
}

console.log(`Indexed ${audits.length} forecast batch(es) into ${outputRoot}`);
for (const audit of audits) {
  console.log(
    `${audit.batchId}: ${audit.counts.entries} entries, ${audit.counts.completedForecasts} completed forecast(s), ${audit.counts.resolvedCases} resolved case(s)`,
  );
}

async function discoverEntries(roots: string[]) {
  const entries: BatchEntry[] = [];
  for (const scanRoot of roots) {
    const paths = await listJsonFiles(scanRoot);
    for (const path of paths) {
      const entry = await readBatchEntry(path);
      if (entry) {
        entries.push(entry);
      }
    }
  }
  return entries;
}

async function listJsonFiles(path: string): Promise<string[]> {
  try {
    const info = await stat(path);
    if (info.isFile()) {
      return path.endsWith(".json") ? [path] : [];
    }
    if (!info.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const children = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    children.map((child) => {
      const childPath = resolve(path, child.name);
      return child.isDirectory() ? listJsonFiles(childPath) : child.name.endsWith(".json") ? Promise.resolve([childPath]) : Promise.resolve([]);
    }),
  );
  return nested.flat();
}

async function readBatchEntry(path: string): Promise<BatchEntry | null> {
  const payload = readRecord(await readJson(path));
  if (!payload) {
    return null;
  }
  const batchId = readString(payload, "batchId");
  if (!batchId) {
    return null;
  }
  const reportType = readString(payload, "reportType") ?? undefined;
  const phase = normalizePhase(readString(payload, "phase"), reportType, path);
  const performance = phase === "forecast_performance" ? readForecastPerformanceArtifact(path, payload) : null;
  return {
    batchId,
    phase,
    path,
    reportType,
    createdAt: readString(payload, "createdAt") ?? readString(payload, "generatedAt") ?? undefined,
    summary: performance ? summarizePerformanceArtifact(performance.summary) : summarizePayload(phase, payload),
    attentionItems: performance ? performance.attentionItems.flatMap(withRequiredId) : [],
    candidateCalibrationGuardRules: performance ? performance.candidateCalibrationGuardRules.flatMap(withRequiredId) : [],
  };
}

function normalizePhase(phase: string | null, reportType: string | undefined, path: string): BatchPhase {
  if (phase === "forecast_ops" || phase === "forecast_resolution" || phase === "forecast_performance") {
    return phase;
  }
  if (reportType === "forecast_ops_run") {
    return "forecast_ops";
  }
  if (reportType === "forecast_resolution_run") {
    return "forecast_resolution";
  }
  if (reportType === "forecast_performance_report" || basename(path) === "forecast-performance.json") {
    return "forecast_performance";
  }
  return "unknown";
}

function summarizePayload(phase: BatchPhase, payload: JsonRecord): JsonRecord {
  if (phase === "forecast_ops") {
    const results = readRecordArray(payload, "results");
    return {
      cases: results.length,
      planned: countStatus(results, "planned"),
      completed: countStatus(results, "completed"),
      failed: countStatus(results, "failed"),
    };
  }
  if (phase === "forecast_resolution") {
    const results = readRecordArray(payload, "results");
    return {
      cases: results.length,
      planned: countStatus(results, "planned"),
      resolved: countStatus(results, "resolved"),
      failed: countStatus(results, "failed"),
    };
  }
  return {};
}

function summarizePerformanceArtifact(summary: ForecastPerformanceSummary): JsonRecord {
  return {
    resolvedTasks: summary.resolvedTasks,
    productScoreRows: summary.productScoreRows,
    aggregateScoreRows: summary.aggregateScoreRows,
    attemptScoreRows: summary.attemptScoreRows,
  };
}

function withRequiredId<T extends { id: string | null }>(item: T): Array<T & { id: string }> {
  return item.id ? [{ ...item, id: item.id }] : [];
}

function buildAudit(
  batchId: string,
  entries: BatchEntry[],
  jsonPath: string,
  markdownPath: string,
  reviewsFilePath: string,
  reviewsByItemId: Map<string, AttentionReview>,
): BatchAudit {
  const sortedEntries = [...entries].sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return leftTime - rightTime || left.path.localeCompare(right.path);
  });
  const attentionItems = sortedEntries
    .flatMap((entry) => entry.attentionItems)
    .map((item) => withReview(item, reviewsByItemId.get(item.id)));
  const candidateCalibrationGuardRules = sortedEntries
    .flatMap((entry) => entry.candidateCalibrationGuardRules)
    .map((rule) => withCandidateRuleReview(rule, reviewsByItemId.get(rule.id)));
  const attentionReviewCounts = summarizeForecastAttentionReviewStatuses(attentionItems);
  const candidateGuardReviewCounts = summarizeForecastAttentionReviewStatuses(candidateCalibrationGuardRules);
  return {
    batchId,
    generatedAt: new Date().toISOString(),
    entries: sortedEntries,
    counts: {
      entries: sortedEntries.length,
      forecastOps: countPhase(sortedEntries, "forecast_ops"),
      resolutions: countPhase(sortedEntries, "forecast_resolution"),
      performanceReports: countPhase(sortedEntries, "forecast_performance"),
      plannedForecasts: sumSummary(sortedEntries, "forecast_ops", "planned"),
      completedForecasts: sumSummary(sortedEntries, "forecast_ops", "completed"),
      failedForecasts: sumSummary(sortedEntries, "forecast_ops", "failed"),
      plannedResolutions: sumSummary(sortedEntries, "forecast_resolution", "planned"),
      resolvedCases: sumSummary(sortedEntries, "forecast_resolution", "resolved"),
      failedResolutions: sumSummary(sortedEntries, "forecast_resolution", "failed"),
      performanceScoreRows: latestNumberSummary(sortedEntries, "forecast_performance", "productScoreRows"),
      attentionItems: attentionItems.length,
      openAttentionItems: attentionReviewCounts.open,
      reviewedAttentionItems: attentionReviewCounts.reviewed,
      deferredAttentionItems: attentionReviewCounts.deferred,
      unresolvedAttentionItems: attentionReviewCounts.unresolved,
      candidateCalibrationGuardRules: candidateCalibrationGuardRules.length,
      openCandidateCalibrationGuardRules: candidateGuardReviewCounts.open,
      reviewedCandidateCalibrationGuardRules: candidateGuardReviewCounts.reviewed,
      deferredCandidateCalibrationGuardRules: candidateGuardReviewCounts.deferred,
      unresolvedCandidateCalibrationGuardRules: candidateGuardReviewCounts.unresolved,
    },
    attentionItems,
    candidateCalibrationGuardRules,
    paths: {
      json: jsonPath,
      markdown: markdownPath,
      reviews: reviewsFilePath,
    },
  };
}

function renderMarkdown(audit: BatchAudit) {
  const lines = [
    `# Forecast batch ${audit.batchId}`,
    "",
    `Generated: ${audit.generatedAt}`,
    "",
    "## Counts",
    "",
    `- Entries: ${audit.counts.entries}`,
    `- Forecast ops manifests: ${audit.counts.forecastOps}`,
    `- Resolution manifests: ${audit.counts.resolutions}`,
    `- Performance reports: ${audit.counts.performanceReports}`,
    `- Completed forecasts: ${audit.counts.completedForecasts}`,
    `- Resolved cases: ${audit.counts.resolvedCases}`,
    `- Performance score rows: ${audit.counts.performanceScoreRows ?? "unknown"}`,
    `- Attention items: ${audit.counts.attentionItems}`,
    `- Open attention items: ${audit.counts.openAttentionItems}`,
    `- Reviewed attention items: ${audit.counts.reviewedAttentionItems}`,
    `- Deferred attention items: ${audit.counts.deferredAttentionItems}`,
    `- Unresolved attention items: ${audit.counts.unresolvedAttentionItems}`,
    `- Candidate calibration guard rules: ${audit.counts.candidateCalibrationGuardRules}`,
    `- Open candidate calibration guard rules: ${audit.counts.openCandidateCalibrationGuardRules}`,
    `- Unresolved candidate calibration guard rules: ${audit.counts.unresolvedCandidateCalibrationGuardRules}`,
    "",
    "## Entries",
    "",
    "| Phase | Created | Summary | Path |",
    "| --- | --- | --- | --- |",
    ...audit.entries.map((entry) =>
      `| ${entry.phase} | ${entry.createdAt ?? ""} | ${escapeMarkdownCell(formatSummary(entry.summary))} | ${escapeMarkdownCell(entry.path)} |`,
    ),
    "",
    "## Attention Items",
    "",
    ...renderAttentionTable(audit.attentionItems),
    "",
    "## Candidate Calibration Guard Rules",
    "",
    ...renderCandidateCalibrationGuardTable(audit.candidateCalibrationGuardRules),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function withReview(item: AttentionItem, review: AttentionReview | undefined): ReviewedAttentionItem {
  return {
    ...item,
    reviewStatus: review?.status ?? defaultForecastAttentionReviewStatus,
    reviewNote: review?.note,
    reviewer: review?.reviewer,
    reviewedAt: review?.updatedAt,
  };
}

function withCandidateRuleReview(
  rule: CandidateCalibrationGuardRule,
  review: AttentionReview | undefined,
): ReviewedCandidateCalibrationGuardRule {
  return {
    ...rule,
    reviewStatus: review?.status ?? defaultForecastAttentionReviewStatus,
    reviewNote: review?.note,
    reviewer: review?.reviewer,
    reviewedAt: review?.updatedAt,
  };
}

function renderAttentionTable(items: ReviewedAttentionItem[]) {
  if (items.length === 0) {
    return ["No attention items found."];
  }
  return [
    "| Status | Severity | Kind | Forecast type | Metric | Score | Delta | Task | Reason | Recommended action | Note |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- |",
    ...items.map((item) =>
      `| ${item.reviewStatus} | ${item.severity} | ${item.kind} | ${item.forecastType ?? "unknown"} | ${item.metric} | ${formatNumber(item.score)} | ${formatNumber(item.delta)} | ${
        escapeMarkdownCell(item.taskLabel ?? item.taskId ?? "")
      } | ${escapeMarkdownCell(item.reason)} | ${escapeMarkdownCell(item.recommendedActions[0] ?? "")} | ${escapeMarkdownCell(item.reviewNote ?? "")} |`,
    ),
  ];
}

function renderCandidateCalibrationGuardTable(items: ReviewedCandidateCalibrationGuardRule[]) {
  if (items.length === 0) {
    return ["No candidate calibration guard rules found."];
  }
  return [
    "| Status | Bucket | Direction | Adjustment | Sample size | Forecast | Observed | Error | Activation | Note |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...items.map((item) =>
      `| ${item.reviewStatus} | ${escapeMarkdownCell(item.bucketLabel)} | ${item.direction} | ${formatNumber(item.suggestedAdjustment)} | ${
        formatNumber(item.sampleSize)
      } | ${formatNumber(item.meanForecast)} | ${formatNumber(item.observedRate)} | ${formatNumber(item.calibrationError)} | ${
        escapeMarkdownCell(item.activationStatus)
      } | ${escapeMarkdownCell(item.reviewNote ?? "")} |`,
    ),
  ];
}

function groupEntries(entries: BatchEntry[]) {
  const grouped = new Map<string, BatchEntry[]>();
  for (const entry of entries) {
    grouped.set(entry.batchId, [...(grouped.get(entry.batchId) ?? []), entry]);
  }
  return grouped;
}

function countPhase(entries: BatchEntry[], phase: BatchPhase) {
  return entries.filter((entry) => entry.phase === phase).length;
}

function sumSummary(entries: BatchEntry[], phase: BatchPhase, key: string) {
  return entries
    .filter((entry) => entry.phase === phase)
    .reduce((sum, entry) => sum + (readNumber(entry.summary, key) ?? 0), 0);
}

function latestNumberSummary(entries: BatchEntry[], phase: BatchPhase, key: string) {
  const candidates = entries.filter((entry) => entry.phase === phase);
  const latest = candidates[candidates.length - 1];
  return latest ? readNumber(latest.summary, key) : null;
}

function readRecordArray(value: unknown, key: string) {
  const record = readRecord(value);
  const raw = record?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is JsonRecord => Boolean(readRecord(item))) : [];
}

function countStatus(rows: JsonRecord[], status: string) {
  return rows.filter((row) => readString(row, "status") === status).length;
}

function readNumber(value: unknown, key: string) {
  const record = readRecord(value);
  const raw = record?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function formatSummary(summary: JsonRecord) {
  return Object.entries(summary)
    .map(([key, value]) => `${key}=${String(value ?? "unknown")}`)
    .join(", ");
}

function formatNumber(value: number | null) {
  return value === null ? "" : String(Math.round(value * 10_000) / 10_000);
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|");
}
