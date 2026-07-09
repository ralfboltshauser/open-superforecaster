import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const baseUrl = readArgValue("--base-url") ?? process.env.OPEN_SUPERFORECASTER_BASE_URL ?? "http://localhost:3000";
const outputDir = resolve(root, readArgValue("--out-dir") ?? `data/reports/forecast-performance/${timestampLabel()}`);

console.log(`Reading forecast performance report from ${baseUrl}`);
console.log(`Output: ${outputDir}`);

const report = await getJson("/api/resolutions/performance");
await mkdir(outputDir, { recursive: true });
await writeJson(resolve(outputDir, "forecast-performance.json"), report);
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

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readArgValue(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readRecord(record: unknown, key?: string): JsonRecord | null {
  const value = key && isRecord(record) ? record[key] : record;
  return isRecord(value) ? value : null;
}

function readString(record: unknown, key: string) {
  if (!isRecord(record)) {
    return null;
  }
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timestampLabel() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}
