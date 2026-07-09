import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildBinaryCalibrationReport } from "../packages/backend/src/performance-calibration";
import { applyBinaryCalibrationGuard } from "../packages/workflows/src/binary-calibration-guard";
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

await check("forecast attention backlog filters batch review status", async () => {
  const batchIndexRoot = resolve(tempRoot, "attention-backlog", "batches");
  const outputDir = resolve(tempRoot, "attention-backlog", "out");
  await mkdir(resolve(batchIndexRoot, "contract-batch"), { recursive: true });
  await writeJson(resolve(batchIndexRoot, "contract-batch", "batch-index.json"), {
    reportType: "forecast_batch_index",
    batchId: "contract-batch",
    attentionItems: [
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
        reviewStatus: "open",
      },
      {
        id: "drift:task-2:log",
        kind: "forecast_score_regression",
        severity: "medium",
        reason: "log score worsened",
        recommendedActions: ["Compare the previous report."],
        metric: "logScore",
        score: 0.8,
        delta: 0.2,
        taskId: "task-2",
        taskLabel: "Drifting forecast",
        forecastType: "numeric",
        reviewStatus: "deferred",
        reviewNote: "Waiting for more resolved samples.",
      },
      {
        id: "poor:task-3:brier",
        kind: "poor_resolved_forecast",
        severity: "low",
        reason: "minor calibration issue",
        recommendedActions: ["No immediate action."],
        metric: "brier",
        score: 0.2,
        delta: null,
        taskId: "task-3",
        taskLabel: "Reviewed forecast",
        forecastType: "binary",
        reviewStatus: "reviewed",
      },
    ],
  });
  await runScript("scripts/forecast-attention-backlog.ts", [
    "--batch-index-dir",
    batchIndexRoot,
    "--out-dir",
    outputDir,
    "--status",
    "deferred",
  ]);
  const report = readRecord(await readJson(resolve(outputDir, "attention-backlog.json")));
  const counts = readRecord(report, "counts");
  const items = readArray(report, "items");
  assert(report, "backlog report is not an object");
  assert(readString(report, "reportType") === "forecast_attention_backlog", "report type mismatch");
  assert(counts, "backlog counts missing");
  assert(readNumber(counts, "items") === 1, "filtered item count mismatch");
  assert(readNumber(counts, "deferred") === 1, "deferred item count mismatch");
  assert(items.length === 1, `expected 1 backlog item, got ${items.length}`);
  assert(readString(items[0], "id") === "drift:task-2:log", "wrong backlog item selected");
  assert(readString(items[0], "reviewStatus") === "deferred", "wrong backlog status selected");
  return "attention backlog reads batch indexes and filters review status";
});

await check("forecast batch health summarizes latest indexed batch", async () => {
  const batchIndexRoot = resolve(tempRoot, "batch-health", "batches");
  const outputDir = resolve(tempRoot, "batch-health", "out");
  await mkdir(resolve(batchIndexRoot, "old-batch"), { recursive: true });
  await mkdir(resolve(batchIndexRoot, "latest-batch"), { recursive: true });
  await writeJson(resolve(batchIndexRoot, "old-batch", "batch-index.json"), {
    reportType: "forecast_batch_index",
    batchId: "old-batch",
    generatedAt: "2026-07-08T00:00:00.000Z",
    counts: {
      entries: 3,
      forecastOps: 1,
      resolutions: 1,
      performanceReports: 1,
      completedForecasts: 1,
      failedForecasts: 0,
      resolvedCases: 1,
      failedResolutions: 0,
      performanceScoreRows: 2,
      attentionItems: 0,
      openAttentionItems: 0,
      reviewedAttentionItems: 0,
      deferredAttentionItems: 0,
    },
    attentionItems: [],
  });
  await writeJson(resolve(batchIndexRoot, "latest-batch", "batch-index.json"), {
    reportType: "forecast_batch_index",
    batchId: "latest-batch",
    generatedAt: "2026-07-09T00:00:00.000Z",
    counts: {
      entries: 2,
      forecastOps: 1,
      resolutions: 1,
      performanceReports: 0,
      completedForecasts: 2,
      failedForecasts: 1,
      resolvedCases: 1,
      failedResolutions: 0,
      performanceScoreRows: null,
      attentionItems: 2,
      openAttentionItems: 1,
      reviewedAttentionItems: 0,
      deferredAttentionItems: 1,
    },
    attentionItems: [
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
        reviewStatus: "open",
      },
      {
        id: "drift:task-2:log",
        kind: "forecast_score_regression",
        severity: "medium",
        reason: "log score worsened",
        recommendedActions: ["Compare the previous report."],
        metric: "logScore",
        score: 0.8,
        delta: 0.2,
        taskId: "task-2",
        taskLabel: "Drifting forecast",
        forecastType: "numeric",
        reviewStatus: "deferred",
      },
    ],
  });
  await runScript("scripts/forecast-batch-health.ts", [
    "--batch-index-dir",
    batchIndexRoot,
    "--out-dir",
    outputDir,
  ]);
  const report = readRecord(await readJson(resolve(outputDir, "batch-health.json")));
  const summary = readRecord(report, "summary");
  const missingPhases = readStringArray(report, "missingPhases");
  const issues = readArray(report, "issues");
  assert(report, "health report is not an object");
  assert(readString(report, "reportType") === "forecast_batch_health", "health report type mismatch");
  assert(readString(report, "batchId") === "latest-batch", "latest batch was not selected");
  assert(readString(report, "status") === "needs_attention", "health status mismatch");
  assert(summary, "health summary missing");
  assert(readNumber(summary, "failedForecasts") === 1, "failed forecast summary mismatch");
  assert(readNumber(summary, "unresolvedAttentionItems") === 2, "unresolved attention summary mismatch");
  assert(readNumber(summary, "scoreRegressionItems") === 1, "score regression summary mismatch");
  assert(missingPhases.includes("forecast_performance"), "missing performance phase was not reported");
  assert(issues.some((issue) => readString(issue, "kind") === "failed_forecasts"), "failed forecast issue missing");
  return "batch health summarizes latest indexed batch issues";
});

await check("forecast performance calibration buckets are stable", async () => {
  const report = buildBinaryCalibrationReport([
    { probability: 10, resolved: false, score: 0.01 },
    { probability: 30, resolved: true, score: 0.49 },
    { probability: 70, resolved: true, score: 0.09 },
    { probability: 90, resolved: false, score: 0.81 },
  ], 4);
  const buckets = report.calibrationBuckets;
  assert(buckets.length === 5, `expected 5 calibration buckets, got ${buckets.length}`);
  assert(buckets[0].count === 1, "0-20 bucket count mismatch");
  assert(buckets[0].observedRate === 0, "0-20 observed rate mismatch");
  assert(buckets[1].count === 1, "20-40 bucket count mismatch");
  assert(buckets[1].observedRate === 100, "20-40 observed rate mismatch");
  assert(buckets[3].meanForecast === 70, "60-80 mean forecast mismatch");
  assert(buckets[4].calibrationError === 90, "80-100 calibration error mismatch");
  assert(report.calibrationSummary.sampleSize === 4, "calibration sample size mismatch");
  assert(Math.round((report.calibrationSummary.expectedCalibrationError ?? 0) * 100) / 100 === 50, "expected calibration error mismatch");
  assert(report.calibrationSummary.status === "collecting_resolved_forecasts", "calibration fitting status mismatch");
  return "binary calibration buckets and ECE summary are deterministic";
});

await check("forecast performance calibration diagnostics flag bucket drift", async () => {
  const report = buildBinaryCalibrationReport([
    { probability: 90, resolved: false, score: 0.81 },
    { probability: 90, resolved: false, score: 0.81 },
    { probability: 90, resolved: false, score: 0.81 },
    { probability: 90, resolved: false, score: 0.81 },
    { probability: 90, resolved: false, score: 0.81 },
  ], 25);
  const diagnostics = report.calibrationDiagnostics;
  assert(diagnostics.length === 1, `expected 1 calibration diagnostic, got ${diagnostics.length}`);
  assert(diagnostics[0].id === "calibration:80-100", "calibration diagnostic id mismatch");
  assert(diagnostics[0].severity === "high", "calibration diagnostic severity mismatch");
  assert(diagnostics[0].direction === "overforecast", "calibration diagnostic direction mismatch");
  assert(diagnostics[0].score === 90, "calibration diagnostic score mismatch");
  assert(diagnostics[0].delta === -90, "calibration diagnostic delta mismatch");
  assert(diagnostics[0].recommendedActions.some((action) => action.includes("candidate calibration guard")), "calibration guard action missing");
  return "calibration diagnostics convert bucket drift into review actions";
});

await check("binary forecast calibration guard preserves deterministic adjustments", async () => {
  const productionRamp = applyBinaryCalibrationGuard({
    probability: 25,
    question: "Will the company deliver at least 100000 units before the deadline?",
    resolutionCriteria: "Resolve from official delivery totals.",
    background: "Recent output has recently begun from limited initial production.",
    fixedEvidence: "The ramp is hard and unusual manufacturing constraints remain.",
  });
  assert(productionRamp.probability === 20, "production ramp probability adjustment mismatch");
  assert(productionRamp.adjustment === -5, "production ramp adjustment mismatch");
  assert(productionRamp.appliedRules.length === 1, "production ramp applied rule count mismatch");
  assert(productionRamp.appliedRules[0].id === "production-ramp-threshold", "production ramp applied rule id mismatch");
  assert(productionRamp.notes.some((note) => note.includes("production-ramp threshold")), "production ramp note missing");

  const centralBankCut = applyBinaryCalibrationGuard({
    probability: 30,
    question: "Will the Federal Reserve cut rates by the next meeting?",
    resolutionCriteria: "Resolve from FOMC target range.",
    background: "The central bank discussed a cut but officials were not committed.",
    fixedEvidence: "Recent minutes emphasized caution and data dependence before any reduction.",
    cutoffHorizonDays: 45,
  });
  assert(centralBankCut.probability === 26.5, "central bank probability adjustment mismatch");
  assert(centralBankCut.adjustment === -3.5, "central bank adjustment mismatch");
  assert(centralBankCut.appliedRules.length === 1, "central bank applied rule count mismatch");
  assert(centralBankCut.appliedRules[0].id === "near-deadline-central-bank-easing", "central bank applied rule id mismatch");
  assert(centralBankCut.notes.some((note) => note.includes("near-deadline central-bank easing")), "central bank note missing");
  return "binary calibration guard is extracted and behavior-stable";
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

function readStringArray(record: unknown, key: string) {
  const value = readRecord(record)?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
