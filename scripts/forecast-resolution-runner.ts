import { mkdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  hasArg,
  readArgValue,
  readArgValues,
  readRecord,
  readString,
  safeSegment,
  timestampLabel,
  type JsonRecord,
  writeJson,
} from "./lib/forecast-script-utils";

type ResolutionCase = {
  id: string;
  taskId: string;
  resolvedValue: JsonRecord;
  resolutionSource?: string;
  resolutionExplanation?: string;
  forceNew?: boolean;
};

type ResolutionResult = {
  id: string;
  taskId: string;
  status: "planned" | "resolved" | "failed";
  detail: string;
  resultJson?: string;
};

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const execute = hasArg(args, "--execute");
const allowSampleInput = hasArg(args, "--allow-sample-input");
const batchId = readArgValue(args, "--batch-id") ?? timestampLabel();
const baseUrl = readArgValue(args, "--base-url") ?? process.env.OPEN_SUPERFORECASTER_BASE_URL ?? "http://localhost:3000";
const inputPath = resolve(root, readArgValue(args, "--input") ?? "examples/resolutions.sample.jsonl");
const outputDir = resolve(root, readArgValue(args, "--out-dir") ?? `data/resolutions/${batchId}`);
const caseFilters = readArgValues(args, "--case");

if (execute && basename(inputPath) === "resolutions.sample.jsonl" && !allowSampleInput) {
  throw new Error("Refusing to execute the bundled sample resolution input. Pass a real input file or --allow-sample-input.");
}

const cases = filterCases(await loadCases(inputPath));
if (cases.length === 0) {
  throw new Error(`No resolution cases matched input=${inputPath} filters=${caseFilters.join(",") || "(none)"}`);
}

console.log(`${execute ? "Resolving" : "Planning"} ${cases.length} forecast resolution case(s) against ${baseUrl}`);
console.log(`Input: ${inputPath}`);
console.log(`Output: ${outputDir}`);
console.log(`Batch: ${batchId}`);
console.log(`Cases: ${cases.map((testCase) => testCase.id).join(", ")}`);

const results: ResolutionResult[] = [];

if (!execute) {
  for (const testCase of cases) {
    results.push({
      id: testCase.id,
      taskId: testCase.taskId,
      status: "planned",
      detail: describeResolvedValue(testCase.resolvedValue),
    });
  }
  await writeManifest(results);
  printSummary(results);
  process.exit();
}

await requireHealthyServer();
await mkdir(outputDir, { recursive: true });

for (const testCase of cases) {
  results.push(await executeCase(testCase));
  await writeManifest(results);
}

const dashboard = await getJson("/api/resolutions");
await writeJson(resolve(outputDir, "resolution-dashboard.json"), dashboard);
await writeManifest(results);
printSummary(results);

if (results.some((result) => result.status === "failed")) {
  process.exitCode = 1;
}

async function loadCases(path: string): Promise<ResolutionCase[]> {
  const lines = (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    const parsed = JSON.parse(line) as JsonRecord;
    const taskId = readString(parsed, "taskId");
    const resolvedValue = readRecord(parsed, "resolvedValue") ?? extractResolvedValue(parsed);
    if (!taskId || !resolvedValue) {
      throw new Error(`Resolution input line ${index + 1} must include taskId and resolvedValue.`);
    }
    return {
      id: readString(parsed, "id") ?? `${basename(path)}-${index + 1}`,
      taskId,
      resolvedValue,
      resolutionSource: readString(parsed, "resolutionSource") ?? undefined,
      resolutionExplanation: readString(parsed, "resolutionExplanation") ?? undefined,
      forceNew: parsed.forceNew === true,
    };
  });
}

function filterCases(cases: ResolutionCase[]) {
  if (caseFilters.length === 0) {
    return cases;
  }
  return cases.filter((testCase) => caseFilters.includes(testCase.id) || caseFilters.includes(testCase.taskId));
}

async function executeCase(testCase: ResolutionCase): Promise<ResolutionResult> {
  console.log(`\n[${testCase.id}] resolve ${testCase.taskId}`);
  try {
    const response = await postJson("/api/resolutions", {
      taskId: testCase.taskId,
      resolvedValue: testCase.resolvedValue,
      resolutionSource: testCase.resolutionSource ?? "manual",
      resolutionExplanation: testCase.resolutionExplanation,
      forceNew: testCase.forceNew,
    });
    const result = readRecord(response, "result");
    if (response.ok !== true || !result) {
      throw new Error(`Resolution failed: ${JSON.stringify(response)}`);
    }

    const caseDir = resolve(outputDir, safeSegment(testCase.id));
    await mkdir(caseDir, { recursive: true });
    const resultJson = resolve(caseDir, "resolution.json");
    await writeJson(resultJson, response);

    return {
      id: testCase.id,
      taskId: testCase.taskId,
      status: "resolved",
      detail: `${String(result.insertedScores ?? 0)} score row(s), ${String(result.skippedScores ?? 0)} skipped`,
      resultJson,
    };
  } catch (error) {
    return {
      id: testCase.id,
      taskId: testCase.taskId,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function requireHealthyServer() {
  const health = await getJson("/api/health");
  if (health.ok !== true) {
    throw new Error(`Health check failed: ${JSON.stringify(health)}`);
  }
}

async function writeManifest(resultsToWrite: ResolutionResult[]) {
  await mkdir(outputDir, { recursive: true });
  await writeJson(resolve(outputDir, "manifest.json"), {
    reportType: "forecast_resolution_run",
    batchId,
    phase: "forecast_resolution",
    createdAt: new Date().toISOString(),
    execute,
    baseUrl,
    inputPath,
    results: resultsToWrite,
  });
}

function printSummary(resultsToPrint: ResolutionResult[]) {
  const counts = {
    planned: resultsToPrint.filter((result) => result.status === "planned").length,
    resolved: resultsToPrint.filter((result) => result.status === "resolved").length,
    failed: resultsToPrint.filter((result) => result.status === "failed").length,
  };
  console.log(`\nResolution summary: ${counts.resolved} resolved, ${counts.planned} planned, ${counts.failed} failed`);
  for (const result of resultsToPrint) {
    console.log(`${result.status.toUpperCase()} ${result.id}: ${result.detail}`);
  }
}

async function getJson(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as JsonRecord;
}

async function postJson(path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as JsonRecord;
}

function extractResolvedValue(record: JsonRecord) {
  const resolvedValue: JsonRecord = {};
  if (typeof record.resolved === "boolean") {
    resolvedValue.resolved = record.resolved;
  }
  if (typeof record.value === "number" && Number.isFinite(record.value)) {
    resolvedValue.value = record.value;
  }
  if (typeof record.value === "string" && Number.isFinite(Number(record.value))) {
    resolvedValue.value = Number(record.value);
  }
  if (typeof record.date === "string" && record.date.trim()) {
    resolvedValue.date = record.date.trim();
  }
  if (typeof record.category === "string" && record.category.trim()) {
    resolvedValue.category = record.category.trim();
  }
  if (typeof record.conditionResolved === "boolean") {
    resolvedValue.conditionResolved = record.conditionResolved;
  }
  if (typeof record.outcomeResolved === "boolean") {
    resolvedValue.outcomeResolved = record.outcomeResolved;
  }
  return Object.keys(resolvedValue).length ? resolvedValue : null;
}

function describeResolvedValue(value: JsonRecord) {
  if (typeof value.resolved === "boolean") {
    return `resolved=${String(value.resolved)}`;
  }
  if (typeof value.value === "number") {
    return `value=${String(value.value)}`;
  }
  if (typeof value.date === "string") {
    return `date=${value.date}`;
  }
  if (typeof value.category === "string") {
    return `category=${value.category}`;
  }
  if (typeof value.conditionResolved === "boolean" || typeof value.outcomeResolved === "boolean") {
    return `conditionResolved=${String(value.conditionResolved)}, outcomeResolved=${String(value.outcomeResolved)}`;
  }
  return JSON.stringify(value);
}
