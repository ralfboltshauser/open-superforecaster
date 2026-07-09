import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

type ForecastOpsCase = {
  id: string;
  body: JsonRecord;
};

type ForecastOpsResult = {
  id: string;
  status: "planned" | "completed" | "failed";
  taskId?: string;
  outputArtifactId?: string | null;
  reportArtifactId?: string;
  detail: string;
  files?: {
    resultJson?: string;
    reportJson?: string;
    reportMarkdown?: string;
  };
};

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const execute = hasArg("--execute");
const baseUrl = readArgValue("--base-url") ?? process.env.OPEN_SUPERFORECASTER_BASE_URL ?? "http://localhost:3000";
const inputPath = resolve(root, readArgValue("--input") ?? "examples/questions.jsonl");
const outputDir = resolve(root, readArgValue("--out-dir") ?? `data/forecast-ops/${timestampLabel()}`);
const caseFilters = readArgValues("--case");
const timeoutMs = readNumberArg("--timeout-ms", 60 * 60 * 1000);
const pollMs = readNumberArg("--poll-ms", 15_000);

const cases = filterCases(await loadCases(inputPath));
if (cases.length === 0) {
  throw new Error(`No forecast ops cases matched input=${inputPath} filters=${caseFilters.join(",") || "(none)"}`);
}

console.log(`${execute ? "Executing" : "Planning"} ${cases.length} forecast ops case(s) against ${baseUrl}`);
console.log(`Input: ${inputPath}`);
console.log(`Output: ${outputDir}`);
console.log(`Cases: ${cases.map((testCase) => testCase.id).join(", ")}`);

const results: ForecastOpsResult[] = [];

if (!execute) {
  for (const testCase of cases) {
    results.push({
      id: testCase.id,
      status: "planned",
      detail: String(testCase.body.prompt ?? testCase.id),
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

printSummary(results);
if (results.some((result) => result.status === "failed")) {
  process.exitCode = 1;
}

async function loadCases(path: string): Promise<ForecastOpsCase[]> {
  const lines = (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.flatMap((line) => {
    const parsed = JSON.parse(line) as JsonRecord;
    const id = readString(parsed, "id");
    const body = readRecord(parsed, "body");
    if (!id || !body) {
      return [];
    }
    const mode = readString(body, "mode") ?? "auto";
    if (mode === "multi_agent") {
      return [];
    }
    return [{ id, body }];
  });
}

function filterCases(cases: ForecastOpsCase[]) {
  if (caseFilters.length === 0) {
    return cases;
  }
  return cases.filter((testCase) => caseFilters.includes(testCase.id));
}

async function executeCase(testCase: ForecastOpsCase): Promise<ForecastOpsResult> {
  console.log(`\n[${testCase.id}] start`);
  try {
    const launched = await postJson("/api/runs", testCase.body);
    const taskId = readString(launched, "taskId");
    if (launched.ok !== true || !taskId) {
      throw new Error(`Launch failed or returned no taskId: ${JSON.stringify(launched)}`);
    }

    const status = await waitForCompletion(taskId);
    if (status.status !== "completed") {
      throw new Error(`Task ended with status=${status.status}: ${String(status.error ?? "no error")}`);
    }

    const resultEnvelope = await getJson(`/api/runs/${taskId}/result`);
    const result = readRecord(resultEnvelope, "result");
    const reportEnvelope = await postJson(`/api/runs/${taskId}/report-artifact`, {});
    const reportArtifact = readRecord(reportEnvelope, "reportArtifact");
    const report = readRecord(reportArtifact, "report");
    if (!result || !reportArtifact || !report) {
      throw new Error(`Result or report response was incomplete for task ${taskId}`);
    }
    const reportArtifactId = readString(reportArtifact, "artifactId");
    const outputArtifactId = readString(result, "outputArtifactId");

    const caseDir = resolve(outputDir, safeSegment(testCase.id));
    await mkdir(caseDir, { recursive: true });
    const resultJson = resolve(caseDir, "result.json");
    const reportJson = resolve(caseDir, "report.json");
    const reportMarkdown = resolve(caseDir, "report.md");
    await writeJson(resultJson, resultEnvelope);
    await writeJson(reportJson, reportEnvelope);
    await writeFile(reportMarkdown, readString(report, "markdown") ?? "", "utf8");

    return {
      id: testCase.id,
      status: "completed",
      taskId,
      outputArtifactId: outputArtifactId ?? undefined,
      reportArtifactId: reportArtifactId ?? undefined,
      detail: `completed ${String(status.operationSubmode ?? status.operationMode ?? "run")}`,
      files: {
        resultJson,
        reportJson,
        reportMarkdown,
      },
    };
  } catch (error) {
    return {
      id: testCase.id,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForCompletion(taskId: string) {
  const deadline = Date.now() + timeoutMs;
  let latest: JsonRecord | null = null;
  while (Date.now() < deadline) {
    const envelope = await getJson(`/api/runs/${taskId}/status`);
    const status = readRecord(envelope, "status");
    if (!status) {
      throw new Error(`Status response was incomplete for task ${taskId}: ${JSON.stringify(envelope)}`);
    }
    latest = status;
    const state = readString(status, "status") ?? "unknown";
    process.stdout.write(`\r${taskId} ${state} ${progressLabel(status)}`);
    if (status.isComplete === true || status.isFailed === true) {
      process.stdout.write("\n");
      return status;
    }
    await sleep(pollMs);
  }
  process.stdout.write("\n");
  throw new Error(`Timed out after ${timeoutMs}ms; latest status=${latest ? JSON.stringify(latest) : "unknown"}`);
}

async function requireHealthyServer() {
  const health = await getJson("/api/health");
  if (health.ok !== true) {
    throw new Error(`Health check failed: ${JSON.stringify(health)}`);
  }
}

async function writeManifest(results: ForecastOpsResult[]) {
  await mkdir(outputDir, { recursive: true });
  await writeJson(resolve(outputDir, "manifest.json"), {
    reportType: "forecast_ops_run",
    createdAt: new Date().toISOString(),
    execute,
    baseUrl,
    inputPath,
    results,
  });
}

function printSummary(resultsToPrint: ForecastOpsResult[]) {
  const counts = {
    planned: resultsToPrint.filter((result) => result.status === "planned").length,
    completed: resultsToPrint.filter((result) => result.status === "completed").length,
    failed: resultsToPrint.filter((result) => result.status === "failed").length,
  };
  console.log(`\nForecast ops summary: ${counts.completed} completed, ${counts.planned} planned, ${counts.failed} failed`);
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

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function progressLabel(status: JsonRecord) {
  const progress = readRecord(status, "progress");
  if (!progress) {
    return "";
  }
  return `${String(progress.completed ?? 0)}/${String(progress.total ?? 0)}`;
}

function hasArg(name: string) {
  return args.includes(name);
}

function readArgValue(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function readArgValues(name: string) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

function readNumberArg(name: string, fallback: number) {
  const raw = readArgValue(name);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function safeSegment(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "case";
}

function timestampLabel() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
