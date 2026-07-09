import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  readArgValue,
  readJson,
  readRecord,
  readString,
  timestampLabel,
  type JsonRecord,
  writeJson,
} from "./lib/forecast-script-utils";

type ReviewStatus = "open" | "reviewed" | "deferred";

type ReviewRecord = {
  attentionItemId: string;
  status: ReviewStatus;
  note?: string;
  reviewer?: string;
  updatedAt: string;
};

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const attentionItemId = readArgValue(args, "--id") ?? readArgValue(args, "--attention-item-id");
const status = readArgValue(args, "--status");
const note = readArgValue(args, "--note");
const reviewer = readArgValue(args, "--reviewer") ?? "local-user";
const updatedAt = readArgValue(args, "--updated-at") ?? new Date().toISOString();
const reviewsFile = resolve(root, readArgValue(args, "--reviews-file") ?? "data/reports/forecast-attention-reviews.json");

if (!attentionItemId) {
  throw new Error("Expected --id <attentionItemId>.");
}
if (!isReviewStatus(status)) {
  throw new Error("Expected --status open, reviewed, or deferred.");
}

const existing = await loadReviewFile(reviewsFile);
const nextReview: ReviewRecord = {
  attentionItemId,
  status,
  ...(note ? { note } : {}),
  ...(reviewer ? { reviewer } : {}),
  updatedAt,
};
const reviews = upsertReview(existing.reviews, nextReview);
await mkdir(dirname(reviewsFile), { recursive: true });
await writeJson(reviewsFile, {
  reportType: "forecast_attention_reviews",
  updatedAt: new Date().toISOString(),
  reviews,
});

console.log(`Wrote ${status} review for ${attentionItemId} to ${reviewsFile}`);

async function loadReviewFile(path: string): Promise<{ reviews: ReviewRecord[] }> {
  let payload: unknown;
  try {
    payload = await readJson(path);
  } catch {
    return { reviews: [] };
  }
  const reviewRows = Array.isArray(payload) ? payload : readRecordArray(payload, "reviews");
  return {
    reviews: reviewRows.flatMap((row) => {
      const itemId = readString(row, "attentionItemId") ?? readString(row, "id");
      const rowStatus = readString(row, "status");
      if (!itemId || !isReviewStatus(rowStatus)) {
        return [];
      }
      return [{
        attentionItemId: itemId,
        status: rowStatus,
        note: readString(row, "note") ?? undefined,
        reviewer: readString(row, "reviewer") ?? readString(row, "reviewedBy") ?? undefined,
        updatedAt: readString(row, "updatedAt") ?? readString(row, "reviewedAt") ?? timestampLabel(),
      }];
    }),
  };
}

function upsertReview(reviews: ReviewRecord[], nextReview: ReviewRecord) {
  const filtered = reviews.filter((review) => review.attentionItemId !== nextReview.attentionItemId);
  return [...filtered, nextReview].sort((left, right) => left.attentionItemId.localeCompare(right.attentionItemId));
}

function readRecordArray(value: unknown, key: string) {
  const record = readRecord(value);
  const raw = record?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is JsonRecord => Boolean(readRecord(item))) : [];
}

function isReviewStatus(value: string | undefined | null): value is ReviewStatus {
  return value === "open" || value === "reviewed" || value === "deferred";
}
