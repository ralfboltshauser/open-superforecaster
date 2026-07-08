import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;
type SampleKind = "run" | "benchmark";
type SampleGroup = "forecast" | "research" | "table" | "benchmark";

type SampleCase = {
  id: string;
  label: string;
  kind: SampleKind;
  group: SampleGroup;
  body: JsonRecord;
  expect: {
    taskRows?: boolean;
    forecastEvidence?: boolean;
    benchmarkCases?: boolean;
  };
};

type SampleResult = {
  id: string;
  status: "pass" | "fail" | "planned";
  detail: string;
  taskId?: string;
  benchmarkRunId?: string;
};

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const execute = hasArg("--execute");
const probe = hasArg("--probe");
const suite = readArgValue("--suite") ?? "quick";
const caseFilters = readArgValues("--case");
const includeLiveWebBenchmark = hasArg("--include-live-web-benchmark");
const baseUrl = readArgValue("--base-url") ?? process.env.OPEN_SUPERFORECASTER_BASE_URL ?? "http://localhost:3000";
const timeoutMs = readNumberArg("--timeout-ms", 30 * 60 * 1000);
const pollMs = readNumberArg("--poll-ms", 10_000);

const samples = filterSamples(await loadSamples());
const results: SampleResult[] = [];

if (samples.length === 0) {
  throw new Error(`No sample cases matched suite=${suite} filters=${caseFilters.join(",") || "(none)"}`);
}

console.log(`${execute ? "Executing" : "Planning"} ${samples.length} sample workflow case(s) against ${baseUrl}`);
console.log(`Suite: ${suite}; cases: ${samples.map((sample) => sample.id).join(", ")}`);

if (!execute) {
  for (const sample of samples) {
    results.push({
      id: sample.id,
      status: "planned",
      detail: `${sample.kind.toUpperCase()} ${sample.group}: ${sample.label}`,
    });
  }
  if (probe) {
    await probeServer(samples);
  }
  printSummary();
  process.exit();
}

await requireHealthyServer();
for (const sample of samples) {
  if (sample.kind === "benchmark") {
    results.push(await executeBenchmarkSample(sample));
  } else {
    results.push(await executeRunSample(sample));
  }
}
printSummary();

async function loadSamples(): Promise<SampleCase[]> {
  const questionLines = (await readFile(resolve(root, "examples/questions.jsonl"), "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const questions = questionLines.map((line) => JSON.parse(line) as { id: string; body: JsonRecord });
  const tableExamples = [
    ["agent-map-companies", "Agent map companies", "request-agent-map-companies.json", { taskRows: true }],
    ["classify-companies", "Classify companies", "request-classify-companies.json", { taskRows: true }],
    ["rank-companies", "Rank companies", "request-rank-companies.json", { taskRows: true }],
    ["merge-companies", "Merge companies", "request-merge-companies.json", {}],
    ["dedupe-companies", "Dedupe companies", "request-dedupe-companies.json", {}],
  ] as const;

  const runSamples: SampleCase[] = [];
  for (const question of questions) {
    const mode = typeof question.body.mode === "string" ? question.body.mode : "auto";
    const group: SampleGroup = mode === "multi_agent" ? "research" : "forecast";
    runSamples.push({
      id: question.id,
      label: String(question.body.prompt ?? question.id),
      kind: "run",
      group,
      body: question.body,
      expect: {
        forecastEvidence: group === "forecast",
      },
    });
  }

  for (const [id, label, filename, expect] of tableExamples) {
    runSamples.push({
      id,
      label,
      kind: "run",
      group: "table",
      body: await readJson(resolve(root, "examples", filename)),
      expect,
    });
  }

  const benchmarkSamples: SampleCase[] = [
    {
      id: "fixed-evidence-benchmark-smoke",
      label: "Fixed-evidence benchmark smoke",
      kind: "benchmark",
      group: "benchmark",
      body: {
        evalMode: "fixed_evidence",
        maxCases: 1,
        rollouts: 1,
        experimentLabel: `sample-runner-${timestampLabel()}`,
      },
      expect: { benchmarkCases: true },
    },
  ];
  if (includeLiveWebBenchmark) {
    benchmarkSamples.push({
      id: "agentic-pastcasting-benchmark-smoke",
      label: "Agentic live-web pastcasting benchmark smoke",
      kind: "benchmark",
      group: "benchmark",
      body: {
        evalMode: "agentic_pastcasting_smoke",
        maxCases: 1,
        experimentLabel: `sample-runner-live-web-${timestampLabel()}`,
      },
      expect: { benchmarkCases: true },
    });
  }

  return [...runSamples, ...benchmarkSamples];
}

function filterSamples(samples: SampleCase[]) {
  const selected = samples.filter((sample) => {
    if (caseFilters.length > 0 && !caseFilters.includes(sample.id)) {
      return false;
    }
    if (suite === "all") {
      return true;
    }
    if (suite === "quick") {
      return ["binary-foldable-iphone", "agent-map-companies", "fixed-evidence-benchmark-smoke"].includes(sample.id);
    }
    if (suite === "forecast") {
      return sample.group === "forecast";
    }
    if (suite === "research") {
      return sample.group === "research";
    }
    if (suite === "table") {
      return sample.group === "table";
    }
    if (suite === "benchmark") {
      return sample.group === "benchmark";
    }
    return sample.id === suite;
  });
  return selected.sort((a, b) => sampleOrder(a) - sampleOrder(b));
}

async function executeRunSample(sample: SampleCase): Promise<SampleResult> {
  try {
    const launched = await postJson("/api/runs", sample.body);
    if (launched.ok !== true) {
      throw new Error(`launch returned ok=${String(launched.ok)}: ${JSON.stringify(launched)}`);
    }
    const taskId = readString(launched, "taskId");
    if (!taskId) {
      throw new Error(`launch response missing taskId: ${JSON.stringify(launched)}`);
    }
    const detail = await waitForTask(taskId);
    validateTaskDetail(sample, detail);
    return {
      id: sample.id,
      status: "pass",
      taskId,
      detail: summarizeTaskDetail(detail),
    };
  } catch (error) {
    return {
      id: sample.id,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function executeBenchmarkSample(sample: SampleCase): Promise<SampleResult> {
  try {
    const launched = await postJson("/api/benchmarks", sample.body);
    if (launched.ok !== true) {
      throw new Error(`benchmark launch returned ok=${String(launched.ok)}: ${JSON.stringify(launched)}`);
    }
    const benchmarkRun = readRecord(launched, "benchmarkRun");
    const benchmarkRunId = readString(benchmarkRun, "benchmarkRunId");
    if (!benchmarkRunId) {
      throw new Error(`benchmark launch response missing benchmarkRunId: ${JSON.stringify(launched)}`);
    }
    const detail = await waitForBenchmarkRun(benchmarkRunId);
    validateBenchmarkDetail(detail);
    return {
      id: sample.id,
      status: "pass",
      benchmarkRunId,
      detail: summarizeBenchmarkDetail(detail),
    };
  } catch (error) {
    return {
      id: sample.id,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForTask(taskId: string) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "unknown";
  while (Date.now() < deadline) {
    let detail: JsonRecord;
    try {
      detail = await getJson(`/api/runs/${taskId}`);
    } catch (error) {
      if (isTransientRunLookupError(error)) {
        lastStatus = "waiting_for_smithers_state";
        await sleep(pollMs);
        continue;
      }
      throw error;
    }
    const run = readRecord(detail, "run");
    const task = readRecord(run, "task");
    lastStatus = readString(task, "status") ?? "unknown";
    if (lastStatus === "completed") {
      return run;
    }
    if (["failed", "cancelled"].includes(lastStatus)) {
      throw new Error(`task ${taskId} ended with status=${lastStatus}: ${readString(task, "error") ?? "no error"}`);
    }
    await sleep(pollMs);
  }
  throw new Error(`task ${taskId} timed out after ${timeoutMs}ms; latest status=${lastStatus}`);
}

async function waitForBenchmarkRun(benchmarkRunId: string) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "unknown";
  while (Date.now() < deadline) {
    let detail: JsonRecord;
    try {
      detail = await getJson(`/api/benchmarks/${benchmarkRunId}`);
    } catch (error) {
      if (isTransientRunLookupError(error)) {
        lastStatus = "waiting_for_smithers_state";
        await sleep(pollMs);
        continue;
      }
      throw error;
    }
    const benchmarkRun = readRecord(detail, "benchmarkRun");
    const run = readRecord(benchmarkRun, "run");
    lastStatus = readString(run, "status") ?? "unknown";
    if (["completed", "partial_failure"].includes(lastStatus)) {
      return benchmarkRun;
    }
    if (["failed", "cancelled"].includes(lastStatus)) {
      throw new Error(`benchmark ${benchmarkRunId} ended with status=${lastStatus}`);
    }
    await sleep(pollMs);
  }
  throw new Error(`benchmark ${benchmarkRunId} timed out after ${timeoutMs}ms; latest status=${lastStatus}`);
}

function validateTaskDetail(sample: SampleCase, run: JsonRecord | null) {
  if (!run) {
    throw new Error("run detail is missing");
  }
  const task = readRecord(run, "task");
  if (readString(task, "status") !== "completed") {
    throw new Error(`task is not completed: ${readString(task, "status") ?? "unknown"}`);
  }
  const artifacts = readArray(run, "artifacts").filter(isRecord);
  const artifactRowCount = artifacts.reduce((sum, artifact) => sum + readArray(artifact, "rows").length, 0);
  if (artifactRowCount < 1) {
    throw new Error("completed run has no persisted artifact rows");
  }
  if (sample.expect.taskRows && readArray(run, "taskRows").length < 1) {
    throw new Error("table sample has no task row ledger entries");
  }
  if (sample.expect.forecastEvidence) {
    if (readArray(run, "forecastAttempts").length < 1) {
      throw new Error("forecast sample has no forecast attempts");
    }
    if (readArray(run, "forecastAggregates").length < 1) {
      throw new Error("forecast sample has no forecast aggregate");
    }
  }
}

function validateBenchmarkDetail(benchmarkRun: JsonRecord | null) {
  if (!benchmarkRun) {
    throw new Error("benchmark detail is missing");
  }
  const run = readRecord(benchmarkRun, "run");
  const status = readString(run, "status");
  if (!["completed", "partial_failure"].includes(status ?? "")) {
    throw new Error(`benchmark run is not terminal-success: ${status ?? "unknown"}`);
  }
  const scorecard = readRecord(benchmarkRun, "scorecard");
  const cases = readArray(benchmarkRun, "cases").filter(isRecord);
  if (!scorecard || cases.length < 1) {
    throw new Error("benchmark detail is missing scorecard or cases");
  }
  const firstCase = cases[0];
  const links = readRecord(firstCase, "links");
  if (!readString(links, "runDetail") || !readString(links, "traceBundle")) {
    throw new Error("benchmark case is missing replay links");
  }
}

async function probeServer(samples: SampleCase[]) {
  await requireHealthyServer();
  for (const sample of samples.filter((candidate) => candidate.kind === "run")) {
    const response = await postJson("/api/classify", sample.body);
    const classification = readRecord(response, "classification");
    console.log(`PROBE ${sample.id}: ${readString(classification, "mode")}/${readString(classification, "workflow")}`);
  }
}

async function requireHealthyServer() {
  const health = await getJson("/api/health");
  if (health.ok !== true || health.service !== "open-superforecaster") {
    throw new Error(`Open Superforecaster server is not healthy: ${JSON.stringify(health)}`);
  }
}

function summarizeTaskDetail(run: JsonRecord | null) {
  const task = readRecord(run, "task");
  const artifacts = readArray(run, "artifacts").filter(isRecord);
  const artifactRows = artifacts.reduce((sum, artifact) => sum + readArray(artifact, "rows").length, 0);
  const attempts = readArray(run, "forecastAttempts").length;
  const sources = readArray(run, "sources").length;
  return `task ${readString(task, "id") ?? "unknown"} completed; artifacts=${artifacts.length}, rows=${artifactRows}, attempts=${attempts}, sources=${sources}`;
}

function summarizeBenchmarkDetail(benchmarkRun: JsonRecord | null) {
  const run = readRecord(benchmarkRun, "run");
  const cases = readArray(benchmarkRun, "cases").filter(isRecord);
  const scorecard = readRecord(benchmarkRun, "scorecard");
  return `benchmark ${readString(run, "id") ?? "unknown"} ${readString(run, "status") ?? "unknown"}; cases=${cases.length}, meanBrier=${formatNumber(scorecard?.meanBrier)}`;
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, "utf8")) as JsonRecord;
}

async function getJson(path: string) {
  const response = await fetchUrl(path);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as JsonRecord;
}

async function postJson(path: string, body: JsonRecord) {
  const response = await fetchUrl(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as JsonRecord;
}

function fetchUrl(path: string, init?: RequestInit) {
  return fetch(new URL(path, baseUrl), init);
}

function hasArg(name: string) {
  return args.includes(name);
}

function readArgValue(name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function readArgValues(name: string) {
  return args.flatMap((arg, index) => (arg === name && args[index + 1] ? [args[index + 1]] : []));
}

function readNumberArg(name: string, fallback: number) {
  const value = Number(readArgValue(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readRecord(value: JsonRecord | null, key: string) {
  const raw = value?.[key];
  return isRecord(raw) ? raw : null;
}

function readArray(value: JsonRecord | null, key: string) {
  const raw = value?.[key];
  return Array.isArray(raw) ? raw : [];
}

function readString(value: JsonRecord | null, key: string) {
  const raw = value?.[key];
  return typeof raw === "string" ? raw : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTransientRunLookupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("RUN_NOT_FOUND") || /Run not found:/i.test(message);
}

function sampleOrder(sample: SampleCase) {
  const groups: Record<SampleGroup, number> = { forecast: 1, research: 2, table: 3, benchmark: 4 };
  return groups[sample.group];
}

function timestampLabel() {
  return new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
}

function formatNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(4) : "n/a";
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function printSummary() {
  for (const result of results) {
    const prefix = result.status === "pass" ? "PASS" : result.status === "fail" ? "FAIL" : "PLAN";
    console.log(`${prefix} ${result.id}: ${result.detail}`);
  }
  const failed = results.filter((result) => result.status === "fail");
  const passed = results.filter((result) => result.status === "pass");
  const planned = results.filter((result) => result.status === "planned");
  console.log(`\nSample workflows: ${passed.length} passed, ${planned.length} planned, ${failed.length} failed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}
