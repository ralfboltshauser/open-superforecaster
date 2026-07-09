import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readJson, readRecord, readString, timestampLabel, writeJson } from "./lib/forecast-script-utils";

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const root = resolve(import.meta.dir, "..");
const tempRoot = resolve("/tmp", `open-superforecaster-forecast-script-check-${timestampLabel()}`);
const checks: CheckResult[] = [];

await rm(tempRoot, { force: true, recursive: true });
await mkdir(tempRoot, { recursive: true });

await check("forecast ops plan manifest includes batch metadata", async () => {
  const outputDir = resolve(tempRoot, "ops-plan");
  await runScript("scripts/forecast-ops-runner.ts", [
    "--batch-id",
    "contract-batch",
    "--case",
    "binary-foldable-iphone",
    "--out-dir",
    outputDir,
  ]);
  const manifest = readRecord(await readJson(resolve(outputDir, "manifest.json")));
  assert(manifest, "manifest is not an object");
  assert(readString(manifest, "batchId") === "contract-batch", "batchId mismatch");
  assert(readString(manifest, "phase") === "forecast_ops", "phase mismatch");
  assert(readString(manifest, "reportType") === "forecast_ops_run", "reportType mismatch");
  const results = readArray(manifest, "results");
  assert(results.length === 1, `expected 1 result, got ${results.length}`);
  assert(readString(results[0], "status") === "planned", "result status mismatch");
  return "forecast ops plan manifest contract is stable";
});

await check("forecast resolution plan manifest includes batch metadata", async () => {
  const outputDir = resolve(tempRoot, "resolution-plan");
  await runScript("scripts/forecast-resolution-runner.ts", [
    "--batch-id",
    "contract-batch",
    "--input",
    "examples/resolutions.sample.jsonl",
    "--case",
    "binary-resolution-template",
    "--out-dir",
    outputDir,
  ]);
  const manifest = readRecord(await readJson(resolve(outputDir, "manifest.json")));
  assert(manifest, "manifest is not an object");
  assert(readString(manifest, "batchId") === "contract-batch", "batchId mismatch");
  assert(readString(manifest, "phase") === "forecast_resolution", "phase mismatch");
  assert(readString(manifest, "reportType") === "forecast_resolution_run", "reportType mismatch");
  const results = readArray(manifest, "results");
  assert(results.length === 1, `expected 1 result, got ${results.length}`);
  assert(readString(results[0], "status") === "planned", "result status mismatch");
  return "resolution plan manifest contract is stable";
});

await check("forecast resolution execute rejects bundled sample input", async () => {
  const result = await runScript(
    "scripts/forecast-resolution-runner.ts",
    ["--execute", "--input", "examples/resolutions.sample.jsonl", "--out-dir", resolve(tempRoot, "unsafe-resolution")],
    { expectedExitCode: 1 },
  );
  assert(result.stderr.includes("Refusing to execute the bundled sample resolution input"), "sample guard message missing");
  return "sample resolution input cannot execute by accident";
});

await check("forecast batch index joins all batch phases", async () => {
  const fixtureRoot = resolve(tempRoot, "batch-fixture");
  const outputDir = resolve(tempRoot, "batch-index");
  await mkdir(resolve(fixtureRoot, "ops", "contract-batch"), { recursive: true });
  await mkdir(resolve(fixtureRoot, "resolutions", "contract-batch"), { recursive: true });
  await mkdir(resolve(fixtureRoot, "performance", "contract-batch"), { recursive: true });
  await writeJson(resolve(fixtureRoot, "ops", "contract-batch", "manifest.json"), {
    reportType: "forecast_ops_run",
    batchId: "contract-batch",
    phase: "forecast_ops",
    createdAt: "2026-07-09T00:00:00.000Z",
    results: [{ status: "completed" }, { status: "failed" }],
  });
  await writeJson(resolve(fixtureRoot, "resolutions", "contract-batch", "manifest.json"), {
    reportType: "forecast_resolution_run",
    batchId: "contract-batch",
    phase: "forecast_resolution",
    createdAt: "2026-07-09T00:01:00.000Z",
    results: [{ status: "resolved" }, { status: "planned" }],
  });
  await writeJson(resolve(fixtureRoot, "performance", "contract-batch", "forecast-performance.json"), {
    reportType: "forecast_performance_report",
    batchId: "contract-batch",
    phase: "forecast_performance",
    generatedAt: "2026-07-09T00:02:00.000Z",
    summary: {
      resolvedTasks: 1,
      productScoreRows: 4,
      aggregateScoreRows: 2,
      attemptScoreRows: 2,
    },
    needsAttention: [
      {
        id: "poor:task-1:brier",
        kind: "poor_resolved_forecast",
        severity: "high",
        reason: "brier exceeded review threshold",
        recommendedActions: ["Open the run report."],
        metric: "brier",
        score: 0.4,
        delta: null,
        taskId: "task-1",
        taskLabel: "Hard forecast",
        forecastType: "binary",
      },
    ],
  });
  const reviewsFile = resolve(fixtureRoot, "reviews.json");
  await writeJson(reviewsFile, {
    reviews: [
      {
        attentionItemId: "poor:task-1:brier",
        status: "reviewed",
        note: "Resolution criteria were ambiguous.",
        reviewer: "contract-check",
        updatedAt: "2026-07-09T00:03:00.000Z",
      },
    ],
  });
  await runScript("scripts/forecast-batch-index.ts", [
    "--batch-id",
    "contract-batch",
    "--ops-dir",
    resolve(fixtureRoot, "ops"),
    "--resolutions-dir",
    resolve(fixtureRoot, "resolutions"),
    "--performance-dir",
    resolve(fixtureRoot, "performance"),
    "--reviews-file",
    reviewsFile,
    "--out-dir",
    outputDir,
  ]);
  const audit = readRecord(await readJson(resolve(outputDir, "contract-batch", "batch-index.json")));
  const counts = readRecord(audit, "counts");
  assert(audit, "audit is not an object");
  assert(counts, "counts block missing");
  assert(readNumber(counts, "entries") === 3, "entry count mismatch");
  assert(readNumber(counts, "completedForecasts") === 1, "completed forecast count mismatch");
  assert(readNumber(counts, "failedForecasts") === 1, "failed forecast count mismatch");
  assert(readNumber(counts, "resolvedCases") === 1, "resolved case count mismatch");
  assert(readNumber(counts, "performanceScoreRows") === 4, "performance score row count mismatch");
  assert(readNumber(counts, "attentionItems") === 1, "attention item count mismatch");
  assert(readNumber(counts, "reviewedAttentionItems") === 1, "reviewed attention count mismatch");
  const attentionItems = readArray(audit, "attentionItems");
  assert(attentionItems.length === 1, "attention item was not copied into audit");
  assert(readString(attentionItems[0], "reviewStatus") === "reviewed", "review status was not merged");
  return "batch index joins ops, resolution, and performance phases";
});

await check("forecast review helper upserts local attention reviews", async () => {
  const reviewsFile = resolve(tempRoot, "review-helper", "reviews.json");
  await runScript("scripts/forecast-review.ts", [
    "--id",
    "poor:task-2:brier",
    "--status",
    "deferred",
    "--note",
    "Waiting for more resolved samples.",
    "--reviewer",
    "contract-check",
    "--updated-at",
    "2026-07-09T00:04:00.000Z",
    "--reviews-file",
    reviewsFile,
  ]);
  await runScript("scripts/forecast-review.ts", [
    "--id",
    "poor:task-2:brier",
    "--status",
    "reviewed",
    "--note",
    "Reviewed after more samples resolved.",
    "--reviewer",
    "contract-check",
    "--updated-at",
    "2026-07-09T00:05:00.000Z",
    "--reviews-file",
    reviewsFile,
  ]);
  const payload = readRecord(await readJson(reviewsFile));
  const reviews = readArray(payload, "reviews");
  assert(reviews.length === 1, `expected 1 upserted review, got ${reviews.length}`);
  assert(readString(reviews[0], "attentionItemId") === "poor:task-2:brier", "attention item id mismatch");
  assert(readString(reviews[0], "status") === "reviewed", "review status was not updated");
  assert(readString(reviews[0], "note") === "Reviewed after more samples resolved.", "review note was not updated");
  return "forecast review helper safely upserts local review records";
});

const failed = checks.filter((result) => !result.ok);
for (const result of checks) {
  console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}: ${result.detail}`);
}
console.log(`\nForecast script checks: ${checks.length - failed.length} passed, ${failed.length} failed`);
if (failed.length > 0) {
  process.exitCode = 1;
}

async function check(name: string, fn: () => Promise<string>) {
  try {
    checks.push({ name, ok: true, detail: await fn() });
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function runScript(scriptPath: string, args: string[], options: { expectedExitCode?: number } = {}) {
  const proc = Bun.spawn([process.execPath, scriptPath, ...args], {
    cwd: root,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const expectedExitCode = options.expectedExitCode ?? 0;
  if (exitCode !== expectedExitCode) {
    await writeFile(resolve(tempRoot, `${scriptPath.replace(/[^a-z0-9]+/gi, "-")}.stdout.log`), stdout, "utf8");
    await writeFile(resolve(tempRoot, `${scriptPath.replace(/[^a-z0-9]+/gi, "-")}.stderr.log`), stderr, "utf8");
    throw new Error(`Expected ${scriptPath} to exit ${expectedExitCode}, got ${exitCode}. Logs: ${tempRoot}`);
  }
  return { stdout, stderr, exitCode };
}

function readArray(record: unknown, key: string) {
  const value = readRecord(record)?.[key];
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(readRecord(item))) : [];
}

function readNumber(record: unknown, key: string) {
  const value = readRecord(record)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
