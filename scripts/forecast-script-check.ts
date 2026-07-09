import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertBenchmarkPromotionDecisionAllowed,
  benchmarkHoldoutSplitIds,
  benchmarkPromotionGateBlockerIds,
  summarizeBenchmarkPromotionGateEvidence,
} from "../packages/backend/src/benchmark-service";
import { readCalibrationGuardSnapshot } from "../packages/backend/src/calibration-guard-metadata";
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

await check("calibration guard metadata snapshots are stable", async () => {
  const snapshot = readCalibrationGuardSnapshot({
    calibrationGuard: {
      adjustment: -5,
      appliedRules: [
        { id: "production-ramp-threshold", adjustment: -5, note: "Subtracted 5 points." },
        { adjustment: 2, note: "Missing id should be ignored." },
      ],
    },
  });
  assert(snapshot, "calibration guard snapshot missing");
  assert(snapshot.adjustment === -5, "calibration guard adjustment mismatch");
  assert(snapshot.appliedRules.length === 1, "calibration guard applied rule count mismatch");
  assert(snapshot.appliedRules[0].id === "production-ramp-threshold", "calibration guard applied rule id mismatch");
  assert(snapshot.appliedRules[0].adjustment === -5, "calibration guard applied rule adjustment mismatch");
  return "calibration guard metadata can be persisted into score config";
});

await check("benchmark promotion gate requires paired improvement", async () => {
  const indistinguishable = summarizeBenchmarkPromotionGateEvidence({
    runStatus: "completed",
    resultCount: 24,
    traceMissing: 0,
    reviewOrFailed: 0,
    comparisonStatus: "indistinguishable",
    splitFindings: { holdoutCaseResults: 10 },
  });
  assert(indistinguishable.status === "needs_more_evidence", "indistinguishable comparison should block promotion review");
  assert(indistinguishable.blockers.includes("comparison_indistinguishable"), "indistinguishable blocker missing");

  const needsBaseline = summarizeBenchmarkPromotionGateEvidence({
    runStatus: "completed",
    resultCount: 24,
    traceMissing: 0,
    reviewOrFailed: 0,
    comparisonStatus: null,
    splitFindings: { holdoutCaseResults: 10 },
  });
  assert(needsBaseline.blockers.includes("missing_comparison_report"), "missing comparison blocker missing");

  const candidateBetter = summarizeBenchmarkPromotionGateEvidence({
    runStatus: "completed",
    resultCount: 24,
    traceMissing: 0,
    reviewOrFailed: 0,
    comparisonStatus: "candidate_better",
    splitFindings: { holdoutCaseResults: 10 },
  });
  assert(candidateBetter.status === "review_for_promotion", "candidate improvement should be reviewable");
  assert(candidateBetter.blockers.length === 0, "candidate improvement should not have blockers");
  const missingHoldout = summarizeBenchmarkPromotionGateEvidence({
    runStatus: "completed",
    resultCount: 24,
    traceMissing: 0,
    reviewOrFailed: 0,
    comparisonStatus: "candidate_better",
    splitFindings: { holdoutCaseResults: 0 },
  });
  assert(missingHoldout.status === "needs_more_evidence", "missing holdout evidence should block promotion review");
  assert(missingHoldout.blockers.includes("insufficient_holdout_evidence"), "holdout evidence blocker missing");
  const qualityBlocked = summarizeBenchmarkPromotionGateEvidence({
    runStatus: "completed",
    resultCount: 24,
    traceMissing: 0,
    reviewOrFailed: 0,
    comparisonStatus: "candidate_better",
    baselineSanityFindings: { missingBaselineSanityCases: 1 },
    componentDisagreementFindings: { unexplainedHighDisagreementCases: 1 },
    forecastErrorFindings: { largeProbabilityMissCases: 1, worseThanBaselineCases: 1 },
    splitFindings: { holdoutCaseResults: 10 },
    sourceQualityFindings: { sourceLeakageCases: 1, informationAdvantageCases: 1 },
    traceQualityFindings: { weakTraceCompletenessCases: 1, missingProbabilityCases: 1, missingScoreRowsCases: 1, missingAggregateRationaleCases: 1 },
  });
  assert(qualityBlocked.status === "needs_more_evidence", "analysis quality findings should block promotion review");
  assert(qualityBlocked.blockers.includes("missing_baseline_sanity"), "baseline sanity blocker missing");
  assert(qualityBlocked.blockers.includes("unexplained_component_disagreement"), "component disagreement blocker missing");
  assert(qualityBlocked.blockers.includes("large_probability_misses"), "large miss blocker missing");
  assert(qualityBlocked.blockers.includes("worse_than_baseline_cases"), "worse-than-baseline blocker missing");
  assert(qualityBlocked.blockers.includes("source_cutoff_leakage"), "source cutoff leakage blocker missing");
  assert(qualityBlocked.blockers.includes("human_forecast_leakage"), "human forecast leakage blocker missing");
  assert(qualityBlocked.blockers.includes("weak_trace_completeness"), "weak trace blocker missing");
  assert(qualityBlocked.blockers.includes("schema_or_scoring_failures"), "schema or scoring blocker missing");
  assert(qualityBlocked.blockers.includes("missing_aggregate_rationale"), "missing rationale blocker missing");
  assertBenchmarkPromotionDecisionAllowed("needs_more_cases", qualityBlocked);
  const blockedPromotion = catchError(() => assertBenchmarkPromotionDecisionAllowed("promoted_for_local_default", qualityBlocked));
  assert(blockedPromotion?.message.includes("missing_baseline_sanity"), "blocked promotion did not report blockers");
  assertBenchmarkPromotionDecisionAllowed("promoted_for_eval_only", candidateBetter);
  return "promotion review requires paired candidate improvement";
});

await check("fixed-evidence benchmark aggregate requires baseline sanity", async () => {
  const workflowSource = await readFile(resolve(root, "packages/workflows/src/fixed-evidence-eval.workflow.tsx"), "utf8");
  const analysisSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  for (const field of ["baselineProbability", "baselineDelta", "baselineSanityCheck", "baseRateAnchor", "insideViewDelta", "skepticalAdjustment", "aggregationRule"]) {
    assert(workflowSource.includes(field), `fixed-evidence aggregate missing ${field}`);
  }
  assert(workflowSource.includes("If a baseline probability is provided"), "rollout prompt does not require baseline comparison");
  assert(analysisSource.includes("baselineSanityGate"), "benchmark analysis does not gate baseline sanity metadata");
  assert(analysisSource.includes("warn_missing_baseline_sanity"), "baseline sanity warning missing");
  assert(analysisSource.includes("baselineSanityFindingsForRun"), "benchmark analysis does not summarize baseline sanity findings");
  return "fixed-evidence aggregates persist baseline sanity metadata";
});

await check("benchmark lab surfaces baseline sanity findings", async () => {
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(backendSource.includes("baselineSanityFindings"), "benchmark list rows do not expose baseline sanity findings");
  assert(dashboardSource.includes("baseline sanity"), "lab dashboard does not surface baseline sanity findings");
  return "benchmark list and lab dashboard expose baseline sanity findings";
});

await check("benchmark analysis summarizes component disagreement", async () => {
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(backendSource.includes("componentDisagreementFindingsForRun"), "benchmark analysis does not summarize component disagreement");
  assert(backendSource.includes("warn_unexplained_component_disagreement"), "component disagreement warning missing");
  assert(backendSource.includes("componentProbabilitySpread"), "component probability spread is not recorded");
  assert(dashboardSource.includes("component spread"), "lab dashboard does not surface component disagreement findings");
  return "benchmark analysis and lab dashboard expose component disagreement findings";
});

await check("benchmark analysis summarizes forecast error findings", async () => {
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(backendSource.includes("forecastErrorFindingsForRun"), "benchmark analysis does not summarize forecast error findings");
  assert(backendSource.includes("largeProbabilityMissCases"), "large probability miss count missing");
  assert(backendSource.includes("worseThanBaselineCases"), "worse-than-baseline count missing");
  assert(dashboardSource.includes("forecast error"), "lab dashboard does not surface forecast error findings");
  return "benchmark analysis and lab dashboard expose forecast error findings";
});

await check("benchmark promotion blocks source independence failures", async () => {
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(backendSource.includes("sourceQualityFindings"), "benchmark promotion gate does not read source quality findings");
  assert(backendSource.includes("source_cutoff_leakage"), "source cutoff leakage blocker missing");
  assert(backendSource.includes("human_forecast_leakage"), "human forecast leakage blocker missing");
  assert(metricsSource.includes("sourceQualityFindings"), "metrics promotion gate does not read source quality findings");
  assert(dashboardSource.includes("source quality"), "lab dashboard does not surface source quality findings");
  return "source leakage and human forecast leakage block benchmark promotion";
});

await check("benchmark promotion blocks trace and schema failures", async () => {
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(backendSource.includes("traceQualityFindings"), "benchmark promotion gate does not read trace quality findings");
  assert(backendSource.includes("missingScoreRowsCases"), "trace quality summary does not count missing score rows");
  assert(backendSource.includes("missingAggregateRationaleCases"), "trace quality summary does not count missing rationale");
  assert(backendSource.includes("schema_or_scoring_failures"), "schema/scoring blocker missing");
  assert(metricsSource.includes("traceQualityFindings"), "metrics promotion gate does not read trace quality findings");
  assert(dashboardSource.includes("trace quality"), "lab dashboard does not surface trace quality findings");
  return "trace completeness, schema, scoring, and rationale failures block benchmark promotion";
});

await check("benchmark promotion requires held-out case evidence", async () => {
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const importerSource = await readFile(resolve(root, "packages/backend/src/btf2-importer.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(backendSource.includes("benchmarkSplitSummaryForResults"), "benchmark split summary helper missing");
  assert(backendSource.includes("pairedHoldoutCaseCount"), "paired comparison does not count held-out cases");
  assert(backendSource.includes("needs_holdout_evidence"), "comparison recommendation does not require holdout evidence");
  assert(importerSource.includes('split: "test"'), "BTF import does not persist dataset split metadata");
  assert(dashboardSource.includes("holdout evidence"), "lab dashboard does not surface holdout evidence");
  for (const splitId of benchmarkHoldoutSplitIds) {
    assert(backendSource.includes(splitId), `benchmark holdout split ${splitId} missing from backend contract`);
  }
  return "promotion review requires held-out benchmark evidence";
});

await check("benchmark comparison selects primary baseline by evidence", async () => {
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  assert(backendSource.includes("selectPrimaryBaselineComparison"), "benchmark comparison does not use a primary-baseline selector");
  assert(backendSource.includes("pairedHoldoutCaseCount - left.pairedHoldoutCaseCount"), "primary-baseline selector does not prioritize held-out overlap");
  assert(backendSource.includes("pairedCaseCount - left.pairedCaseCount"), "primary-baseline selector does not prioritize paired overlap");
  assert(backendSource.includes("promotionStateRank"), "primary-baseline selector does not use promotion state as a tie-breaker");
  assert(backendSource.includes("baselineBenchmarkRunId.localeCompare"), "primary-baseline selector does not have a deterministic final tie-breaker");
  assert(backendSource.includes("primaryBaselineBenchmarkRunId"), "comparison recommendation does not report the primary baseline");
  return "comparison recommendation uses the strongest paired baseline evidence";
});

await check("benchmark primary baseline is exported to DuckDB", async () => {
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  assert(syncSource.includes("primary_baseline_benchmark_run_id"), "DuckDB benchmark run mart missing primary baseline id");
  assert(syncSource.includes("recommendation,primaryBaselineBenchmarkRunId"), "DuckDB benchmark run mart does not read recommendation primary baseline");
  assert(syncSource.includes("baselines,0,baselineBenchmarkRunId"), "DuckDB benchmark run mart missing legacy baseline fallback");
  return "local analytics use the same primary baseline as benchmark comparison recommendations";
});

await check("benchmark promotion gate blockers are exported as metrics", async () => {
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const smokeSource = await readFile(resolve(root, "scripts/smoke-check.ts"), "utf8");
  assert(metricsSource.includes("open_superforecaster_benchmark_promotion_gate_status"), "promotion gate status metric missing");
  assert(metricsSource.includes("open_superforecaster_benchmark_promotion_gate_blocker"), "promotion gate blocker metric missing");
  assert(metricsSource.includes("summarizeBenchmarkPromotionGateEvidence"), "metrics exporter does not use shared promotion gate helper");
  assert(smokeSource.includes("open_superforecaster_benchmark_promotion_gate_status"), "smoke check does not require promotion gate status metric");
  return "promotion gate blockers are visible in Prometheus metrics";
});

await check("benchmark promotion gate blockers are exported to DuckDB", async () => {
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  assert(syncSource.includes("promotion_gate_status"), "DuckDB benchmark run mart missing promotion gate status");
  assert(syncSource.includes("promotion_gate_blockers"), "DuckDB benchmark run mart missing promotion gate blockers");
  assert(syncSource.includes("missing_baseline_sanity_cases"), "DuckDB benchmark run mart missing baseline sanity count");
  assert(syncSource.includes("unexplained_component_disagreement_cases"), "DuckDB benchmark run mart missing component disagreement count");
  assert(syncSource.includes("large_probability_miss_cases"), "DuckDB benchmark run mart missing large miss count");
  assert(syncSource.includes("worse_than_baseline_cases"), "DuckDB benchmark run mart missing worse-than-baseline count");
  assert(syncSource.includes("holdout_case_results"), "DuckDB benchmark run mart missing holdout evidence count");
  assert(syncSource.includes("required_holdout_case_results"), "DuckDB benchmark run mart missing required holdout evidence count");
  assert(syncSource.includes("source_leakage_cases"), "DuckDB benchmark run mart missing source leakage count");
  assert(syncSource.includes("information_advantage_cases"), "DuckDB benchmark run mart missing information advantage count");
  assert(syncSource.includes("human_forecast_source_cases"), "DuckDB benchmark run mart missing human forecast source count");
  assert(syncSource.includes("weak_trace_completeness_cases"), "DuckDB benchmark run mart missing weak trace count");
  assert(syncSource.includes("missing_probability_cases"), "DuckDB benchmark run mart missing missing probability count");
  assert(syncSource.includes("missing_score_rows_cases"), "DuckDB benchmark run mart missing missing score rows count");
  assert(syncSource.includes("missing_aggregate_rationale_cases"), "DuckDB benchmark run mart missing missing rationale count");
  for (const blockerId of benchmarkPromotionGateBlockerIds) {
    assert(syncSource.includes(blockerId), `DuckDB promotion gate export missing blocker ${blockerId}`);
  }
  return "promotion gate blockers are visible in local DuckDB analytics";
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

function catchError(fn: () => void) {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
