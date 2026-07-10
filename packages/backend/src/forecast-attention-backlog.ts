import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

export async function isExportCompatibleAttentionBacklog(root: string, payload: JsonRecord) {
  const generatedAt = readString(payload, "generatedAt");
  if (!generatedAt) {
    return false;
  }
  const filters = readRecord(payload, "filters");
  const statuses = readStringArray(filters, "statuses");
  const batchIds = readStringArray(filters, "batchIds");
  if (batchIds.length > 0) {
    return false;
  }
  const missingStatuses = ["open", "deferred"].filter((status) => !statuses.includes(status));
  if (statuses.length > 0 && missingStatuses.length > 0) {
    return false;
  }
  const reviewsUpdatedAt = await readAttentionBacklogReviewsUpdatedAt(root, payload);
  return !reviewsUpdatedAt || timestampValue(generatedAt) >= timestampValue(reviewsUpdatedAt);
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
