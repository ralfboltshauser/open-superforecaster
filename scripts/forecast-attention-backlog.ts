import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  readArgValue,
  readArgValues,
  readJson,
  readRecord,
  readString,
  type JsonRecord,
  writeJson,
} from "./lib/forecast-script-utils";

type ReviewStatus = "open" | "reviewed" | "deferred";

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
  items: BacklogItem[];
  paths: {
    json: string;
    markdown: string;
    batchIndexDir: string;
  };
};

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const batchIndexDir = resolve(root, readArgValue(args, "--batch-index-dir") ?? "data/reports/forecast-batches");
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
const items = await readBacklogItems(batchIndexDir, statuses, new Set(batchFilters));
const report = buildReport(items, statuses, batchFilters, jsonPath, markdownPath, batchIndexDir);

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

async function readBacklogItems(batchRoot: string, statuses: ReviewStatus[], batchIds: Set<string>) {
  const paths = await listBatchIndexFiles(batchRoot);
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
      const backlogItem = readBacklogItem(item, batchId, path);
      if (backlogItem && statuses.includes(backlogItem.reviewStatus)) {
        items.push(backlogItem);
      }
    }
  }
  return sortBacklog(items);
}

async function listBatchIndexFiles(path: string): Promise<string[]> {
  try {
    const info = await stat(path);
    if (info.isFile()) {
      return path.endsWith("batch-index.json") ? [path] : [];
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
      return child.isDirectory()
        ? listBatchIndexFiles(childPath)
        : child.name === "batch-index.json"
          ? Promise.resolve([childPath])
          : Promise.resolve([]);
    }),
  );
  return nested.flat();
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

function buildReport(
  items: BacklogItem[],
  statuses: ReviewStatus[],
  batchIds: string[],
  jsonPath: string,
  markdownPath: string,
  sourceDir: string,
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
    items,
    paths: {
      json: jsonPath,
      markdown: markdownPath,
      batchIndexDir: sourceDir,
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
    "## Items",
    "",
    ...renderItemsTable(report.items),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderItemsTable(items: BacklogItem[]) {
  if (items.length === 0) {
    return ["No attention items matched the filters."];
  }
  return [
    "| Status | Severity | Batch | Kind | Metric | Score | Delta | Task | Recommended action | Note | Source |",
    "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- |",
    ...items.map((item) =>
      `| ${item.reviewStatus} | ${item.severity} | ${item.batchId} | ${item.kind} | ${item.metric} | ${formatNumber(item.score)} | ${
        formatNumber(item.delta)
      } | ${escapeMarkdownCell(item.taskLabel ?? item.taskId ?? "")} | ${escapeMarkdownCell(item.recommendedActions[0] ?? "")} | ${
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

function countStatus(items: BacklogItem[], status: ReviewStatus) {
  return items.filter((item) => item.reviewStatus === status).length;
}

function countSeverity(items: BacklogItem[], severity: string) {
  return items.filter((item) => item.severity === severity).length;
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

function isReviewStatus(value: string | undefined | null): value is ReviewStatus {
  return value === "open" || value === "reviewed" || value === "deferred";
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|");
}
