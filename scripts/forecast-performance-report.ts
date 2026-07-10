import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  readArgValue,
  readRecord,
  readString,
  timestampLabel,
  type JsonRecord,
  writeJson,
} from "./lib/forecast-script-utils";

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const batchId = readArgValue(args, "--batch-id") ?? timestampLabel();
const baseUrl = readArgValue(args, "--base-url") ?? process.env.OPEN_SUPERFORECASTER_BASE_URL ?? "http://localhost:3000";
const outputDir = resolve(root, readArgValue(args, "--out-dir") ?? `data/reports/forecast-performance/${batchId}`);

console.log(`Reading forecast performance report from ${baseUrl}`);
console.log(`Output: ${outputDir}`);
console.log(`Batch: ${batchId}`);

const report = await getJson("/api/resolutions/performance");
await mkdir(outputDir, { recursive: true });
await writeJson(resolve(outputDir, "forecast-performance.json"), {
  ...report,
  batchId,
  phase: "forecast_performance",
});
await writeFile(resolve(outputDir, "forecast-performance.md"), readString(report, "markdown") ?? "", "utf8");

const summary = readRecord(report, "summary") ?? {};
console.log(
  `Forecast performance: ${String(summary.resolvedTasks ?? 0)} resolved task(s), ${String(
    summary.productScoreRows ?? 0,
  )} score row(s)`,
);

async function getJson(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as JsonRecord;
}
