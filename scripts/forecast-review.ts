import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  readAttentionReviewFile,
  upsertAttentionReview,
  type AttentionReviewRecord,
} from "./lib/forecast-attention-reviews";
import { isForecastAttentionReviewStatus } from "../packages/backend/src/forecast-attention-policy";
import {
  readArgValue,
  writeJson,
} from "./lib/forecast-script-utils";

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
if (!isForecastAttentionReviewStatus(status)) {
  throw new Error("Expected --status open, reviewed, or deferred.");
}

const existing = await readAttentionReviewFile(reviewsFile);
const nextReview: AttentionReviewRecord = {
  attentionItemId,
  status,
  ...(note ? { note } : {}),
  ...(reviewer ? { reviewer } : {}),
  updatedAt,
};
const reviews = upsertAttentionReview(existing.reviews, nextReview);
await mkdir(dirname(reviewsFile), { recursive: true });
await writeJson(reviewsFile, {
  reportType: "forecast_attention_reviews",
  updatedAt: new Date().toISOString(),
  reviews,
});

console.log(`Wrote ${status} review for ${attentionItemId} to ${reviewsFile}`);
