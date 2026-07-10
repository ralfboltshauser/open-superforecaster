import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

export type AttentionBacklogCompatibilityIssue = {
  kind:
    | "attention_backlog_timestamp_missing"
    | "attention_backlog_stale"
    | "attention_backlog_reviews_stale"
    | "attention_backlog_status_filter"
    | "attention_backlog_batch_filter";
  missingStatuses?: string[];
  batchIds?: string[];
};

export type AttentionBacklogCompatibilityOptions = {
  selectedBatchId?: string | null;
  batchIndexGeneratedAt?: string | null;
};

export async function isExportCompatibleAttentionBacklog(root: string, payload: JsonRecord) {
  return (await evaluateAttentionBacklogCompatibility(root, payload)).compatible;
}

export async function evaluateAttentionBacklogCompatibility(
  root: string,
  payload: JsonRecord,
  options: AttentionBacklogCompatibilityOptions = {},
) {
  const issues: AttentionBacklogCompatibilityIssue[] = [];
  const generatedAt = readString(payload, "generatedAt");
  const backlogTimestamp = timestampValue(generatedAt);
  const filters = readRecord(payload, "filters");
  const statuses = readStringArray(filters, "statuses");
  const batchIds = readStringArray(filters, "batchIds");
  const batchTimestamp = timestampValue(options.batchIndexGeneratedAt ?? null);
  if (backlogTimestamp === 0) {
    issues.push({ kind: "attention_backlog_timestamp_missing" });
  }
  if (batchTimestamp > 0 && backlogTimestamp > 0 && backlogTimestamp < batchTimestamp) {
    issues.push({ kind: "attention_backlog_stale" });
  }
  const missingStatuses = ["open", "deferred"].filter((status) => !statuses.includes(status));
  if (statuses.length > 0 && missingStatuses.length > 0) {
    issues.push({ kind: "attention_backlog_status_filter", missingStatuses });
  }
  const reviewsUpdatedAt = await readAttentionBacklogReviewsUpdatedAt(root, payload);
  const reviewsTimestamp = timestampValue(reviewsUpdatedAt);
  if (reviewsTimestamp > 0 && backlogTimestamp > 0 && backlogTimestamp < reviewsTimestamp) {
    issues.push({ kind: "attention_backlog_reviews_stale" });
  }
  if (batchIds.length > 0) {
    const selectedBatchId = options.selectedBatchId ?? null;
    if (!selectedBatchId || !batchIds.includes(selectedBatchId)) {
      issues.push({ kind: "attention_backlog_batch_filter", batchIds });
    }
  }
  return {
    compatible: issues.length === 0,
    generatedAt,
    reviewsUpdatedAt,
    issues,
  };
}

export async function readAttentionBacklogReviewsUpdatedAt(root: string, payload: JsonRecord) {
  const paths = readRecord(payload, "paths");
  const reviewsPath = readString(paths, "reviews");
  if (!reviewsPath) {
    return null;
  }
  try {
    const resolvedPath = isAbsolute(reviewsPath) ? reviewsPath : resolve(root, reviewsPath);
    const reviews = readRecord(JSON.parse(await readFile(resolvedPath, "utf8")));
    return readString(reviews, "updatedAt");
  } catch {
    return null;
  }
}

function readRecord(value: unknown, key?: string) {
  const raw = key && isRecord(value) ? value[key] : value;
  return isRecord(raw) ? raw : null;
}

function readString(value: unknown, key: string) {
  const raw = readRecord(value)?.[key];
  return typeof raw === "string" ? raw : null;
}

function readStringArray(value: JsonRecord | null, key: string) {
  const raw = value?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}

function timestampValue(value: string | null) {
  if (!value) {
    return 0;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
