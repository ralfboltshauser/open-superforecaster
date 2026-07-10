import { readJson, readRecord, readString, timestampLabel, type JsonRecord } from "./forecast-script-utils";
import {
  isForecastAttentionReviewStatus,
  type ForecastAttentionReviewStatus,
} from "../../packages/backend/src/forecast-attention-policy";

export type AttentionReviewStatus = ForecastAttentionReviewStatus;

export type AttentionReviewRecord = {
  attentionItemId: string;
  status: AttentionReviewStatus;
  note?: string;
  reviewer?: string;
  updatedAt: string;
};

export async function loadAttentionReviews(path: string) {
  return reviewsByItemId((await readAttentionReviewFile(path)).reviews);
}

export async function readAttentionReviewFile(path: string): Promise<{ reviews: AttentionReviewRecord[] }> {
  let payload: unknown;
  try {
    payload = await readJson(path);
  } catch {
    return { reviews: [] };
  }
  const reviewRows = Array.isArray(payload) ? payload : readRecordArray(payload, "reviews");
  return {
    reviews: reviewRows.flatMap(readAttentionReviewRecord),
  };
}

export function upsertAttentionReview(reviews: AttentionReviewRecord[], nextReview: AttentionReviewRecord) {
  const filtered = reviews.filter((review) => review.attentionItemId !== nextReview.attentionItemId);
  return [...filtered, nextReview].sort((left, right) => left.attentionItemId.localeCompare(right.attentionItemId));
}

export function isAttentionReviewStatus(value: string | undefined | null): value is AttentionReviewStatus {
  return isForecastAttentionReviewStatus(value);
}

function reviewsByItemId(reviews: AttentionReviewRecord[]) {
  const reviewsByItemId = new Map<string, AttentionReviewRecord>();
  for (const review of reviews) {
    reviewsByItemId.set(review.attentionItemId, review);
  }
  return reviewsByItemId;
}

function readAttentionReviewRecord(row: JsonRecord): AttentionReviewRecord[] {
  const attentionItemId = readString(row, "attentionItemId") ?? readString(row, "id");
  const status = readString(row, "status");
  if (!attentionItemId || !isAttentionReviewStatus(status)) {
    return [];
  }
  return [{
    attentionItemId,
    status,
    note: readString(row, "note") ?? undefined,
    reviewer: readString(row, "reviewer") ?? readString(row, "reviewedBy") ?? undefined,
    updatedAt: readString(row, "updatedAt") ?? readString(row, "reviewedAt") ?? timestampLabel(),
  }];
}

function readRecordArray(value: unknown, key: string) {
  const record = readRecord(value);
  const raw = record?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is JsonRecord => Boolean(readRecord(item))) : [];
}
