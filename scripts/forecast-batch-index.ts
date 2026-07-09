import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  readArgValue,
  readJson,
  readRecord,
  readString,
  safeSegment,
  timestampLabel,
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
  };
  paths: {
    json: string;
    markdown: string;
  };
};

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const requestedBatchId = readArgValue(args, "--batch-id") ?? null;
const outputRoot = resolve(root, readArgValue(args, "--out-dir") ?? "data/reports/forecast-batches");
const scanRoots = [
  resolve(root, readArgValue(args, "--ops-dir") ?? "data/forecast-ops"),
  resolve(root, readArgValue(args, "--resolutions-dir") ?? "data/resolutions"),
  resolve(root, readArgValue(args, "--performance-dir") ?? "data/reports/forecast-performance"),
];

const discoveredEntries = await discoverEntries(scanRoots);
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
  const audit = buildAudit(batchId, entries, jsonPath, markdownPath);
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
  return {
    batchId,
    phase,
    path,
    reportType,
    createdAt: readString(payload, "createdAt") ?? readString(payload, "generatedAt") ?? undefined,
    summary: summarizePayload(phase, payload),
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
  if (phase === "forecast_performance") {
    const summary = readRecord(payload, "summary") ?? {};
    return {
      resolvedTasks: readNumber(summary, "resolvedTasks"),
      productScoreRows: readNumber(summary, "productScoreRows"),
      aggregateScoreRows: readNumber(summary, "aggregateScoreRows"),
      attemptScoreRows: readNumber(summary, "attemptScoreRows"),
    };
  }
  return {};
}

function buildAudit(batchId: string, entries: BatchEntry[], jsonPath: string, markdownPath: string): BatchAudit {
  const sortedEntries = [...entries].sort((left, right) => {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
    return leftTime - rightTime || left.path.localeCompare(right.path);
  });
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
    },
    paths: {
      json: jsonPath,
      markdown: markdownPath,
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
    "",
    "## Entries",
    "",
    "| Phase | Created | Summary | Path |",
    "| --- | --- | --- | --- |",
    ...audit.entries.map((entry) =>
      `| ${entry.phase} | ${entry.createdAt ?? ""} | ${escapeMarkdownCell(formatSummary(entry.summary))} | ${escapeMarkdownCell(entry.path)} |`,
    ),
    "",
  ];
  return `${lines.join("\n")}\n`;
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

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|");
}
