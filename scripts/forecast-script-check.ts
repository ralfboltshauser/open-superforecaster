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
import { applyBinaryCalibrationGuard, BINARY_CALIBRATION_GUARD_RULES } from "../packages/workflows/src/binary-calibration-guard";
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
    candidateCalibrationGuardRules: [
      {
        id: "candidate-guard:80-100%",
        bucketLabel: "80-100%",
        direction: "overforecast",
        suggestedAdjustment: -15,
        sampleSize: 5,
        meanForecast: 90,
        observedRate: 0,
        calibrationError: 90,
        activationStatus: "ready_for_review",
        rationale: "80-100% binary aggregates are overforecasting.",
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
      {
        attentionItemId: "candidate-guard:80-100%",
        status: "deferred",
        note: "Wait for one more weekly report.",
        reviewer: "contract-check",
        updatedAt: "2026-07-09T00:04:00.000Z",
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
  assert(readNumber(counts, "candidateCalibrationGuardRules") === 1, "candidate calibration guard count mismatch");
  assert(readNumber(counts, "deferredCandidateCalibrationGuardRules") === 1, "candidate calibration guard review status mismatch");
  const attentionItems = readArray(audit, "attentionItems");
  const candidateGuardRules = readArray(audit, "candidateCalibrationGuardRules");
  assert(attentionItems.length === 1, "attention item was not copied into audit");
  assert(readString(attentionItems[0], "reviewStatus") === "reviewed", "review status was not merged");
  assert(candidateGuardRules.length === 1, "candidate calibration guard was not copied into audit");
  assert(readString(candidateGuardRules[0], "reviewStatus") === "deferred", "candidate calibration guard review status was not merged");
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

await check("forecast calibration guard proposals require reviewed ready candidates", async () => {
  const batchIndexRoot = resolve(tempRoot, "calibration-guard-proposals", "batches", "contract-batch");
  const outputDir = resolve(tempRoot, "calibration-guard-proposals", "out");
  await mkdir(batchIndexRoot, { recursive: true });
  await writeJson(resolve(batchIndexRoot, "batch-index.json"), {
    reportType: "forecast_batch_index",
    batchId: "contract-batch",
    generatedAt: "2026-07-09T00:06:00.000Z",
    candidateCalibrationGuardRules: [
      {
        id: "candidate-guard:80-100%",
        reviewStatus: "reviewed",
        reviewNote: "Evidence is stable enough to draft a guard.",
        reviewer: "contract-check",
        reviewedAt: "2026-07-09T00:05:00.000Z",
        bucketLabel: "80-100%",
        direction: "overforecast",
        suggestedAdjustment: -15,
        sampleSize: 5,
        meanForecast: 90,
        observedRate: 0,
        calibrationError: 90,
        activationStatus: "ready_for_review",
        rationale: "80-100% binary aggregates are overforecasting.",
      },
      {
        id: "candidate-guard:60-80%",
        reviewStatus: "open",
        bucketLabel: "60-80%",
        direction: "underforecast",
        suggestedAdjustment: 8,
        sampleSize: 2,
        meanForecast: 65,
        observedRate: 80,
        calibrationError: 15,
        activationStatus: "needs_more_resolved_forecasts",
        rationale: "Too few resolved forecasts.",
      },
      {
        id: "candidate-guard:20-40%",
        reviewStatus: "deferred",
        bucketLabel: "20-40%",
        direction: "underforecast",
        suggestedAdjustment: 5,
        sampleSize: 5,
        meanForecast: 30,
        observedRate: 45,
        calibrationError: 15,
        activationStatus: "ready_for_review",
        rationale: "Deferred by reviewer.",
      },
    ],
  });
  await runScript("scripts/forecast-calibration-guard-proposals.ts", [
    "--batch-index-dir",
    resolve(tempRoot, "calibration-guard-proposals", "batches"),
    "--out-dir",
    outputDir,
  ]);
  const report = readRecord(await readJson(resolve(outputDir, "calibration-guard-proposals.json")));
  const summary = readRecord(report, "summary");
  const proposals = readArray(report, "proposalDrafts");
  assert(report, "proposal report missing");
  assert(summary, "proposal summary missing");
  assert(readNumber(summary, "candidateCalibrationGuardRules") === 3, "candidate guard input count mismatch");
  assert(readNumber(summary, "eligibleCandidateCalibrationGuardRules") === 1, "eligible candidate count mismatch");
  assert(readNumber(summary, "proposalDrafts") === 1, "proposal draft count mismatch");
  assert(readString(proposals[0], "sourceCandidateGuardId") === "candidate-guard:80-100%", "wrong candidate guard became a proposal");
  assert(readString(proposals[0], "targetWorkflowId") === "binary-calibration-guard", "proposal target workflow mismatch");
  return "reviewed ready calibration guard candidates become proposal drafts";
});

await check("forecast calibration guard validation replays proposal impact", async () => {
  const fixtureRoot = resolve(tempRoot, "calibration-guard-validation");
  const proposalsDir = resolve(fixtureRoot, "proposals");
  const performanceDir = resolve(fixtureRoot, "performance", "contract-batch");
  const holdoutPerformanceDir = resolve(fixtureRoot, "performance", "holdout-batch");
  const outputDir = resolve(fixtureRoot, "out");
  await mkdir(proposalsDir, { recursive: true });
  await mkdir(performanceDir, { recursive: true });
  await mkdir(holdoutPerformanceDir, { recursive: true });
  await writeJson(resolve(proposalsDir, "calibration-guard-proposals.json"), {
    reportType: "forecast_calibration_guard_proposals",
    proposalDrafts: [
      {
        id: "calibration-guard-proposal:contract-batch:candidate-guard:80-100%",
        sourceCandidateGuardId: "candidate-guard:80-100%",
        targetWorkflowId: "binary-calibration-guard",
        calibrationEvidence: {
          bucketLabel: "80-100%",
          suggestedAdjustment: -15,
        },
      },
    ],
  });
  await writeJson(resolve(performanceDir, "forecast-performance.json"), {
    reportType: "forecast_performance_report",
    generatedAt: "2026-07-09T00:07:00.000Z",
    calibrationReplayRows: [
      { id: "score-1", taskId: "task-1", probability: 90, resolved: false, score: 0.81 },
      { id: "score-2", taskId: "task-2", probability: 85, resolved: true, score: 0.0225 },
      { id: "score-3", taskId: "task-3", probability: 90, resolved: false, score: 0.81 },
    ],
  });
  await writeJson(resolve(holdoutPerformanceDir, "forecast-performance.json"), {
    reportType: "forecast_performance_report",
    generatedAt: "2026-07-10T00:07:00.000Z",
    calibrationReplayRows: [
      { id: "holdout-score-1", taskId: "holdout-task-1", probability: 90, resolved: false, score: 0.81 },
      { id: "holdout-score-2", taskId: "holdout-task-2", probability: 85, resolved: true, score: 0.0225 },
      { id: "holdout-score-3", taskId: "holdout-task-3", probability: 90, resolved: false, score: 0.81 },
    ],
  });
  await runScript("scripts/forecast-calibration-guard-validation.ts", [
    "--proposals",
    resolve(proposalsDir, "calibration-guard-proposals.json"),
    "--performance-report",
    resolve(performanceDir, "forecast-performance.json"),
    "--out-dir",
    outputDir,
  ]);
  const report = readRecord(await readJson(resolve(outputDir, "calibration-guard-validation.json")));
  const summary = readRecord(report, "summary");
  const validations = readArray(report, "validations");
  assert(report, "validation report missing");
  assert(summary, "validation summary missing");
  assert(readNumber(summary, "proposalDrafts") === 1, "proposal draft count mismatch");
  assert(readNumber(summary, "replayRows") === 3, "replay row count mismatch");
  assert(readNumber(summary, "holdoutReplayRows") === 0, "source replay should not count holdout rows");
  assert(readNumber(summary, "promoteForHoldout") === 1, "validation should promote for holdout");
  assert(readString(validations[0], "recommendation") === "promote_for_holdout", "wrong validation recommendation");
  assert(readString(validations[0], "validationMode") === "source_replay", "source validation mode mismatch");
  assert(readNumber(validations[0], "matchedRows") === 3, "matched replay rows mismatch");
  assert((readNumber(validations[0], "brierDelta") ?? 0) < 0, "candidate guard did not improve Brier");
  await runScript("scripts/forecast-calibration-guard-validation.ts", [
    "--proposals",
    resolve(proposalsDir, "calibration-guard-proposals.json"),
    "--performance-report",
    resolve(performanceDir, "forecast-performance.json"),
    "--holdout-performance-report",
    resolve(holdoutPerformanceDir, "forecast-performance.json"),
    "--out-dir",
    outputDir,
  ]);
  const holdoutReport = readRecord(await readJson(resolve(outputDir, "calibration-guard-validation.json")));
  const holdoutSummary = readRecord(holdoutReport, "summary");
  const holdoutValidations = readArray(holdoutReport, "validations");
  assert(readNumber(holdoutSummary, "holdoutReplayRows") === 3, "holdout replay row count mismatch");
  assert(readNumber(holdoutSummary, "promoteForDefault") === 1, "holdout validation should promote for default");
  assert(readString(holdoutValidations[0], "validationMode") === "holdout_replay", "holdout validation mode mismatch");
  assert(readString(holdoutValidations[0], "recommendation") === "promote_for_default", "holdout recommendation mismatch");
  return "calibration guard proposals are replayed before promotion";
});

await check("forecast calibration default plan requires held-out promotion", async () => {
  const fixtureRoot = resolve(tempRoot, "calibration-guard-default-plan");
  const validationDir = resolve(fixtureRoot, "validation");
  const outputDir = resolve(fixtureRoot, "out");
  await mkdir(validationDir, { recursive: true });
  await writeJson(resolve(validationDir, "calibration-guard-validation.json"), {
    reportType: "forecast_calibration_guard_validation",
    generatedAt: "2026-07-09T00:09:00.000Z",
    validations: [
      {
        validationMode: "holdout_replay",
        proposalId: "calibration-guard-proposal:contract-batch:candidate-guard:80-100%",
        sourceCandidateGuardId: "candidate-guard:80-100%",
        bucketLabel: "80-100%",
        suggestedAdjustment: -15,
        matchedRows: 3,
        brierDelta: -0.12,
        calibrationErrorDelta: -15,
        recommendation: "promote_for_default",
      },
      {
        validationMode: "source_replay",
        proposalId: "calibration-guard-proposal:contract-batch:candidate-guard:60-80%",
        sourceCandidateGuardId: "candidate-guard:60-80%",
        bucketLabel: "60-80%",
        suggestedAdjustment: 5,
        matchedRows: 4,
        brierDelta: -0.03,
        calibrationErrorDelta: -5,
        recommendation: "promote_for_holdout",
      },
      {
        validationMode: "holdout_replay",
        proposalId: "calibration-guard-proposal:contract-batch:candidate-guard:20-40%",
        sourceCandidateGuardId: "candidate-guard:20-40%",
        bucketLabel: "20-40%",
        suggestedAdjustment: 5,
        matchedRows: 4,
        brierDelta: 0.02,
        calibrationErrorDelta: 5,
        recommendation: "reject",
      },
    ],
  });
  await runScript("scripts/forecast-calibration-guard-default-plan.ts", [
    "--validation-report-dir",
    validationDir,
    "--out-dir",
    outputDir,
  ]);
  const report = readRecord(await readJson(resolve(outputDir, "calibration-guard-default-plan.json")));
  const summary = readRecord(report, "summary");
  const candidates = readArray(report, "defaultCandidates");
  const skippedRows = readArray(report, "skippedRows");
  assert(report, "default plan report missing");
  assert(readString(report, "reportType") === "forecast_calibration_guard_default_plan", "default plan report type mismatch");
  assert(summary, "default plan summary missing");
  assert(readNumber(summary, "validationRows") === 3, "validation row count mismatch");
  assert(readNumber(summary, "defaultCandidates") === 1, "default candidate count mismatch");
  assert(readNumber(summary, "skippedNonHoldout") === 1, "non-holdout skip count mismatch");
  assert(readNumber(summary, "skippedNotPromoted") === 1, "not-promoted skip count mismatch");
  assert(readString(candidates[0], "targetWorkflowId") === "binary-calibration-guard", "default plan target workflow mismatch");
  assert(
    readString(candidates[0], "targetFile") === "packages/workflows/src/binary-calibration-guard.ts",
    "default plan target file mismatch",
  );
  assert(readString(candidates[0], "implementationStatus") === "manual_review_required", "default plan should require manual review");
  assert(skippedRows.length === 2, `expected 2 skipped rows, got ${skippedRows.length}`);
  return "held-out default promotions become explicit manual implementation plans";
});

await check("forecast attention backlog filters batch review status", async () => {
  const batchIndexRoot = resolve(tempRoot, "attention-backlog", "batches");
  const validationRoot = resolve(tempRoot, "attention-backlog", "validations");
  const outputDir = resolve(tempRoot, "attention-backlog", "out");
  const reviewsFile = resolve(tempRoot, "attention-backlog", "reviews.json");
  await mkdir(resolve(batchIndexRoot, "contract-batch"), { recursive: true });
  await mkdir(validationRoot, { recursive: true });
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
    candidateCalibrationGuardRules: [
      {
        id: "candidate-guard:80-100%",
        reviewStatus: "deferred",
        reviewNote: "Waiting for a second batch.",
        bucketLabel: "80-100%",
        direction: "overforecast",
        suggestedAdjustment: -15,
        sampleSize: 5,
        meanForecast: 90,
        observedRate: 0,
        calibrationError: 90,
        activationStatus: "ready_for_review",
        rationale: "80-100% binary aggregates are overforecasting.",
      },
    ],
  });
  await writeJson(resolve(validationRoot, "calibration-guard-validation.json"), {
    reportType: "forecast_calibration_guard_validation",
    validations: [
      {
        proposalId: "calibration-guard-proposal:contract-batch:candidate-guard:80-100%",
        sourceCandidateGuardId: "candidate-guard:80-100%",
        bucketLabel: "80-100%",
        suggestedAdjustment: -15,
        matchedRows: 3,
        brierDelta: -0.12,
        calibrationErrorDelta: -15,
        recommendation: "promote_for_holdout",
      },
      {
        proposalId: "calibration-guard-proposal:contract-batch:candidate-guard:20-40%",
        sourceCandidateGuardId: "candidate-guard:20-40%",
        bucketLabel: "20-40%",
        suggestedAdjustment: 5,
        matchedRows: 4,
        brierDelta: 0.02,
        calibrationErrorDelta: 5,
        recommendation: "reject",
      },
    ],
  });
  await writeJson(reviewsFile, {
    reviews: [
      {
        attentionItemId: "calibration-validation:calibration-guard-proposal:contract-batch:candidate-guard:80-100%",
        status: "deferred",
        note: "Need a held-out batch first.",
        reviewer: "contract-check",
        updatedAt: "2026-07-09T00:08:00.000Z",
      },
    ],
  });
  await runScript("scripts/forecast-attention-backlog.ts", [
    "--batch-index-dir",
    batchIndexRoot,
    "--validation-report-dir",
    validationRoot,
    "--reviews-file",
    reviewsFile,
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
  assert(readNumber(counts, "items") === 3, "filtered item count mismatch");
  assert(readNumber(counts, "deferred") === 3, "deferred item count mismatch");
  assert(items.length === 3, `expected 3 backlog items, got ${items.length}`);
  assert(items.some((item) => readString(item, "id") === "drift:task-2:log"), "deferred attention item missing");
  const guardItem = items.find((item) => readString(item, "id") === "candidate-guard:80-100%");
  assert(guardItem, "candidate calibration guard backlog item missing");
  assert(readString(guardItem, "kind") === "candidate_calibration_guard", "candidate calibration guard kind mismatch");
  assert(readString(guardItem, "reviewStatus") === "deferred", "wrong candidate calibration guard status selected");
  const deferredValidationItem = items.find((item) => readString(item, "kind") === "calibration_guard_holdout_candidate");
  assert(deferredValidationItem, "reviewed calibration validation item missing from deferred filter");
  assert(readString(deferredValidationItem, "reviewStatus") === "deferred", "validation review status was not merged");
  await runScript("scripts/forecast-attention-backlog.ts", [
    "--batch-index-dir",
    batchIndexRoot,
    "--validation-report-dir",
    validationRoot,
    "--reviews-file",
    resolve(tempRoot, "attention-backlog", "empty-reviews.json"),
    "--out-dir",
    outputDir,
    "--status",
    "open",
  ]);
  const openReport = readRecord(await readJson(resolve(outputDir, "attention-backlog.json")));
  const openItems = readArray(openReport, "items");
  const validationItem = openItems.find((item) => readString(item, "kind") === "calibration_guard_holdout_candidate");
  assert(validationItem, "calibration guard validation backlog item missing");
  assert(readString(validationItem, "batchId") === "contract-batch", "validation backlog batch id mismatch");
  assert(readString(validationItem, "reviewStatus") === "open", "validation backlog item should start open");
  assert(!openItems.some((item) => readString(item, "id")?.includes("candidate-guard:20-40%")), "rejected validation should not enter backlog");
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
      candidateCalibrationGuardRules: 0,
      openCandidateCalibrationGuardRules: 0,
      reviewedCandidateCalibrationGuardRules: 0,
      deferredCandidateCalibrationGuardRules: 0,
    },
    attentionItems: [],
    candidateCalibrationGuardRules: [],
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
      candidateCalibrationGuardRules: 1,
      openCandidateCalibrationGuardRules: 1,
      reviewedCandidateCalibrationGuardRules: 0,
      deferredCandidateCalibrationGuardRules: 0,
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
    candidateCalibrationGuardRules: [
      {
        id: "candidate-guard:80-100%",
        reviewStatus: "open",
        bucketLabel: "80-100%",
        direction: "overforecast",
        suggestedAdjustment: -15,
        sampleSize: 5,
        meanForecast: 90,
        observedRate: 0,
        calibrationError: 90,
        activationStatus: "ready_for_review",
        rationale: "80-100% binary aggregates are overforecasting.",
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
  assert(readNumber(summary, "unresolvedCandidateCalibrationGuardRules") === 1, "unresolved candidate calibration guard summary mismatch");
  assert(missingPhases.includes("forecast_performance"), "missing performance phase was not reported");
  assert(issues.some((issue) => readString(issue, "kind") === "failed_forecasts"), "failed forecast issue missing");
  assert(issues.some((issue) => readString(issue, "kind") === "candidate_calibration_guard_review"), "candidate calibration guard issue missing");
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
  assert(report.candidateCalibrationGuardRules.length === 0, "small calibration sample should not emit candidate guard rules");
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
  assert(report.candidateCalibrationGuardRules.length === 1, "candidate calibration guard rule missing");
  assert(report.candidateCalibrationGuardRules[0].id === "candidate-guard:80-100%", "candidate calibration guard id mismatch");
  assert(report.candidateCalibrationGuardRules[0].suggestedAdjustment === -15, "candidate calibration guard adjustment mismatch");
  assert(report.candidateCalibrationGuardRules[0].activationStatus === "ready_for_review", "candidate calibration guard activation status mismatch");
  return "calibration diagnostics convert bucket drift into review actions";
});

await check("forecast performance reports surface candidate calibration guards", async () => {
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(resolutionSource.includes("candidateCalibrationGuardRules: calibrationReport.candidateCalibrationGuardRules"), "performance report missing candidate calibration guard rules");
  assert(resolutionSource.includes("calibrationGuardImpact"), "performance report missing calibration guard impact summary");
  assert(resolutionSource.includes("calibrationReplayRows: calibrationReplayRows(aggregateBrierScores)"), "performance report missing calibration replay rows");
  assert(resolutionSource.includes("## Calibration guard impact"), "performance Markdown missing calibration guard impact section");
  assert(resolutionSource.includes("## Candidate calibration guards"), "performance Markdown missing candidate calibration guard section");
  assert(dashboardSource.includes("candidateCalibrationGuardRules"), "lab dashboard does not read candidate calibration guard rules");
  assert(dashboardSource.includes("Candidate calibration guards"), "lab dashboard does not render candidate calibration guard rules");
  assert(dashboardSource.includes("PerformanceGuardImpact"), "lab dashboard does not render calibration guard impact summary");
  return "candidate calibration guard rules are visible in report artifacts and the lab dashboard";
});

await check("forecast calibration health is exported as metrics", async () => {
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const smokeSource = await readFile(resolve(root, "scripts/smoke-check.ts"), "utf8");
  const metricsRouteSource = await readFile(resolve(root, "apps/web/src/app/metrics/route.ts"), "utf8");
  assert(metricsSource.includes("buildBinaryCalibrationReport"), "metrics exporter does not use shared calibration report builder");
  assert(metricsSource.includes("open_superforecaster_binary_calibration_status"), "calibration status metric missing");
  assert(metricsSource.includes("open_superforecaster_binary_calibration_expected_error"), "calibration expected error metric missing");
  assert(metricsSource.includes("open_superforecaster_binary_calibration_bucket_error"), "calibration bucket error metric missing");
  assert(metricsSource.includes("open_superforecaster_binary_calibration_diagnostic"), "calibration diagnostic metric missing");
  assert(metricsSource.includes("open_superforecaster_binary_calibration_candidate_guard_rules_total"), "candidate calibration guard metric missing");
  assert(metricsSource.includes("readCalibrationGuardValidationMetricRows"), "metrics exporter does not read calibration guard validation reports");
  assert(metricsSource.includes("readCalibrationGuardDefaultPlanMetricRows"), "metrics exporter does not read calibration guard default plan reports");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_validation_reports_total"), "calibration validation report metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_validation_brier_delta"), "calibration validation Brier delta metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_validation_calibration_error_delta"), "calibration validation calibration error delta metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_default_plan_candidates_total"), "calibration default plan candidate metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_default_plan_candidate_brier_delta"), "calibration default plan Brier delta metric missing");
  assert(smokeSource.includes("open_superforecaster_binary_calibration_status"), "smoke check does not require calibration status metric");
  assert(smokeSource.includes("open_superforecaster_calibration_guard_validation_reports_total"), "smoke check does not require calibration validation metric");
  assert(metricsRouteSource.includes("renderPrometheusMetrics"), "metrics route does not render Prometheus metrics");
  assert(metricsRouteSource.includes("text/plain; version=0.0.4"), "metrics route missing Prometheus content type");
  return "binary calibration health, candidate guard rules, and validation outcomes are visible in Prometheus metrics";
});

await check("forecast calibration health is exported to DuckDB", async () => {
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const validationSource = await readFile(resolve(root, "scripts/forecast-calibration-guard-validation.ts"), "utf8");
  assert(syncSource.includes("osf_forecast_scores"), "DuckDB sync missing forecast score mart");
  assert(syncSource.includes("osf_binary_calibration_buckets"), "DuckDB sync missing binary calibration bucket mart");
  assert(syncSource.includes("osf_calibration_guard_validations"), "DuckDB sync missing calibration guard validation mart");
  assert(syncSource.includes("osf_calibration_guard_default_plan_candidates"), "DuckDB sync missing calibration guard default plan mart");
  assert(syncSource.includes("buildBinaryCalibrationReport"), "DuckDB sync does not use shared binary calibration report builder");
  assert(syncSource.includes("buildBinaryCalibrationBucketMartRows"), "DuckDB sync missing calibration bucket mart mapper");
  assert(syncSource.includes("calibration_guard_adjustment"), "forecast score mart missing calibration guard adjustment");
  assert(syncSource.includes("calibration_guard_rules_json"), "forecast score mart missing calibration guard rules");
  assert(syncSource.includes("candidate_guard_suggested_adjustment"), "binary calibration bucket mart missing candidate guard adjustment");
  assert(syncSource.includes("candidate_guard_activation_status"), "binary calibration bucket mart missing candidate guard activation status");
  assert(syncSource.includes("readCalibrationGuardValidationRows"), "DuckDB sync does not read calibration guard validation reports");
  assert(syncSource.includes("readCalibrationGuardDefaultPlanRows"), "DuckDB sync does not read calibration guard default plan reports");
  assert(syncSource.includes("validation_mode"), "calibration guard validation mart missing validation mode");
  assert(syncSource.includes("brier_delta"), "calibration guard validation mart missing Brier delta");
  assert(syncSource.includes("calibration_error_delta"), "calibration guard validation mart missing calibration error delta");
  assert(syncSource.includes("recommendation"), "calibration guard validation mart missing recommendation");
  assert(syncSource.includes("acceptance_criteria_json"), "calibration guard default plan mart missing acceptance criteria");
  assert(syncSource.includes("resolved_forecast_count"), "binary calibration bucket mart missing resolved forecast count");
  assert(validationSource.includes("BINARY_CALIBRATION_POLICY.minimumBucketSampleSize"), "calibration validation does not use shared minimum bucket sample policy");
  return "binary calibration scores, candidate guard rules, and validation outcomes are visible in local DuckDB analytics";
});

await check("local export includes forecast review reports", async () => {
  const exportSource = await readFile(resolve(root, "scripts/export-local.ts"), "utf8");
  assert(exportSource.includes("\"data/reports\""), "local export does not include data/reports");
  assert(exportSource.includes("local forecast review reports"), "local export manifest notes do not mention forecast review reports");
  return "local export preserves forecast review reports";
});

await check("binary forecast calibration guard preserves deterministic adjustments", async () => {
  assert(BINARY_CALIBRATION_GUARD_RULES.length === 5, "calibration guard registry rule count mismatch");
  assert(
    BINARY_CALIBRATION_GUARD_RULES.some((rule) => rule.id === "production-ramp-threshold" && rule.adjustment === -5),
    "production ramp rule missing from registry",
  );
  assert(
    BINARY_CALIBRATION_GUARD_RULES.some((rule) => rule.id === "near-deadline-central-bank-easing" && rule.adjustment === -3.5),
    "central bank easing rule missing from registry",
  );
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
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(backendSource.includes("selectPrimaryBaselineComparison"), "benchmark comparison does not use a primary-baseline selector");
  assert(backendSource.includes("pairedHoldoutCaseCount - left.pairedHoldoutCaseCount"), "primary-baseline selector does not prioritize held-out overlap");
  assert(backendSource.includes("pairedCaseCount - left.pairedCaseCount"), "primary-baseline selector does not prioritize paired overlap");
  assert(backendSource.includes("promotionStateRank"), "primary-baseline selector does not use promotion state as a tie-breaker");
  assert(backendSource.includes("baselineBenchmarkRunId.localeCompare"), "primary-baseline selector does not have a deterministic final tie-breaker");
  assert(backendSource.includes("primaryBaselineBenchmarkRunId"), "comparison recommendation does not report the primary baseline");
  assert(dashboardSource.includes("primaryBaselineBenchmarkRunId"), "lab dashboard does not surface primary baseline selection");
  return "comparison recommendation uses the strongest paired baseline evidence";
});

await check("benchmark primary baseline is exported to DuckDB", async () => {
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  assert(syncSource.includes("primary_baseline_benchmark_run_id"), "DuckDB benchmark run mart missing primary baseline id");
  assert(syncSource.includes("primary_baseline.row_json"), "DuckDB benchmark run mart does not select a primary baseline row");
  assert(syncSource.includes("recommendation,primaryBaselineBenchmarkRunId"), "DuckDB benchmark run mart does not read recommendation primary baseline");
  assert(syncSource.includes("baselines,0,baselineBenchmarkRunId"), "DuckDB benchmark run mart missing legacy baseline fallback");
  assert(syncSource.includes("primary_baseline.row_json #>> '{pairedCaseCount}'"), "DuckDB paired counts do not come from primary baseline");
  assert(syncSource.includes("primary_baseline.row_json #>> '{pairedMeanBrierDelta}'"), "DuckDB paired deltas do not come from primary baseline");
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

await check("workflow change proposal lifecycle is exported as metrics", async () => {
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const smokeSource = await readFile(resolve(root, "scripts/smoke-check.ts"), "utf8");
  assert(metricsSource.includes("workflowChangeProposals"), "metrics exporter does not read workflow change proposals");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposals_total"), "workflow proposal count metric missing");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposal_info"), "workflow proposal info metric missing");
  assert(metricsSource.includes("implementation_status"), "workflow proposal metric missing implementation status label");
  assert(metricsSource.includes("implementation_experiment_label"), "workflow proposal metric missing implementation experiment label");
  assert(metricsSource.includes("validation_benchmark_run_id"), "workflow proposal metric missing validation benchmark label");
  assert(metricsSource.includes("validation_comparison_report_artifact_id"), "workflow proposal metric missing validation comparison artifact label");
  assert(metricsSource.includes("validation_recommendation_status"), "workflow proposal metric missing validation recommendation status label");
  assert(metricsSource.includes("validation_result_status"), "workflow proposal metric missing validation result status");
  assert(metricsSource.includes("validation_gate_status"), "workflow proposal metric missing validation gate status");
  assert(metricsSource.includes("reviewed_by"), "workflow proposal metric missing reviewer label");
  assert(metricsSource.includes("source_benchmark_run_id"), "workflow proposal metric missing source benchmark label");
  assert(smokeSource.includes("open_superforecaster_workflow_change_proposals_total"), "smoke check does not require workflow proposal metric");
  return "workflow proposal lifecycle state is visible in Prometheus metrics";
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

await check("workflow change proposals are exported to DuckDB", async () => {
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  assert(syncSource.includes("from workflow_change_proposals"), "DuckDB sync does not query workflow change proposals");
  assert(syncSource.includes("osf_workflow_change_proposals"), "DuckDB sync missing workflow change proposal mart");
  assert(syncSource.includes("source_benchmark_run_id"), "workflow proposal mart missing source benchmark run id");
  assert(syncSource.includes("target_workflow_id"), "workflow proposal mart missing target workflow id");
  assert(syncSource.includes("proposed_change"), "workflow proposal mart missing proposed change");
  assert(syncSource.includes("expected_metric_effect"), "workflow proposal mart missing expected metric effect");
  assert(syncSource.includes("expected_cost_latency_effect"), "workflow proposal mart missing cost/latency effect");
  assert(syncSource.includes("overfit_risk"), "workflow proposal mart missing overfit risk");
  assert(syncSource.includes("validation_plan"), "workflow proposal mart missing validation plan");
  assert(syncSource.includes("evidence_case_ids_json"), "workflow proposal mart missing evidence case ids");
  assert(syncSource.includes("review_note"), "workflow proposal mart missing review note");
  assert(syncSource.includes("reviewed_by"), "workflow proposal mart missing reviewer");
  assert(syncSource.includes("reviewed_at"), "workflow proposal mart missing review timestamp");
  assert(syncSource.includes("implementation_task_title"), "workflow proposal mart missing implementation task title");
  assert(syncSource.includes("implementation_status"), "workflow proposal mart missing implementation status");
  assert(syncSource.includes("implementation_experiment_label"), "workflow proposal mart missing implementation experiment label");
  assert(syncSource.includes("implementation_note"), "workflow proposal mart missing implementation note");
  assert(syncSource.includes("validation_benchmark_run_id"), "workflow proposal mart missing validation benchmark run id");
  assert(syncSource.includes("validation_launched_by"), "workflow proposal mart missing validation launcher");
  assert(syncSource.includes("validation_launched_at"), "workflow proposal mart missing validation launch timestamp");
  assert(syncSource.includes("validation_result_status"), "workflow proposal mart missing validation result status");
  assert(syncSource.includes("validation_result_summary"), "workflow proposal mart missing validation result summary");
  assert(syncSource.includes("validation_mean_brier_delta"), "workflow proposal mart missing validation Brier delta");
  assert(syncSource.includes("validation_completed_cases"), "workflow proposal mart missing validation completed case count");
  assert(syncSource.includes("validation_gate_status"), "workflow proposal mart missing validation gate status");
  assert(syncSource.includes("validation_gate_blockers_json"), "workflow proposal mart missing validation gate blockers");
  assert(syncSource.includes("validation_comparison_report_artifact_id"), "workflow proposal mart missing validation comparison artifact id");
  assert(syncSource.includes("validation_recommendation_status"), "workflow proposal mart missing validation recommendation status");
  assert(syncSource.includes("validation_primary_baseline_benchmark_run_id"), "workflow proposal mart missing validation primary baseline id");
  assert(syncSource.includes("validation_paired_mean_brier_delta"), "workflow proposal mart missing validation paired Brier delta");
  assert(syncSource.includes("validation_paired_brier_ci_lower"), "workflow proposal mart missing validation paired uncertainty interval");
  return "benchmark-derived workflow proposals are visible in local DuckDB analytics";
});

await check("workflow change proposals are visible in the lab dashboard", async () => {
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(dashboardSource.includes("workflowChangeProposals"), "lab dashboard does not read workflow change proposals");
  assert(dashboardSource.includes("Workflow proposals"), "lab dashboard does not render a workflow proposal section");
  assert(dashboardSource.includes("targetWorkflowId"), "lab dashboard proposal section missing target workflow id");
  assert(dashboardSource.includes("proposedChange"), "lab dashboard proposal section missing proposed change");
  assert(dashboardSource.includes("overfitRisk"), "lab dashboard proposal section missing overfit risk");
  assert(dashboardSource.includes("validationPlan"), "lab dashboard proposal section missing validation plan");
  assert(dashboardSource.includes("updateWorkflowChangeProposal"), "lab dashboard does not expose workflow proposal lifecycle actions");
  assert(dashboardSource.includes("implemented"), "lab dashboard proposal section missing implemented action");
  assert(dashboardSource.includes("start patch"), "lab dashboard proposal section missing implementation start action");
  assert(dashboardSource.includes("run validation"), "lab dashboard proposal section missing validation launch action");
  assert(dashboardSource.includes("implementationExperimentLabel"), "lab dashboard proposal section missing implementation experiment label");
  assert(dashboardSource.includes("validationBenchmarkRunId"), "lab dashboard proposal section missing validation benchmark link");
  assert(dashboardSource.includes("validationResultSummary"), "lab dashboard proposal section missing validation result summary");
  assert(dashboardSource.includes("validationMeanBrierDelta"), "lab dashboard proposal section missing validation score delta");
  assert(dashboardSource.includes("validationComparisonReport"), "lab dashboard proposal section missing validation comparison report");
  assert(dashboardSource.includes("validationRecommendationStatus"), "lab dashboard proposal section missing validation recommendation status");
  assert(dashboardSource.includes("validationPairedMeanBrierDelta"), "lab dashboard proposal section missing validation paired Brier delta");
  assert(dashboardSource.includes("validationGateStatus"), "lab dashboard proposal section missing validation gate status");
  assert(dashboardSource.includes("validationGateBlockers"), "lab dashboard proposal section missing validation gate blockers");
  assert(dashboardSource.includes("canMarkImplemented"), "lab dashboard does not gate implemented action on validation result");
  return "benchmark-derived workflow proposals are visible where promotion blockers are reviewed";
});

await check("workflow change proposal lifecycle is auditable", async () => {
  const schemaSource = await readFile(resolve(root, "packages/db/src/schema.ts"), "utf8");
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const routeSource = await readFile(
    resolve(root, "apps/web/src/app/api/benchmarks/[benchmarkRunId]/proposals/[proposalId]/route.ts"),
    "utf8",
  );
  const validationRouteSource = await readFile(
    resolve(root, "apps/web/src/app/api/benchmarks/[benchmarkRunId]/proposals/[proposalId]/validation/route.ts"),
    "utf8",
  );
  assert(schemaSource.includes("reviewNote: text(\"review_note\")"), "workflow proposal schema missing review note");
  assert(schemaSource.includes("reviewedBy: text(\"reviewed_by\")"), "workflow proposal schema missing reviewer");
  assert(schemaSource.includes("reviewedAt: timestamp(\"reviewed_at\""), "workflow proposal schema missing review timestamp");
  assert(schemaSource.includes("implementationTaskTitle: text(\"implementation_task_title\")"), "workflow proposal schema missing implementation task title");
  assert(schemaSource.includes("implementationStatus: text(\"implementation_status\")"), "workflow proposal schema missing implementation status");
  assert(schemaSource.includes("implementationExperimentLabel: text(\"implementation_experiment_label\")"), "workflow proposal schema missing implementation experiment label");
  assert(schemaSource.includes("validationBenchmarkRunId: uuid(\"validation_benchmark_run_id\")"), "workflow proposal schema missing validation benchmark run id");
  assert(schemaSource.includes("validationResultStatus: text(\"validation_result_status\")"), "workflow proposal schema missing validation result status");
  assert(schemaSource.includes("validationMeanBrierDelta: doublePrecision(\"validation_mean_brier_delta\")"), "workflow proposal schema missing validation Brier delta");
  assert(schemaSource.includes("validationGateStatus: text(\"validation_gate_status\")"), "workflow proposal schema missing validation gate status");
  assert(schemaSource.includes("validationGateBlockers: jsonb(\"validation_gate_blockers\")"), "workflow proposal schema missing validation gate blockers");
  assert(backendSource.includes("workflowChangeProposalStatuses"), "backend missing shared workflow proposal status set");
  assert(backendSource.includes("workflowChangeProposalImplementationStatuses"), "backend missing shared implementation status set");
  for (const status of ["candidate", "accepted", "rejected", "implemented"]) {
    assert(backendSource.includes(`"${status}"`), `backend missing workflow proposal status ${status}`);
  }
  for (const status of ["not_started", "planned", "in_progress", "validated"]) {
    assert(backendSource.includes(`"${status}"`), `backend missing workflow proposal implementation status ${status}`);
  }
  assert(backendSource.includes("updateWorkflowChangeProposalStatus"), "backend missing workflow proposal lifecycle function");
  assert(backendSource.includes("eq(workflowChangeProposals.sourceBenchmarkRunId, input.benchmarkRunId)"), "proposal update does not verify benchmark ownership");
  assert(backendSource.includes("assertWorkflowChangeProposalStatusTransitionAllowed"), "backend missing workflow proposal transition guard");
  assert(backendSource.includes("validationResultStatus === \"completed\""), "backend implemented transition does not require completed validation");
  assert(backendSource.includes("implementationStatusForProposalTransition"), "backend missing proposal implementation transition helper");
  assert(backendSource.includes("proposal-${existing.id.slice(0, 8)}"), "backend missing deterministic proposal experiment label");
  assert(backendSource.includes("startWorkflowChangeProposalValidation"), "backend missing proposal validation launcher");
  assert(backendSource.includes("evalModeForProposalTargetWorkflow"), "backend missing proposal target workflow mapper");
  assert(backendSource.includes("suiteId: sourceRun.suiteId"), "proposal validation does not reuse source benchmark suite");
  assert(backendSource.includes("validationBenchmarkRunId"), "backend missing validation benchmark linkage");
  assert(backendSource.includes("already has validation benchmark run"), "backend does not block duplicate proposal validation launches");
  assert(backendSource.includes("createWorkflowProposalValidationComparison"), "backend missing proposal validation comparison helper");
  assert(backendSource.includes("baselineBenchmarkRunIds: [proposal.sourceBenchmarkRunId]"), "proposal validation comparison does not use source benchmark as baseline");
  assert(backendSource.includes("syncWorkflowProposalValidationEvidence"), "backend missing proposal validation evidence sync");
  assert(backendSource.includes("validationMeanBrierDelta"), "backend missing validation Brier delta sync");
  assert(backendSource.includes("gateBlockers: validationGate.blockers"), "backend missing validation gate blocker sync");
  assert(routeSource.includes("updateWorkflowChangeProposalStatus"), "proposal lifecycle API route missing backend update call");
  assert(routeSource.includes("reviewNote"), "proposal lifecycle API route missing review note");
  assert(routeSource.includes("implementationStatus"), "proposal lifecycle API route missing implementation status");
  assert(validationRouteSource.includes("startWorkflowChangeProposalValidation"), "proposal validation API route missing backend launch call");
  return "workflow proposal status changes keep reviewer context and benchmark ownership";
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
