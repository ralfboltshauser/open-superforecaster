import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertBenchmarkPromotionDecisionAllowed,
  summarizeBenchmarkPromotionGateEvidence,
} from "../packages/backend/src/benchmark-service";
import {
  benchmarkHoldoutSplitIds,
  benchmarkPromotionGateBlockerIds,
  benchmarkPromotionGateStatusNeedsMoreEvidence,
  benchmarkPromotionGateStatusReview,
  minimumPromotionHoldoutCases,
  minimumPromotionPairedCases,
  minimumPromotionResultCases,
} from "../packages/backend/src/benchmark-promotion-policy";
import {
  calibrationGuardActivationStatusNeedsMoreResolvedForecasts,
  calibrationGuardActivationStatusReadyForReview,
} from "../packages/backend/src/calibration-guard-activation-policy";
import {
  calibrationGuardDefaultPlanSkippedReasonNotHoldoutReplay,
  calibrationGuardRecommendationPromoteForDefault,
  calibrationGuardRecommendationPromoteForHoldout,
  calibrationGuardValidationModeHoldoutReplay,
  calibrationGuardValidationModeSourceReplay,
} from "../packages/backend/src/calibration-guard-validation-policy";
import {
  blockerInsufficientPrimaryPairedCases,
  blockerInsufficientPrimaryPairedHoldoutCases,
  blockerInsufficientValidationCaseCoverage,
  blockerValidationGateNotPassing,
  blockerValidationRecommendationNotCandidateBetter,
  blockerValidationResultIncomplete,
  workflowChangeProposalImplementationStatuses,
  workflowChangeProposalStatuses,
  workflowProposalValidationReadinessBlockerIds,
} from "../packages/backend/src/workflow-proposal-policy";
import { qualityIssueCountBand, readAggregateQualitySnapshot, roundsUsedBand } from "../packages/backend/src/aggregate-quality-metadata";
import { adjustmentFromMedianBand, aggregateSideAgreementBand, attemptCountBand, finalAdjustmentDirection, finalComponentPositionBand, finalConfidenceShiftBand, finalInsideViewDeltaBand, insideViewDeltaBand, meanConfidenceDistanceBand, readAggregateStatsSnapshot } from "../packages/backend/src/aggregate-stats-metadata";
import { readBaselineSanitySnapshot } from "../packages/backend/src/baseline-sanity-metadata";
import { buildBinaryConfidenceSnapshot, readBinaryConfidenceSnapshot } from "../packages/backend/src/binary-confidence-metadata";
import { buildCalibrationGuardImpact } from "../packages/backend/src/calibration-guard-impact";
import { readCalibrationGuardSnapshot } from "../packages/backend/src/calibration-guard-metadata";
import { readCategoricalForecastSnapshot } from "../packages/backend/src/categorical-forecast-metadata";
import { buildComponentWeightingSnapshot, readComponentWeightingSnapshot } from "../packages/backend/src/component-weighting-metadata";
import { readConditionalForecastSnapshot } from "../packages/backend/src/conditional-forecast-metadata";
import { readDateForecastSnapshot } from "../packages/backend/src/date-forecast-metadata";
import { readEvidenceCoverageSnapshot } from "../packages/backend/src/evidence-coverage-metadata";
import { FORECAST_BATCH_HEALTH_REPORT_PATH, readLatestForecastBatchHealth } from "../packages/backend/src/forecast-batch-health";
import { contextCompletenessScore, readForecastInputContextSnapshot, requestedRoutedTypeBand } from "../packages/backend/src/forecast-input-context-metadata";
import { readForecastRunSnapshot } from "../packages/backend/src/forecast-run-metadata";
import { readMarketAnchorSnapshot } from "../packages/backend/src/market-anchor-metadata";
import { readNumericForecastSnapshot } from "../packages/backend/src/numeric-forecast-metadata";
import { buildBinaryCalibrationReport } from "../packages/backend/src/performance-calibration";
import { readResolutionBoundarySnapshot } from "../packages/backend/src/resolution-boundary-metadata";
import { readThresholdedForecastSnapshot } from "../packages/backend/src/thresholded-forecast-metadata";
import { readUncertaintyRangeSnapshot } from "../packages/backend/src/uncertainty-range-metadata";
import { canonicalCitedSourceKey } from "../packages/workflow-contracts/src/index";
import { buildBinaryBaselineSanityAudit } from "../packages/workflows/src/binary-baseline-sanity";
import { applyBinaryCalibrationGuard, BINARY_CALIBRATION_GUARD_RULES } from "../packages/workflows/src/binary-calibration-guard";
import { buildBinaryMarketAnchorAudit } from "../packages/workflows/src/binary-market-anchor";
import { buildBinaryResolutionBoundaryAudit } from "../packages/workflows/src/binary-resolution-boundary";
import { buildBinaryUncertaintyRangeAudit } from "../packages/workflows/src/binary-uncertainty-range";
import { collectCitedSources, collectKeyUncertainties } from "../packages/workflows/src/forecast-evidence";
import { readForecastTiming } from "../packages/workflows/src/forecast-timing";
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
        activationStatus: calibrationGuardActivationStatusReadyForReview,
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
  const markdown = await readFile(resolve(outputDir, "contract-batch", "batch-index.md"), "utf8");
  assert(attentionItems.length === 1, "attention item was not copied into audit");
  assert(readString(attentionItems[0], "reviewStatus") === "reviewed", "review status was not merged");
  assert(markdown.includes("Reason | Recommended action"), "batch index markdown missing attention reason column");
  assert(markdown.includes("Kind | Forecast type | Metric"), "batch index markdown missing attention forecast type column");
  assert(markdown.includes("brier exceeded review threshold"), "batch index markdown does not render attention reason");
  assert(markdown.includes("poor_resolved_forecast | binary | brier"), "batch index markdown does not render attention forecast type");
  assert(candidateGuardRules.length === 1, "candidate calibration guard was not copied into audit");
  assert(readString(candidateGuardRules[0], "reviewStatus") === "deferred", "candidate calibration guard review status was not merged");
  const batchIndexSource = await readFile(resolve(root, "scripts/forecast-batch-index.ts"), "utf8");
  assert(batchIndexSource.includes("summarizeForecastAttentionReviewStatuses"), "batch index does not use shared attention review status counts");
  assert(!batchIndexSource.includes("isAttentionReviewStatus"), "batch index should not use the review helper as a policy validator");
  assert(!batchIndexSource.includes("function isReviewStatus("), "batch index should not keep local review status validation");
  return "batch index joins ops, resolution, and performance phases";
});

await check("forecast review helper upserts local attention reviews", async () => {
  const reviewsFile = resolve(tempRoot, "review-helper", "reviews.json");
  await mkdir(resolve(tempRoot, "review-helper"), { recursive: true });
  await writeJson(reviewsFile, {
    reviews: [
      {
        id: "poor:task-2:brier",
        status: "deferred",
        note: "Legacy review shape.",
        reviewedBy: "legacy-check",
        reviewedAt: "2026-07-09T00:03:00.000Z",
      },
    ],
  });
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
  assert(readString(reviews[0], "reviewer") === "contract-check", "review alias shape was not normalized before upsert");
  return "forecast review helper safely upserts local review records";
});

await check("forecast calibration guard proposals require reviewed ready candidates", async () => {
  const batchIndexRoot = resolve(tempRoot, "calibration-guard-proposals", "batches", "contract-batch");
  const outputDir = resolve(tempRoot, "calibration-guard-proposals", "out");
  const proposalSource = await readFile(resolve(root, "scripts/forecast-calibration-guard-proposals.ts"), "utf8");
  const batchIndexReaderSource = await readFile(resolve(root, "packages/backend/src/forecast-batch-index-artifacts.ts"), "utf8");
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
        activationStatus: calibrationGuardActivationStatusReadyForReview,
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
        activationStatus: calibrationGuardActivationStatusNeedsMoreResolvedForecasts,
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
        activationStatus: calibrationGuardActivationStatusReadyForReview,
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
  assert(readNumber(summary, "skippedOpen") === 1, "skipped open candidate count mismatch");
  assert(readNumber(summary, "skippedDeferred") === 1, "skipped deferred candidate count mismatch");
  assert(readString(proposals[0], "sourceCandidateGuardId") === "candidate-guard:80-100%", "wrong candidate guard became a proposal");
  assert(readString(proposals[0], "targetWorkflowId") === "binary-calibration-guard", "proposal target workflow mismatch");
  assert(proposalSource.includes("readForecastBatchIndexArtifacts"), "calibration guard proposal generator does not use the shared batch-index artifact reader");
  assert(proposalSource.includes("summarizeForecastAttentionReviewStatuses"), "calibration guard proposal generator does not use shared review status counts");
  assert(proposalSource.includes("normalizeForecastAttentionReviewStatus"), "calibration guard proposal generator does not use shared review status normalization");
  assert(proposalSource.includes("isForecastAttentionReviewOpen"), "calibration guard proposal generator does not use shared open review policy");
  assert(proposalSource.includes("isForecastAttentionReviewResolved"), "calibration guard proposal generator does not use shared resolved review policy");
  assert(proposalSource.includes("isForecastAttentionReviewDeferred"), "calibration guard proposal generator does not use shared deferred review policy");
  assert(proposalSource.includes("reportRoot: batchRoot"), "calibration guard proposal generator does not pass its configured batch-index directory to the shared reader");
  assert(!proposalSource.includes("listFilesNamed(batchRoot"), "calibration guard proposal generator should not keep a local batch-index scanner");
  assert(!proposalSource.includes("readRecordArray(batchIndex"), "calibration guard proposal generator should not parse candidate rules from raw batch-index JSON");
  assert(!proposalSource.includes("function readReviewStatus("), "calibration guard proposal generator should not keep a local review status reader");
  assert(!proposalSource.includes("reviewStatus === \"open\""), "calibration guard proposal generator should not keep local open review checks");
  assert(!proposalSource.includes("reviewStatus === \"deferred\""), "calibration guard proposal generator should not keep local deferred review checks");
  assert(!proposalSource.includes("reviewStatus === \"reviewed\""), "calibration guard proposal generator should not keep local resolved review checks");
  assert(batchIndexReaderSource.includes("candidateCalibrationGuardRules"), "shared batch-index reader does not expose candidate calibration guard rules");
  return "reviewed ready calibration guard candidates become proposal drafts";
});

await check("forecast calibration guard validation replays proposal impact", async () => {
  const fixtureRoot = resolve(tempRoot, "calibration-guard-validation");
  const proposalsDir = resolve(fixtureRoot, "proposals");
  const performanceDir = resolve(fixtureRoot, "performance", "contract-batch");
  const holdoutPerformanceDir = resolve(fixtureRoot, "performance", "holdout-batch");
  const outputDir = resolve(fixtureRoot, "out");
  const validationSource = await readFile(resolve(root, "scripts/forecast-calibration-guard-validation.ts"), "utf8");
  const validationPolicySource = await readFile(resolve(root, "packages/backend/src/calibration-guard-validation-policy.ts"), "utf8");
  const proposalReaderSource = await readFile(resolve(root, "packages/backend/src/calibration-guard-proposal-artifacts.ts"), "utf8");
  const performanceReaderSource = await readFile(resolve(root, "packages/backend/src/forecast-performance-artifacts.ts"), "utf8");
  const backendIndexSource = await readFile(resolve(root, "packages/backend/src/index.ts"), "utf8");
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
  assert(readString(validations[0], "recommendation") === calibrationGuardRecommendationPromoteForHoldout, "wrong validation recommendation");
  assert(readString(validations[0], "validationMode") === calibrationGuardValidationModeSourceReplay, "source validation mode mismatch");
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
  assert(readString(holdoutValidations[0], "validationMode") === calibrationGuardValidationModeHoldoutReplay, "holdout validation mode mismatch");
  assert(readString(holdoutValidations[0], "recommendation") === calibrationGuardRecommendationPromoteForDefault, "holdout recommendation mismatch");
  assert(validationSource.includes("readCalibrationGuardProposalArtifacts"), "calibration validation does not use the shared proposal artifact reader");
  assert(validationSource.includes("readForecastPerformanceArtifacts"), "calibration validation does not use the shared performance artifact reader");
  assert(validationSource.includes("calibrationGuardValidationModeHoldoutReplay"), "calibration validation does not use shared validation mode policy");
  assert(validationSource.includes("calibrationGuardRecommendationPromoteForDefault"), "calibration validation does not use shared recommendation policy");
  assert(validationPolicySource.includes("isCalibrationGuardDefaultPromotionCandidate"), "calibration validation policy does not expose the default promotion predicate");
  assert(validationPolicySource.includes("calibrationGuardDefaultPlanSkippedReasonForValidation"), "calibration validation policy does not expose skipped-row reason mapping");
  assert(validationSource.includes("reportRoot: performanceRoot"), "calibration validation does not pass the configured performance directory to the shared reader");
  assert(!validationSource.includes("listFilesNamed(performanceRoot"), "calibration validation should not keep a local performance artifact scanner");
  assert(!validationSource.includes("readRecordArray(input.proposals"), "calibration validation should not parse proposal drafts from raw JSON");
  assert(!validationSource.includes("readRecordArray(input.performance"), "calibration validation should not parse replay rows from raw JSON");
  assert(proposalReaderSource.includes("proposalDrafts"), "shared proposal reader does not expose proposal drafts");
  assert(performanceReaderSource.includes("calibrationReplayRows"), "shared performance reader does not expose calibration replay rows");
  assert(backendIndexSource.includes("calibration-guard-proposal-artifacts"), "backend package barrel does not export calibration proposal artifacts");
  assert(backendIndexSource.includes("calibration-guard-validation-policy"), "backend package barrel does not export calibration validation policy");
  assert(backendIndexSource.includes("forecast-performance-artifacts"), "backend package barrel does not export forecast performance artifacts");
  return "calibration guard proposals are replayed before promotion";
});

await check("forecast calibration default plan requires held-out promotion", async () => {
  const fixtureRoot = resolve(tempRoot, "calibration-guard-default-plan");
  const validationDir = resolve(fixtureRoot, "validation");
  const outputDir = resolve(fixtureRoot, "out");
  const defaultPlanSource = await readFile(resolve(root, "scripts/forecast-calibration-guard-default-plan.ts"), "utf8");
  await mkdir(validationDir, { recursive: true });
  await writeJson(resolve(validationDir, "calibration-guard-validation.json"), {
    reportType: "forecast_calibration_guard_validation",
    generatedAt: "2026-07-09T00:09:00.000Z",
    validations: [
      {
        validationMode: calibrationGuardValidationModeHoldoutReplay,
        proposalId: "calibration-guard-proposal:contract-batch:candidate-guard:80-100%",
        sourceCandidateGuardId: "candidate-guard:80-100%",
        bucketLabel: "80-100%",
        suggestedAdjustment: -15,
        matchedRows: 3,
        brierDelta: -0.12,
        calibrationErrorDelta: -15,
        recommendation: calibrationGuardRecommendationPromoteForDefault,
      },
      {
        validationMode: calibrationGuardValidationModeSourceReplay,
        proposalId: "calibration-guard-proposal:contract-batch:candidate-guard:60-80%",
        sourceCandidateGuardId: "candidate-guard:60-80%",
        bucketLabel: "60-80%",
        suggestedAdjustment: 5,
        matchedRows: 4,
        brierDelta: -0.03,
        calibrationErrorDelta: -5,
        recommendation: calibrationGuardRecommendationPromoteForHoldout,
      },
      {
        validationMode: calibrationGuardValidationModeHoldoutReplay,
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
  const issues = readArray(report, "issues");
  const markdown = await readFile(resolve(outputDir, "calibration-guard-default-plan.md"), "utf8");
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
  assert(readNumber(summary, "issues") === 0, "fresh default plan should not report artifact issues");
  assert(issues.length === 0, "fresh default plan issue rows should be empty");
  assert(markdown.includes("## Issues"), "default plan markdown missing issues section");
  await mkdir(resolve(validationDir, "newer"), { recursive: true });
  await writeJson(resolve(validationDir, "newer", "calibration-guard-validation.json"), {
    reportType: "forecast_calibration_guard_validation",
    generatedAt: "2026-07-10T00:09:00.000Z",
    validations: readArray(await readJson(resolve(validationDir, "calibration-guard-validation.json")), "validations"),
  });
  await runScript("scripts/forecast-calibration-guard-default-plan.ts", [
    "--validation-report",
    resolve(validationDir, "calibration-guard-validation.json"),
    "--validation-report-dir",
    validationDir,
    "--out-dir",
    outputDir,
  ]);
  const staleReport = readRecord(await readJson(resolve(outputDir, "calibration-guard-default-plan.json")));
  const staleSummary = readRecord(staleReport, "summary");
  const staleIssues = readArray(staleReport, "issues");
  const staleMarkdown = await readFile(resolve(outputDir, "calibration-guard-default-plan.md"), "utf8");
  assert(readNumber(staleSummary, "issues") === 1, "stale default plan should report one artifact issue");
  assert(staleIssues.some((issue) => readString(issue, "kind") === "validation_report_stale"), "default plan missing stale validation report issue");
  assert(staleMarkdown.includes("validation_report_stale"), "default plan markdown missing stale validation report issue");
  assert(defaultPlanSource.includes("readCalibrationGuardValidationArtifacts"), "default-plan generator does not use the shared calibration validation artifact reader");
  assert(defaultPlanSource.includes("isCalibrationGuardDefaultPromotionCandidate"), "default-plan generator does not use shared default promotion predicate");
  assert(defaultPlanSource.includes("calibrationGuardDefaultPlanSkippedReasonForValidation"), "default-plan generator does not use shared skipped-row reason policy");
  assert(defaultPlanSource.includes("reportRoot: validationReportDir"), "default-plan generator does not pass its configured validation directory to the shared reader");
  assert(!defaultPlanSource.includes("listFilesNamed(validationRoot"), "default-plan generator should not keep a local validation artifact scanner");
  assert(!defaultPlanSource.includes("readRecordArray(input.validationPayload"), "default-plan generator should not parse validation rows from raw JSON");
  return "held-out default promotions become explicit manual implementation plans with validation freshness issues";
});

await check("forecast attention backlog filters batch review status", async () => {
  const batchIndexRoot = resolve(tempRoot, "attention-backlog", "batches");
  const validationRoot = resolve(tempRoot, "attention-backlog", "validations");
  const defaultPlanRoot = resolve(tempRoot, "attention-backlog", "default-plan");
  const outputDir = resolve(tempRoot, "attention-backlog", "out");
  const reviewsFile = resolve(tempRoot, "attention-backlog", "reviews.json");
  await mkdir(resolve(batchIndexRoot, "contract-batch"), { recursive: true });
  await mkdir(validationRoot, { recursive: true });
  await mkdir(defaultPlanRoot, { recursive: true });
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
        activationStatus: calibrationGuardActivationStatusReadyForReview,
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
        recommendation: calibrationGuardRecommendationPromoteForHoldout,
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
  await writeJson(resolve(defaultPlanRoot, "calibration-guard-default-plan.json"), {
    reportType: "forecast_calibration_guard_default_plan",
    skippedRows: [
      {
        proposalId: "calibration-guard-proposal:contract-batch:candidate-guard:80-100%",
        bucketLabel: "80-100%",
        recommendation: calibrationGuardRecommendationPromoteForHoldout,
        validationMode: calibrationGuardValidationModeSourceReplay,
        reason: calibrationGuardDefaultPlanSkippedReasonNotHoldoutReplay,
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
    "--default-plan-report-dir",
    defaultPlanRoot,
    "--reviews-file",
    reviewsFile,
    "--out-dir",
    outputDir,
    "--status",
    "deferred",
  ]);
  const report = readRecord(await readJson(resolve(outputDir, "attention-backlog.json")));
  const markdown = await readFile(resolve(outputDir, "attention-backlog.md"), "utf8");
  const backlogSource = await readFile(resolve(root, "scripts/forecast-attention-backlog.ts"), "utf8");
  const defaultPlanReaderSource = await readFile(resolve(root, "packages/backend/src/calibration-default-plan-artifacts.ts"), "utf8");
  const counts = readRecord(report, "counts");
  const byForecastType = readArray(report, "byForecastType");
  const byKind = readArray(report, "byKind");
  const items = readArray(report, "items");
  assert(report, "backlog report is not an object");
  assert(readString(report, "reportType") === "forecast_attention_backlog", "report type mismatch");
  assert(readString(readRecord(report, "paths"), "defaultPlanReportDir") === defaultPlanRoot, "backlog report missing default-plan report path");
  assert(backlogSource.includes("readForecastBatchIndexArtifacts"), "attention backlog does not use the shared batch-index artifact reader");
  assert(backlogSource.includes("reportRoot: batchRoot"), "attention backlog does not pass its configured batch-index directory to the shared reader");
  assert(!backlogSource.includes("listFilesNamed(batchRoot"), "attention backlog should not keep a local batch-index scanner");
  assert(backlogSource.includes("readCalibrationGuardValidationArtifacts"), "attention backlog does not use the shared calibration validation artifact reader");
  assert(backlogSource.includes("reportRoot: validationRoot"), "attention backlog does not pass its configured validation report directory to the shared reader");
  assert(!backlogSource.includes("listFilesNamed(validationRoot"), "attention backlog should not keep a local validation artifact scanner");
  assert(backlogSource.includes("readCalibrationDefaultPlanArtifacts"), "attention backlog does not use the shared default-plan artifact reader");
  assert(backlogSource.includes("reportRoot: defaultPlanRoot"), "attention backlog does not pass its configured default-plan report directory to the shared reader");
  assert(!backlogSource.includes("listFilesNamed(defaultPlanRoot"), "attention backlog should not keep a local default-plan artifact scanner");
  const validationReaderSource = await readFile(resolve(root, "packages/backend/src/calibration-guard-validation-artifacts.ts"), "utf8");
  assert(validationReaderSource.includes("reportRoot?: string"), "shared calibration validation reader does not support custom report roots");
  assert(defaultPlanReaderSource.includes("reportRoot?: string"), "shared default-plan reader does not support custom report roots");
  assert(counts, "backlog counts missing");
  assert(readNumber(counts, "items") === 3, "filtered item count mismatch");
  assert(readNumber(counts, "deferred") === 3, "deferred item count mismatch");
  const binaryType = byForecastType.find((row) => readString(row, "forecastType") === "binary");
  const numericType = byForecastType.find((row) => readString(row, "forecastType") === "numeric");
  assert(binaryType, "binary backlog forecast-type breakdown missing");
  assert(numericType, "numeric backlog forecast-type breakdown missing");
  assert(readNumber(binaryType, "items") === 2, "binary backlog forecast-type item count mismatch");
  assert(readNumber(binaryType, "deferred") === 2, "binary backlog forecast-type deferred count mismatch");
  assert(readNumber(binaryType, "high") === 2, "binary backlog forecast-type severity count mismatch");
  assert(readNumber(numericType, "items") === 1, "numeric backlog forecast-type item count mismatch");
  assert(readNumber(numericType, "medium") === 1, "numeric backlog forecast-type severity count mismatch");
  const scoreRegressionKind = byKind.find((row) => readString(row, "kind") === "forecast_score_regression");
  const candidateGuardKind = byKind.find((row) => readString(row, "kind") === "candidate_calibration_guard");
  const validationKind = byKind.find((row) => readString(row, "kind") === "calibration_guard_holdout_candidate");
  assert(scoreRegressionKind, "score-regression backlog kind breakdown missing");
  assert(candidateGuardKind, "candidate guard backlog kind breakdown missing");
  assert(validationKind, "validation backlog kind breakdown missing");
  assert(readNumber(scoreRegressionKind, "items") === 1, "score-regression backlog kind item count mismatch");
  assert(readNumber(candidateGuardKind, "high") === 1, "candidate guard backlog kind severity count mismatch");
  assert(readNumber(validationKind, "deferred") === 1, "validation backlog kind deferred count mismatch");
  assert(markdown.includes("Reason | Recommended action"), "attention backlog markdown missing reason column");
  assert(markdown.includes("Kind | Forecast type | Metric"), "attention backlog markdown missing forecast type column");
  assert(markdown.includes("## Forecast Types"), "attention backlog markdown missing forecast-type summary");
  assert(markdown.includes("| binary | 2 | 0 | 2 | 0 | 2 | 0 | 0 |"), "attention backlog markdown missing binary forecast-type summary row");
  assert(markdown.includes("| numeric | 1 | 0 | 1 | 0 | 0 | 1 | 0 |"), "attention backlog markdown missing numeric forecast-type summary row");
  assert(markdown.includes("## Kinds"), "attention backlog markdown missing kind summary");
  assert(markdown.includes("| candidate_calibration_guard | 1 | 0 | 1 | 0 | 1 | 0 | 0 |"), "attention backlog markdown missing candidate guard kind summary row");
  assert(markdown.includes("| calibration_guard_holdout_candidate | 1 | 0 | 1 | 0 | 1 | 0 | 0 |"), "attention backlog markdown missing validation kind summary row");
  assert(markdown.includes("| forecast_score_regression | 1 | 0 | 1 | 0 | 0 | 1 | 0 |"), "attention backlog markdown missing score-regression kind summary row");
  assert(markdown.includes("log score worsened"), "attention backlog markdown does not render attention reason");
  assert(markdown.includes("forecast_score_regression | numeric | logScore"), "attention backlog markdown does not render attention forecast type");
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
    "--default-plan-report-dir",
    defaultPlanRoot,
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
  const skippedDefaultPlanItem = openItems.find((item) => readString(item, "kind") === "calibration_guard_default_plan_not_holdout_replay");
  assert(validationItem, "calibration guard validation backlog item missing");
  assert(skippedDefaultPlanItem, "calibration guard default-plan skipped backlog item missing");
  assert(readString(validationItem, "batchId") === "contract-batch", "validation backlog batch id mismatch");
  assert(readString(skippedDefaultPlanItem, "batchId") === "contract-batch", "default-plan skipped backlog batch id mismatch");
  assert(readString(validationItem, "reviewStatus") === "open", "validation backlog item should start open");
  assert(readString(skippedDefaultPlanItem, "reviewStatus") === "open", "default-plan skipped backlog item should start open");
  assert(!openItems.some((item) => readString(item, "id")?.includes("candidate-guard:20-40%")), "rejected validation should not enter backlog");
  return "attention backlog reads batch indexes and filters review status";
});

await check("forecast batch health summarizes latest indexed batch", async () => {
  const batchIndexRoot = resolve(tempRoot, "batch-health", "batches");
  const attentionBacklogRoot = resolve(tempRoot, "batch-health", "attention-backlog");
  const outputDir = resolve(tempRoot, "batch-health", "out");
  await mkdir(resolve(batchIndexRoot, "old-batch"), { recursive: true });
  await mkdir(resolve(batchIndexRoot, "latest-batch"), { recursive: true });
  await mkdir(attentionBacklogRoot, { recursive: true });
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
      attentionItems: 4,
      openAttentionItems: 3,
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
      {
        id: "calibration-guard-impact:worse-brier",
        kind: "calibration_guard_regression",
        severity: "high",
        reason: "Guarded aggregates are scoring worse.",
        recommendedActions: ["Review guarded aggregate forecasts."],
        metric: "brier",
        score: 0.35,
        delta: 0.1,
        taskId: null,
        taskLabel: "Calibration guard impact",
        forecastType: "binary",
        reviewStatus: "open",
      },
      {
        id: "evidence-coverage:task-4:brier",
        kind: "evidence_coverage_miss",
        severity: "high",
        reason: "brier 0.5 followed sparse evidence coverage.",
        recommendedActions: ["Audit cited sources."],
        metric: "brier",
        score: 0.5,
        delta: 1,
        taskId: "task-4",
        taskLabel: "Sparse evidence forecast",
        forecastType: "binary",
        reviewStatus: "open",
        reviewNote: "Investigate thin source coverage before rerun.",
        reviewer: "contract-check",
        reviewedAt: "2026-07-09T00:06:00.000Z",
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
        activationStatus: calibrationGuardActivationStatusReadyForReview,
        rationale: "80-100% binary aggregates are overforecasting.",
        reviewNote: "Validate on a held-out batch first.",
        reviewer: "contract-check",
        reviewedAt: "2026-07-09T00:07:00.000Z",
      },
    ],
  });
  await writeJson(resolve(attentionBacklogRoot, "attention-backlog.json"), {
    reportType: "forecast_attention_backlog",
    generatedAt: "2026-07-09T00:05:00.000Z",
    filters: {
      statuses: ["open", "deferred"],
      batchIds: [],
    },
    counts: {
      items: 4,
      open: 3,
      deferred: 1,
      reviewed: 0,
      high: 1,
      medium: 2,
      low: 1,
    },
    byForecastType: [],
    byKind: [],
    items: [
      {
        batchId: "latest-batch",
        id: "calibration-default-plan-skipped:latest-batch:80-100%",
        reviewStatus: "open",
        severity: "low",
        kind: "calibration_guard_default_plan_not_holdout_replay",
        reason: "80-100% default-plan row skipped: not_holdout_replay.",
        recommendedActions: ["Run a held-out calibration validation before considering 80-100% as a default calibration guard."],
        metric: "default_plan_skip",
        score: null,
        delta: null,
        taskId: null,
        taskLabel: "80-100% default-plan skip",
        forecastType: "binary",
        sourcePath: "calibration-guard-default-plan.json",
      },
      {
        batchId: "latest-batch",
        id: "poor:task-1:brier",
        reviewStatus: "open",
        severity: "high",
        kind: "poor_resolved_forecast",
        reason: "duplicate batch-index item should not inflate health",
        recommendedActions: ["Open the run report."],
        metric: "brier",
        score: 0.4,
        delta: null,
        taskId: "task-1",
        taskLabel: "Hard forecast",
        forecastType: "binary",
        sourcePath: "batch-index.json",
      },
      {
        batchId: "latest-batch",
        id: "candidate-guard:80-100%",
        reviewStatus: "open",
        severity: "high",
        kind: "candidate_calibration_guard",
        reason: "duplicate candidate guard should stay in candidate guard table only",
        recommendedActions: ["Review candidate guard."],
        metric: "calibration_error",
        score: 90,
        delta: -15,
        taskId: null,
        taskLabel: "80-100% candidate calibration guard",
        forecastType: "binary",
        sourcePath: "batch-index.json",
      },
      {
        batchId: "other-batch",
        id: "calibration-default-plan-skipped:other-batch:60-80%",
        reviewStatus: "open",
        severity: "medium",
        kind: "calibration_guard_default_plan_not_promoted_for_default",
        reason: "other batch should not inflate latest batch health",
        recommendedActions: ["Review other batch."],
        metric: "default_plan_skip",
        score: null,
        delta: null,
        taskId: null,
        taskLabel: "60-80% default-plan skip",
        forecastType: "binary",
        sourcePath: "calibration-guard-default-plan.json",
      },
    ],
    paths: {
      json: resolve(attentionBacklogRoot, "attention-backlog.json"),
      markdown: resolve(attentionBacklogRoot, "attention-backlog.md"),
      batchIndexDir: batchIndexRoot,
      validationReportDir: "validation",
      defaultPlanReportDir: "default-plan",
      reviews: "reviews.json",
    },
  });
  await runScript("scripts/forecast-batch-health.ts", [
    "--batch-index-dir",
    batchIndexRoot,
    "--attention-backlog-dir",
    attentionBacklogRoot,
    "--out-dir",
    outputDir,
  ]);
  const report = readRecord(await readJson(resolve(outputDir, "batch-health.json")));
  const summary = readRecord(report, "summary");
  const missingPhases = readStringArray(report, "missingPhases");
  const issues = readArray(report, "issues");
  const attentionByKind = readArray(report, "attentionByKind");
  const attentionBySeverity = readArray(report, "attentionBySeverity");
  const attentionByForecastType = readArray(report, "attentionByForecastType");
  const attentionItems = readArray(report, "attentionItems");
  const candidateRules = readArray(report, "candidateCalibrationGuardRules");
  const markdown = await readFile(resolve(outputDir, "batch-health.md"), "utf8");
  assert(report, "health report is not an object");
  assert(readString(report, "reportType") === "forecast_batch_health", "health report type mismatch");
  assert(readString(report, "batchId") === "latest-batch", "latest batch was not selected");
  assert(readString(report, "status") === "needs_attention", "health status mismatch");
  assert(summary, "health summary missing");
  assert(readNumber(summary, "failedForecasts") === 1, "failed forecast summary mismatch");
  assert(readNumber(summary, "unresolvedAttentionItems") === 5, "unresolved attention summary mismatch");
  assert(readNumber(summary, "scoreRegressionItems") === 1, "score regression summary mismatch");
  assert(readNumber(summary, "calibrationGuardRegressionItems") === 1, "calibration guard regression summary mismatch");
  assert(readNumber(summary, "unresolvedCandidateCalibrationGuardRules") === 1, "unresolved candidate calibration guard summary mismatch");
  const evidenceKind = attentionByKind.find((row) => readString(row, "kind") === "evidence_coverage_miss");
  const highSeverity = attentionBySeverity.find((row) => readString(row, "severity") === "high");
  const binaryType = attentionByForecastType.find((row) => readString(row, "forecastType") === "binary");
  const numericType = attentionByForecastType.find((row) => readString(row, "forecastType") === "numeric");
  assert(evidenceKind, "attention kind breakdown missing evidence coverage misses");
  assert(readNumber(evidenceKind, "open") === 1, "attention kind breakdown open count mismatch");
  assert(readNumber(evidenceKind, "unresolved") === 1, "attention kind breakdown unresolved count mismatch");
  const defaultPlanKind = attentionByKind.find((row) => readString(row, "kind") === "calibration_guard_default_plan_not_holdout_replay");
  assert(defaultPlanKind, "attention kind breakdown missing supplemental default-plan skipped row");
  assert(readNumber(defaultPlanKind, "open") === 1, "supplemental default-plan skipped row open count mismatch");
  assert(highSeverity, "attention severity breakdown missing high severity");
  assert(readNumber(highSeverity, "open") === 3, "attention severity open count mismatch");
  assert(readNumber(highSeverity, "unresolved") === 3, "attention severity unresolved count mismatch");
  assert(binaryType, "attention forecast-type breakdown missing binary rows");
  assert(readNumber(binaryType, "open") === 4, "attention forecast-type binary open count mismatch");
  assert(readNumber(binaryType, "unresolved") === 4, "attention forecast-type binary unresolved count mismatch");
  assert(numericType, "attention forecast-type breakdown missing numeric rows");
  assert(readNumber(numericType, "deferred") === 1, "attention forecast-type numeric deferred count mismatch");
  assert(readNumber(numericType, "unresolved") === 1, "attention forecast-type numeric unresolved count mismatch");
  assert(markdown.includes("## Attention Breakdown"), "health markdown missing attention breakdown");
  assert(markdown.includes("## Attention Forecast Types"), "health markdown missing attention forecast-type breakdown");
  assert(markdown.includes("Review note"), "health markdown missing review note column");
  assert(markdown.includes("Source"), "health markdown missing source column");
  assert(markdown.includes("Investigate thin source coverage before rerun."), "health markdown missing attention review note");
  assert(markdown.includes("Validate on a held-out batch first."), "health markdown missing candidate guard review note");
  assert(markdown.includes("Attention backlog:"), "health markdown missing attention backlog path");
  assert(markdown.includes("calibration_guard_default_plan_not_holdout_replay"), "health markdown missing supplemental default-plan skipped row");
  assert(markdown.includes("calibration-guard-default-plan.json"), "health markdown missing supplemental attention source path");
  assert(markdown.includes("evidence_coverage_miss"), "health markdown missing attention kind row");
  assert(markdown.includes("| binary | 4 | 4 | 0 | 0 | 3 | 0 | 1 |"), "health markdown missing binary forecast-type row with supplemental item");
  assert(markdown.includes("| numeric | 1 | 0 | 1 | 0 | 0 | 1 | 0 |"), "health markdown missing numeric forecast-type row");
  const evidenceItem = attentionItems.find((item) => readString(item, "id") === "evidence-coverage:task-4:brier");
  const defaultPlanItem = attentionItems.find((item) => readString(item, "id") === "calibration-default-plan-skipped:latest-batch:80-100%");
  const candidateRule = candidateRules.find((rule) => readString(rule, "id") === "candidate-guard:80-100%");
  assert(evidenceItem && readString(evidenceItem, "reviewNote") === "Investigate thin source coverage before rerun.", "health report did not preserve attention review note");
  assert(evidenceItem && readString(evidenceItem, "reviewer") === "contract-check", "health report did not preserve attention reviewer");
  assert(defaultPlanItem, "health report missing supplemental default-plan skipped item from attention backlog");
  assert(defaultPlanItem && readString(defaultPlanItem, "sourcePath") === "calibration-guard-default-plan.json", "health report did not preserve supplemental attention source path");
  assert(evidenceItem && readString(evidenceItem, "sourcePath")?.endsWith("latest-batch/batch-index.json"), "health report did not preserve batch-index attention source path");
  assert(attentionItems.filter((item) => readString(item, "id") === "poor:task-1:brier").length === 1, "health report duplicated batch-index attention item");
  assert(!attentionItems.some((item) => readString(item, "id") === "candidate-guard:80-100%"), "health report duplicated candidate guard as attention item");
  assert(candidateRule && readString(candidateRule, "reviewNote") === "Validate on a held-out batch first.", "health report did not preserve candidate guard review note");
  assert(missingPhases.includes("forecast_performance"), "missing performance phase was not reported");
  assert(issues.some((issue) => readString(issue, "kind") === "failed_forecasts"), "failed forecast issue missing");
  assert(issues.some((issue) => readString(issue, "kind") === "calibration_guard_regression"), "calibration guard regression issue missing");
  assert(issues.some((issue) => readString(issue, "kind") === "candidate_calibration_guard_review"), "candidate calibration guard issue missing");
  const healthSource = await readFile(resolve(root, "scripts/forecast-batch-health.ts"), "utf8");
  assert(healthSource.includes("evaluateAttentionBacklogArtifactCompatibility"), "batch health does not use the shared attention backlog artifact compatibility evaluator");
  assert(healthSource.includes("../packages/backend/src/forecast-attention-backlog"), "batch health does not import the shared attention backlog helper");
  assert(healthSource.includes("readForecastAttentionBacklogArtifacts"), "batch health does not use the shared attention backlog artifact reader");
  assert(healthSource.includes("readForecastBatchIndexArtifacts"), "batch health does not use the shared batch-index artifact reader");
  assert(healthSource.includes("unresolved: reviewCounts.unresolved"), "batch health does not persist shared unresolved review counts in breakdowns");
  assert(healthSource.includes("row.unresolved > 0"), "batch health issue summaries do not use shared unresolved breakdown counts");
  assert(healthSource.includes("`${row.kind}=${row.unresolved}`"), "batch health top-kind issue summaries do not render shared unresolved breakdown counts");
  assert(healthSource.includes("right.unresolved - left.unresolved"), "batch health breakdown sorting does not use shared unresolved counts");
  assert(!healthSource.includes("openAttentionItems + summary.deferredAttentionItems"), "batch health should not derive unresolved attention counts locally");
  assert(!healthSource.includes("openCandidateCalibrationGuardRules + summary.deferredCandidateCalibrationGuardRules"), "batch health should not derive unresolved candidate guard counts locally");
  assert(!healthSource.includes("row.open + row.deferred"), "batch health should not derive unresolved attention breakdown counts locally");
  assert(!healthSource.includes("right.open + right.deferred"), "batch health should not sort by locally derived unresolved counts");
  assert(!healthSource.includes("left.open + left.deferred"), "batch health should not sort by locally derived unresolved counts");
  assert(!healthSource.includes("listFilesNamed(batchRoot"), "batch health should not keep a local batch-index scanner");
  assert(!healthSource.includes("listFilesNamed(backlogRoot"), "batch health should not keep a local attention backlog scanner");
  assert(!healthSource.includes("readRecordArray(attentionBacklog"), "batch health should not parse supplemental attention backlog rows from raw JSON");
  assert(!healthSource.includes("function readAttentionBacklogReviewsUpdatedAt"), "batch health should not keep a local attention backlog freshness reader");
  assert(!healthSource.includes("readStringArray(filters"), "batch health should not keep local attention backlog filter compatibility parsing");
  const attentionBacklogReaderSource = await readFile(resolve(root, "packages/backend/src/forecast-attention-backlog-artifacts.ts"), "utf8");
  const backendIndexSource = await readFile(resolve(root, "packages/backend/src/index.ts"), "utf8");
  assert(attentionBacklogReaderSource.includes("items: ForecastAttentionBacklogItem[]"), "shared attention backlog reader does not expose normalized items");
  assert(backendIndexSource.includes("forecast-attention-backlog-artifacts"), "backend package barrel does not export forecast attention backlog artifacts");
  assert((await readFile(resolve(root, "packages/backend/src/forecast-batch-index-artifacts.ts"), "utf8")).includes("counts: ForecastBatchIndexCounts"), "shared batch-index reader does not expose normalized counts");
  return "batch health summarizes latest indexed batch issues";
});

await check("forecast batch health rejects incompatible attention backlog filters", async () => {
  const batchIndexRoot = resolve(tempRoot, "batch-health-filtered-backlog", "batches");
  const attentionBacklogRoot = resolve(tempRoot, "batch-health-filtered-backlog", "attention-backlog");
  const outputDir = resolve(tempRoot, "batch-health-filtered-backlog", "out");
  await mkdir(resolve(batchIndexRoot, "filtered-batch"), { recursive: true });
  await mkdir(attentionBacklogRoot, { recursive: true });
  await writeJson(resolve(batchIndexRoot, "filtered-batch", "batch-index.json"), {
    reportType: "forecast_batch_index",
    batchId: "filtered-batch",
    generatedAt: "2026-07-09T00:00:00.000Z",
    counts: {
      entries: 3,
      forecastOps: 1,
      resolutions: 1,
      performanceReports: 1,
      completedForecasts: 1,
      failedForecasts: 0,
      resolvedCases: 1,
      failedResolutions: 0,
      performanceScoreRows: 1,
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
  await writeJson(resolve(attentionBacklogRoot, "attention-backlog.json"), {
    reportType: "forecast_attention_backlog",
    generatedAt: "2026-07-09T00:05:00.000Z",
    filters: {
      statuses: ["reviewed"],
      batchIds: ["other-batch"],
    },
    counts: {
      items: 1,
      open: 0,
      deferred: 0,
      reviewed: 1,
      high: 0,
      medium: 1,
      low: 0,
    },
    byForecastType: [],
    byKind: [],
    items: [
      {
        batchId: "filtered-batch",
        id: "calibration-default-plan-skipped:filtered-batch:80-100%",
        reviewStatus: "open",
        severity: "medium",
        kind: "calibration_guard_default_plan_not_promoted_for_default",
        reason: "Filtered backlog item should not be merged.",
        recommendedActions: ["Review compatible backlog generation."],
        metric: "default_plan_skip",
        score: null,
        delta: null,
        taskId: null,
        taskLabel: "80-100% default-plan skip",
        forecastType: "binary",
        sourcePath: "calibration-guard-default-plan.json",
      },
    ],
  });
  await runScript("scripts/forecast-batch-health.ts", [
    "--batch-index-dir",
    batchIndexRoot,
    "--attention-backlog-dir",
    attentionBacklogRoot,
    "--out-dir",
    outputDir,
  ]);
  const report = readRecord(await readJson(resolve(outputDir, "batch-health.json")));
  const summary = readRecord(report, "summary");
  const issues = readArray(report, "issues");
  const attentionItems = readArray(report, "attentionItems");
  const markdown = await readFile(resolve(outputDir, "batch-health.md"), "utf8");
  assert(readNumber(summary, "unresolvedAttentionItems") === 0, "filtered attention backlog should not inflate unresolved health count");
  assert(!attentionItems.some((item) => readString(item, "id") === "calibration-default-plan-skipped:filtered-batch:80-100%"), "filtered attention backlog item was merged into health");
  assert(issues.some((issue) => readString(issue, "kind") === "attention_backlog_status_filter"), "health report missing attention backlog status-filter issue");
  assert(issues.some((issue) => readString(issue, "kind") === "attention_backlog_batch_filter"), "health report missing attention backlog batch-filter issue");
  assert(markdown.includes("attention_backlog_status_filter"), "health markdown missing attention backlog status-filter issue");
  assert(markdown.includes("attention_backlog_batch_filter"), "health markdown missing attention backlog batch-filter issue");
  return "batch health ignores filtered supplemental attention backlog reports";
});

await check("forecast batch health rejects stale attention backlog reports", async () => {
  const batchIndexRoot = resolve(tempRoot, "batch-health-stale-backlog", "batches");
  const attentionBacklogRoot = resolve(tempRoot, "batch-health-stale-backlog", "attention-backlog");
  const outputDir = resolve(tempRoot, "batch-health-stale-backlog", "out");
  await mkdir(resolve(batchIndexRoot, "fresh-batch"), { recursive: true });
  await mkdir(attentionBacklogRoot, { recursive: true });
  await writeJson(resolve(batchIndexRoot, "fresh-batch", "batch-index.json"), {
    reportType: "forecast_batch_index",
    batchId: "fresh-batch",
    generatedAt: "2026-07-09T01:00:00.000Z",
    counts: {
      entries: 3,
      forecastOps: 1,
      resolutions: 1,
      performanceReports: 1,
      completedForecasts: 1,
      failedForecasts: 0,
      resolvedCases: 1,
      failedResolutions: 0,
      performanceScoreRows: 1,
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
  await writeJson(resolve(attentionBacklogRoot, "attention-backlog.json"), {
    reportType: "forecast_attention_backlog",
    generatedAt: "2026-07-09T00:59:59.000Z",
    filters: {
      statuses: ["open", "deferred"],
      batchIds: [],
    },
    counts: {
      items: 1,
      open: 1,
      deferred: 0,
      reviewed: 0,
      high: 0,
      medium: 1,
      low: 0,
    },
    byForecastType: [],
    byKind: [],
    items: [
      {
        batchId: "fresh-batch",
        id: "calibration-default-plan-skipped:fresh-batch:80-100%",
        reviewStatus: "open",
        severity: "medium",
        kind: "calibration_guard_default_plan_not_promoted_for_default",
        reason: "Stale backlog item should not be merged.",
        recommendedActions: ["Regenerate attention backlog after the batch index."],
        metric: "default_plan_skip",
        score: null,
        delta: null,
        taskId: null,
        taskLabel: "80-100% default-plan skip",
        forecastType: "binary",
        sourcePath: "calibration-guard-default-plan.json",
      },
    ],
  });
  await runScript("scripts/forecast-batch-health.ts", [
    "--batch-index-dir",
    batchIndexRoot,
    "--attention-backlog-dir",
    attentionBacklogRoot,
    "--out-dir",
    outputDir,
  ]);
  const report = readRecord(await readJson(resolve(outputDir, "batch-health.json")));
  const summary = readRecord(report, "summary");
  const issues = readArray(report, "issues");
  const attentionItems = readArray(report, "attentionItems");
  const markdown = await readFile(resolve(outputDir, "batch-health.md"), "utf8");
  assert(readNumber(summary, "unresolvedAttentionItems") === 0, "stale attention backlog should not inflate unresolved health count");
  assert(!attentionItems.some((item) => readString(item, "id") === "calibration-default-plan-skipped:fresh-batch:80-100%"), "stale attention backlog item was merged into health");
  assert(issues.some((issue) => readString(issue, "kind") === "attention_backlog_stale"), "health report missing stale attention backlog issue");
  assert(markdown.includes("attention_backlog_stale"), "health markdown missing stale attention backlog issue");
  return "batch health ignores stale supplemental attention backlog reports";
});

await check("forecast batch health rejects review-stale attention backlog reports", async () => {
  const batchIndexRoot = resolve(tempRoot, "batch-health-review-stale-backlog", "batches");
  const attentionBacklogRoot = resolve(tempRoot, "batch-health-review-stale-backlog", "attention-backlog");
  const outputDir = resolve(tempRoot, "batch-health-review-stale-backlog", "out");
  const reviewsFile = resolve(tempRoot, "batch-health-review-stale-backlog", "reviews.json");
  await mkdir(resolve(batchIndexRoot, "reviewed-batch"), { recursive: true });
  await mkdir(attentionBacklogRoot, { recursive: true });
  await writeJson(resolve(batchIndexRoot, "reviewed-batch", "batch-index.json"), {
    reportType: "forecast_batch_index",
    batchId: "reviewed-batch",
    generatedAt: "2026-07-09T01:00:00.000Z",
    counts: {
      entries: 3,
      forecastOps: 1,
      resolutions: 1,
      performanceReports: 1,
      completedForecasts: 1,
      failedForecasts: 0,
      resolvedCases: 1,
      failedResolutions: 0,
      performanceScoreRows: 1,
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
  await writeJson(reviewsFile, {
    reportType: "forecast_attention_reviews",
    updatedAt: "2026-07-09T01:06:00.000Z",
    reviews: [
      {
        attentionItemId: "calibration-default-plan-skipped:reviewed-batch:80-100%",
        status: "reviewed",
        note: "Already reviewed locally.",
        reviewer: "contract-check",
        updatedAt: "2026-07-09T01:06:00.000Z",
      },
    ],
  });
  await writeJson(resolve(attentionBacklogRoot, "attention-backlog.json"), {
    reportType: "forecast_attention_backlog",
    generatedAt: "2026-07-09T01:05:00.000Z",
    filters: {
      statuses: ["open", "deferred"],
      batchIds: [],
    },
    counts: {
      items: 1,
      open: 1,
      deferred: 0,
      reviewed: 0,
      high: 0,
      medium: 1,
      low: 0,
    },
    byForecastType: [],
    byKind: [],
    items: [
      {
        batchId: "reviewed-batch",
        id: "calibration-default-plan-skipped:reviewed-batch:80-100%",
        reviewStatus: "open",
        severity: "medium",
        kind: "calibration_guard_default_plan_not_promoted_for_default",
        reason: "Review-stale backlog item should not be merged.",
        recommendedActions: ["Regenerate attention backlog after reviewing items."],
        metric: "default_plan_skip",
        score: null,
        delta: null,
        taskId: null,
        taskLabel: "80-100% default-plan skip",
        forecastType: "binary",
        sourcePath: "calibration-guard-default-plan.json",
      },
    ],
    paths: {
      reviews: reviewsFile,
    },
  });
  await runScript("scripts/forecast-batch-health.ts", [
    "--batch-index-dir",
    batchIndexRoot,
    "--attention-backlog-dir",
    attentionBacklogRoot,
    "--out-dir",
    outputDir,
  ]);
  const report = readRecord(await readJson(resolve(outputDir, "batch-health.json")));
  const summary = readRecord(report, "summary");
  const issues = readArray(report, "issues");
  const attentionItems = readArray(report, "attentionItems");
  const markdown = await readFile(resolve(outputDir, "batch-health.md"), "utf8");
  assert(readNumber(summary, "unresolvedAttentionItems") === 0, "review-stale attention backlog should not inflate unresolved health count");
  assert(!attentionItems.some((item) => readString(item, "id") === "calibration-default-plan-skipped:reviewed-batch:80-100%"), "review-stale attention backlog item was merged into health");
  assert(issues.some((issue) => readString(issue, "kind") === "attention_backlog_reviews_stale"), "health report missing review-stale attention backlog issue");
  assert(markdown.includes("attention_backlog_reviews_stale"), "health markdown missing review-stale attention backlog issue");
  return "batch health ignores review-stale supplemental attention backlog reports";
});

await check("forecast batch health rejects undated attention backlog reports", async () => {
  const batchIndexRoot = resolve(tempRoot, "batch-health-undated-backlog", "batches");
  const attentionBacklogRoot = resolve(tempRoot, "batch-health-undated-backlog", "attention-backlog");
  const outputDir = resolve(tempRoot, "batch-health-undated-backlog", "out");
  await mkdir(resolve(batchIndexRoot, "dated-batch"), { recursive: true });
  await mkdir(attentionBacklogRoot, { recursive: true });
  await writeJson(resolve(batchIndexRoot, "dated-batch", "batch-index.json"), {
    reportType: "forecast_batch_index",
    batchId: "dated-batch",
    generatedAt: "2026-07-09T01:00:00.000Z",
    counts: {
      entries: 3,
      forecastOps: 1,
      resolutions: 1,
      performanceReports: 1,
      completedForecasts: 1,
      failedForecasts: 0,
      resolvedCases: 1,
      failedResolutions: 0,
      performanceScoreRows: 1,
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
  await writeJson(resolve(attentionBacklogRoot, "attention-backlog.json"), {
    reportType: "forecast_attention_backlog",
    filters: {
      statuses: ["open", "deferred"],
      batchIds: [],
    },
    counts: {
      items: 1,
      open: 1,
      deferred: 0,
      reviewed: 0,
      high: 0,
      medium: 1,
      low: 0,
    },
    byForecastType: [],
    byKind: [],
    items: [
      {
        batchId: "dated-batch",
        id: "calibration-default-plan-skipped:dated-batch:80-100%",
        reviewStatus: "open",
        severity: "medium",
        kind: "calibration_guard_default_plan_not_promoted_for_default",
        reason: "Undated backlog item should not be merged.",
        recommendedActions: ["Regenerate attention backlog with generatedAt."],
        metric: "default_plan_skip",
        score: null,
        delta: null,
        taskId: null,
        taskLabel: "80-100% default-plan skip",
        forecastType: "binary",
        sourcePath: "calibration-guard-default-plan.json",
      },
    ],
  });
  await runScript("scripts/forecast-batch-health.ts", [
    "--batch-index-dir",
    batchIndexRoot,
    "--attention-backlog-dir",
    attentionBacklogRoot,
    "--out-dir",
    outputDir,
  ]);
  const report = readRecord(await readJson(resolve(outputDir, "batch-health.json")));
  const summary = readRecord(report, "summary");
  const issues = readArray(report, "issues");
  const attentionItems = readArray(report, "attentionItems");
  const markdown = await readFile(resolve(outputDir, "batch-health.md"), "utf8");
  assert(readNumber(summary, "unresolvedAttentionItems") === 0, "undated attention backlog should not inflate unresolved health count");
  assert(!attentionItems.some((item) => readString(item, "id") === "calibration-default-plan-skipped:dated-batch:80-100%"), "undated attention backlog item was merged into health");
  assert(issues.some((issue) => readString(issue, "kind") === "attention_backlog_timestamp_missing"), "health report missing undated attention backlog issue");
  assert(markdown.includes("attention_backlog_timestamp_missing"), "health markdown missing undated attention backlog issue");
  return "batch health ignores undated supplemental attention backlog reports";
});

await check("diagnostics surface latest forecast batch health", async () => {
  const fixtureRoot = resolve(tempRoot, "diagnostics-batch-health");
  await mkdir(resolve(fixtureRoot, "data/reports/forecast-batch-health"), { recursive: true });
  await writeJson(resolve(fixtureRoot, FORECAST_BATCH_HEALTH_REPORT_PATH), {
    reportType: "forecast_batch_health",
    batchId: "diagnostics-batch",
    generatedAt: "2026-07-09T00:00:00.000Z",
    status: "needs_attention",
    summary: {
      unresolvedAttentionItems: 3,
      openAttentionItems: 2,
      deferredAttentionItems: 1,
      unresolvedCandidateCalibrationGuardRules: 1,
      scoreRegressionItems: 1,
      calibrationGuardRegressionItems: 1,
    },
    missingPhases: ["forecast_performance"],
    issues: [
      { severity: "high", kind: "unresolved_attention", message: "3 attention item(s) remain open or deferred." },
    ],
    attentionByKind: [
      { kind: "evidence_coverage_miss", items: 2, open: 2, deferred: 0, reviewed: 0, unresolved: 2, high: 1, medium: 1, low: 0 },
    ],
    attentionBySeverity: [
      { severity: "high", items: 2, open: 1, deferred: 1, reviewed: 0, unresolved: 2 },
    ],
    attentionByForecastType: [
      { forecastType: "binary", items: 1, open: 1, deferred: 0, reviewed: 0, unresolved: 1, high: 1, medium: 0, low: 0 },
    ],
    attentionItems: [
      {
        id: "evidence-coverage:task-1:brier",
        reviewStatus: "open",
        severity: "high",
        kind: "evidence_coverage_miss",
        reason: "brier 0.5 followed sparse evidence coverage.",
        recommendedAction: "Audit cited sources.",
        metric: "brier",
        score: 0.5,
        delta: 1,
        forecastType: "binary",
        taskId: "task-1",
        taskLabel: "Sparse evidence forecast",
        reviewNote: "Investigate thin source coverage before rerun.",
        reviewer: "contract-check",
        reviewedAt: "2026-07-09T00:06:00.000Z",
        sourcePath: "data/reports/forecast-batches/diagnostics-batch/batch-index.json",
      },
    ],
    paths: {
      json: resolve(fixtureRoot, FORECAST_BATCH_HEALTH_REPORT_PATH),
      markdown: resolve(fixtureRoot, "data/reports/forecast-batch-health/batch-health.md"),
      batchIndex: "data/reports/forecast-batches/diagnostics-batch/batch-index.json",
      batchIndexDir: "data/reports/forecast-batches",
      attentionBacklog: "data/reports/forecast-attention-backlog/attention-backlog.json",
      attentionBacklogDir: "data/reports/forecast-attention-backlog",
    },
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
        activationStatus: calibrationGuardActivationStatusReadyForReview,
        rationale: "80-100% binary aggregates are overforecasting.",
        reviewNote: "Validate on a held-out batch first.",
        reviewer: "contract-check",
        reviewedAt: "2026-07-09T00:07:00.000Z",
      },
    ],
  });
  const health = readLatestForecastBatchHealth(fixtureRoot);
  const diagnosticsSource = await readFile(resolve(root, "packages/backend/src/diagnostics-service.ts"), "utf8");
  const benchmarkServiceSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const benchmarkPromotionPolicySource = await readFile(resolve(root, "packages/backend/src/benchmark-promotion-policy.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const smokeSource = await readFile(resolve(root, "scripts/smoke-check.ts"), "utf8");
  const sourceDomainSummarySource = await readFile(resolve(root, "packages/backend/src/source-domain-summary.ts"), "utf8");
  const dashboardHookSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/use-lab-dashboard.ts"), "utf8");
  const dashboardShellSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard.tsx"), "utf8");
  const dashboardPanelSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(health.exists, "shared batch health reader did not find the report");
  assert(health.batchId === "diagnostics-batch", "shared batch health reader did not preserve batch id");
  assert(health.summary.unresolvedAttentionItems === 3, "shared batch health reader did not expose unresolved attention count");
  assert(health.summary.unresolvedCandidateCalibrationGuardRules === 1, "shared batch health reader did not expose unresolved candidate guard count");
  assert(health.missingPhases.includes("forecast_performance"), "shared batch health reader did not expose missing phases");
  assert(health.issues.some((issue) => issue.kind === "unresolved_attention"), "shared batch health reader did not expose issue kinds");
  assert(health.attentionByKind.some((row) => row.kind === "evidence_coverage_miss" && row.open === 2), "shared batch health reader did not expose attention kind breakdowns");
  assert(health.attentionByKind.some((row) => row.kind === "evidence_coverage_miss" && row.unresolved === 2), "shared batch health reader did not expose attention kind unresolved counts");
  assert(health.attentionBySeverity.some((row) => row.severity === "high" && row.deferred === 1), "shared batch health reader did not expose attention severity breakdowns");
  assert(health.attentionBySeverity.some((row) => row.severity === "high" && row.unresolved === 2), "shared batch health reader did not expose attention severity unresolved counts");
  assert(health.attentionByForecastType.some((row) => row.forecastType === "binary" && row.open === 1), "shared batch health reader did not expose attention forecast-type breakdowns");
  assert(health.attentionByForecastType.some((row) => row.forecastType === "binary" && row.unresolved === 1), "shared batch health reader did not expose attention forecast-type unresolved counts");
  assert(health.paths.batchIndex === "data/reports/forecast-batches/diagnostics-batch/batch-index.json", "shared batch health reader did not expose batch-index path");
  assert(health.paths.attentionBacklog === "data/reports/forecast-attention-backlog/attention-backlog.json", "shared batch health reader did not expose attention backlog path");
  assert(health.attentionItems.some((item) => item.id === "evidence-coverage:task-1:brier" && item.recommendedAction === "Audit cited sources." && item.forecastType === "binary" && item.reviewNote === "Investigate thin source coverage before rerun."), "shared batch health reader did not expose actionable attention review context");
  assert(health.attentionItems.some((item) => item.id === "evidence-coverage:task-1:brier" && item.sourcePath === "data/reports/forecast-batches/diagnostics-batch/batch-index.json"), "shared batch health reader did not expose attention source path");
  assert(health.candidateCalibrationGuardRules.some((rule) => rule.id === "candidate-guard:80-100%" && rule.suggestedAdjustment === -15 && rule.reviewNote === "Validate on a held-out batch first."), "shared batch health reader did not expose candidate guard review context");
  assert(diagnosticsSource.includes("readLatestForecastBatchHealth"), "diagnostics does not read local forecast batch health through the shared reader");
  assert(diagnosticsSource.includes("forecastBatchHealthDiagnostic"), "diagnostics does not turn forecast batch health into a check item");
  assert(diagnosticsSource.includes("ForecastBatchHealthSnapshot"), "diagnostics does not type batch health from the shared reader");
  assert(diagnosticsSource.includes("listBenchmarkRuns(db, 8)"), "diagnostics does not reuse the benchmark read model for promotion gates");
  assert(diagnosticsSource.includes("benchmarkPromotionDiagnostics"), "diagnostics does not summarize benchmark promotion gates");
  assert(diagnosticsSource.includes("benchmarkPromotionDiagnostic"), "diagnostics does not turn benchmark promotion status into a check item");
  assert(diagnosticsSource.includes("sourceRiskBlockedRuns"), "diagnostics does not expose source-risk-blocked benchmark runs");
  assert(benchmarkPromotionPolicySource.includes("benchmarkPromotionSourceRiskBlockerIds"), "backend does not keep source-risk promotion blockers with the promotion blocker contract");
  assert(diagnosticsSource.includes("benchmarkPromotionSourceRiskBlockerIds"), "diagnostics does not derive source-risk blockers from the promotion blocker contract");
  assert(benchmarkPromotionPolicySource.includes("blockerSourceCutoffLeakage") && benchmarkPromotionPolicySource.includes("blockerHumanForecastLeakage"), "promotion source-risk contract does not include leakage blockers");
  assert(diagnosticsSource.includes("gateBlockers"), "diagnostics does not expose benchmark promotion blocker breakdowns");
  assert(smokeSource.includes("benchmarkPromotion"), "smoke check does not validate benchmark promotion diagnostics");
  assert(smokeSource.includes("benchmark_promotion_gate"), "smoke check does not require the benchmark promotion diagnostic item");
  assert(smokeSource.includes("sourceRiskBlockedRuns"), "smoke check does not require source-risk benchmark promotion counts");
  assert(smokeSource.includes("gateBlockers"), "smoke check does not validate benchmark promotion blocker breakdowns");
  assert(diagnosticsSource.includes("workflowProposalReadinessDiagnostics"), "diagnostics does not summarize workflow proposal readiness");
  assert(diagnosticsSource.includes("workflowProposalValidationReadiness"), "diagnostics does not reuse shared workflow proposal readiness logic");
  assert(diagnosticsSource.includes("workflow_proposal_readiness"), "diagnostics does not turn workflow proposal readiness into a check item");
  assert(diagnosticsSource.includes("blockedActiveProposals"), "diagnostics does not expose blocked active proposal count");
  assert(diagnosticsSource.includes("readinessBlockers"), "diagnostics does not expose workflow proposal blocker breakdowns");
  assert(diagnosticsSource.includes("readLatestCalibrationDefaultPlan"), "diagnostics does not read local calibration default-plan reports");
  assert(diagnosticsSource.includes("./calibration-default-plan-artifacts"), "diagnostics does not use the shared calibration default-plan artifact reader");
  assert(diagnosticsSource.includes("calibrationDefaultPlanDiagnostic"), "diagnostics does not turn calibration default-plan issues into a check item");
  assert(diagnosticsSource.includes("calibrationDefaultPlan"), "diagnostics snapshot does not expose calibration default-plan summary");
  assert(diagnosticsSource.includes("validation_report_stale") || diagnosticsSource.includes("issues"), "diagnostics does not expose calibration default-plan issue rows");
  assert(!diagnosticsSource.includes("function readLatestCalibrationDefaultPlan("), "diagnostics should not keep a local calibration default-plan parser");
  assert(smokeSource.includes("workflowProposalReadiness"), "smoke check does not validate workflow proposal readiness diagnostics");
  assert(smokeSource.includes("workflow_proposal_readiness"), "smoke check does not require the workflow proposal readiness diagnostic item");
  assert(smokeSource.includes("readinessBlockers"), "smoke check does not validate workflow proposal blocker breakdowns");
  assert(diagnosticsSource.includes("unresolvedAttentionItems"), "diagnostics does not expose unresolved attention count");
  assert(diagnosticsSource.includes("unresolvedCandidateCalibrationGuardRules"), "diagnostics does not expose unresolved candidate guard count");
  assert(diagnosticsSource.includes("summarizeSourceDomains(sourceRows)"), "diagnostics does not summarize source-bank domains");
  assert(diagnosticsSource.includes("./source-domain-summary"), "diagnostics does not use the shared source-domain summary helper");
  assert(!diagnosticsSource.includes("function summarizeSourceDomains"), "diagnostics should not keep a local source-domain summarizer");
  assert(diagnosticsSource.includes("sourceDomainCount"), "diagnostics does not expose source-domain count");
  assert(diagnosticsSource.includes("sourceDomains.slice(0, 8)"), "diagnostics does not cap source-domain summary");
  assert(sourceDomainSummarySource.includes("source_type"), "shared source-domain summary helper does not support mart source-type rows");
  assert(sourceDomainSummarySource.includes("used_in_final"), "shared source-domain summary helper does not support mart final-use rows");
  assert(sourceDomainSummarySource.includes("quality_score"), "shared source-domain summary helper does not support mart quality-score rows");
  assert(metricsSource.includes("readLatestForecastBatchHealth"), "metrics do not read latest forecast batch health through the shared reader");
  assert(metricsSource.includes("open_superforecaster_forecast_batch_health_status"), "metrics do not expose batch health status");
  assert(metricsSource.includes("open_superforecaster_forecast_batch_health_unresolved_attention_items"), "metrics do not expose unresolved attention count");
  assert(metricsSource.includes("open_superforecaster_forecast_batch_health_unresolved_candidate_guard_rules"), "metrics do not expose unresolved candidate guard count");
  assert(metricsSource.includes("unresolved: row.unresolved"), "metrics should export batch-health unresolved breakdown counts from the shared reader");
  assert(!metricsSource.includes("unresolved: (row.open ?? 0) + (row.deferred ?? 0)"), "metrics should not derive unresolved breakdown counts locally");
  assert(diagnosticsSource.includes("items,"), "diagnostics snapshot does not expose structured diagnostic items");
  assert(dashboardHookSource.includes("...readArray(diagnostics, \"items\")"), "lab dashboard does not read diagnostics items");
  assert(dashboardHookSource.includes("forecastBatchHealth"), "lab dashboard does not expose forecast batch health from diagnostics");
  assert(dashboardShellSource.includes("ForecastBatchHealthCard"), "lab dashboard does not mount forecast batch health");
  assert(dashboardPanelSource.includes("benchmarkPromotion"), "lab dashboard does not render benchmark promotion diagnostics");
  assert(dashboardPanelSource.includes("sourceRiskBlockedRuns"), "lab dashboard does not render source-risk benchmark diagnostics");
  assert(dashboardPanelSource.includes("benchmarkPromotionGateBlockers"), "lab dashboard does not render benchmark promotion blocker breakdowns");
  assert(dashboardPanelSource.includes("workflowProposalReadiness"), "lab dashboard does not render workflow proposal readiness diagnostics");
  assert(dashboardPanelSource.includes("latestBlockedReadinessBlockers"), "lab dashboard does not render proposal readiness blockers");
  assert(dashboardPanelSource.includes("proposalReadinessBlockers"), "lab dashboard does not render proposal readiness blocker breakdowns");
  assert(dashboardPanelSource.includes("calibrationDefaultPlan"), "lab dashboard does not render calibration default-plan diagnostics");
  assert(dashboardPanelSource.includes("Calibration default plan"), "lab dashboard does not label calibration default-plan diagnostics");
  assert(dashboardPanelSource.includes("calibrationDefaultPlanIssues"), "lab dashboard does not render calibration default-plan issue rows");
  assert(dashboardPanelSource.includes("unresolvedCandidateCalibrationGuardRules"), "lab dashboard does not render candidate guard review count");
  assert(dashboardPanelSource.includes("calibrationGuardRegressionItems"), "lab dashboard does not render guard regression count");
  assert(dashboardPanelSource.includes("attentionByKind"), "lab dashboard does not render attention kind breakdowns");
  assert(dashboardPanelSource.includes("attentionBySeverity"), "lab dashboard does not render attention severity breakdowns");
  assert(dashboardPanelSource.includes("attentionByForecastType"), "lab dashboard does not render attention forecast-type breakdowns");
  assert(dashboardPanelSource.includes("readNumber(row, \"unresolved\")"), "lab dashboard does not render shared unresolved breakdown counts");
  assert(!dashboardPanelSource.includes("open + deferred"), "lab dashboard should not derive unresolved counts locally");
  assert(!dashboardPanelSource.includes("readNumber(row, \"open\") ?? 0) + (readNumber(row, \"deferred\") ?? 0"), "lab dashboard should not derive unresolved severity counts locally");
  assert(dashboardPanelSource.includes("Attention by forecast type"), "lab dashboard does not label attention forecast-type breakdowns");
  assert(dashboardPanelSource.includes("paths.batchIndex"), "lab dashboard does not render batch health source batch-index path");
  assert(dashboardPanelSource.includes("paths.attentionBacklog"), "lab dashboard does not render batch health source attention-backlog path");
  assert(dashboardPanelSource.includes("attentionItems"), "lab dashboard does not render actionable attention items");
  assert(dashboardPanelSource.includes("candidateCalibrationGuardRules"), "lab dashboard does not render candidate guard rules from batch health");
  assert(dashboardPanelSource.includes("item.reviewNote"), "lab dashboard does not render attention review notes from batch health");
  assert(dashboardPanelSource.includes("item.sourcePath"), "lab dashboard does not render attention source paths from batch health");
  assert(dashboardPanelSource.includes("rule.reviewNote"), "lab dashboard does not render candidate guard review notes from batch health");
  assert(dashboardPanelSource.includes("Source domains"), "lab dashboard does not label source-domain diagnostics");
  assert(dashboardPanelSource.includes("sourceDomains"), "lab dashboard does not render source-domain diagnostics");
  return "latest forecast batch health is shared by diagnostics and metrics";
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
  const calibrationSource = await readFile(resolve(root, "packages/backend/src/performance-calibration.ts"), "utf8");
  const backendIndexSource = await readFile(resolve(root, "packages/backend/src/index.ts"), "utf8");
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
  assert(report.candidateCalibrationGuardRules[0].activationStatus === calibrationGuardActivationStatusReadyForReview, "candidate calibration guard activation status mismatch");
  assert(calibrationSource.includes("calibrationGuardActivationStatusForCandidateFitting"), "calibration report does not use shared candidate guard activation policy");
  assert(backendIndexSource.includes("calibration-guard-activation-policy"), "backend package barrel does not export calibration guard activation policy");
  return "calibration diagnostics convert bucket drift into review actions";
});

await check("forecast performance reports surface candidate calibration guards", async () => {
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const batchIndexSource = await readFile(resolve(root, "scripts/forecast-batch-index.ts"), "utf8");
  const attentionPolicySource = await readFile(resolve(root, "packages/backend/src/forecast-attention-policy.ts"), "utf8");
  const attentionBacklogSource = await readFile(resolve(root, "scripts/forecast-attention-backlog.ts"), "utf8");
  const batchHealthSource = await readFile(resolve(root, "scripts/forecast-batch-health.ts"), "utf8");
  const backendBatchHealthSource = await readFile(resolve(root, "packages/backend/src/forecast-batch-health.ts"), "utf8");
  const calibrationProposalSource = await readFile(resolve(root, "scripts/forecast-calibration-guard-proposals.ts"), "utf8");
  const attentionReviewSource = await readFile(resolve(root, "scripts/lib/forecast-attention-reviews.ts"), "utf8");
  const forecastReviewSource = await readFile(resolve(root, "scripts/forecast-review.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(resolutionSource.includes("candidateCalibrationGuardRules: calibrationReport.candidateCalibrationGuardRules"), "performance report missing candidate calibration guard rules");
  assert(resolutionSource.includes("calibrationGuardImpact"), "performance report missing calibration guard impact summary");
  assert(resolutionSource.includes("calibrationGuardRegressionAttentionKind"), "performance report does not use shared calibration guard regression attention kind");
  assert(attentionPolicySource.includes("guarded-vs-unguarded Brier delta recovers"), "calibration guard regression action missing");
  assert(resolutionSource.includes("calibrationGuardImpact.byRule"), "performance report does not inspect rule-level guard impact");
  assert(resolutionSource.includes("calibrationReplayRows: calibrationReplayRows(aggregateBrierScores)"), "performance report missing calibration replay rows");
  assert(resolutionSource.includes("from \"./forecast-score-policy\""), "performance report does not import the shared forecast score policy");
  assert(resolutionSource.includes("from \"./forecast-attention-policy\""), "performance report does not import the shared forecast attention policy");
  assert(!resolutionSource.includes("function poorScoreThreshold("), "performance report should not keep local poor-score thresholds");
  assert(!resolutionSource.includes("function trendDeltaHighThreshold("), "performance report should not keep local trend threshold policy");
  assert(!resolutionSource.includes("function isProbabilityMetric("), "performance report should not keep local probability metric policy");
  assert(!resolutionSource.includes("function recommendAttentionActions("), "performance report should not keep local attention actions");
  assert(!resolutionSource.includes("function attentionKindIdPrefix("), "performance report should not keep local attention kind id policy");
  assert(!resolutionSource.includes("kind: \"poor_resolved_forecast\""), "performance report should not keep local poor resolved forecast attention kind");
  assert(!resolutionSource.includes("kind: \"worsening_trend\""), "performance report should not keep local worsening trend attention kind");
  assert(!resolutionSource.includes("kind: \"calibration_guard_regression\""), "performance report should not keep local calibration guard regression attention kind");
  assert((await readFile(resolve(root, "packages/backend/src/forecast-score-policy.ts"), "utf8")).includes("selectPrimaryScoreMetric"), "shared forecast score policy does not expose primary metric selection");
  assert(attentionPolicySource.includes("recommendPerformanceAttentionActions"), "shared forecast attention policy does not expose recommendation actions");
  assert(attentionPolicySource.includes("forecastAttentionReviewStatuses"), "shared forecast attention policy does not expose review statuses");
  assert(attentionPolicySource.includes("isForecastAttentionReviewOpen"), "shared forecast attention policy does not expose open review policy");
  assert(attentionPolicySource.includes("isForecastAttentionReviewResolved"), "shared forecast attention policy does not expose resolved review policy");
  assert(attentionPolicySource.includes("isForecastAttentionReviewDeferred"), "shared forecast attention policy does not expose deferred review policy");
  assert(attentionPolicySource.includes("isForecastAttentionReviewUnresolved"), "shared forecast attention policy does not expose unresolved review policy");
  assert(attentionPolicySource.includes("unresolved: open + deferred"), "shared forecast attention policy does not summarize unresolved review counts");
  assert(attentionPolicySource.includes("poorResolvedForecastAttentionKind"), "shared forecast attention policy does not expose poor resolved forecast attention kind");
  assert(attentionPolicySource.includes("worseningTrendAttentionKind"), "shared forecast attention policy does not expose worsening trend attention kind");
  assert(attentionPolicySource.includes("calibrationGuardRegressionAttentionKind"), "shared forecast attention policy does not expose calibration guard regression attention kind");
  assert(attentionPolicySource.includes("calibrationGuardRegressionIssueKind"), "shared forecast attention policy does not expose calibration guard regression issue kind");
  assert(attentionPolicySource.includes("candidateCalibrationGuardReviewIssueKind"), "shared forecast attention policy does not expose candidate guard review issue kind");
  assert(attentionPolicySource.includes("isForecastScoreRegressionAttentionKind"), "shared forecast attention policy does not expose score-regression attention kind policy");
  assert(attentionPolicySource.includes("isCalibrationGuardRegressionAttentionKind"), "shared forecast attention policy does not expose calibration-guard regression attention kind policy");
  assert(attentionPolicySource.includes("candidateCalibrationGuardAttentionKind"), "shared forecast attention policy does not expose candidate guard attention kind policy");
  assert(attentionPolicySource.includes("forecastAttentionSeveritySortRank"), "shared forecast attention policy does not expose severity sort ranking");
  assert(attentionPolicySource.includes("summarizeForecastAttentionSeverities"), "shared forecast attention policy does not expose severity counts");
  assert(attentionPolicySource.includes("performanceAttentionSeverityRank"), "shared forecast attention policy does not expose performance severity ranking");
  assert(attentionPolicySource.includes("recommendCalibrationValidationActions"), "shared forecast attention policy does not expose validation backlog actions");
  assert(attentionPolicySource.includes("recommendCalibrationDefaultPlanSkippedActions"), "shared forecast attention policy does not expose default-plan backlog actions");
  assert((await readFile(resolve(root, "packages/backend/src/index.ts"), "utf8")).includes("forecast-score-policy"), "backend package barrel does not export forecast score policy");
  assert((await readFile(resolve(root, "packages/backend/src/index.ts"), "utf8")).includes("forecast-attention-policy"), "backend package barrel does not export forecast attention policy");
  assert(attentionBacklogSource.includes("recommendCalibrationValidationActions"), "attention backlog does not use shared validation backlog actions");
  assert(attentionBacklogSource.includes("forecastAttentionReviewStatusRank"), "attention backlog does not use shared review status rank");
  assert(attentionBacklogSource.includes("summarizeForecastAttentionReviewStatuses"), "attention backlog does not use shared review status counts");
  assert(attentionBacklogSource.includes("forecastAttentionSeveritySortRank"), "attention backlog does not use shared attention severity rank");
  assert(attentionBacklogSource.includes("summarizeForecastAttentionSeverities"), "attention backlog does not use shared attention severity counts");
  assert(attentionBacklogSource.includes("candidateCalibrationGuardAttentionKind"), "attention backlog does not use shared candidate guard attention kind");
  assert(attentionBacklogSource.includes("calibrationGuardActivationSeverity"), "attention backlog does not use shared candidate guard activation severity");
  assert(!attentionBacklogSource.includes("function recommendedActionsForCalibrationValidation("), "attention backlog should not keep local validation actions");
  assert(!attentionBacklogSource.includes("function recommendedActionsForDefaultPlanSkipped("), "attention backlog should not keep local default-plan actions");
  assert(!attentionBacklogSource.includes("function statusRank("), "attention backlog should not keep local review status rank");
  assert(!attentionBacklogSource.includes("function isReviewStatus("), "attention backlog should not keep local review status validation");
  assert(!attentionBacklogSource.includes("function countStatus("), "attention backlog should not keep local review status counter");
  assert(!attentionBacklogSource.includes("function countSeverity("), "attention backlog should not keep local severity counter");
  assert(!attentionBacklogSource.includes("function severityRank("), "attention backlog should not keep local severity rank");
  assert(!attentionBacklogSource.includes("kind: \"candidate_calibration_guard\""), "attention backlog should not keep local candidate guard attention kind");
  assert(batchHealthSource.includes("forecastAttentionReviewStatusRank"), "batch health does not use shared review status rank");
  assert(batchHealthSource.includes("determineForecastBatchHealthStatus"), "batch health does not use shared status derivation policy");
  assert(batchHealthSource.includes("isForecastScoreRegressionAttentionKind"), "batch health does not use shared score-regression attention kind policy");
  assert(batchHealthSource.includes("isCalibrationGuardRegressionAttentionKind"), "batch health does not use shared calibration-guard regression attention kind policy");
  assert(batchHealthSource.includes("calibrationGuardRegressionIssueKind"), "batch health does not use shared calibration-guard regression issue kind policy");
  assert(batchHealthSource.includes("candidateCalibrationGuardReviewIssueKind"), "batch health does not use shared candidate guard review issue kind policy");
  assert(batchHealthSource.includes("isForecastAttentionReviewUnresolved"), "batch health does not use shared unresolved review policy");
  assert(batchHealthSource.includes("summarizeForecastAttentionReviewStatuses"), "batch health does not use shared review status counts");
  assert(batchHealthSource.includes("forecastAttentionSeveritySortRank"), "batch health does not use shared attention severity rank");
  assert(batchHealthSource.includes("summarizeForecastAttentionSeverities"), "batch health does not use shared attention severity counts");
  assert(batchHealthSource.includes("candidateCalibrationGuardAttentionKind"), "batch health does not use shared candidate guard attention kind");
  assert(batchHealthSource.includes("calibrationGuardActivationSeverity"), "batch health does not use shared candidate guard activation severity");
  assert(backendBatchHealthSource.includes("normalizeCalibrationGuardActivationStatus"), "shared batch health reader does not normalize candidate guard activation status");
  assert(backendBatchHealthSource.includes("forecastBatchHealthStatuses"), "shared batch health reader does not expose health status vocabulary");
  assert(backendBatchHealthSource.includes("normalizeForecastBatchHealthStatus"), "shared batch health reader does not normalize health status");
  assert(backendBatchHealthSource.includes("determineForecastBatchHealthStatus"), "shared batch health reader does not expose health status derivation");
  assert(batchIndexSource.includes("normalizeCalibrationGuardActivationStatus"), "batch index does not normalize candidate guard activation status");
  assert(!batchHealthSource.includes("function statusRank("), "batch health should not keep local review status rank");
  assert(!batchHealthSource.includes("function isReviewStatus("), "batch health should not keep local review status validation");
  assert(!batchHealthSource.includes("function countStatus("), "batch health should not keep local review status counter");
  assert(!batchHealthSource.includes("function countSeverity("), "batch health should not keep local severity counter");
  assert(!batchHealthSource.includes("function countCandidateRuleStatus("), "batch health should not keep local candidate guard review status counter");
  assert(!batchHealthSource.includes("function severityRank("), "batch health should not keep local severity rank");
  assert(!batchHealthSource.includes("function healthStatus("), "batch health should not keep local health status derivation");
  assert(!batchHealthSource.includes("reviewStatus !== \"reviewed\""), "batch health should not keep local unresolved review checks");
  assert(!batchHealthSource.includes("item.kind === \"forecast_score_regression\""), "batch health should not keep local score-regression kind checks");
  assert(!batchHealthSource.includes("item.kind === \"worsening_trend\""), "batch health should not keep local worsening-trend kind checks");
  assert(!batchHealthSource.includes("item.kind === \"calibration_guard_regression\""), "batch health should not keep local calibration-guard regression kind checks");
  assert(!batchHealthSource.includes("item.kind === \"candidate_calibration_guard\""), "batch health should not keep local candidate guard attention kind checks");
  assert(!batchHealthSource.includes("kind: \"calibration_guard_regression\""), "batch health should not keep local calibration-guard regression issue kind");
  assert(!batchHealthSource.includes("kind: \"candidate_calibration_guard_review\""), "batch health should not keep local candidate guard review issue kind");
  assert(resolutionSource.includes("performanceAttentionSeverityRank"), "performance report does not use shared performance severity rank");
  assert(calibrationProposalSource.includes("normalizeForecastAttentionReviewStatus"), "calibration proposals do not use shared review status normalization");
  assert(calibrationProposalSource.includes("isCalibrationGuardReadyForReview"), "calibration proposals do not use shared candidate guard readiness policy");
  assert(attentionReviewSource.includes("isForecastAttentionReviewStatus"), "attention review parser does not use shared review status validation");
  assert(!attentionReviewSource.includes("isAttentionReviewStatus"), "attention review helper should not re-export a duplicate review status validator");
  assert(forecastReviewSource.includes("isForecastAttentionReviewStatus"), "forecast review writer does not use shared review status validation");
  assert(!forecastReviewSource.includes("isAttentionReviewStatus"), "forecast review writer should not use the review helper as a policy validator");
  assert(resolutionSource.includes("evidence_coverage_miss"), "performance report does not turn weak evidence coverage into attention");
  assert(resolutionSource.includes("input_context_miss"), "performance report does not turn weak input context into attention");
  assert(resolutionSource.includes("run_metadata_miss"), "performance report does not turn suspicious run metadata into attention");
  assert(resolutionSource.includes("evidenceCoverage: readEvidenceCoverageSnapshot(latest.scoreConfig)"), "performance cases do not retain evidence coverage snapshots");
  assert(resolutionSource.includes("inputContext: readForecastInputContextSnapshot(latest.scoreConfig)"), "performance cases do not retain input context snapshots");
  assert(resolutionSource.includes("runMetadata: readForecastRunSnapshot(latest.scoreConfig)"), "performance cases do not retain run metadata snapshots");
  assert(resolutionSource.includes("## Calibration guard impact"), "performance Markdown missing calibration guard impact section");
  assert(resolutionSource.includes("renderCalibrationGuardRuleImpactTable"), "performance Markdown missing rule-level calibration guard impact table");
  assert(resolutionSource.includes("## Forecast attempt-count groups"), "performance Markdown missing forecast attempt-count group section");
  assert(resolutionSource.includes("## Binary confidence groups"), "performance Markdown missing binary confidence group section");
  assert(resolutionSource.includes("## Binary side groups"), "performance Markdown missing binary side group section");
  assert(resolutionSource.includes("## Baseline sanity groups"), "performance Markdown missing baseline sanity group section");
  assert(resolutionSource.includes("## Aggregate quality groups"), "performance Markdown missing aggregate quality group section");
  assert(resolutionSource.includes("## Aggregate quality review-round groups"), "performance Markdown missing aggregate quality review-round group section");
  assert(resolutionSource.includes("## Aggregate quality issue-count groups"), "performance Markdown missing aggregate quality issue-count group section");
  assert(resolutionSource.includes("## Component disagreement groups"), "performance Markdown missing component disagreement group section");
  assert(resolutionSource.includes("## Component envelope groups"), "performance Markdown missing component envelope group section");
  assert(resolutionSource.includes("## Aggregate side-agreement groups"), "performance Markdown missing aggregate side-agreement group section");
  assert(resolutionSource.includes("## Aggregate panel-confidence groups"), "performance Markdown missing aggregate panel-confidence group section");
  assert(resolutionSource.includes("## Final confidence shift groups"), "performance Markdown missing final confidence shift group section");
  assert(resolutionSource.includes("## Median adjustment groups"), "performance Markdown missing median adjustment group section");
  assert(resolutionSource.includes("## Inside-view shift groups"), "performance Markdown missing inside-view shift group section");
  assert(resolutionSource.includes("## Final aggregation adjustment groups"), "performance Markdown missing final aggregation adjustment group section");
  assert(resolutionSource.includes("## Final aggregation direction groups"), "performance Markdown missing final aggregation direction group section");
  assert(resolutionSource.includes("## Aggregate attempt-count groups"), "performance Markdown missing aggregate attempt-count group section");
  assert(resolutionSource.includes("## Aggregation anchor groups"), "performance Markdown missing aggregation anchor group section");
  assert(resolutionSource.includes("## Research depth groups"), "performance Markdown missing research depth group section");
  assert(resolutionSource.includes("## Forecaster panel size groups"), "performance Markdown missing forecaster panel size group section");
  assert(resolutionSource.includes("## Complexity score groups"), "performance Markdown missing complexity score group section");
  assert(resolutionSource.includes("## Conditional branch groups"), "performance Markdown missing conditional branch group section");
  assert(resolutionSource.includes("## Conditional effect groups"), "performance Markdown missing conditional effect group section");
  assert(resolutionSource.includes("## Conditional resolved-branch groups"), "performance Markdown missing conditional resolved-branch group section");
  assert(resolutionSource.includes("## Thresholded direction groups"), "performance Markdown missing thresholded direction group section");
  assert(resolutionSource.includes("## Thresholded source groups"), "performance Markdown missing thresholded source group section");
  assert(resolutionSource.includes("## Thresholded monotonicity groups"), "performance Markdown missing thresholded monotonicity group section");
  assert(resolutionSource.includes("## Thresholded curve-spread groups"), "performance Markdown missing thresholded curve-spread group section");
  assert(resolutionSource.includes("## Thresholded resolved-band groups"), "performance Markdown missing thresholded resolved-band group section");
  assert(resolutionSource.includes("## Numeric interval groups"), "performance Markdown missing numeric interval group section");
  assert(resolutionSource.includes("## Numeric unit groups"), "performance Markdown missing numeric unit group section");
  assert(resolutionSource.includes("## Numeric median-error groups"), "performance Markdown missing numeric median-error group section");
  assert(resolutionSource.includes("## Numeric resolved-position groups"), "performance Markdown missing numeric resolved-position group section");
  assert(resolutionSource.includes("## Date interval groups"), "performance Markdown missing date interval group section");
  assert(resolutionSource.includes("## Date never-probability groups"), "performance Markdown missing date never-probability group section");
  assert(resolutionSource.includes("## Date median-error groups"), "performance Markdown missing date median-error group section");
  assert(resolutionSource.includes("## Date resolved-position groups"), "performance Markdown missing date resolved-position group section");
  assert(resolutionSource.includes("## Categorical confidence groups"), "performance Markdown missing categorical confidence group section");
  assert(resolutionSource.includes("## Categorical entropy groups"), "performance Markdown missing categorical entropy group section");
  assert(resolutionSource.includes("## Categorical source groups"), "performance Markdown missing categorical source group section");
  assert(resolutionSource.includes("## Categorical coverage groups"), "performance Markdown missing categorical coverage group section");
  assert(resolutionSource.includes("## Categorical resolved-category groups"), "performance Markdown missing categorical resolved-category group section");
  assert(resolutionSource.includes("## Evidence source-count groups"), "performance Markdown missing evidence source-count group section");
  assert(resolutionSource.includes("## Evidence source-diversity groups"), "performance Markdown missing evidence source-diversity group section");
  assert(resolutionSource.includes("## Evidence source-concentration groups"), "performance Markdown missing evidence source-concentration group section");
  assert(resolutionSource.includes("## Evidence source-freshness groups"), "performance Markdown missing evidence source-freshness group section");
  assert(resolutionSource.includes("## Evidence source-timing groups"), "performance Markdown missing evidence source-timing group section");
  assert(resolutionSource.includes("## Evidence uncertainty-count groups"), "performance Markdown missing evidence uncertainty-count group section");
  assert(resolutionSource.includes("## Evidence rationale-length groups"), "performance Markdown missing evidence rationale-length group section");
  assert(resolutionSource.includes("## Input requested-forecast-type groups"), "performance Markdown missing input requested-forecast-type group section");
  assert(resolutionSource.includes("## Input routed-forecast-type groups"), "performance Markdown missing input routed-forecast-type group section");
  assert(resolutionSource.includes("## Input type-alignment groups"), "performance Markdown missing input type-alignment group section");
  assert(resolutionSource.includes("## Input routing-confidence groups"), "performance Markdown missing input routing-confidence group section");
  assert(resolutionSource.includes("## Input source groups"), "performance Markdown missing input source group section");
  assert(resolutionSource.includes("## Input context-completeness groups"), "performance Markdown missing input context-completeness group section");
  assert(resolutionSource.includes("## Input evidence-as-of-date groups"), "performance Markdown missing input evidence-as-of-date group section");
  assert(resolutionSource.includes("## Input resolution-criteria-depth groups"), "performance Markdown missing input resolution-criteria-depth group section");
  assert(resolutionSource.includes("## Input resolution-horizon groups"), "performance Markdown missing input resolution-horizon group section");
  assert(resolutionSource.includes("## Input background-depth groups"), "performance Markdown missing input background-depth group section");
  assert(resolutionSource.includes("## Input market-context groups"), "performance Markdown missing input market-context group section");
  assert(resolutionSource.includes("## Input market-recency groups"), "performance Markdown missing input market-recency group section");
  assert(resolutionSource.includes("## Input market-metadata groups"), "performance Markdown missing input market-metadata group section");
  assert(resolutionSource.includes("## Input market-creation-age groups"), "performance Markdown missing input market-creation-age group section");
  assert(resolutionSource.includes("## Input question-length groups"), "performance Markdown missing input question-length group section");
  assert(resolutionSource.includes("## Input category-count groups"), "performance Markdown missing input category-count group section");
  assert(resolutionSource.includes("## Input category-coverage groups"), "performance Markdown missing input category-coverage group section");
  assert(resolutionSource.includes("## Input threshold-count groups"), "performance Markdown missing input threshold-count group section");
  assert(resolutionSource.includes("## Input threshold-value groups"), "performance Markdown missing input threshold-value group section");
  assert(resolutionSource.includes("## Input threshold-direction groups"), "performance Markdown missing input threshold-direction group section");
  assert(resolutionSource.includes("## Input condition-criteria groups"), "performance Markdown missing input condition-criteria group section");
  assert(resolutionSource.includes("## Input condition-depth groups"), "performance Markdown missing input condition-depth group section");
  assert(resolutionSource.includes("## Input condition-criteria-depth groups"), "performance Markdown missing input condition-criteria-depth group section");
  assert(resolutionSource.includes("## Input unit-specificity groups"), "performance Markdown missing input unit-specificity group section");
  assert(resolutionSource.includes("## Run duration groups"), "performance Markdown missing run duration group section");
  assert(resolutionSource.includes("## Run workflow-version groups"), "performance Markdown missing run workflow-version group section");
  assert(resolutionSource.includes("## Run workflow-variant groups"), "performance Markdown missing run workflow-variant group section");
  assert(resolutionSource.includes("## Run experiment groups"), "performance Markdown missing run experiment group section");
  assert(resolutionSource.includes("## Candidate calibration guards"), "performance Markdown missing candidate calibration guard section");
  assert(dashboardSource.includes("candidateCalibrationGuardRules"), "lab dashboard does not read candidate calibration guard rules");
  assert(dashboardSource.includes("Candidate calibration guards"), "lab dashboard does not render candidate calibration guard rules");
  assert(dashboardSource.includes("PerformanceGuardImpact"), "lab dashboard does not render calibration guard impact summary");
  assert(dashboardSource.includes("readArray(impact, \"byRule\")"), "lab dashboard does not render rule-level guard impact");
  assert(dashboardSource.includes("byForecastAttemptCount"), "lab dashboard does not read forecast attempt-count performance groups");
  assert(dashboardSource.includes("Forecast attempt-count outcomes"), "lab dashboard does not render forecast attempt-count performance groups");
  assert(dashboardSource.includes("byBaselineSanity"), "lab dashboard does not read baseline sanity performance groups");
  assert(dashboardSource.includes("Baseline sanity outcomes"), "lab dashboard does not render baseline sanity performance groups");
  assert(dashboardSource.includes("byAggregateQuality"), "lab dashboard does not read aggregate quality performance groups");
  assert(dashboardSource.includes("Aggregate quality outcomes"), "lab dashboard does not render aggregate quality performance groups");
  assert(dashboardSource.includes("byAggregateQualityRounds"), "lab dashboard does not read aggregate review-round performance groups");
  assert(dashboardSource.includes("Aggregate review-round outcomes"), "lab dashboard does not render aggregate review-round performance groups");
  assert(dashboardSource.includes("byAggregateQualityIssues"), "lab dashboard does not read aggregate quality-issue performance groups");
  assert(dashboardSource.includes("Aggregate quality-issue outcomes"), "lab dashboard does not render aggregate quality-issue performance groups");
  assert(dashboardSource.includes("byAggregateDisagreement"), "lab dashboard does not read component disagreement performance groups");
  assert(dashboardSource.includes("Component disagreement outcomes"), "lab dashboard does not render component disagreement performance groups");
  assert(dashboardSource.includes("byAggregateFinalComponentPosition"), "lab dashboard does not read component envelope performance groups");
  assert(dashboardSource.includes("Component envelope outcomes"), "lab dashboard does not render component envelope performance groups");
  assert(dashboardSource.includes("byAggregateSideAgreement"), "lab dashboard does not read aggregate side-agreement performance groups");
  assert(dashboardSource.includes("Aggregate side-agreement outcomes"), "lab dashboard does not render aggregate side-agreement performance groups");
  assert(dashboardSource.includes("byAggregateMeanConfidenceDistance"), "lab dashboard does not read aggregate panel-confidence performance groups");
  assert(dashboardSource.includes("Aggregate panel-confidence outcomes"), "lab dashboard does not render aggregate panel-confidence performance groups");
  assert(dashboardSource.includes("byAggregateFinalConfidenceShift"), "lab dashboard does not read final confidence shift performance groups");
  assert(dashboardSource.includes("Final confidence shift outcomes"), "lab dashboard does not render final confidence shift performance groups");
  assert(dashboardSource.includes("byAggregateMedianAdjustment"), "lab dashboard does not read median adjustment performance groups");
  assert(dashboardSource.includes("Median adjustment outcomes"), "lab dashboard does not render median adjustment performance groups");
  assert(dashboardSource.includes("byAggregateInsideViewShift"), "lab dashboard does not read inside-view shift performance groups");
  assert(dashboardSource.includes("Inside-view shift outcomes"), "lab dashboard does not render inside-view shift performance groups");
  assert(dashboardSource.includes("byAggregateFinalInsideViewAdjustment"), "lab dashboard does not read final aggregation adjustment performance groups");
  assert(dashboardSource.includes("Final aggregation adjustment outcomes"), "lab dashboard does not render final aggregation adjustment performance groups");
  assert(dashboardSource.includes("byAggregateFinalAdjustmentDirection"), "lab dashboard does not read final aggregation direction performance groups");
  assert(dashboardSource.includes("Final aggregation direction outcomes"), "lab dashboard does not render final aggregation direction performance groups");
  assert(dashboardSource.includes("byAggregateAttemptCount"), "lab dashboard does not read aggregate attempt-count performance groups");
  assert(dashboardSource.includes("Aggregate attempt-count outcomes"), "lab dashboard does not render aggregate attempt-count performance groups");
  assert(dashboardSource.includes("byAggregationAnchor"), "lab dashboard does not read aggregation anchor performance groups");
  assert(dashboardSource.includes("Aggregation anchor outcomes"), "lab dashboard does not render aggregation anchor performance groups");
  assert(dashboardSource.includes("byResearchDepth"), "lab dashboard does not read research depth performance groups");
  assert(dashboardSource.includes("Research depth outcomes"), "lab dashboard does not render research depth performance groups");
  assert(dashboardSource.includes("byForecasterPanelSize"), "lab dashboard does not read panel size performance groups");
  assert(dashboardSource.includes("Panel size outcomes"), "lab dashboard does not render panel size performance groups");
  assert(dashboardSource.includes("byComplexityScore"), "lab dashboard does not read complexity score performance groups");
  assert(dashboardSource.includes("Complexity score outcomes"), "lab dashboard does not render complexity score performance groups");
  assert(dashboardSource.includes("typeof item.reason === \"string\""), "lab dashboard does not read attention item reasons");
  assert(dashboardSource.includes("byConditionalBranch"), "lab dashboard does not read conditional branch performance groups");
  assert(dashboardSource.includes("Conditional branch outcomes"), "lab dashboard does not render conditional branch performance groups");
  assert(dashboardSource.includes("byConditionalEffect"), "lab dashboard does not read conditional effect performance groups");
  assert(dashboardSource.includes("Conditional effect outcomes"), "lab dashboard does not render conditional effect performance groups");
  assert(dashboardSource.includes("byConditionalResolvedBranch"), "lab dashboard does not read conditional resolved-branch performance groups");
  assert(dashboardSource.includes("Conditional resolved-branch outcomes"), "lab dashboard does not render conditional resolved-branch performance groups");
  assert(dashboardSource.includes("byThresholdedDirection"), "lab dashboard does not read thresholded direction performance groups");
  assert(dashboardSource.includes("Threshold direction outcomes"), "lab dashboard does not render thresholded direction performance groups");
  assert(dashboardSource.includes("byThresholdedSource"), "lab dashboard does not read thresholded source performance groups");
  assert(dashboardSource.includes("Threshold source outcomes"), "lab dashboard does not render thresholded source performance groups");
  assert(dashboardSource.includes("byThresholdedRepair"), "lab dashboard does not read thresholded repair performance groups");
  assert(dashboardSource.includes("Threshold monotonicity outcomes"), "lab dashboard does not render thresholded repair performance groups");
  assert(dashboardSource.includes("byThresholdedCurveSpread"), "lab dashboard does not read threshold curve-spread performance groups");
  assert(dashboardSource.includes("Threshold curve-spread outcomes"), "lab dashboard does not render threshold curve-spread performance groups");
  assert(dashboardSource.includes("byThresholdedResolvedBand"), "lab dashboard does not read threshold resolved-band performance groups");
  assert(dashboardSource.includes("Threshold resolved-band outcomes"), "lab dashboard does not render threshold resolved-band performance groups");
  assert(dashboardSource.includes("byNumericInterval"), "lab dashboard does not read numeric interval performance groups");
  assert(dashboardSource.includes("Numeric interval outcomes"), "lab dashboard does not render numeric interval performance groups");
  assert(dashboardSource.includes("byNumericUnit"), "lab dashboard does not read numeric unit performance groups");
  assert(dashboardSource.includes("Numeric unit outcomes"), "lab dashboard does not render numeric unit performance groups");
  assert(dashboardSource.includes("byNumericResolvedPosition"), "lab dashboard does not read numeric resolved-position performance groups");
  assert(dashboardSource.includes("Numeric resolved-position outcomes"), "lab dashboard does not render numeric resolved-position performance groups");
  assert(dashboardSource.includes("byDateInterval"), "lab dashboard does not read date interval performance groups");
  assert(dashboardSource.includes("Date interval outcomes"), "lab dashboard does not render date interval performance groups");
  assert(dashboardSource.includes("byDateNeverProbability"), "lab dashboard does not read date never-probability performance groups");
  assert(dashboardSource.includes("Date never-probability outcomes"), "lab dashboard does not render date never-probability performance groups");
  assert(dashboardSource.includes("byDateResolvedPosition"), "lab dashboard does not read date resolved-position performance groups");
  assert(dashboardSource.includes("Date resolved-position outcomes"), "lab dashboard does not render date resolved-position performance groups");
  assert(dashboardSource.includes("byCategoricalConfidence"), "lab dashboard does not read categorical confidence performance groups");
  assert(dashboardSource.includes("Categorical confidence outcomes"), "lab dashboard does not render categorical confidence performance groups");
  assert(dashboardSource.includes("byCategoricalEntropy"), "lab dashboard does not read categorical entropy performance groups");
  assert(dashboardSource.includes("Categorical entropy outcomes"), "lab dashboard does not render categorical entropy performance groups");
  assert(dashboardSource.includes("byCategoricalSource"), "lab dashboard does not read categorical source performance groups");
  assert(dashboardSource.includes("Categorical source outcomes"), "lab dashboard does not render categorical source performance groups");
  assert(dashboardSource.includes("byCategoricalCoverage"), "lab dashboard does not read categorical coverage performance groups");
  assert(dashboardSource.includes("Categorical coverage outcomes"), "lab dashboard does not render categorical coverage performance groups");
  assert(dashboardSource.includes("byCategoricalResolvedCategory"), "lab dashboard does not read categorical resolved-category performance groups");
  assert(dashboardSource.includes("Categorical resolved-category outcomes"), "lab dashboard does not render categorical resolved-category performance groups");
  assert(dashboardSource.includes("byNumericP50Error"), "lab dashboard does not read numeric median-error performance groups");
  assert(dashboardSource.includes("Numeric median-error outcomes"), "lab dashboard does not render numeric median-error performance groups");
  assert(dashboardSource.includes("byDateP50Error"), "lab dashboard does not read date median-error performance groups");
  assert(dashboardSource.includes("Date median-error outcomes"), "lab dashboard does not render date median-error performance groups");
  assert(dashboardSource.includes("byBinaryConfidence"), "lab dashboard does not read binary confidence performance groups");
  assert(dashboardSource.includes("Binary confidence outcomes"), "lab dashboard does not render binary confidence performance groups");
  assert(dashboardSource.includes("byBinaryForecastSide"), "lab dashboard does not read binary side performance groups");
  assert(dashboardSource.includes("Binary side outcomes"), "lab dashboard does not render binary side performance groups");
  assert(dashboardSource.includes("byEvidenceSourceCount"), "lab dashboard does not read evidence source performance groups");
  assert(dashboardSource.includes("Evidence source outcomes"), "lab dashboard does not render evidence source performance groups");
  assert(dashboardSource.includes("byEvidenceSourceDiversity"), "lab dashboard does not read evidence source diversity performance groups");
  assert(dashboardSource.includes("Evidence source-diversity outcomes"), "lab dashboard does not render evidence source diversity performance groups");
  assert(dashboardSource.includes("byEvidenceSourceConcentration"), "lab dashboard does not read evidence source concentration performance groups");
  assert(dashboardSource.includes("Evidence source-concentration outcomes"), "lab dashboard does not render evidence source concentration performance groups");
  assert(dashboardSource.includes("byEvidenceSourceFreshness"), "lab dashboard does not read evidence freshness performance groups");
  assert(dashboardSource.includes("Evidence freshness outcomes"), "lab dashboard does not render evidence freshness performance groups");
  assert(dashboardSource.includes("byEvidenceSourceTiming"), "lab dashboard does not read evidence timing performance groups");
  assert(dashboardSource.includes("Evidence timing outcomes"), "lab dashboard does not render evidence timing performance groups");
  assert(dashboardSource.includes("byEvidenceUncertaintyCount"), "lab dashboard does not read evidence uncertainty performance groups");
  assert(dashboardSource.includes("Evidence uncertainty outcomes"), "lab dashboard does not render evidence uncertainty performance groups");
  assert(dashboardSource.includes("byEvidenceRationaleLength"), "lab dashboard does not read evidence rationale performance groups");
  assert(dashboardSource.includes("Evidence rationale outcomes"), "lab dashboard does not render evidence rationale performance groups");
  assert(dashboardSource.includes("byInputRequestedForecastType"), "lab dashboard does not read input requested-type performance groups");
  assert(dashboardSource.includes("Input requested-type outcomes"), "lab dashboard does not render input requested-type performance groups");
  assert(dashboardSource.includes("byInputRoutedForecastType"), "lab dashboard does not read input routed-type performance groups");
  assert(dashboardSource.includes("Input routed-type outcomes"), "lab dashboard does not render input routed-type performance groups");
  assert(dashboardSource.includes("byInputTypeAlignment"), "lab dashboard does not read input type-alignment performance groups");
  assert(dashboardSource.includes("Input type-alignment outcomes"), "lab dashboard does not render input type-alignment performance groups");
  assert(dashboardSource.includes("byInputRoutingConfidence"), "lab dashboard does not read input routing-confidence performance groups");
  assert(dashboardSource.includes("Input routing-confidence outcomes"), "lab dashboard does not render input routing-confidence performance groups");
  assert(dashboardSource.includes("byInputSource"), "lab dashboard does not read input source performance groups");
  assert(dashboardSource.includes("Input source outcomes"), "lab dashboard does not render input source performance groups");
  assert(dashboardSource.includes("byInputContextCompleteness"), "lab dashboard does not read input context performance groups");
  assert(dashboardSource.includes("Input context outcomes"), "lab dashboard does not render input context performance groups");
  assert(dashboardSource.includes("byInputEvidenceAsOfDate"), "lab dashboard does not read input evidence-as-of performance groups");
  assert(dashboardSource.includes("Input evidence-as-of outcomes"), "lab dashboard does not render input evidence-as-of performance groups");
  assert(dashboardSource.includes("byInputResolutionCriteriaDepth"), "lab dashboard does not read input resolution-criteria performance groups");
  assert(dashboardSource.includes("Input resolution-criteria outcomes"), "lab dashboard does not render input resolution-criteria performance groups");
  assert(dashboardSource.includes("byInputResolutionHorizon"), "lab dashboard does not read input horizon performance groups");
  assert(dashboardSource.includes("Input horizon outcomes"), "lab dashboard does not render input horizon performance groups");
  assert(dashboardSource.includes("byInputBackgroundDepth"), "lab dashboard does not read input background-depth performance groups");
  assert(dashboardSource.includes("Input background outcomes"), "lab dashboard does not render input background-depth performance groups");
  assert(dashboardSource.includes("byInputMarketContext"), "lab dashboard does not read input market performance groups");
  assert(dashboardSource.includes("Input market outcomes"), "lab dashboard does not render input market performance groups");
  assert(dashboardSource.includes("byInputMarketRecency"), "lab dashboard does not read input market-recency performance groups");
  assert(dashboardSource.includes("Input market-recency outcomes"), "lab dashboard does not render input market-recency performance groups");
  assert(dashboardSource.includes("byInputMarketMetadata"), "lab dashboard does not read input market metadata performance groups");
  assert(dashboardSource.includes("Input market-metadata outcomes"), "lab dashboard does not render input market metadata performance groups");
  assert(dashboardSource.includes("byInputMarketCreationAge"), "lab dashboard does not read input market creation performance groups");
  assert(dashboardSource.includes("Input market-creation outcomes"), "lab dashboard does not render input market creation performance groups");
  assert(dashboardSource.includes("byInputQuestionLength"), "lab dashboard does not read input question performance groups");
  assert(dashboardSource.includes("Input question outcomes"), "lab dashboard does not render input question performance groups");
  assert(dashboardSource.includes("byInputCategoryCoverage"), "lab dashboard does not read input category-coverage performance groups");
  assert(dashboardSource.includes("Input category-coverage outcomes"), "lab dashboard does not render input category-coverage performance groups");
  assert(dashboardSource.includes("byInputThresholdValueCoverage"), "lab dashboard does not read input threshold-value performance groups");
  assert(dashboardSource.includes("Input threshold-value outcomes"), "lab dashboard does not render input threshold-value performance groups");
  assert(dashboardSource.includes("byInputThresholdDirection"), "lab dashboard does not read input threshold-direction performance groups");
  assert(dashboardSource.includes("Input threshold-direction outcomes"), "lab dashboard does not render input threshold-direction performance groups");
  assert(dashboardSource.includes("byInputConditionCriteria"), "lab dashboard does not read input condition-criteria performance groups");
  assert(dashboardSource.includes("Input condition-criteria outcomes"), "lab dashboard does not render input condition-criteria performance groups");
  assert(dashboardSource.includes("byInputConditionDepth"), "lab dashboard does not read input condition-depth performance groups");
  assert(dashboardSource.includes("Input condition-depth outcomes"), "lab dashboard does not render input condition-depth performance groups");
  assert(dashboardSource.includes("byInputConditionCriteriaDepth"), "lab dashboard does not read input condition-criteria-depth performance groups");
  assert(dashboardSource.includes("Input condition-criteria-depth outcomes"), "lab dashboard does not render input condition-criteria-depth performance groups");
  assert(dashboardSource.includes("byInputUnitSpecificity"), "lab dashboard does not read input unit performance groups");
  assert(dashboardSource.includes("Input unit outcomes"), "lab dashboard does not render input unit performance groups");
  assert(dashboardSource.includes("byRunDuration"), "lab dashboard does not read run duration performance groups");
  assert(dashboardSource.includes("Run duration outcomes"), "lab dashboard does not render run duration performance groups");
  assert(dashboardSource.includes("byRunExperiment"), "lab dashboard does not read run experiment performance groups");
  assert(dashboardSource.includes("Run experiment outcomes"), "lab dashboard does not render run experiment performance groups");
  return "candidate calibration guard rules are visible in report artifacts and the lab dashboard";
});

await check("calibration guard impact summary compares guarded and unguarded Brier", async () => {
  const impact = buildCalibrationGuardImpact([
    {
      score: 0.2,
      taskId: "guarded-1",
      calibrationGuard: {
        adjustment: -5,
        appliedRules: [{ id: "production-ramp-threshold", adjustment: -5, note: "Subtracted 5 points." }],
      },
    },
    {
      score: 0.4,
      taskId: "unguarded-1",
      calibrationGuard: null,
    },
    {
      score: 0.6,
      taskId: "unguarded-2",
      calibrationGuard: { adjustment: 0, appliedRules: [] },
    },
    {
      score: 0.8,
      taskId: "guarded-2",
      calibrationGuard: {
        adjustment: -2.5,
        appliedRules: [{ id: "labor-deterioration-threshold", adjustment: -2.5, note: "Subtracted 2.5 points." }],
      },
    },
  ]);
  assert(impact.status === "flat", "guard impact status mismatch");
  assert(impact.guardedRows === 2, "guarded row count mismatch");
  assert(impact.unguardedRows === 2, "unguarded row count mismatch");
  assert(impact.guardedResolvedTasks === 2, "guarded task count mismatch");
  assert(impact.unguardedResolvedTasks === 2, "unguarded task count mismatch");
  assert(impact.guardedMeanBrier === 0.5, "guarded mean Brier mismatch");
  assert(impact.unguardedMeanBrier === 0.5, "unguarded mean Brier mismatch");
  assert(impact.brierDelta === 0, "guard impact Brier delta mismatch");
  assert(impact.byRule.length === 2, "rule-level guard impact count mismatch");
  assert(impact.byRule[0].ruleId === "labor-deterioration-threshold", "worse rule impact should sort first");
  assert(impact.byRule[0].status === "worse", "worse rule impact status mismatch");
  assert(impact.byRule[0].brierDelta === 0.3, "worse rule impact Brier delta mismatch");
  assert(impact.byRule[1].ruleId === "production-ramp-threshold", "improved rule impact should sort after worse rule");
  assert(impact.byRule[1].status === "improved", "improved rule impact status mismatch");
  assert(impact.byRule[1].brierDelta === -0.3, "improved rule impact Brier delta mismatch");
  return "calibration guard impact summary is shared and deterministic";
});

await check("binary confidence metadata reaches resolved score analytics", async () => {
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  const snapshot = buildBinaryConfidenceSnapshot(92);
  assert(snapshot?.forecastSide === "yes", "binary confidence side mismatch");
  assert(snapshot?.distanceFromEven === 42, "binary confidence distance mismatch");
  assert(snapshot?.confidenceBand === "very_likely", "binary confidence band mismatch");
  const normalized = readBinaryConfidenceSnapshot({ binaryConfidence: { probability: 0.04 } });
  assert(normalized?.probability === 4, "binary confidence did not normalize fractional probability");
  assert(normalized?.forecastSide === "no", "binary confidence normalized side mismatch");
  assert(normalized?.confidenceBand === "extreme", "binary confidence normalized band mismatch");
  const historical = readBinaryConfidenceSnapshot({ probability: 72, binaryConfidence: { confidenceBand: "likely" } });
  assert(historical?.forecastSide === "yes", "binary confidence did not fall back to top-level probability");
  assert(resolutionSource.includes("buildBinaryConfidenceSnapshot(probability)"), "resolution scoring does not build binary confidence metadata");
  assert(resolutionSource.includes("binaryConfidence: readBinaryConfidenceSnapshot(latest.scoreConfig)"), "performance cases do not retain binary confidence snapshots");
  assert(resolutionSource.includes("byBinaryConfidence"), "performance report does not group by binary confidence");
  assert(resolutionSource.includes("byBinaryForecastSide"), "performance report does not group by binary side");
  assert(resolutionSource.includes("binary_confidence_miss"), "performance report does not turn high-confidence misses into attention");
  assert(metricsSource.includes("open_superforecaster_binary_confidence_scores_total"), "metrics missing binary confidence score counts");
  assert(metricsSource.includes("confidence_band"), "metrics missing binary confidence labels");
  assert(metricsSource.includes("forecast_side"), "metrics missing binary forecast-side labels");
  assert(syncSource.includes("binary_confidence_band"), "DuckDB forecast score mart missing binary confidence band");
  assert(syncSource.includes("binary_forecast_side"), "DuckDB forecast score mart missing binary forecast side");
  assert(syncSource.includes("binary_distance_from_even"), "DuckDB forecast score mart missing binary distance from even");
  assert(dashboardSource.includes("Binary confidence outcomes"), "lab dashboard does not render binary confidence outcomes");
  assert(dashboardSource.includes("Binary side outcomes"), "lab dashboard does not render binary side outcomes");
  return "binary confidence metadata is persisted and visible in resolved score analytics";
});

await check("forecast calibration health is exported as metrics", async () => {
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const attentionBacklogSource = await readFile(resolve(root, "packages/backend/src/forecast-attention-backlog.ts"), "utf8");
  const smokeSource = await readFile(resolve(root, "scripts/smoke-check.ts"), "utf8");
  const metricsRouteSource = await readFile(resolve(root, "apps/web/src/app/metrics/route.ts"), "utf8");
  assert(metricsSource.includes("buildBinaryCalibrationReport"), "metrics exporter does not use shared calibration report builder");
  assert(metricsSource.includes("open_superforecaster_binary_calibration_status"), "calibration status metric missing");
  assert(metricsSource.includes("open_superforecaster_binary_calibration_expected_error"), "calibration expected error metric missing");
  assert(metricsSource.includes("open_superforecaster_binary_calibration_bucket_error"), "calibration bucket error metric missing");
  assert(metricsSource.includes("open_superforecaster_binary_calibration_diagnostic"), "calibration diagnostic metric missing");
  assert(metricsSource.includes("open_superforecaster_binary_calibration_candidate_guard_rules_total"), "candidate calibration guard metric missing");
  assert(metricsSource.includes("open_superforecaster_baseline_sanity_scores_total"), "baseline sanity score count metric missing");
  assert(metricsSource.includes("open_superforecaster_baseline_sanity_score_mean"), "baseline sanity score mean metric missing");
  assert(metricsSource.includes("open_superforecaster_aggregate_quality_scores_total"), "aggregate quality score count metric missing");
  assert(metricsSource.includes("open_superforecaster_aggregate_quality_score_mean"), "aggregate quality score mean metric missing");
  assert(metricsSource.includes("open_superforecaster_aggregate_stats_scores_total"), "aggregate stats score count metric missing");
  assert(metricsSource.includes("open_superforecaster_aggregate_stats_score_mean"), "aggregate stats score mean metric missing");
  assert(metricsSource.includes("open_superforecaster_aggregate_plan_scores_total"), "aggregate plan score count metric missing");
  assert(metricsSource.includes("open_superforecaster_aggregate_plan_score_mean"), "aggregate plan score mean metric missing");
  assert(metricsSource.includes("open_superforecaster_conditional_scores_total"), "conditional score count metric missing");
  assert(metricsSource.includes("open_superforecaster_conditional_score_mean"), "conditional score mean metric missing");
  assert(metricsSource.includes("open_superforecaster_thresholded_scores_total"), "thresholded score count metric missing");
  assert(metricsSource.includes("open_superforecaster_thresholded_score_mean"), "thresholded score mean metric missing");
  assert(metricsSource.includes("open_superforecaster_numeric_distribution_scores_total"), "numeric distribution score count metric missing");
  assert(metricsSource.includes("open_superforecaster_numeric_distribution_score_mean"), "numeric distribution score mean metric missing");
  assert(metricsSource.includes("open_superforecaster_date_distribution_scores_total"), "date distribution score count metric missing");
  assert(metricsSource.includes("open_superforecaster_date_distribution_score_mean"), "date distribution score mean metric missing");
  assert(metricsSource.includes("open_superforecaster_categorical_distribution_scores_total"), "categorical distribution score count metric missing");
  assert(metricsSource.includes("open_superforecaster_categorical_distribution_score_mean"), "categorical distribution score mean metric missing");
  assert(metricsSource.includes("open_superforecaster_evidence_coverage_scores_total"), "evidence coverage score count metric missing");
  assert(metricsSource.includes("open_superforecaster_evidence_coverage_score_mean"), "evidence coverage score mean metric missing");
  assert(metricsSource.includes("open_superforecaster_input_context_scores_total"), "input context score count metric missing");
  assert(metricsSource.includes("open_superforecaster_input_context_score_mean"), "input context score mean metric missing");
  assert(metricsSource.includes("open_superforecaster_run_metadata_scores_total"), "run metadata score count metric missing");
  assert(metricsSource.includes("open_superforecaster_run_metadata_score_mean"), "run metadata score mean metric missing");
  assert(metricsSource.includes("buildCalibrationGuardImpact"), "metrics exporter does not use shared calibration guard impact builder");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_impact_status"), "calibration guard impact status metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_impact_brier_delta"), "calibration guard impact Brier delta metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_rule_impact_status"), "rule-level calibration guard impact status metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_rule_impact_brier_delta"), "rule-level calibration guard impact Brier delta metric missing");
  assert(metricsSource.includes("readCalibrationGuardValidationMetricRows"), "metrics exporter does not read calibration guard validation reports");
  assert(metricsSource.includes("readCalibrationGuardDefaultPlanMetricRows"), "metrics exporter does not read calibration guard default plan reports");
  assert(metricsSource.includes("readForecastAttentionMetricRows"), "metrics exporter does not read forecast attention items");
  assert(metricsSource.includes("readForecastBatchIndexArtifacts"), "metrics exporter does not use shared batch-index reader for forecast attention items");
  assert(metricsSource.includes("readForecastAttentionBacklogArtifacts"), "metrics exporter does not use shared attention backlog artifact reader");
  assert(metricsSource.includes("isExportCompatibleAttentionBacklogArtifact"), "metrics exporter does not guard generated forecast attention backlog artifact compatibility");
  assert(metricsSource.includes("./forecast-attention-backlog"), "metrics exporter does not use the shared attention backlog compatibility helper");
  assert(!metricsSource.includes("listFilesNamed(resolve(root, \"data/reports/forecast-attention-backlog\")"), "metrics exporter should not keep a local attention backlog scanner");
  assert(!metricsSource.includes("readRecordArray(payload, \"items\")"), "metrics exporter should not parse generated attention backlog rows from raw JSON");
  assert(attentionBacklogSource.includes("readAttentionBacklogReviewsUpdatedAt"), "shared attention backlog helper does not reject review-stale generated attention backlog items");
  assert(attentionBacklogSource.includes("input.batchIds.length > 0"), "shared attention backlog helper does not reject batch-filtered exports");
  assert(!metricsSource.includes("function readAttentionBacklogReviewsUpdatedAt"), "metrics exporter should not keep a local attention backlog freshness reader");
  assert(metricsSource.includes("emitForecastBatchHealthAttentionBreakdownMetrics"), "metrics exporter does not emit batch-health attention breakdowns from the shared health snapshot");
  assert(metricsSource.includes("open_superforecaster_forecast_batch_health_attention_breakdown_items"), "forecast batch health attention breakdown metric missing");
  assert(metricsSource.includes("open_superforecaster_forecast_attention_reports_total"), "forecast attention report metric missing");
  assert(metricsSource.includes("open_superforecaster_forecast_attention_items_total"), "forecast attention item count metric missing");
  assert(metricsSource.includes("forecast_type: row.forecastType"), "forecast attention item count metric missing forecast type labels");
  assert(metricsSource.includes("open_superforecaster_forecast_attention_item_info"), "forecast attention item info metric missing");
  assert(metricsSource.includes("open_superforecaster_forecast_attention_item_score"), "forecast attention item score metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_validation_reports_total"), "calibration validation report metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_validation_brier_delta"), "calibration validation Brier delta metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_validation_calibration_error_delta"), "calibration validation calibration error delta metric missing");
  assert(metricsSource.includes("readCalibrationGuardValidationArtifacts"), "metrics do not use shared calibration validation artifact reader");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_default_plan_candidates_total"), "calibration default plan candidate metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_default_plan_candidate_brier_delta"), "calibration default plan Brier delta metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_default_plan_skipped_rows_total"), "calibration default plan skipped-row metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_default_plan_skipped_row_info"), "calibration default plan skipped-row metadata metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_default_plan_issues_total"), "calibration default plan issue metric missing");
  assert(metricsSource.includes("open_superforecaster_calibration_guard_default_plan_issue_info"), "calibration default plan issue metadata metric missing");
  assert(metricsSource.includes("readCalibrationDefaultPlanArtifacts"), "metrics do not use shared calibration default-plan artifact reader");
  assert(metricsSource.includes("open_superforecaster_source_bank_domains_total"), "source-bank domain count metric missing");
  assert(metricsSource.includes("open_superforecaster_source_bank_domain_entries"), "source-bank domain entry metric missing");
  assert(metricsSource.includes("open_superforecaster_source_bank_domain_used_in_final_entries"), "source-bank domain final-use metric missing");
  assert(metricsSource.includes("open_superforecaster_source_bank_domain_task_count"), "source-bank domain task-count metric missing");
  assert(metricsSource.includes("open_superforecaster_source_bank_domain_quality_score_mean"), "source-bank domain quality metric missing");
  assert(metricsSource.includes("summarizeSourceDomains(sourceRows)"), "metrics exporter does not use source-domain summary");
  assert(metricsSource.includes("./source-domain-summary"), "metrics exporter does not use the shared source-domain summary helper");
  assert(!metricsSource.includes("function summarizeSourceDomains"), "metrics exporter should not keep a local source-domain summarizer");
  assert(smokeSource.includes("open_superforecaster_binary_calibration_status"), "smoke check does not require calibration status metric");
  assert(smokeSource.includes("open_superforecaster_calibration_guard_impact_status"), "smoke check does not require calibration guard impact metric");
  assert(smokeSource.includes("open_superforecaster_aggregate_quality_scores_total"), "smoke check does not require aggregate quality metric");
  assert(smokeSource.includes("open_superforecaster_aggregate_stats_scores_total"), "smoke check does not require aggregate stats metric");
  assert(smokeSource.includes("open_superforecaster_aggregate_plan_scores_total"), "smoke check does not require aggregate plan metric");
  assert(smokeSource.includes("open_superforecaster_conditional_scores_total"), "smoke check does not require conditional metric");
  assert(smokeSource.includes("open_superforecaster_thresholded_scores_total"), "smoke check does not require thresholded metric");
  assert(smokeSource.includes("open_superforecaster_numeric_distribution_scores_total"), "smoke check does not require numeric distribution metric");
  assert(smokeSource.includes("open_superforecaster_date_distribution_scores_total"), "smoke check does not require date distribution metric");
  assert(smokeSource.includes("open_superforecaster_categorical_distribution_scores_total"), "smoke check does not require categorical distribution metric");
  assert(smokeSource.includes("open_superforecaster_evidence_coverage_scores_total"), "smoke check does not require evidence coverage metric");
  assert(smokeSource.includes("open_superforecaster_input_context_scores_total"), "smoke check does not require input context metric");
  assert(smokeSource.includes("open_superforecaster_run_metadata_scores_total"), "smoke check does not require run metadata metric");
  assert(smokeSource.includes("open_superforecaster_forecast_attention_items_total"), "smoke check does not require forecast attention metric");
  assert(smokeSource.includes("open_superforecaster_forecast_batch_health_attention_breakdown_items"), "smoke check does not require forecast batch health attention breakdown metric");
  assert(smokeSource.includes("open_superforecaster_source_bank_domains_total"), "smoke check does not require source-bank domain metric");
  assert(smokeSource.includes("open_superforecaster_calibration_guard_validation_reports_total"), "smoke check does not require calibration validation metric");
  assert(smokeSource.includes("open_superforecaster_calibration_guard_default_plan_skipped_rows_total"), "smoke check does not require calibration default-plan skipped-row metric");
  assert(smokeSource.includes("open_superforecaster_calibration_guard_default_plan_issues_total"), "smoke check does not require calibration default-plan issue metric");
  assert(metricsRouteSource.includes("renderPrometheusMetrics"), "metrics route does not render Prometheus metrics");
  assert(metricsRouteSource.includes("text/plain; version=0.0.4"), "metrics route missing Prometheus content type");
  return "binary calibration health, candidate guard rules, and validation outcomes are visible in Prometheus metrics";
});

await check("forecast calibration health is exported to DuckDB", async () => {
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const attentionBacklogSource = await readFile(resolve(root, "packages/backend/src/forecast-attention-backlog.ts"), "utf8");
  const validationSource = await readFile(resolve(root, "scripts/forecast-calibration-guard-validation.ts"), "utf8");
  assert(syncSource.includes("osf_forecast_scores"), "DuckDB sync missing forecast score mart");
  assert(syncSource.includes("osf_binary_calibration_buckets"), "DuckDB sync missing binary calibration bucket mart");
  assert(syncSource.includes("osf_calibration_guard_impact"), "DuckDB sync missing calibration guard impact mart");
  assert(syncSource.includes("osf_calibration_guard_rule_impact"), "DuckDB sync missing rule-level calibration guard impact mart");
  assert(syncSource.includes("osf_calibration_guard_validations"), "DuckDB sync missing calibration guard validation mart");
  assert(syncSource.includes("osf_calibration_guard_default_plan_candidates"), "DuckDB sync missing calibration guard default plan mart");
  assert(syncSource.includes("osf_calibration_guard_default_plan_skipped_rows"), "DuckDB sync missing calibration guard default plan skipped-row mart");
  assert(syncSource.includes("osf_calibration_guard_default_plan_issues"), "DuckDB sync missing calibration guard default plan issue mart");
  assert(syncSource.includes("readCalibrationGuardValidationArtifacts"), "DuckDB sync does not use shared calibration validation artifact reader");
  assert(syncSource.includes("readCalibrationDefaultPlanArtifacts"), "DuckDB sync does not use shared calibration default-plan artifact reader");
  assert(syncSource.includes("osf_forecast_attention_items"), "DuckDB sync missing forecast attention item mart");
  assert(syncSource.includes("readForecastBatchIndexArtifacts"), "DuckDB sync does not use shared batch-index reader for forecast attention items");
  assert(syncSource.includes("readForecastAttentionBacklogArtifacts"), "DuckDB sync does not use shared attention backlog artifact reader");
  assert(syncSource.includes("isExportCompatibleAttentionBacklogArtifact"), "DuckDB sync does not guard generated forecast attention backlog artifact compatibility");
  assert(syncSource.includes("../packages/backend/src/forecast-attention-backlog"), "DuckDB sync does not use the shared attention backlog compatibility helper");
  assert(!syncSource.includes("listFilesNamed(resolve(root, \"data/reports/forecast-attention-backlog\")"), "DuckDB sync should not keep a local attention backlog scanner");
  assert(!syncSource.includes("readRecordArray(payload, \"items\")"), "DuckDB sync should not parse generated attention backlog rows from raw JSON");
  assert(attentionBacklogSource.includes("readAttentionBacklogReviewsUpdatedAt"), "shared attention backlog helper does not reject review-stale generated attention backlog items");
  assert(!syncSource.includes("function readAttentionBacklogReviewsUpdatedAt"), "DuckDB sync should not keep a local attention backlog freshness reader");
  assert(syncSource.includes("osf_source_bank_domains"), "DuckDB sync missing source-bank domain mart");
  assert(syncSource.includes("osf_smithers_token_usage"), "DuckDB sync missing detailed token-usage mart");
  assert(syncSource.includes("osf_smithers_token_usage_by_task"), "DuckDB sync missing task token-usage summary mart");
  assert(syncSource.includes("osf_forecast_batch_health"), "DuckDB sync missing forecast batch health mart");
  assert(syncSource.includes("osf_forecast_batch_health_issues"), "DuckDB sync missing forecast batch health issue mart");
  assert(syncSource.includes("osf_forecast_batch_health_attention_items"), "DuckDB sync missing forecast batch health attention-item mart");
  assert(syncSource.includes("osf_forecast_batch_health_attention_kinds"), "DuckDB sync missing forecast batch health attention-kind mart");
  assert(syncSource.includes("osf_forecast_batch_health_attention_severities"), "DuckDB sync missing forecast batch health attention-severity mart");
  assert(syncSource.includes("osf_forecast_batch_health_attention_types"), "DuckDB sync missing forecast batch health attention-type mart");
  assert(syncSource.includes("osf_forecast_batch_health_candidate_guards"), "DuckDB sync missing forecast batch health candidate guard mart");
  assert(syncSource.includes("buildBinaryCalibrationReport"), "DuckDB sync does not use shared binary calibration report builder");
  assert(syncSource.includes("buildCalibrationGuardImpact"), "DuckDB sync does not use shared calibration guard impact builder");
  assert(syncSource.includes("readLatestForecastBatchHealth"), "DuckDB sync does not use shared batch health reader");
  assert(syncSource.includes("buildForecastBatchHealthAttentionKindMartRows"), "DuckDB sync missing batch-health attention-kind mapper");
  assert(syncSource.includes("buildForecastBatchHealthAttentionSeverityMartRows"), "DuckDB sync missing batch-health attention-severity mapper");
  assert(syncSource.includes("buildCalibrationGuardRuleImpactMartRows"), "DuckDB sync missing rule-level calibration guard impact mapper");
  assert(syncSource.includes("buildBinaryCalibrationBucketMartRows"), "DuckDB sync missing calibration bucket mart mapper");
  assert(syncSource.includes("readSmithersTokenUsage"), "DuckDB token-usage mart does not use the shared durable-log parser");
  assert(syncSource.includes("summarizeSmithersTokenUsage"), "DuckDB token-usage mart does not use the shared token summary reducer");
  assert(syncSource.includes("buildSmithersTokenUsageMarts"), "DuckDB sync missing token-usage mart mapper");
  assert(syncSource.includes("buildForecastBatchHealthMartRows"), "DuckDB sync missing batch health mart mapper");
  assert(syncSource.includes("buildForecastBatchHealthAttentionItemMartRows"), "DuckDB sync missing batch health attention-item mapper");
  assert(syncSource.includes("buildForecastBatchHealthAttentionTypeMartRows"), "DuckDB sync missing batch health attention-type mapper");
  assert(syncSource.includes("buildForecastBatchHealthCandidateGuardMartRows"), "DuckDB sync missing batch health candidate guard mapper");
  assert(syncSource.includes("buildSourceDomainMartRows"), "DuckDB sync missing source-bank domain mapper");
  assert(syncSource.includes("source-domain-summary"), "DuckDB sync does not use the shared source-domain summary helper");
  assert(syncSource.includes("summarizeSourceDomains(sources)"), "DuckDB source-domain mart does not use the shared summary builder");
  assert(syncSource.includes("calibration_guard_adjustment"), "forecast score mart missing calibration guard adjustment");
  assert(syncSource.includes("calibration_guard_rules_json"), "forecast score mart missing calibration guard rules");
  assert(syncSource.includes("unresolved_attention_items"), "batch health mart missing unresolved attention count");
  assert(syncSource.includes("unresolved_candidate_calibration_guard_rules"), "batch health mart missing unresolved candidate guard count");
  assert(syncSource.includes("missing_phases_json"), "batch health mart missing missing phases");
  assert(syncSource.includes("batch_index_path"), "batch health mart missing batch-index source path");
  assert(syncSource.includes("attention_backlog_path"), "batch health mart missing attention-backlog source path");
  assert(syncSource.includes("source_path: item.sourcePath"), "batch health attention-item mart missing source path");
  assert(syncSource.includes("unresolved_items"), "batch health attention-type mart missing unresolved item count");
  assert(syncSource.includes("unresolved_items: row.unresolved"), "DuckDB sync should export batch-health unresolved breakdown counts from the shared reader");
  assert(!syncSource.includes("unresolved_items: (row.open ?? 0) + (row.deferred ?? 0)"), "DuckDB sync should not derive unresolved breakdown counts locally");
  assert(syncSource.includes("review_note"), "batch health candidate guard mart missing review note");
  assert(syncSource.includes("reviewer"), "batch health candidate guard mart missing reviewer");
  assert(syncSource.includes("reviewed_at"), "batch health candidate guard mart missing review timestamp");
  assert(syncSource.includes("source_types_json"), "source-bank domain mart missing source-type summary");
  assert(syncSource.includes("mean_quality_score"), "source-bank domain mart missing quality-score summary");
  assert(syncSource.includes("agent_calls"), "token-usage summary mart missing agent-call count");
  assert(syncSource.includes("reasoning_output_tokens"), "token-usage marts missing reasoning-token columns");
  assert(syncSource.includes("join osf_smithers_token_usage_by_task usage using (task_id)"), "DuckDB examples do not show score/token joins");
  assert(syncSource.includes("baseline_sanity_status"), "forecast score mart missing baseline sanity status");
  assert(syncSource.includes("baseline_delta"), "forecast score mart missing baseline sanity delta");
  assert(syncSource.includes("market_anchor_status"), "forecast score mart missing market anchor status");
  assert(syncSource.includes("market_anchor_delta"), "forecast score mart missing market anchor delta");
  assert(syncSource.includes("resolution_boundary_status"), "forecast score mart missing resolution boundary status");
  assert(syncSource.includes("resolution_boundary_ambiguity_flag_count"), "forecast score mart missing resolution boundary ambiguity count");
  assert(syncSource.includes("uncertainty_range_status"), "forecast score mart missing uncertainty range status");
  assert(syncSource.includes("uncertainty_range_median_width"), "forecast score mart missing uncertainty range median width");
  assert(syncSource.includes("component_weighting_status"), "forecast score mart missing component weighting status");
  assert(syncSource.includes("component_weighting_downweight_count"), "forecast score mart missing component weighting downweight count");
  assert(syncSource.includes("aggregate_convergence_status"), "forecast score mart missing aggregate convergence status");
  assert(syncSource.includes("aggregate_max_iterations_reached"), "forecast score mart missing aggregate max-iteration flag");
  assert(syncSource.includes("aggregate_component_disagreement"), "forecast score mart missing aggregate component disagreement");
  assert(syncSource.includes("aggregation_anchor"), "forecast score mart missing aggregation anchor");
  assert(syncSource.includes("aggregate_forecaster_count"), "forecast score mart missing forecaster count");
  assert(syncSource.includes("aggregate_complexity_score"), "forecast score mart missing complexity score");
  assert(syncSource.includes("aggregate_research_depth"), "forecast score mart missing research depth");
  assert(syncSource.includes("conditional_branch"), "forecast score mart missing conditional branch");
  assert(syncSource.includes("conditional_effect_band"), "forecast score mart missing conditional effect band");
  assert(syncSource.includes("threshold_source"), "forecast score mart missing threshold source");
  assert(syncSource.includes("monotonicity_repaired"), "forecast score mart missing monotonicity repair flag");
  assert(syncSource.includes("numeric_interval_width_band"), "forecast score mart missing numeric interval band");
  assert(syncSource.includes("numeric_attempt_count"), "forecast score mart missing numeric attempt count");
  assert(syncSource.includes("numeric_attempt_count_band"), "forecast score mart missing numeric attempt count band");
  assert(syncSource.includes("date_interval_days"), "forecast score mart missing date interval days");
  assert(syncSource.includes("date_never_probability_band"), "forecast score mart missing date never-probability band");
  assert(syncSource.includes("categorical_top_probability_band"), "forecast score mart missing categorical top probability band");
  assert(syncSource.includes("categorical_entropy_band"), "forecast score mart missing categorical entropy band");
  assert(syncSource.includes("categorical_category_source"), "forecast score mart missing categorical category source");
  assert(syncSource.includes("evidence_source_count_band"), "forecast score mart missing evidence source count band");
  assert(syncSource.includes("evidence_uncertainty_count_band"), "forecast score mart missing evidence uncertainty count band");
  assert(syncSource.includes("evidence_rationale_length_band"), "forecast score mart missing evidence rationale length band");
  assert(syncSource.includes("input_requested_forecast_type_band"), "forecast score mart missing input requested forecast type band");
  assert(syncSource.includes("input_context_completeness_band"), "forecast score mart missing input context completeness band");
  assert(syncSource.includes("input_resolution_criteria_length_band"), "forecast score mart missing input resolution criteria length band");
  assert(syncSource.includes("input_resolution_horizon_band"), "forecast score mart missing input resolution horizon band");
  assert(syncSource.includes("input_background_length_band"), "forecast score mart missing input background length band");
  assert(syncSource.includes("input_market_price_band"), "forecast score mart missing input market price band");
  assert(syncSource.includes("input_market_price_age_band"), "forecast score mart missing input market price age band");
  assert(syncSource.includes("input_market_metadata_band"), "forecast score mart missing input market metadata band");
  assert(syncSource.includes("input_market_creation_age_band"), "forecast score mart missing input market creation age band");
  assert(syncSource.includes("input_condition_criteria_band"), "forecast score mart missing input condition criteria band");
  assert(syncSource.includes("input_unit_specificity_band"), "forecast score mart missing input unit specificity band");
  assert(syncSource.includes("input_category_coverage_band"), "forecast score mart missing input category coverage band");
  assert(syncSource.includes("input_threshold_value_coverage_band"), "forecast score mart missing input threshold value coverage band");
  assert(syncSource.includes("input_threshold_direction_band"), "forecast score mart missing input threshold direction band");
  assert(syncSource.includes("input_question_length_band"), "forecast score mart missing input question length band");
  assert(syncSource.includes("run_workflow_version"), "forecast score mart missing run workflow version");
  assert(syncSource.includes("run_experiment_label"), "forecast score mart missing run experiment label");
  assert(syncSource.includes("run_duration_band"), "forecast score mart missing run duration band");
  assert(syncSource.includes("candidate_guard_suggested_adjustment"), "binary calibration bucket mart missing candidate guard adjustment");
  assert(syncSource.includes("candidate_guard_activation_status"), "binary calibration bucket mart missing candidate guard activation status");
  assert(syncSource.includes("readCalibrationGuardValidationRows"), "DuckDB sync does not read calibration guard validation reports");
  assert(syncSource.includes("readCalibrationGuardDefaultPlanRows"), "DuckDB sync does not read calibration guard default plan reports");
  assert(syncSource.includes("readForecastAttentionItemRows"), "DuckDB sync does not read forecast attention batch indexes");
  assert(syncSource.includes("attention_item_id"), "forecast attention mart missing attention item id");
  assert(syncSource.includes("review_status"), "forecast attention mart missing review status");
  assert(syncSource.includes("recommended_actions_json"), "forecast attention mart missing recommended actions");
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

await check("binary forecast aggregates persist baseline sanity audit", async () => {
  const workflowSource = await readFile(resolve(root, "packages/workflows/src/binary-forecast.workflow.tsx"), "utf8");
  const panelSource = await readFile(resolve(root, "apps/web/src/components/run-workspace/panels.tsx"), "utf8");
  const reportSource = await readFile(resolve(root, "packages/backend/src/run-service.ts"), "utf8");
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const largeDelta = buildBinaryBaselineSanityAudit({
    finalProbability: 75,
    components: [
      { baseRateProbability: 30 },
      { baseRateProbability: 40 },
      { baseRateProbability: 35 },
    ],
  });
  assert(largeDelta.status === "large_delta", "large baseline delta status mismatch");
  assert(largeDelta.baselineProbability === 35, "baseline probability mismatch");
  assert(largeDelta.baselineDelta === 40, "baseline delta mismatch");
  assert(largeDelta.componentBaseRateCount === 3, "base-rate count mismatch");
  assert(largeDelta.componentBaseRateDisagreement === 10, "base-rate disagreement mismatch");

  const missing = buildBinaryBaselineSanityAudit({ finalProbability: 52, components: [] });
  assert(missing.status === "missing_component_base_rates", "missing baseline status mismatch");
  assert(missing.baselineProbability === null, "missing baseline probability should be null");
  const snapshot = readBaselineSanitySnapshot({ baselineSanity: largeDelta });
  assert(snapshot?.status === "large_delta", "baseline sanity snapshot status mismatch");
  assert(snapshot?.baselineDelta === 40, "baseline sanity snapshot delta mismatch");
  assert(workflowSource.includes("baselineSanity"), "binary aggregate schema missing baseline sanity");
  assert(workflowSource.includes("buildBinaryBaselineSanityAudit"), "binary workflow does not use shared baseline sanity builder");
  assert(resolutionSource.includes("readBaselineSanitySnapshot(input.prediction)"), "resolution scoring does not persist baseline sanity");
  assert(resolutionSource.includes("byBaselineSanity"), "performance report does not group by baseline sanity");
  assert(resolutionSource.includes("baseline_sanity_miss"), "performance report does not turn poor baseline moves into attention");
  assert(resolutionSource.includes("component base-rate anchor"), "baseline sanity attention action missing");
  assert(panelSource.includes("baseline sanity"), "run workspace does not render baseline sanity");
  assert(reportSource.includes("readReportBaselineSanity"), "generated report does not include baseline sanity");
  return "binary aggregate baseline sanity audit is deterministic, persisted, and visible";
});

await check("binary forecast aggregates persist market anchor audit", async () => {
  const workflowSource = await readFile(resolve(root, "packages/workflows/src/binary-forecast.workflow.tsx"), "utf8");
  const panelSource = await readFile(resolve(root, "apps/web/src/components/run-workspace/panels.tsx"), "utf8");
  const reportSource = await readFile(resolve(root, "packages/backend/src/run-service.ts"), "utf8");
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  const largeDelta = buildBinaryMarketAnchorAudit({
    finalProbability: 72,
    market: {
      marketPrice: 42,
      marketPriceAsOf: "2026-01-02",
      marketPlatform: "Kalshi",
      marketUrl: "https://example.com/market",
    },
  });
  assert(largeDelta.status === "large_delta", "large market delta status mismatch");
  assert(largeDelta.marketPrice === 42, "market anchor price mismatch");
  assert(largeDelta.marketDelta === 30, "market anchor delta mismatch");
  assert(largeDelta.marketPlatform === "Kalshi", "market anchor platform mismatch");
  const missing = buildBinaryMarketAnchorAudit({ finalProbability: 55, market: {} });
  assert(missing.status === "missing_market_price", "missing market anchor status mismatch");
  assert(missing.marketPrice === null, "missing market price should be null");
  const snapshot = readMarketAnchorSnapshot({ marketAnchor: largeDelta });
  assert(snapshot?.status === "large_delta", "market anchor snapshot status mismatch");
  assert(snapshot?.marketDelta === 30, "market anchor snapshot delta mismatch");
  assert(workflowSource.includes("marketAnchor"), "binary aggregate schema missing market anchor");
  assert(workflowSource.includes("buildBinaryMarketAnchorAudit"), "binary workflow does not use shared market anchor builder");
  assert(workflowSource.includes("structured market price is provided"), "binary workflow does not require market divergence justification");
  assert(resolutionSource.includes("readMarketAnchorSnapshot(input.prediction)"), "resolution scoring does not persist market anchor");
  assert(resolutionSource.includes("byMarketAnchor"), "performance report does not group by market anchor");
  assert(resolutionSource.includes("market_anchor_miss"), "performance report does not turn poor market divergence into attention");
  assert(metricsSource.includes("open_superforecaster_market_anchor_scores_total"), "metrics missing market anchor score counts");
  assert(syncSource.includes("market_anchor_status"), "DuckDB forecast score mart missing market anchor status");
  assert(syncSource.includes("market_anchor_delta"), "DuckDB forecast score mart missing market anchor delta");
  assert(panelSource.includes("market anchor"), "run workspace does not render market anchor");
  assert(reportSource.includes("readReportMarketAnchor"), "generated report does not include market anchor");
  assert(dashboardSource.includes("byMarketAnchor"), "lab dashboard does not read market anchor performance groups");
  assert(dashboardSource.includes("Market-anchor outcomes"), "lab dashboard does not render market anchor performance groups");
  return "binary aggregate market anchor audit is deterministic, persisted, and visible";
});

await check("binary forecast aggregates persist resolution boundary audit", async () => {
  const material = buildBinaryResolutionBoundaryAudit({
    components: [
      { resolutionBoundary: "Clear if the agency publishes a final rule." },
      { resolutionBoundary: "Ambiguous edge case if a draft rule is disputed or later annulled." },
      { resolutionBoundary: "Unclear whether a temporary order should count." },
    ],
    qualityIssues: ["major: unresolved resolution boundary concern"],
    plannerRisks: ["Resolution criteria may be ambiguous."],
    resolutionCriteria: "Resolve from official agency publications.",
  });
  assert(material.status === "material_ambiguity", "material boundary status mismatch");
  assert(material.componentBoundaryCount === 3, "boundary component count mismatch");
  assert(material.ambiguityFlagCount === 2, "boundary ambiguity count mismatch");
  assert(material.qualityIssueCount === 1, "boundary quality issue count mismatch");
  assert(material.plannerRiskCount === 1, "boundary planner risk count mismatch");
  const missing = buildBinaryResolutionBoundaryAudit({ components: [] });
  assert(missing.status === "missing_boundary_review", "missing boundary status mismatch");
  const snapshot = readResolutionBoundarySnapshot({ resolutionBoundary: material });
  assert(snapshot?.status === "material_ambiguity", "resolution boundary snapshot status mismatch");
  assert(snapshot?.ambiguityFlagCount === 2, "resolution boundary snapshot ambiguity count mismatch");
  const workflowSource = await readFile(resolve(root, "packages/workflows/src/binary-forecast.workflow.tsx"), "utf8");
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  const panelSource = await readFile(resolve(root, "apps/web/src/components/run-workspace/panels.tsx"), "utf8");
  const reportSource = await readFile(resolve(root, "packages/backend/src/run-service.ts"), "utf8");
  assert(workflowSource.includes("buildBinaryResolutionBoundaryAudit"), "binary workflow does not use shared resolution boundary builder");
  assert(workflowSource.includes("resolutionBoundary"), "binary aggregate schema missing resolution boundary audit");
  assert(resolutionSource.includes("readResolutionBoundarySnapshot(input.prediction)"), "resolution scoring does not persist resolution boundary");
  assert(resolutionSource.includes("byResolutionBoundary"), "performance report does not group by resolution boundary");
  assert(resolutionSource.includes("resolution_boundary_miss"), "performance report does not flag boundary ambiguity misses");
  assert(metricsSource.includes("open_superforecaster_resolution_boundary_scores_total"), "metrics missing resolution boundary score counts");
  assert(syncSource.includes("resolution_boundary_status"), "DuckDB forecast score mart missing resolution boundary status");
  assert(syncSource.includes("resolution_boundary_ambiguity_flag_count"), "DuckDB forecast score mart missing boundary flag count");
  assert(dashboardSource.includes("byResolutionBoundary"), "lab dashboard does not read resolution boundary performance groups");
  assert(dashboardSource.includes("Resolution-boundary outcomes"), "lab dashboard does not render resolution boundary performance groups");
  assert(panelSource.includes("resolution boundary"), "run workspace does not render resolution boundary");
  assert(reportSource.includes("readReportResolutionBoundary"), "generated report does not include resolution boundary");
  return "binary aggregate resolution boundary audit is deterministic, persisted, and visible";
});

await check("binary forecast aggregates persist uncertainty range audit", async () => {
  const narrow = buildBinaryUncertaintyRangeAudit({
    components: [
      { probabilityRange: { low: 45, high: 55 } },
      { probabilityRange: { low: 50, high: 62 } },
      { probabilityRange: { low: 52, high: 66 } },
    ],
  });
  assert(narrow.status === "narrow", "narrow uncertainty range status mismatch");
  assert(narrow.componentRangeCount === 3, "uncertainty range component count mismatch");
  assert(narrow.medianRangeWidth === 12, "uncertainty range median width mismatch");
  assert(narrow.meanRangeWidth === 12, "uncertainty range mean width mismatch");
  assert(narrow.widestRangeWidth === 14, "uncertainty range widest width mismatch");
  assert(narrow.narrowRangeCount === 3, "uncertainty range narrow count mismatch");
  const missing = buildBinaryUncertaintyRangeAudit({ components: [] });
  assert(missing.status === "missing_ranges", "missing uncertainty range status mismatch");
  const snapshot = readUncertaintyRangeSnapshot({ uncertaintyRange: narrow });
  assert(snapshot?.status === "narrow", "uncertainty range snapshot status mismatch");
  assert(snapshot?.medianRangeWidth === 12, "uncertainty range snapshot median mismatch");
  const workflowSource = await readFile(resolve(root, "packages/workflows/src/binary-forecast.workflow.tsx"), "utf8");
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  const panelSource = await readFile(resolve(root, "apps/web/src/components/run-workspace/panels.tsx"), "utf8");
  const reportSource = await readFile(resolve(root, "packages/backend/src/run-service.ts"), "utf8");
  assert(workflowSource.includes("buildBinaryUncertaintyRangeAudit"), "binary workflow does not use shared uncertainty range builder");
  assert(workflowSource.includes("uncertaintyRange"), "binary aggregate schema missing uncertainty range audit");
  assert(resolutionSource.includes("readUncertaintyRangeSnapshot(input.prediction)"), "resolution scoring does not persist uncertainty range");
  assert(resolutionSource.includes("byUncertaintyRange"), "performance report does not group by uncertainty range");
  assert(resolutionSource.includes("uncertainty_range_miss"), "performance report does not flag uncertainty range misses");
  assert(metricsSource.includes("open_superforecaster_uncertainty_range_scores_total"), "metrics missing uncertainty range score counts");
  assert(syncSource.includes("uncertainty_range_status"), "DuckDB forecast score mart missing uncertainty range status");
  assert(syncSource.includes("uncertainty_range_median_width"), "DuckDB forecast score mart missing uncertainty range median width");
  assert(dashboardSource.includes("byUncertaintyRange"), "lab dashboard does not read uncertainty range performance groups");
  assert(dashboardSource.includes("Uncertainty-range outcomes"), "lab dashboard does not render uncertainty range performance groups");
  assert(panelSource.includes("uncertainty range"), "run workspace does not render uncertainty range");
  assert(reportSource.includes("readReportUncertaintyRange"), "generated report does not include uncertainty range");
  return "binary aggregate uncertainty range audit is deterministic, persisted, and visible";
});

await check("binary forecast aggregates persist component weighting audit", async () => {
  const mixed = buildComponentWeightingSnapshot([
    { forecasterLabel: "base", weight: "normal", calibrationRisk: "Solid base rate." },
    { forecasterLabel: "inside", weight: "downweight", calibrationRisk: "Double-counted evidence." },
    { forecasterLabel: "tail", weight: "upweight", calibrationRisk: "Found a live tail path." },
  ]);
  assert(mixed.status === "mixed_weights", "component weighting status mismatch");
  assert(mixed.auditedComponentCount === 3, "component weighting audited count mismatch");
  assert(mixed.downweightCount === 1, "component weighting downweight count mismatch");
  assert(mixed.upweightCount === 1, "component weighting upweight count mismatch");
  assert(mixed.normalWeightCount === 1, "component weighting normal count mismatch");
  assert(mixed.calibrationRiskCount === 3, "component weighting risk count mismatch");
  const snapshot = readComponentWeightingSnapshot({ componentWeighting: mixed });
  assert(snapshot?.status === "mixed_weights", "component weighting snapshot status mismatch");
  assert(snapshot?.downweightCount === 1, "component weighting snapshot downweight mismatch");
  const inferredSnapshot = readComponentWeightingSnapshot({
    componentAudits: [
      { weight: "downweight", calibrationRisk: "Unsupported leap." },
      { weight: "normal", calibrationRisk: "Reasonable." },
    ],
  });
  assert(inferredSnapshot?.status === "has_downweight", "component weighting inferred status mismatch");
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  const panelSource = await readFile(resolve(root, "apps/web/src/components/run-workspace/panels.tsx"), "utf8");
  const reportSource = await readFile(resolve(root, "packages/backend/src/run-service.ts"), "utf8");
  assert(resolutionSource.includes("readComponentWeightingSnapshot(input.prediction)"), "resolution scoring does not persist component weighting");
  assert(resolutionSource.includes("byComponentWeighting"), "performance report does not group by component weighting");
  assert(resolutionSource.includes("component_weighting_miss"), "performance report does not flag component weighting misses");
  assert(metricsSource.includes("open_superforecaster_component_weighting_scores_total"), "metrics missing component weighting score counts");
  assert(syncSource.includes("component_weighting_status"), "DuckDB forecast score mart missing component weighting status");
  assert(syncSource.includes("component_weighting_downweight_count"), "DuckDB forecast score mart missing component downweight count");
  assert(dashboardSource.includes("byComponentWeighting"), "lab dashboard does not read component weighting performance groups");
  assert(dashboardSource.includes("Component-weighting outcomes"), "lab dashboard does not render component weighting performance groups");
  assert(panelSource.includes("component weighting"), "run workspace does not render component weighting");
  assert(reportSource.includes("readReportComponentWeighting"), "generated report does not include component weighting");
  return "binary aggregate component weighting audit is deterministic, persisted, and visible";
});

await check("binary aggregate quality metadata reaches resolved score analytics", async () => {
  const snapshot = readAggregateQualitySnapshot({
    aggregateQuality: {
      convergenceStatus: "max_iterations_return_last",
      qualityApproved: false,
      maxIterationsReached: true,
      roundsUsed: 3,
      forecasterCount: 5,
      complexityScore: 4,
      researchDepth: "deep",
      roleIds: ["base-rate", "skeptic"],
      qualityIssueCount: 2,
      finalReviewRationale: "Still has one unresolved boundary concern.",
    },
  });
  assert(snapshot?.convergenceStatus === "max_iterations_return_last", "aggregate quality convergence status mismatch");
  assert(snapshot?.qualityApproved === false, "aggregate quality approval mismatch");
  assert(snapshot?.maxIterationsReached === true, "aggregate quality max-iteration mismatch");
  assert(snapshot?.roundsUsed === 3, "aggregate quality rounds mismatch");
  assert(snapshot?.roundsUsedBand === "few_rounds", "aggregate quality rounds band mismatch");
  assert(snapshot?.qualityIssueCount === 2, "aggregate quality issue count mismatch");
  assert(snapshot?.qualityIssueCountBand === "some_issues", "aggregate quality issue band mismatch");
  assert(snapshot?.roleIds.length === 2, "aggregate quality role ids mismatch");
  assert(roundsUsedBand(4) === "many_rounds", "aggregate quality rounds band contract mismatch");
  assert(qualityIssueCountBand(3) === "many_issues", "aggregate quality issue count band contract mismatch");
  const workflowSource = await readFile(resolve(root, "packages/workflows/src/binary-forecast.workflow.tsx"), "utf8");
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(workflowSource.includes("convergenceStatus"), "binary aggregate schema missing convergence status");
  assert(resolutionSource.includes("readAggregateQualitySnapshot(input.prediction)"), "resolution scoring does not persist aggregate quality");
  assert(resolutionSource.includes("byAggregateQuality"), "performance report does not group by aggregate quality");
  assert(resolutionSource.includes("byAggregateQualityRounds"), "performance report does not group by aggregate quality review rounds");
  assert(resolutionSource.includes("byAggregateQualityIssues"), "performance report does not group by aggregate quality issues");
  assert(resolutionSource.includes("aggregate_quality_miss"), "performance report does not flag aggregate quality misses");
  assert(resolutionSource.includes("aggregate_quality_rounds_miss"), "performance report does not flag aggregate quality review-round misses");
  assert(resolutionSource.includes("aggregateQualityRoundsMissSignal"), "performance report does not centralize aggregate quality review-round signals");
  assert(resolutionSource.includes("aggregate_quality_issues_miss"), "performance report does not flag aggregate quality issue-count misses");
  assert(resolutionSource.includes("aggregateQualityIssuesMissSignal"), "performance report does not centralize aggregate quality issue-count signals");
  assert(resolutionSource.includes("## Aggregate quality groups"), "performance Markdown missing aggregate quality group section");
  assert(resolutionSource.includes("## Aggregate quality review-round groups"), "performance Markdown missing aggregate quality review-round group section");
  assert(resolutionSource.includes("## Aggregate quality issue-count groups"), "performance Markdown missing aggregate quality issue-count group section");
  assert(metricsSource.includes("open_superforecaster_aggregate_quality_scores_total"), "metrics missing aggregate quality score counts");
  assert(metricsSource.includes("open_superforecaster_aggregate_quality_score_mean"), "metrics missing aggregate quality score means");
  assert(metricsSource.includes("aggregate_rounds_used_band"), "metrics missing aggregate rounds-used bands");
  assert(metricsSource.includes("aggregate_quality_issue_count_band"), "metrics missing aggregate quality issue-count bands");
  assert(syncSource.includes("aggregate_convergence_status"), "DuckDB forecast score mart missing aggregate convergence status");
  assert(syncSource.includes("aggregate_max_iterations_reached"), "DuckDB forecast score mart missing max-iteration flag");
  assert(syncSource.includes("aggregate_rounds_used_band"), "DuckDB forecast score mart missing aggregate rounds-used band");
  assert(syncSource.includes("aggregate_quality_issue_count_band"), "DuckDB forecast score mart missing aggregate quality issue-count band");
  assert(syncSource.includes("aggregate_role_ids_json"), "DuckDB forecast score mart missing role ids");
  assert(dashboardSource.includes("byAggregateQuality"), "lab dashboard does not read aggregate quality performance groups");
  assert(dashboardSource.includes("Aggregate quality outcomes"), "lab dashboard does not render aggregate quality performance groups");
  assert(dashboardSource.includes("Aggregate review-round outcomes"), "lab dashboard does not render aggregate review-round outcomes");
  assert(dashboardSource.includes("Aggregate quality-issue outcomes"), "lab dashboard does not render aggregate quality-issue outcomes");
  return "binary aggregate quality metadata is persisted and visible in resolved score analytics";
});

await check("binary aggregate stats reach resolved score analytics", async () => {
  const snapshot = readAggregateStatsSnapshot({
    aggregateStats: {
      meanProbability: 67,
      medianProbability: 70,
      probability: 82,
      componentProbabilities: [
        { probability: 55, baseRateProbability: 30, insideViewProbability: 50 },
        { probability: 60, baseRateProbability: 40, insideViewProbability: 70 },
        { probability: 75, baseRateProbability: 35, insideViewProbability: 65 },
      ],
      disagreement: 22,
      aggregationAnchor: "median",
      adjustmentFromMedian: -5,
      attemptCount: 4,
    },
  });
  assert(snapshot?.meanProbability === 67, "aggregate stats mean mismatch");
  assert(snapshot?.medianProbability === 70, "aggregate stats median mismatch");
  assert(snapshot?.componentMinProbability === 55, "aggregate stats component minimum mismatch");
  assert(snapshot?.componentMaxProbability === 75, "aggregate stats component maximum mismatch");
  assert(snapshot?.finalComponentPositionBand === "above_components", "aggregate stats final component position mismatch");
  assert(snapshot?.meanConfidenceDistance === 17, "aggregate stats mean confidence distance mismatch");
  assert(snapshot?.finalConfidenceShift === 15, "aggregate stats final confidence shift mismatch");
  assert(snapshot?.finalConfidenceShiftBand === "more_confident", "aggregate stats final confidence shift band mismatch");
  assert(snapshot?.meanBaseRateProbability === 35, "aggregate stats mean base rate mismatch");
  assert(snapshot?.meanInsideViewProbability === 61.7, "aggregate stats mean inside view mismatch");
  assert(snapshot?.insideViewDelta === 26.7, "aggregate stats inside-view delta mismatch");
  assert(snapshot?.insideViewDeltaBand === "large_shift", "aggregate stats inside-view delta band mismatch");
  assert(snapshot?.finalInsideViewDelta === 20.3, "aggregate stats final inside-view delta mismatch");
  assert(snapshot?.finalInsideViewDeltaBand === "large_adjustment", "aggregate stats final inside-view delta band mismatch");
  assert(snapshot?.finalAdjustmentDirection === "amplifies_inside_view", "aggregate stats final adjustment direction mismatch");
  assert(snapshot?.disagreement === 22, "aggregate stats disagreement mismatch");
  assert(snapshot?.disagreementBand === "high", "aggregate stats disagreement band mismatch");
  assert(snapshot?.meanConfidenceDistanceBand === "likely", "aggregate stats mean confidence distance band mismatch");
  assert(snapshot?.aggregationAnchor === "median", "aggregate stats anchor mismatch");
  assert(snapshot?.adjustmentFromMedian === -5, "aggregate stats adjustment mismatch");
  assert(snapshot?.adjustmentFromMedianBand === "near_median", "aggregate stats median adjustment band mismatch");
  assert(snapshot?.attemptCount === 4, "aggregate stats attempt count mismatch");
  assert(snapshot?.attemptCountBand === "few_attempts", "aggregate stats attempt count band mismatch");
  assert(finalComponentPositionBand({
    finalProbability: 50,
    componentMinProbability: 55,
    componentMaxProbability: 75,
  }) === "below_components", "aggregate stats below-component contract mismatch");
  assert(aggregateSideAgreementBand(62, 42) === "final_flips_to_yes", "aggregate stats side agreement contract mismatch");
  assert(aggregateSideAgreementBand(53, 62) === "final_near_even", "aggregate stats side agreement neutral-zone contract mismatch");
  assert(meanConfidenceDistanceBand(41) === "extreme", "aggregate stats mean confidence distance contract mismatch");
  assert(finalConfidenceShiftBand(22, 1, 1) === "much_more_confident", "aggregate stats final confidence shift contract mismatch");
  assert(adjustmentFromMedianBand(21, 1, 1) === "large_adjustment", "aggregate stats median adjustment contract mismatch");
  assert(attemptCountBand(5) === "many_attempts", "aggregate stats attempt count contract mismatch");
  assert(insideViewDeltaBand(12, 2, 2) === "moderate_shift", "aggregate stats inside-view shift contract mismatch");
  assert(finalInsideViewDeltaBand(9, 1, 2) === "moderate_adjustment", "aggregate stats final adjustment contract mismatch");
  assert(finalAdjustmentDirection(20, -8) === "dampens_inside_view", "aggregate stats dampening direction mismatch");
  assert(finalAdjustmentDirection(20, -25) === "reverses_inside_view", "aggregate stats reversal direction mismatch");
  assert(finalAdjustmentDirection(1, 9) === "final_only_shift", "aggregate stats final-only direction mismatch");
  assert(readAggregateStatsSnapshot({
    aggregateStats: {
      meanBaseRateProbability: 20,
      meanInsideViewProbability: 47,
    },
  })?.insideViewDeltaBand === "large_shift", "aggregate stats inside-view shift should derive from explicit means");
  assert(readAggregateStatsSnapshot({
    aggregateStats: {
      finalConfidenceShift: 21,
    },
  })?.finalConfidenceShiftBand === "much_more_confident", "aggregate stats final confidence band should derive from explicit shift");
  assert(readAggregateStatsSnapshot({
    aggregateStats: {
      adjustmentFromMedian: -22,
    },
  })?.adjustmentFromMedianBand === "large_adjustment", "aggregate stats median adjustment band should derive from explicit adjustment");
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(resolutionSource.includes("readAggregateStatsSnapshot(input.prediction)"), "resolution scoring does not persist aggregate stats");
  assert(resolutionSource.includes("byAggregateDisagreement"), "performance report does not group by component disagreement");
  assert(resolutionSource.includes("byAggregateFinalComponentPosition"), "performance report does not group by component envelope position");
  assert(resolutionSource.includes("byAggregateSideAgreement"), "performance report does not group by aggregate side agreement");
  assert(resolutionSource.includes("byAggregateMeanConfidenceDistance"), "performance report does not group by aggregate panel confidence");
  assert(resolutionSource.includes("byAggregateFinalConfidenceShift"), "performance report does not group by final confidence shift");
  assert(resolutionSource.includes("byAggregateMedianAdjustment"), "performance report does not group by median adjustment");
  assert(resolutionSource.includes("byAggregateInsideViewShift"), "performance report does not group by inside-view shift");
  assert(resolutionSource.includes("byAggregateFinalInsideViewAdjustment"), "performance report does not group by final aggregation adjustment");
  assert(resolutionSource.includes("byAggregateFinalAdjustmentDirection"), "performance report does not group by final aggregation direction");
  assert(resolutionSource.includes("byAggregateAttemptCount"), "performance report does not group by aggregate attempt count");
  assert(resolutionSource.includes("byAggregationAnchor"), "performance report does not group by aggregation anchor");
  assert(resolutionSource.includes("component_disagreement_miss"), "performance report does not flag high-disagreement misses");
  assert(resolutionSource.includes("component_envelope_miss"), "performance report does not flag component envelope misses");
  assert(resolutionSource.includes("componentEnvelopeMissSignal"), "performance report does not centralize component envelope miss signals");
  assert(resolutionSource.includes("aggregate_side_flip_miss"), "performance report does not flag aggregate side-flip misses");
  assert(resolutionSource.includes("aggregateSideFlipMissSignal"), "performance report does not centralize aggregate side-flip miss signals");
  assert(resolutionSource.includes("aggregate_panel_confidence_miss"), "performance report does not flag aggregate panel-confidence misses");
  assert(resolutionSource.includes("aggregatePanelConfidenceMissSignal"), "performance report does not centralize aggregate panel-confidence miss signals");
  assert(resolutionSource.includes("aggregate_confidence_miss"), "performance report does not flag final confidence shift misses");
  assert(resolutionSource.includes("aggregateConfidenceMissSignal"), "performance report does not centralize final confidence shift miss signals");
  assert(resolutionSource.includes("median_adjustment_miss"), "performance report does not flag median adjustment misses");
  assert(resolutionSource.includes("medianAdjustmentMissSignal"), "performance report does not centralize median adjustment miss signals");
  assert(resolutionSource.includes("inside_view_shift_miss"), "performance report does not flag inside-view shift misses");
  assert(resolutionSource.includes("insideViewShiftMissSignal"), "performance report does not centralize inside-view shift miss signals");
  assert(resolutionSource.includes("aggregate_adjustment_miss"), "performance report does not flag final aggregation adjustment misses");
  assert(resolutionSource.includes("aggregateAdjustmentMissSignal"), "performance report does not centralize final aggregation adjustment miss signals");
  assert(resolutionSource.includes("aggregate_direction_miss"), "performance report does not flag final aggregation direction misses");
  assert(resolutionSource.includes("aggregateDirectionMissSignal"), "performance report does not centralize final aggregation direction miss signals");
  assert(resolutionSource.includes("aggregate_attempt_miss"), "performance report does not flag aggregate attempt-count misses");
  assert(resolutionSource.includes("aggregateAttemptMissSignal"), "performance report does not centralize aggregate attempt-count miss signals");
  assert(resolutionSource.includes("componentDisagreementMissSignal"), "performance report does not centralize component disagreement miss signals");
  assert(resolutionSource.includes("thresholdedForecast.componentDisagreementBand"), "attention queue does not use thresholded component disagreement");
  assert(resolutionSource.includes("numericForecast.p50DisagreementBand"), "attention queue does not use numeric component disagreement");
  assert(resolutionSource.includes("dateForecast.p50DisagreementBand"), "attention queue does not use date component disagreement");
  assert(resolutionSource.includes("categoricalForecast.topCategoryAgreementBand"), "attention queue does not use categorical top-category agreement");
  assert(resolutionSource.includes("conditionalForecast.branchDisagreementBand"), "attention queue does not use conditional branch disagreement");
  assert(metricsSource.includes("open_superforecaster_aggregate_stats_scores_total"), "metrics missing aggregate stats score counts");
  assert(metricsSource.includes("final_component_position_band"), "metrics missing final component position labels");
  assert(metricsSource.includes("aggregate_side_agreement"), "metrics missing aggregate side agreement labels");
  assert(metricsSource.includes("mean_confidence_distance_band"), "metrics missing mean confidence distance labels");
  assert(metricsSource.includes("final_confidence_shift_band"), "metrics missing final confidence shift labels");
  assert(metricsSource.includes("inside_view_delta_band"), "metrics missing inside-view delta labels");
  assert(metricsSource.includes("final_inside_view_delta_band"), "metrics missing final inside-view delta labels");
  assert(metricsSource.includes("final_adjustment_direction"), "metrics missing final adjustment direction labels");
  assert(metricsSource.includes("adjustment_from_median_band"), "metrics missing median adjustment labels");
  assert(metricsSource.includes("aggregate_attempt_count_band"), "metrics missing aggregate attempt count labels");
  assert(syncSource.includes("aggregate_component_min_probability"), "DuckDB forecast score mart missing component minimum probability");
  assert(syncSource.includes("aggregate_component_max_probability"), "DuckDB forecast score mart missing component maximum probability");
  assert(syncSource.includes("aggregate_final_component_position_band"), "DuckDB forecast score mart missing final component position band");
  assert(syncSource.includes("aggregate_side_agreement"), "DuckDB forecast score mart missing aggregate side agreement");
  assert(syncSource.includes("aggregate_mean_confidence_distance"), "DuckDB forecast score mart missing mean confidence distance");
  assert(syncSource.includes("aggregate_mean_confidence_distance_band"), "DuckDB forecast score mart missing mean confidence distance band");
  assert(syncSource.includes("aggregate_final_confidence_shift"), "DuckDB forecast score mart missing final confidence shift");
  assert(syncSource.includes("aggregate_final_confidence_shift_band"), "DuckDB forecast score mart missing final confidence shift band");
  assert(syncSource.includes("aggregate_mean_base_rate_probability"), "DuckDB forecast score mart missing mean base-rate probability");
  assert(syncSource.includes("aggregate_mean_inside_view_probability"), "DuckDB forecast score mart missing mean inside-view probability");
  assert(syncSource.includes("aggregate_inside_view_delta"), "DuckDB forecast score mart missing inside-view delta");
  assert(syncSource.includes("aggregate_inside_view_delta_band"), "DuckDB forecast score mart missing inside-view delta band");
  assert(syncSource.includes("aggregate_final_inside_view_delta"), "DuckDB forecast score mart missing final inside-view delta");
  assert(syncSource.includes("aggregate_final_inside_view_delta_band"), "DuckDB forecast score mart missing final inside-view delta band");
  assert(syncSource.includes("aggregate_final_adjustment_direction"), "DuckDB forecast score mart missing final adjustment direction");
  assert(syncSource.includes("aggregate_component_disagreement_band"), "DuckDB forecast score mart missing disagreement band");
  assert(syncSource.includes("adjustment_from_median_band"), "DuckDB forecast score mart missing median adjustment band");
  assert(syncSource.includes("aggregate_attempt_count_band"), "DuckDB forecast score mart missing aggregate attempt count band");
  assert(dashboardSource.includes("Component disagreement outcomes"), "lab dashboard does not render component disagreement outcomes");
  assert(dashboardSource.includes("Component envelope outcomes"), "lab dashboard does not render component envelope outcomes");
  assert(dashboardSource.includes("Aggregate side-agreement outcomes"), "lab dashboard does not render aggregate side-agreement outcomes");
  assert(dashboardSource.includes("Aggregate panel-confidence outcomes"), "lab dashboard does not render aggregate panel-confidence outcomes");
  assert(dashboardSource.includes("Final confidence shift outcomes"), "lab dashboard does not render final confidence shift outcomes");
  assert(dashboardSource.includes("Median adjustment outcomes"), "lab dashboard does not render median adjustment outcomes");
  assert(dashboardSource.includes("Inside-view shift outcomes"), "lab dashboard does not render inside-view shift outcomes");
  assert(dashboardSource.includes("Final aggregation adjustment outcomes"), "lab dashboard does not render final aggregation adjustment outcomes");
  assert(dashboardSource.includes("Final aggregation direction outcomes"), "lab dashboard does not render final aggregation direction outcomes");
  assert(dashboardSource.includes("Aggregate attempt-count outcomes"), "lab dashboard does not render aggregate attempt-count outcomes");
  assert(dashboardSource.includes("Aggregation anchor outcomes"), "lab dashboard does not render aggregation anchor outcomes");
  return "binary aggregate stats are persisted and visible in resolved score analytics";
});

await check("binary aggregate planning metadata reaches resolved score analytics", async () => {
  const snapshot = readAggregateQualitySnapshot({
    aggregateQuality: {
      convergenceStatus: "approved",
      qualityApproved: true,
      maxIterationsReached: false,
      roundsUsed: 1,
      forecasterCount: 6,
      complexityScore: 5,
      researchDepth: "deep",
      roleIds: ["base-rate", "skeptic", "market-signal"],
    },
  });
  assert(snapshot?.forecasterCount === 6, "planning metadata forecaster count mismatch");
  assert(snapshot?.complexityScore === 5, "planning metadata complexity score mismatch");
  assert(snapshot?.researchDepth === "deep", "planning metadata research depth mismatch");
  assert(snapshot?.roleIds.includes("market-signal"), "planning metadata role id mismatch");
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(resolutionSource.includes("byResearchDepth"), "performance report does not group by research depth");
  assert(resolutionSource.includes("byForecasterPanelSize"), "performance report does not group by forecaster panel size");
  assert(resolutionSource.includes("byComplexityScore"), "performance report does not group by complexity score");
  assert(metricsSource.includes("open_superforecaster_aggregate_plan_scores_total"), "metrics missing aggregate plan score counts");
  assert(syncSource.includes("aggregate_role_ids_json"), "DuckDB forecast score mart missing role id export");
  assert(dashboardSource.includes("PerformancePlanShapeGroupList"), "lab dashboard does not share plan shape group rendering");
  return "binary aggregate planning metadata is visible in resolved score analytics";
});

await check("conditional forecast metadata reaches resolved score analytics", async () => {
  const snapshot = readConditionalForecastSnapshot({
    conditionalForecast: {
      conditionProbability: 40,
      probabilityGivenCondition: 72,
      probabilityGivenNotCondition: 38,
      probabilityDelta: 34,
      condition: "the stated catalyst happens",
      attemptCount: 3,
      componentBranches: [
        { forecasterLabel: "base-rate", probabilityGivenCondition: 72, probabilityGivenNotCondition: 38 },
        { forecasterLabel: "inside-view", probabilityGivenCondition: 65, probabilityGivenNotCondition: 41 },
        { forecasterLabel: "skeptic", probabilityGivenCondition: 54, probabilityGivenNotCondition: 52 },
      ],
    },
    conditionResolved: false,
  });
  assert(snapshot?.conditionProbability === 40, "conditional metadata condition probability mismatch");
  assert(snapshot?.probabilityGivenCondition === 72, "conditional metadata true-branch probability mismatch");
  assert(snapshot?.probabilityGivenNotCondition === 38, "conditional metadata false-branch probability mismatch");
  assert(snapshot?.probabilityDelta === 34, "conditional metadata probability delta mismatch");
  assert(snapshot?.effectBand === "large", "conditional metadata effect band mismatch");
  assert(snapshot?.conditionResolved === false, "conditional metadata resolved condition mismatch");
  assert(snapshot?.resolvedBranchProbability === 38, "conditional metadata resolved branch probability mismatch");
  assert(snapshot?.resolvedBranchProbabilityBand === "moderate", "conditional metadata resolved branch probability band mismatch");
  assert(snapshot?.resolvedBranchPlacement === "lower_probability", "conditional metadata resolved branch placement mismatch");
  assert(snapshot?.componentBranchCount === 3, "conditional metadata component branch count mismatch");
  assert(snapshot?.givenConditionDisagreement === 18, "conditional metadata true-branch disagreement mismatch");
  assert(snapshot?.givenNotConditionDisagreement === 14, "conditional metadata false-branch disagreement mismatch");
  assert(snapshot?.effectDisagreement === 32, "conditional metadata effect disagreement mismatch");
  assert(snapshot?.branchDisagreementBand === "wide", "conditional metadata branch disagreement band mismatch");
  assert(snapshot?.effectDirectionAgreement === "mixed", "conditional metadata effect direction agreement mismatch");
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(resolutionSource.includes("readConditionalForecastSnapshot({ ...input.prediction, conditionResolved })"), "resolution scoring does not persist conditional metadata with resolved branch");
  assert(resolutionSource.includes("byConditionalBranch"), "performance report does not group by conditional branch");
  assert(resolutionSource.includes("byConditionalEffect"), "performance report does not group by conditional effect size");
  assert(resolutionSource.includes("byConditionalBranchDisagreement"), "performance report does not group by conditional branch disagreement");
  assert(resolutionSource.includes("byConditionalResolvedBranch"), "performance report does not group by conditional resolved branch");
  assert(resolutionSource.includes("byForecastAttemptCount"), "performance report does not group by forecast attempt count");
  assert(resolutionSource.includes("conditional_branch_miss"), "attention queue does not classify conditional branch misses separately");
  assert(resolutionSource.includes("conditionalForecast.resolvedBranchPlacement"), "attention queue does not use conditional resolved branch placement");
  assert(metricsSource.includes("open_superforecaster_conditional_scores_total"), "metrics missing conditional score counts");
  assert(metricsSource.includes("conditional_branch_disagreement_band"), "metrics missing conditional branch disagreement labels");
  assert(metricsSource.includes("conditional_resolved_branch_placement"), "metrics missing conditional resolved branch labels");
  assert(metricsSource.includes("attempt_count_band"), "metrics missing attempt count band labels");
  assert(syncSource.includes("probability_given_condition"), "DuckDB forecast score mart missing conditional true branch probability");
  assert(syncSource.includes("conditional_probability_delta"), "DuckDB forecast score mart missing conditional probability delta");
  assert(syncSource.includes("conditional_resolved_branch_probability"), "DuckDB forecast score mart missing conditional resolved branch probability");
  assert(syncSource.includes("conditional_resolved_branch_placement"), "DuckDB forecast score mart missing conditional resolved branch placement");
  assert(syncSource.includes("conditional_attempt_count_band"), "DuckDB forecast score mart missing conditional attempt count band");
  assert(syncSource.includes("conditional_effect_disagreement"), "DuckDB forecast score mart missing conditional effect disagreement");
  assert(dashboardSource.includes("Conditional branch outcomes"), "lab dashboard does not render conditional branch outcomes");
  assert(dashboardSource.includes("Conditional effect outcomes"), "lab dashboard does not render conditional effect outcomes");
  assert(dashboardSource.includes("Conditional branch-disagreement outcomes"), "lab dashboard does not render conditional branch disagreement outcomes");
  assert(dashboardSource.includes("Conditional resolved-branch outcomes"), "lab dashboard does not render conditional resolved branch outcomes");
  return "conditional forecast metadata is persisted and visible in resolved score analytics";
});

await check("thresholded forecast metadata reaches resolved score analytics", async () => {
  const snapshot = readThresholdedForecastSnapshot({
    thresholdedForecast: {
      thresholdDirection: "at_least",
      thresholdSource: "caller",
      thresholds: ["10", "20", "30"],
      probabilities: [
        { threshold: "10", probability: 80 },
        { threshold: "20", probability: 50 },
        { threshold: "30", probability: 20 },
      ],
      monotonicityRepaired: false,
      attemptCount: 3,
      componentCurves: [
        {
          forecasterLabel: "base-rate",
          probabilities: [
            { threshold: "10", probability: 85 },
            { threshold: "20", probability: 55 },
            { threshold: "30", probability: 25 },
          ],
        },
        {
          forecasterLabel: "inside-view",
          probabilities: [
            { threshold: "10", probability: 75 },
            { threshold: "20", probability: 50 },
            { threshold: "30", probability: 15 },
          ],
        },
        {
          forecasterLabel: "skeptic",
          probabilities: [
            { threshold: "10", probability: 40 },
            { threshold: "20", probability: 25 },
            { threshold: "30", probability: 5 },
          ],
        },
      ],
    },
    actualValue: 35,
  });
  assert(snapshot?.thresholdDirection === "at_least", "thresholded metadata direction mismatch");
  assert(snapshot?.thresholdSource === "caller", "thresholded metadata source mismatch");
  assert(snapshot?.thresholdCount === 3, "thresholded metadata threshold count mismatch");
  assert(snapshot?.probabilitySpread === 60, "thresholded metadata probability spread mismatch");
  assert(snapshot?.probabilitySpreadBand === "steep", "thresholded metadata probability spread band mismatch");
  assert(snapshot?.actualValue === 35, "thresholded metadata actual value mismatch");
  assert(snapshot?.nearestThresholdDistance === 5, "thresholded metadata nearest threshold distance mismatch");
  assert(snapshot?.resolvedThresholdBand === "above_range", "thresholded metadata resolved threshold band mismatch");
  assert(snapshot?.monotonicityRepaired === false, "thresholded metadata monotonicity flag mismatch");
  assert(snapshot?.componentCurveCount === 3, "thresholded metadata component curve count mismatch");
  assert(snapshot?.componentProbabilityDisagreement === 45, "thresholded metadata component disagreement mismatch");
  assert(snapshot?.componentDisagreementBand === "wide", "thresholded metadata component disagreement band mismatch");
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(resolutionSource.includes("readThresholdedForecastSnapshot({ ...input.prediction, actualValue: actual })"), "resolution scoring does not persist thresholded metadata with resolved value");
  assert(resolutionSource.includes("byThresholdedDirection"), "performance report does not group by threshold direction");
  assert(resolutionSource.includes("byThresholdedRepair"), "performance report does not group by threshold repair status");
  assert(resolutionSource.includes("byThresholdedCurveSpread"), "performance report does not group by threshold curve spread");
  assert(resolutionSource.includes("byThresholdedComponentDisagreement"), "performance report does not group by threshold component disagreement");
  assert(resolutionSource.includes("byThresholdedResolvedBand"), "performance report does not group by threshold resolved band");
  assert(resolutionSource.includes("thresholded_curve_miss"), "attention queue does not classify threshold curve misses separately");
  assert(resolutionSource.includes("thresholdedForecast.resolvedThresholdBand"), "attention queue does not use threshold resolved band");
  assert(metricsSource.includes("open_superforecaster_thresholded_scores_total"), "metrics missing thresholded score counts");
  assert(metricsSource.includes("probability_spread_band"), "metrics missing threshold probability spread labels");
  assert(metricsSource.includes("thresholdedForecast?.componentDisagreementBand"), "metrics missing threshold component disagreement labels");
  assert(metricsSource.includes("thresholdedForecast?.resolvedThresholdBand"), "metrics missing threshold resolved-band labels");
  assert(metricsSource.includes("attemptCountBand(thresholdedForecast?.attemptCount"), "metrics missing threshold attempt count labels");
  assert(syncSource.includes("threshold_probability_spread"), "DuckDB forecast score mart missing threshold probability spread");
  assert(syncSource.includes("threshold_probability_spread_band"), "DuckDB forecast score mart missing threshold probability spread band");
  assert(syncSource.includes("threshold_actual_value"), "DuckDB forecast score mart missing threshold actual value");
  assert(syncSource.includes("threshold_nearest_distance"), "DuckDB forecast score mart missing nearest threshold distance");
  assert(syncSource.includes("threshold_resolved_band"), "DuckDB forecast score mart missing threshold resolved band");
  assert(syncSource.includes("thresholded_attempt_count_band"), "DuckDB forecast score mart missing threshold attempt count band");
  assert(syncSource.includes("thresholded_component_probability_disagreement"), "DuckDB forecast score mart missing threshold component disagreement");
  assert(dashboardSource.includes("Threshold monotonicity outcomes"), "lab dashboard does not render threshold monotonicity outcomes");
  assert(dashboardSource.includes("Threshold curve-spread outcomes"), "lab dashboard does not render threshold curve spread outcomes");
  assert(dashboardSource.includes("Threshold resolved-band outcomes"), "lab dashboard does not render threshold resolved-band outcomes");
  assert(dashboardSource.includes("Threshold component-disagreement outcomes"), "lab dashboard does not render threshold component disagreement outcomes");
  return "thresholded forecast metadata is persisted and visible in resolved score analytics";
});

await check("numeric and date forecast distribution metadata reaches resolved score analytics", async () => {
  const numericSnapshot = readNumericForecastSnapshot({
    numericForecast: {
      unit: "units",
      distribution: {
        p10: 80,
        p50: 100,
        p90: 150,
      },
      attemptCount: 3,
      componentValues: [
        { forecasterLabel: "base-rate", unit: "units", quantiles: { p10: 70, p25: 80, p50: 90, p75: 105, p90: 120 }, value: 90 },
        { forecasterLabel: "inside-view", unit: "units", quantiles: { p10: 80, p25: 90, p50: 100, p75: 130, p90: 150 }, value: 100 },
        { forecasterLabel: "skeptic", unit: "items", quantiles: { p10: 95, p25: 115, p50: 175, p75: 210, p90: 240 }, value: 175 },
      ],
    },
    actualValue: 160,
  });
  assert(numericSnapshot?.unit === "units", "numeric metadata unit mismatch");
  assert(numericSnapshot?.p10 === 80, "numeric metadata p10 mismatch");
  assert(numericSnapshot?.p50 === 100, "numeric metadata p50 mismatch");
  assert(numericSnapshot?.p90 === 150, "numeric metadata p90 mismatch");
  assert(numericSnapshot?.intervalWidth === 70, "numeric metadata interval width mismatch");
  assert(numericSnapshot?.intervalWidthBand === "moderate", "numeric metadata interval band mismatch");
  assert(numericSnapshot?.actualValue === 160, "numeric metadata actual value mismatch");
  assert(numericSnapshot?.p50Error === -60, "numeric metadata p50 error mismatch");
  assert(numericSnapshot?.absoluteP50Error === 60, "numeric metadata absolute p50 error mismatch");
  assert(numericSnapshot?.p50ErrorBand === "moderate", "numeric metadata p50 error band mismatch");
  assert(numericSnapshot?.resolvedPositionBand === "above_p90", "numeric metadata resolved position band mismatch");
  assert(numericSnapshot?.attemptCount === 3, "numeric metadata attempt count mismatch");
  assert(numericSnapshot?.componentValueCount === 3, "numeric metadata component value count mismatch");
  assert(numericSnapshot?.p50Disagreement === 85, "numeric metadata p50 disagreement mismatch");
  assert(numericSnapshot?.p50DisagreementBand === "wide", "numeric metadata p50 disagreement band mismatch");
  assert(numericSnapshot?.unitDisagreementCount === 1, "numeric metadata unit disagreement count mismatch");

  const dateSnapshot = readDateForecastSnapshot({
    dateForecast: {
      dateDistribution: {
        p10: "2026-01-01",
        p50: "2026-03-01",
        p90: "2026-07-01",
      },
      neverProbability: 12,
      attemptCount: 3,
      componentDates: [
        {
          forecasterLabel: "base-rate",
          targetDate: "2026-02-01",
          dateDistribution: { p10: "2026-01-01", p25: "2026-01-15", p50: "2026-02-01", p75: "2026-03-01", p90: "2026-04-01" },
          neverProbability: 5,
        },
        {
          forecasterLabel: "inside-view",
          targetDate: "2026-03-15",
          dateDistribution: { p10: "2026-02-01", p25: "2026-02-20", p50: "2026-03-15", p75: "2026-05-01", p90: "2026-06-01" },
          neverProbability: 12,
        },
        {
          forecasterLabel: "skeptic",
          targetDate: "2026-07-01",
          dateDistribution: { p10: "2026-03-01", p25: "2026-05-01", p50: "2026-07-01", p75: "2026-08-01", p90: "2026-09-01" },
          neverProbability: 22,
        },
      ],
    },
    actualDate: "2025-12-15",
  });
  assert(dateSnapshot?.p10 === "2026-01-01", "date metadata p10 mismatch");
  assert(dateSnapshot?.p50 === "2026-03-01", "date metadata p50 mismatch");
  assert(dateSnapshot?.p90 === "2026-07-01", "date metadata p90 mismatch");
  assert(dateSnapshot?.intervalDays === 181, "date metadata interval days mismatch");
  assert(dateSnapshot?.intervalBand === "wide", "date metadata interval band mismatch");
  assert(dateSnapshot?.actualDate === "2025-12-15", "date metadata actual date mismatch");
  assert(dateSnapshot?.p50ErrorDays === 76, "date metadata p50 error days mismatch");
  assert(dateSnapshot?.absoluteP50ErrorDays === 76, "date metadata absolute p50 error days mismatch");
  assert(dateSnapshot?.p50ErrorBand === "moderate", "date metadata p50 error band mismatch");
  assert(dateSnapshot?.resolvedPositionBand === "before_p10", "date metadata resolved position band mismatch");
  assert(dateSnapshot?.neverProbability === 12, "date metadata never probability mismatch");
  assert(dateSnapshot?.neverProbabilityBand === "moderate", "date metadata never probability band mismatch");
  assert(dateSnapshot?.attemptCount === 3, "date metadata attempt count mismatch");
  assert(dateSnapshot?.componentDateCount === 3, "date metadata component date count mismatch");
  assert(dateSnapshot?.p50DisagreementDays === 150, "date metadata p50 disagreement days mismatch");
  assert(dateSnapshot?.p50DisagreementBand === "wide", "date metadata p50 disagreement band mismatch");
  assert(dateSnapshot?.neverProbabilityDisagreement === 17, "date metadata never probability disagreement mismatch");

  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(resolutionSource.includes("readNumericForecastSnapshot({ ...input.prediction, actualValue: actual })"), "resolution scoring does not persist numeric distribution metadata with resolved value");
  assert(resolutionSource.includes("readDateForecastSnapshot({ ...input.prediction, actualDate })"), "resolution scoring does not persist date distribution metadata with resolved date");
  assert(resolutionSource.includes("byNumericInterval"), "performance report does not group by numeric interval width");
  assert(resolutionSource.includes("byNumericP50Disagreement"), "performance report does not group by numeric component value disagreement");
  assert(resolutionSource.includes("byNumericP50Error"), "performance report does not group by numeric median error");
  assert(resolutionSource.includes("byNumericResolvedPosition"), "performance report does not group by numeric resolved position");
  assert(resolutionSource.includes("byDateNeverProbability"), "performance report does not group by date never probability");
  assert(resolutionSource.includes("byDateP50Disagreement"), "performance report does not group by date component timing disagreement");
  assert(resolutionSource.includes("byDateP50Error"), "performance report does not group by date median error");
  assert(resolutionSource.includes("byDateResolvedPosition"), "performance report does not group by date resolved position");
  assert(resolutionSource.includes("numeric_distribution_miss"), "attention queue does not classify numeric distribution misses separately");
  assert(resolutionSource.includes("date_distribution_miss"), "attention queue does not classify date distribution misses separately");
  assert(resolutionSource.includes("numericForecast.resolvedPositionBand"), "attention queue does not use numeric resolved position");
  assert(resolutionSource.includes("numericForecast.p50ErrorBand"), "attention queue does not use numeric median-error band");
  assert(resolutionSource.includes("dateForecast.resolvedPositionBand"), "attention queue does not use date resolved position");
  assert(resolutionSource.includes("dateForecast.p50ErrorBand"), "attention queue does not use date median-error band");
  assert(metricsSource.includes("open_superforecaster_numeric_distribution_scores_total"), "metrics missing numeric distribution score counts");
  assert(metricsSource.includes("numericForecast?.p50DisagreementBand"), "metrics missing numeric component disagreement labels");
  assert(metricsSource.includes("numericForecast?.p50ErrorBand"), "metrics missing numeric median-error labels");
  assert(metricsSource.includes("numericForecast?.resolvedPositionBand"), "metrics missing numeric resolved-position labels");
  assert(metricsSource.includes("open_superforecaster_date_distribution_scores_total"), "metrics missing date distribution score counts");
  assert(metricsSource.includes("dateForecast?.p50ErrorBand"), "metrics missing date median-error labels");
  assert(metricsSource.includes("dateForecast?.resolvedPositionBand"), "metrics missing date resolved-position labels");
  assert(syncSource.includes("numeric_interval_width"), "DuckDB forecast score mart missing numeric interval width");
  assert(syncSource.includes("numeric_interval_width_band"), "DuckDB forecast score mart missing numeric interval band");
  assert(syncSource.includes("numeric_actual_value"), "DuckDB forecast score mart missing numeric actual value");
  assert(syncSource.includes("numeric_p50_error"), "DuckDB forecast score mart missing numeric p50 error");
  assert(syncSource.includes("numeric_p50_error_band"), "DuckDB forecast score mart missing numeric p50 error band");
  assert(syncSource.includes("numeric_resolved_position_band"), "DuckDB forecast score mart missing numeric resolved position band");
  assert(syncSource.includes("numeric_attempt_count_band"), "DuckDB forecast score mart missing numeric attempt count band");
  assert(syncSource.includes("numeric_p50_disagreement"), "DuckDB forecast score mart missing numeric component value disagreement");
  assert(syncSource.includes("date_interval_days"), "DuckDB forecast score mart missing date interval days");
  assert(syncSource.includes("date_actual_date"), "DuckDB forecast score mart missing date actual date");
  assert(syncSource.includes("date_p50_error_days"), "DuckDB forecast score mart missing date p50 error days");
  assert(syncSource.includes("date_p50_error_band"), "DuckDB forecast score mart missing date p50 error band");
  assert(syncSource.includes("date_resolved_position_band"), "DuckDB forecast score mart missing date resolved position band");
  assert(syncSource.includes("date_never_probability_band"), "DuckDB forecast score mart missing date never-probability band");
  assert(syncSource.includes("date_attempt_count_band"), "DuckDB forecast score mart missing date attempt count band");
  assert(syncSource.includes("date_p50_disagreement_days"), "DuckDB forecast score mart missing date component timing disagreement");
  assert(dashboardSource.includes("Numeric interval outcomes"), "lab dashboard does not render numeric interval outcomes");
  assert(dashboardSource.includes("Numeric component-value outcomes"), "lab dashboard does not render numeric component value outcomes");
  assert(dashboardSource.includes("Numeric median-error outcomes"), "lab dashboard does not render numeric median-error outcomes");
  assert(dashboardSource.includes("Numeric resolved-position outcomes"), "lab dashboard does not render numeric resolved-position outcomes");
  assert(dashboardSource.includes("Date never-probability outcomes"), "lab dashboard does not render date never-probability outcomes");
  assert(dashboardSource.includes("Date component-timing outcomes"), "lab dashboard does not render date component timing outcomes");
  assert(dashboardSource.includes("Date median-error outcomes"), "lab dashboard does not render date median-error outcomes");
  assert(dashboardSource.includes("Date resolved-position outcomes"), "lab dashboard does not render date resolved-position outcomes");
  return "numeric and date forecast distributions are persisted and visible in resolved score analytics";
});

await check("categorical forecast distribution metadata reaches resolved score analytics", async () => {
  const snapshot = readCategoricalForecastSnapshot({
    categoricalForecast: {
      topCategory: "Alpha",
      categories: ["Alpha", "Beta", "Other"],
      categoriesExhaustive: false,
      categorySource: "caller_with_other",
      probabilities: [
        { category: "Alpha", probability: 65 },
        { category: "Beta", probability: 25 },
        { category: "Other", probability: 10 },
      ],
      attemptCount: 3,
      componentCategories: [
        {
          forecasterLabel: "base-rate",
          topCategory: "Alpha",
          probabilities: [
            { category: "Alpha", probability: 70 },
            { category: "Beta", probability: 20 },
            { category: "Other", probability: 10 },
          ],
        },
        {
          forecasterLabel: "inside-view",
          topCategory: "Alpha",
          probabilities: [
            { category: "Alpha", probability: 60 },
            { category: "Beta", probability: 30 },
            { category: "Other", probability: 10 },
          ],
        },
        {
          forecasterLabel: "skeptic",
          topCategory: "Beta",
          probabilities: [
            { category: "Alpha", probability: 35 },
            { category: "Beta", probability: 50 },
            { category: "Other", probability: 15 },
          ],
        },
      ],
    },
    actualCategory: "Beta",
  });
  assert(snapshot?.topCategory === "Alpha", "categorical metadata top category mismatch");
  assert(snapshot?.topProbability === 65, "categorical metadata top probability mismatch");
  assert(snapshot?.topProbabilityBand === "moderate", "categorical metadata confidence band mismatch");
  assert(snapshot?.categoryCount === 3, "categorical metadata category count mismatch");
  assert(snapshot?.categorySource === "caller_with_other", "categorical metadata category source mismatch");
  assert(snapshot?.categoriesExhaustive === false, "categorical metadata exhaustive flag mismatch");
  assert(snapshot?.categoryCoverageBand === "open_set", "categorical metadata coverage band mismatch");
  assert(snapshot?.entropy === 0.78, "categorical metadata entropy mismatch");
  assert(snapshot?.entropyBand === "diffuse", "categorical metadata entropy band mismatch");
  assert(snapshot?.actualCategory === "Beta", "categorical metadata actual category mismatch");
  assert(snapshot?.actualProbability === 25, "categorical metadata actual probability mismatch");
  assert(snapshot?.actualProbabilityBand === "moderate", "categorical metadata actual probability band mismatch");
  assert(snapshot?.resolvedCategoryBand === "in_distribution", "categorical metadata resolved category band mismatch");
  assert(snapshot?.attemptCount === 3, "categorical metadata attempt count mismatch");
  assert(snapshot?.componentCategoryCount === 3, "categorical metadata component category count mismatch");
  assert(snapshot?.uniqueTopCategoryCount === 2, "categorical metadata unique top category count mismatch");
  assert(snapshot?.topCategoryVoteShare === 66.67, "categorical metadata top category vote share mismatch");
  assert(snapshot?.topCategoryAgreementBand === "split", "categorical metadata top category agreement band mismatch");
  assert(snapshot?.topCategoryProbabilitySpread === 35, "categorical metadata top category probability spread mismatch");

  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(resolutionSource.includes("readCategoricalForecastSnapshot({ ...input.prediction, actualCategory })"), "resolution scoring does not persist categorical distribution metadata with resolved category");
  assert(resolutionSource.includes("byCategoricalConfidence"), "performance report does not group by categorical confidence");
  assert(resolutionSource.includes("byCategoricalEntropy"), "performance report does not group by categorical entropy");
  assert(resolutionSource.includes("byCategoricalSource"), "performance report does not group by categorical source");
  assert(resolutionSource.includes("byCategoricalCoverage"), "performance report does not group by categorical coverage");
  assert(resolutionSource.includes("byCategoricalTopAgreement"), "performance report does not group by categorical top agreement");
  assert(resolutionSource.includes("byCategoricalResolvedCategory"), "performance report does not group by categorical resolved category");
  assert(resolutionSource.includes("categorical_distribution_miss"), "attention queue does not classify categorical distribution misses separately");
  assert(resolutionSource.includes("categoricalForecast.resolvedCategoryBand"), "attention queue does not use categorical resolved category");
  assert(metricsSource.includes("open_superforecaster_categorical_distribution_scores_total"), "metrics missing categorical distribution score counts");
  assert(metricsSource.includes("category_coverage_band"), "metrics missing categorical coverage labels");
  assert(metricsSource.includes("top_category_agreement_band"), "metrics missing categorical top agreement labels");
  assert(metricsSource.includes("resolved_category_band"), "metrics missing categorical resolved-category labels");
  assert(metricsSource.includes("attemptCountBand(categoricalForecast?.attemptCount"), "metrics missing categorical attempt count labels");
  assert(syncSource.includes("categorical_top_probability"), "DuckDB forecast score mart missing categorical top probability");
  assert(syncSource.includes("categorical_category_coverage_band"), "DuckDB forecast score mart missing categorical coverage band");
  assert(syncSource.includes("categorical_entropy_band"), "DuckDB forecast score mart missing categorical entropy band");
  assert(syncSource.includes("categorical_attempt_count_band"), "DuckDB forecast score mart missing categorical attempt count band");
  assert(syncSource.includes("categorical_top_category_vote_share"), "DuckDB forecast score mart missing categorical top category vote share");
  assert(syncSource.includes("categorical_actual_category"), "DuckDB forecast score mart missing categorical actual category");
  assert(syncSource.includes("categorical_actual_probability"), "DuckDB forecast score mart missing categorical actual probability");
  assert(syncSource.includes("categorical_resolved_category_band"), "DuckDB forecast score mart missing categorical resolved category band");
  assert(dashboardSource.includes("Categorical confidence outcomes"), "lab dashboard does not render categorical confidence outcomes");
  assert(dashboardSource.includes("Categorical entropy outcomes"), "lab dashboard does not render categorical entropy outcomes");
  assert(dashboardSource.includes("Categorical coverage outcomes"), "lab dashboard does not render categorical coverage outcomes");
  assert(dashboardSource.includes("Categorical top-agreement outcomes"), "lab dashboard does not render categorical top agreement outcomes");
  assert(dashboardSource.includes("Categorical resolved-category outcomes"), "lab dashboard does not render categorical resolved-category outcomes");
  return "categorical forecast distributions are persisted and visible in resolved score analytics";
});

await check("forecast evidence coverage metadata reaches resolved score analytics", async () => {
  const snapshot = readEvidenceCoverageSnapshot({
    citedSources: [
      { title: "A", url: "https://example.com/a", publishedAt: "2026-01-02", claim: "first source" },
      { title: "B", url: "https://example.com/b", publishedAt: "2025-12-15", claim: "second source" },
      { title: "C", url: "https://other.example/c", claim: "third source" },
    ],
    keyUncertainties: ["base rate", "timing", "measurement"],
    rationale: "This forecast cites concrete evidence, names uncertainty, and gives enough explanation to be reviewed later against the resolution outcome.",
    method: "sample_method_v1",
    evidenceAsOfDate: "2026-07-09",
  });
  assert(snapshot?.sourceCount === 3, "evidence source count mismatch");
  assert(snapshot?.sourceCountBand === "sourced", "evidence source count band mismatch");
  assert(snapshot?.sourceDomainCount === 2, "evidence source domain count mismatch");
  assert(snapshot?.sourceDiversityBand === "mixed", "evidence source diversity band mismatch");
  assert(snapshot?.topSourceDomainCount === 2, "evidence top source domain count mismatch");
  assert(snapshot?.topSourceDomainShare === 2 / 3, "evidence top source domain share mismatch");
  assert(snapshot?.sourceConcentrationBand === "concentrated", "evidence source concentration band mismatch");
  assert(snapshot?.datedSourceCount === 2, "evidence dated source count mismatch");
  assert(snapshot?.undatedSourceCount === 1, "evidence undated source count mismatch");
  assert(snapshot?.sourceDateCoverageBand === "partial", "evidence source date coverage band mismatch");
  assert(snapshot?.newestPublishedAt === "2026-01-02", "evidence newest source date mismatch");
  assert(snapshot?.oldestPublishedAt === "2025-12-15", "evidence oldest source date mismatch");
  assert(snapshot?.evidenceAsOfDate === "2026-07-09", "evidence as-of date mismatch");
  assert(snapshot?.postAsOfSourceCount === 0, "evidence post-as-of source count mismatch");
  assert(snapshot?.sourceTimingBand === "clean", "evidence source timing band mismatch");
  assert(snapshot?.newestSourceAgeDays === 188, "evidence newest source age mismatch");
  assert(snapshot?.sourceFreshnessBand === "stale", "evidence source freshness band mismatch");
  assert(snapshot?.uncertaintyCount === 3, "evidence uncertainty count mismatch");
  assert(snapshot?.uncertaintyCountBand === "many", "evidence uncertainty count band mismatch");
  assert(snapshot?.rationaleLength === 19, "evidence rationale length mismatch");
  assert(snapshot?.rationaleLengthBand === "short", "evidence rationale length band mismatch");
  assert(snapshot?.method === "sample_method_v1", "evidence method mismatch");

  const conditionalSnapshot = readEvidenceCoverageSnapshot({
    rationaleGivenCondition: "The condition would materially improve the outcome odds.",
    rationaleGivenNotCondition: "Without the condition, the outcome remains possible but less supported.",
  });
  assert(conditionalSnapshot?.rationaleLength === 18, "conditional evidence rationale length mismatch");
  assert(conditionalSnapshot?.rationaleLengthBand === "short", "conditional evidence rationale band mismatch");
  const postAsOfSnapshot = readEvidenceCoverageSnapshot({
    citedSources: [
      { title: "Future source", url: "https://example.com/future", publishedAt: "2026-08-01", claim: "future-dated source" },
    ],
    evidenceAsOfDate: "2026-07-09",
    rationale: "A short rationale.",
  });
  assert(postAsOfSnapshot?.postAsOfSourceCount === 1, "future-dated evidence source count mismatch");
  assert(postAsOfSnapshot?.sourceTimingBand === "post_as_of", "future-dated evidence source timing band mismatch");
  assert(postAsOfSnapshot?.sourceFreshnessBand === "current", "future-dated evidence freshness remains current but timing must be flagged");
  const singleDomainSnapshot = readEvidenceCoverageSnapshot({
    citedSources: [
      { title: "A", url: "https://example.com/a", publishedAt: "2026-01-01" },
      { title: "B", url: "https://example.com/b", publishedAt: "2026-01-02" },
      { title: "C", url: "https://www.example.com/c", publishedAt: "2026-01-03" },
    ],
  });
  assert(singleDomainSnapshot?.sourceDiversityBand === "single_domain", "single-domain evidence diversity band mismatch");
  assert(singleDomainSnapshot?.topSourceDomainCount === 3, "single-domain top source domain count mismatch");
  assert(singleDomainSnapshot?.sourceConcentrationBand === "dominant", "single-domain evidence concentration band mismatch");
  const timing = readForecastTiming({ present_date: "2026-07-09T12:34:56Z", cutoff_date: "2026-07-01" });
  assert(timing.evidenceAsOfDate === "2026-07-09", "forecast timing did not normalize present date");
  assert(timing.cutoffDate === "2026-07-01", "forecast timing did not normalize cutoff date");
  assert(timing.promptBlock.includes("Timing context:"), "forecast timing prompt block missing heading");
  assert(
    canonicalCitedSourceKey({ url: "https://example.com/a?b=2&a=1#frag", claim: "first" }) === "url:https://example.com/a?a=1&b=2",
    "canonical cited-source key did not normalize URL query and hash",
  );
  assert(
    canonicalCitedSourceKey({ title: " A ", claim: " First " }) === "fallback:a::first",
    "canonical cited-source key did not normalize fallback title and claim",
  );
  const aggregatedUncertainties = collectKeyUncertainties([
    { keyUncertainties: ["base rate", " timing "] },
    { keyUncertainties: ["timing", "measurement"] },
  ]);
  assert(aggregatedUncertainties.join("|") === "base rate|timing|measurement", "forecast uncertainty aggregation is not stable");
  const aggregatedSources = collectCitedSources([
    {
      citedSources: [
        { title: "A", url: "https://example.com/a", publishedAt: "2026-01-02", claim: "first" },
        { title: "A duplicate", url: "https://example.com/a", claim: "duplicate" },
      ],
    },
    { citedSources: [{ title: "B", claim: "second" }] },
  ]);
  assert(aggregatedSources.length === 2, "forecast cited-source aggregation did not dedupe repeated URLs");
  assert(aggregatedSources[0]?.publishedAt === "2026-01-02", "forecast cited-source aggregation did not preserve first source detail");

  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const runServiceSource = await readFile(resolve(root, "packages/backend/src/run-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  const workflowFiles = [
    "binary-forecast.workflow.tsx",
    "date-forecast.workflow.tsx",
    "numeric-forecast.workflow.tsx",
    "categorical-forecast.workflow.tsx",
    "conditional-forecast.workflow.tsx",
    "thresholded-forecast.workflow.tsx",
  ];
  const workflowSources = await Promise.all(workflowFiles.map(async (file) => ({
    file,
    source: await readFile(resolve(root, "packages/workflows/src", file), "utf8"),
  })));
  for (const { file, source } of workflowSources) {
    assert(source.includes("publishedAt: z.string().optional()"), `${file} cited-source schema does not accept publishedAt`);
    assert(source.includes("publishedAt as an ISO date"), `${file} prompts do not request source publication dates`);
    assert(source.includes("evidenceAsOfDate: z.string().optional()"), `${file} aggregate schema does not persist evidence as-of date`);
    assert(source.includes("keyUncertainties: z.array(z.string()).default([])"), `${file} aggregate schema does not persist key uncertainties`);
    assert(source.includes("collectCitedSources"), `${file} does not use shared cited-source aggregation`);
    assert(source.includes("collectKeyUncertainties"), `${file} does not use shared uncertainty aggregation`);
  }
  for (const { file, source } of workflowSources.filter((item) => item.file !== "binary-forecast.workflow.tsx")) {
    assert(source.includes("timing.promptBlock"), `${file} prompt does not include timing context`);
  }
  assert(resolutionSource.includes("readEvidenceCoverageSnapshot(input.prediction)"), "resolution scoring does not persist evidence coverage metadata");
  assert(runServiceSource.includes("canonicalCitedSourceKey"), "run source-bank persistence does not use shared cited-source canonicalization");
  assert(!runServiceSource.includes("function canonicalSourceKey"), "run source-bank persistence still has a duplicate cited-source key function");
  assert(resolutionSource.includes("byEvidenceSourceCount"), "performance report does not group by evidence source count");
  assert(resolutionSource.includes("byEvidenceSourceDiversity"), "performance report does not group by evidence source diversity");
  assert(resolutionSource.includes("byEvidenceSourceConcentration"), "performance report does not group by evidence source concentration");
  assert(resolutionSource.includes("byEvidenceSourceDateCoverage"), "performance report does not group by evidence source date coverage");
  assert(resolutionSource.includes("byEvidenceSourceFreshness"), "performance report does not group by evidence source freshness");
  assert(resolutionSource.includes("byEvidenceSourceTiming"), "performance report does not group by evidence source timing");
  assert(resolutionSource.includes("postAsOfSourceCount"), "performance report does not inspect post-as-of evidence sources");
  assert(resolutionSource.includes("sourceFreshnessBand"), "performance report does not inspect evidence source freshness");
  assert(resolutionSource.includes("sourceConcentrationBand"), "performance report does not inspect evidence source concentration");
  assert(resolutionSource.includes("byEvidenceUncertaintyCount"), "performance report does not group by evidence uncertainty count");
  assert(resolutionSource.includes("byEvidenceRationaleLength"), "performance report does not group by evidence rationale length");
  assert(metricsSource.includes("open_superforecaster_evidence_coverage_scores_total"), "metrics missing evidence coverage score counts");
  assert(metricsSource.includes("source_diversity_band"), "metrics missing evidence source diversity labels");
  assert(metricsSource.includes("source_concentration_band"), "metrics missing evidence source concentration labels");
  assert(metricsSource.includes("source_date_coverage_band"), "metrics missing evidence source date coverage labels");
  assert(metricsSource.includes("source_freshness_band"), "metrics missing evidence source freshness labels");
  assert(metricsSource.includes("source_timing_band"), "metrics missing evidence source timing labels");
  assert(syncSource.includes("evidence_source_count_band"), "DuckDB forecast score mart missing evidence source count band");
  assert(syncSource.includes("evidence_source_diversity_band"), "DuckDB forecast score mart missing evidence source diversity band");
  assert(syncSource.includes("evidence_top_source_domain_count"), "DuckDB forecast score mart missing evidence top source domain count");
  assert(syncSource.includes("evidence_top_source_domain_share"), "DuckDB forecast score mart missing evidence top source domain share");
  assert(syncSource.includes("evidence_source_concentration_band"), "DuckDB forecast score mart missing evidence source concentration band");
  assert(syncSource.includes("evidence_source_date_coverage_band"), "DuckDB forecast score mart missing evidence source date coverage band");
  assert(syncSource.includes("evidence_newest_published_at"), "DuckDB forecast score mart missing evidence newest source date");
  assert(syncSource.includes("evidence_as_of_date"), "DuckDB forecast score mart missing evidence as-of date");
  assert(syncSource.includes("evidence_post_as_of_source_count"), "DuckDB forecast score mart missing post-as-of source count");
  assert(syncSource.includes("evidence_source_timing_band"), "DuckDB forecast score mart missing source timing band");
  assert(syncSource.includes("evidence_newest_source_age_days"), "DuckDB forecast score mart missing evidence newest source age");
  assert(syncSource.includes("evidence_source_freshness_band"), "DuckDB forecast score mart missing evidence source freshness band");
  assert(syncSource.includes("evidence_rationale_length_band"), "DuckDB forecast score mart missing evidence rationale length band");
  assert(dashboardSource.includes("Evidence source outcomes"), "lab dashboard does not render evidence source outcomes");
  assert(dashboardSource.includes("Evidence source-diversity outcomes"), "lab dashboard does not render evidence source diversity outcomes");
  assert(dashboardSource.includes("Evidence source-concentration outcomes"), "lab dashboard does not render evidence source concentration outcomes");
  assert(dashboardSource.includes("Evidence source-date outcomes"), "lab dashboard does not render evidence source date outcomes");
  assert(dashboardSource.includes("Evidence freshness outcomes"), "lab dashboard does not render evidence freshness outcomes");
  assert(dashboardSource.includes("Evidence timing outcomes"), "lab dashboard does not render evidence timing outcomes");
  assert(dashboardSource.includes("Evidence rationale outcomes"), "lab dashboard does not render evidence rationale outcomes");
  return "forecast evidence coverage is persisted and visible in resolved score analytics";
});

await check("forecast input context metadata reaches resolved score analytics", async () => {
  const snapshot = readForecastInputContextSnapshot({
    classification: {
      forecastType: "thresholded",
      confidence: 0.74,
    },
    forecastInput: {
      source: "open-superforecaster-ui",
      question: "Will ACME deliver at least 1000 units before January 1, 2028?",
      resolutionCriteria: "Resolve from audited delivery totals.",
      resolutionDate: "2028-01-01",
      presentDate: "2026-07-09",
      background: "The company has guided to a production ramp.",
      marketPrice: 72,
      marketPriceAsOf: "2026-06-01",
      marketCreationDate: "2026-05-01",
      marketPlatform: "Kalshi",
      marketUrl: "https://example.com/market",
      categories: ["Yes", "No", "Other"],
      thresholds: [
        { label: "at least 500", value: 500 },
        { label: "at least 1000", value: 1000 },
      ],
      condition: "Supplier financing closes.",
      conditionResolutionCriteria: "Resolve from a signed financing announcement.",
      unit: "units",
    },
  });
  assert(snapshot?.requestedForecastType === null, "input context requested forecast type mismatch");
  assert(snapshot?.requestedForecastTypeBand === "unspecified", "input context requested forecast type band mismatch");
  assert(snapshot?.routedForecastType === "thresholded", "input context routed forecast type mismatch");
  assert(snapshot?.routedForecastTypeBand === "specified", "input context routed forecast type band mismatch");
  assert(snapshot?.requestedRoutedTypeBand === "routed_only", "input context requested/routed type band mismatch");
  assert(snapshot?.routingConfidence === 0.74, "input context routing confidence mismatch");
  assert(snapshot?.routingConfidenceBand === "medium", "input context routing confidence band mismatch");
  assert(snapshot?.inputSource === "open-superforecaster-ui", "input context source mismatch");
  assert(snapshot?.inputSourceBand === "ui", "input context source band mismatch");
  assert(snapshot?.questionLength === 11, "input context question length mismatch");
  assert(snapshot?.questionLengthBand === "short", "input context question length band mismatch");
  assert(snapshot?.hasResolutionCriteria === true, "input context resolution criteria flag mismatch");
  assert(snapshot?.resolutionCriteriaLength === 5, "input context resolution criteria length mismatch");
  assert(snapshot?.resolutionCriteriaLengthBand === "thin", "input context resolution criteria length band mismatch");
  assert(snapshot?.hasResolutionDate === true, "input context resolution date flag mismatch");
  assert(snapshot?.resolutionDate === "2028-01-01", "input context resolution date mismatch");
  assert(snapshot?.hasEvidenceAsOfDate === true, "input context evidence as-of flag mismatch");
  assert(snapshot?.evidenceAsOfDate === "2026-07-09", "input context evidence as-of date mismatch");
  assert(snapshot?.evidenceAsOfDateBand === "specified", "input context evidence as-of date band mismatch");
  assert(snapshot?.resolutionHorizonDays === 541, "input context resolution horizon days mismatch");
  assert(snapshot?.resolutionHorizonBand === "medium", "input context resolution horizon band mismatch");
  assert(snapshot?.hasBackground === true, "input context background flag mismatch");
  assert(snapshot?.backgroundLength === 8, "input context background length mismatch");
  assert(snapshot?.backgroundLengthBand === "thin", "input context background length band mismatch");
  assert(snapshot?.hasMarketPrice === true, "input context market flag mismatch");
  assert(snapshot?.marketPriceBand === "high", "input context market price band mismatch");
  assert(snapshot?.marketPriceAsOfDate === "2026-06-01", "input context market price as-of date mismatch");
  assert(snapshot?.marketPriceAgeDays === 38, "input context market price age mismatch");
  assert(snapshot?.marketPriceAgeBand === "old", "input context market price age band mismatch");
  assert(snapshot?.marketPlatform === "Kalshi", "input context market platform mismatch");
  assert(snapshot?.marketUrl === "https://example.com/market", "input context market URL mismatch");
  assert(snapshot?.hasMarketUrl === true, "input context market URL flag mismatch");
  assert(snapshot?.marketCreationDate === "2026-05-01", "input context market creation date mismatch");
  assert(snapshot?.marketCreationAgeDays === 69, "input context market creation age mismatch");
  assert(snapshot?.marketCreationAgeBand === "established", "input context market creation age band mismatch");
  assert(snapshot?.marketMetadataBand === "linked", "input context market metadata band mismatch");
  assert(snapshot?.categoryCount === 3, "input context category count mismatch");
  assert(snapshot?.categoryCountBand === "few", "input context category count band mismatch");
  assert(snapshot?.categoriesExhaustive === false, "input context categories exhaustive flag mismatch");
  assert(snapshot?.categoryCoverageBand === "open_set", "input context category coverage band mismatch");
  assert(snapshot?.thresholdCount === 2, "input context threshold count mismatch");
  assert(snapshot?.thresholdCountBand === "curve", "input context threshold band mismatch");
  assert(snapshot?.thresholdValueCount === 2, "input context threshold value count mismatch");
  assert(snapshot?.thresholdValueCoverageBand === "complete", "input context threshold value coverage band mismatch");
  assert(snapshot?.thresholdDirection === null, "input context threshold direction mismatch");
  assert(snapshot?.thresholdDirectionBand === "missing", "input context threshold direction band mismatch");
  assert(snapshot?.hasCondition === true, "input context condition flag mismatch");
  assert(snapshot?.conditionLength === 3, "input context condition length mismatch");
  assert(snapshot?.conditionLengthBand === "thin", "input context condition length band mismatch");
  assert(snapshot?.hasConditionResolutionCriteria === true, "input context condition criteria flag mismatch");
  assert(snapshot?.conditionResolutionCriteriaLength === 6, "input context condition criteria length mismatch");
  assert(snapshot?.conditionResolutionCriteriaLengthBand === "adequate", "input context condition criteria length band mismatch");
  assert(snapshot?.conditionCriteriaBand === "condition_with_criteria", "input context condition criteria band mismatch");
  assert(snapshot?.hasUnit === true, "input context unit flag mismatch");
  assert(snapshot?.unit === "units", "input context unit mismatch");
  assert(snapshot?.unitSpecificityBand === "generic", "input context unit specificity band mismatch");
  assert(snapshot?.contextCompleteness === 13, "input context completeness mismatch");
  assert(snapshot?.contextCompletenessBand === "rich", "input context completeness band mismatch");
  assert(contextCompletenessScore({
    hasRequestedForecastType: true,
    hasRoutedForecastType: true,
    hasRoutingConfidence: true,
    hasInputSource: true,
    hasResolutionCriteria: true,
    hasResolutionDate: true,
    hasEvidenceAsOfDate: true,
    hasBackground: true,
    hasMarketPrice: true,
    hasCategories: true,
    hasThresholds: true,
    hasCondition: true,
    hasConditionResolutionCriteria: true,
    hasUnit: true,
  }) === 14, "input context completeness score contract mismatch");
  assert(requestedRoutedTypeBand({
    requestedForecastType: "binary",
    routedForecastType: "binary",
  }) === "match", "input context requested/routed match contract mismatch");
  assert(requestedRoutedTypeBand({
    requestedForecastType: "binary",
    routedForecastType: "date",
  }) === "mismatch", "input context requested/routed mismatch contract mismatch");

  const fallbackSnapshot = readForecastInputContextSnapshot({
    prompt: "Will this launch happen?",
  });
  assert(fallbackSnapshot?.questionLength === 4, "legacy prompt input context fallback mismatch");
  assert(fallbackSnapshot?.contextCompletenessBand === "sparse", "legacy prompt context completeness mismatch");
  const conditionOnlySnapshot = readForecastInputContextSnapshot({
    question: "Will adoption increase if the policy passes?",
    condition: "The policy passes.",
  });
  assert(conditionOnlySnapshot?.conditionCriteriaBand === "condition_only", "condition-only input context band mismatch");
  const persistedSnapshot = readForecastInputContextSnapshot({ inputContext: snapshot });
  assert(persistedSnapshot?.contextCompletenessBand === "rich", "persisted input context snapshot was not readable");
  assert(persistedSnapshot?.requestedForecastTypeBand === "unspecified", "persisted input context requested forecast type band mismatch");
  assert(persistedSnapshot?.routedForecastTypeBand === "specified", "persisted input context routed forecast type band mismatch");
  assert(persistedSnapshot?.requestedRoutedTypeBand === "routed_only", "persisted input context requested/routed band mismatch");
  assert(persistedSnapshot?.routingConfidenceBand === "medium", "persisted input context routing confidence band mismatch");
  assert(persistedSnapshot?.inputSourceBand === "ui", "persisted input context source band mismatch");
  assert(persistedSnapshot?.evidenceAsOfDateBand === "specified", "persisted input context evidence as-of band mismatch");
  assert(persistedSnapshot?.resolutionCriteriaLengthBand === "thin", "persisted input context resolution criteria length band mismatch");
  assert(persistedSnapshot?.backgroundLengthBand === "thin", "persisted input context background band mismatch");
  assert(persistedSnapshot?.marketPriceBand === "high", "persisted input context market band mismatch");
  assert(persistedSnapshot?.marketPriceAgeBand === "old", "persisted input context market age band mismatch");
  assert(persistedSnapshot?.marketCreationAgeBand === "established", "persisted input context market creation age band mismatch");
  assert(persistedSnapshot?.marketMetadataBand === "linked", "persisted input context market metadata band mismatch");
  assert(persistedSnapshot?.categoryCoverageBand === "open_set", "persisted input context category coverage band mismatch");
  assert(persistedSnapshot?.thresholdValueCoverageBand === "complete", "persisted input context threshold value coverage band mismatch");
  assert(persistedSnapshot?.thresholdDirectionBand === "missing", "persisted input context threshold direction band mismatch");
  assert(persistedSnapshot?.conditionCriteriaBand === "condition_with_criteria", "persisted input context condition criteria band mismatch");
  assert(persistedSnapshot?.conditionLengthBand === "thin", "persisted input context condition length band mismatch");
  assert(persistedSnapshot?.conditionResolutionCriteriaLengthBand === "adequate", "persisted input context condition criteria length band mismatch");
  assert(persistedSnapshot?.unitSpecificityBand === "generic", "persisted input context unit specificity band mismatch");
  assert(persistedSnapshot?.resolutionHorizonBand === "medium", "persisted input context horizon band mismatch");

  const runPlanSource = await readFile(resolve(root, "apps/web/src/app/api/runs/run-request.ts"), "utf8");
  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(runPlanSource.includes("forecastInput: smithersInput"), "run planner does not persist forecast input in task config");
  assert(resolutionSource.includes("readForecastInputContextSnapshot(task.configJson)"), "resolution scoring does not read input context from task config");
  assert(resolutionSource.includes("byInputRequestedForecastType"), "performance report does not group by requested forecast type");
  assert(resolutionSource.includes("context.requestedForecastType"), "attention queue does not use requested forecast type");
  assert(resolutionSource.includes("byInputRoutedForecastType"), "performance report does not group by routed forecast type");
  assert(resolutionSource.includes("context.routedForecastType"), "attention queue does not use routed forecast type");
  assert(resolutionSource.includes("byInputTypeAlignment"), "performance report does not group by requested/routed type alignment");
  assert(resolutionSource.includes("context.requestedRoutedTypeBand"), "attention queue does not use requested/routed type alignment");
  assert(resolutionSource.includes("byInputRoutingConfidence"), "performance report does not group by input routing confidence");
  assert(resolutionSource.includes("context.routingConfidenceBand"), "attention queue does not use input routing confidence");
  assert(resolutionSource.includes("byInputSource"), "performance report does not group by input source");
  assert(resolutionSource.includes("byInputContextCompleteness"), "performance report does not group by input context completeness");
  assert(resolutionSource.includes("byInputEvidenceAsOfDate"), "performance report does not group by input evidence as-of date");
  assert(resolutionSource.includes("context.hasEvidenceAsOfDate"), "attention queue does not use input evidence as-of date");
  assert(resolutionSource.includes("byInputResolutionCriteriaDepth"), "performance report does not group by input resolution criteria depth");
  assert(resolutionSource.includes("context.resolutionCriteriaLengthBand"), "attention queue does not use input resolution criteria depth");
  assert(resolutionSource.includes("byInputResolutionHorizon"), "performance report does not group by input resolution horizon");
  assert(resolutionSource.includes("context.resolutionHorizonBand"), "attention queue does not use input resolution horizon");
  assert(resolutionSource.includes("byInputBackgroundDepth"), "performance report does not group by input background depth");
  assert(resolutionSource.includes("context.backgroundLengthBand"), "attention queue does not use input background depth");
  assert(resolutionSource.includes("byInputMarketContext"), "performance report does not group by input market context");
  assert(resolutionSource.includes("byInputMarketRecency"), "performance report does not group by input market recency");
  assert(resolutionSource.includes("context.marketPriceAgeBand"), "attention queue does not use input market recency");
  assert(resolutionSource.includes("byInputMarketMetadata"), "performance report does not group by input market metadata");
  assert(resolutionSource.includes("byInputMarketCreationAge"), "performance report does not group by input market creation age");
  assert(resolutionSource.includes("context.marketMetadataBand"), "attention queue does not use input market metadata");
  assert(resolutionSource.includes("context.marketCreationAgeBand"), "attention queue does not use input market creation age");
  assert(resolutionSource.includes("byInputCategoryCount"), "performance report does not group by input category count");
  assert(resolutionSource.includes("byInputCategoryCoverage"), "performance report does not group by input category coverage");
  assert(resolutionSource.includes("context.categoryCoverageBand"), "attention queue does not use input category coverage");
  assert(resolutionSource.includes("byInputThresholdCount"), "performance report does not group by input threshold count");
  assert(resolutionSource.includes("byInputThresholdValueCoverage"), "performance report does not group by input threshold value coverage");
  assert(resolutionSource.includes("context.thresholdValueCoverageBand"), "attention queue does not use input threshold value coverage");
  assert(resolutionSource.includes("byInputThresholdDirection"), "performance report does not group by input threshold direction");
  assert(resolutionSource.includes("context.thresholdDirectionBand"), "attention queue does not use input threshold direction");
  assert(resolutionSource.includes("byInputConditionCriteria"), "performance report does not group by input condition criteria");
  assert(resolutionSource.includes("context.conditionCriteriaBand"), "attention queue does not use input condition criteria");
  assert(resolutionSource.includes("byInputConditionDepth"), "performance report does not group by input condition depth");
  assert(resolutionSource.includes("context.conditionLengthBand"), "attention queue does not use input condition depth");
  assert(resolutionSource.includes("byInputConditionCriteriaDepth"), "performance report does not group by input condition criteria depth");
  assert(resolutionSource.includes("context.conditionResolutionCriteriaLengthBand"), "attention queue does not use input condition criteria depth");
  assert(resolutionSource.includes("byInputUnitSpecificity"), "performance report does not group by input unit specificity");
  assert(resolutionSource.includes("context.unitSpecificityBand"), "attention queue does not use input unit specificity");
  assert(metricsSource.includes("open_superforecaster_input_context_scores_total"), "metrics missing input context score counts");
  assert(metricsSource.includes("requested_forecast_type_band"), "metrics missing requested forecast type labels");
  assert(metricsSource.includes("routed_forecast_type_band"), "metrics missing routed forecast type labels");
  assert(metricsSource.includes("requested_routed_type_band"), "metrics missing requested/routed type labels");
  assert(metricsSource.includes("routing_confidence_band"), "metrics missing input routing-confidence labels");
  assert(metricsSource.includes("input_source_band"), "metrics missing input source labels");
  assert(metricsSource.includes("evidence_as_of_date_band"), "metrics missing input evidence as-of labels");
  assert(metricsSource.includes("resolution_criteria_length_band"), "metrics missing input resolution-criteria labels");
  assert(metricsSource.includes("resolution_horizon_band"), "metrics missing input resolution-horizon labels");
  assert(metricsSource.includes("background_length_band"), "metrics missing input background-depth labels");
  assert(metricsSource.includes("market_price_age_band"), "metrics missing input market-recency labels");
  assert(metricsSource.includes("market_creation_age_band"), "metrics missing input market-creation labels");
  assert(metricsSource.includes("market_metadata_band"), "metrics missing input market-metadata labels");
  assert(metricsSource.includes("category_count_band"), "metrics missing input category-count labels");
  assert(metricsSource.includes("category_coverage_band"), "metrics missing input category-coverage labels");
  assert(metricsSource.includes("threshold_count_band"), "metrics missing input threshold-count labels");
  assert(metricsSource.includes("threshold_value_coverage_band"), "metrics missing input threshold-value labels");
  assert(metricsSource.includes("threshold_direction_band"), "metrics missing input threshold-direction labels");
  assert(metricsSource.includes("condition_criteria_band"), "metrics missing input condition-criteria labels");
  assert(metricsSource.includes("condition_length_band"), "metrics missing input condition-depth labels");
  assert(metricsSource.includes("condition_resolution_criteria_length_band"), "metrics missing input condition-criteria-depth labels");
  assert(metricsSource.includes("unit_specificity_band"), "metrics missing input unit-specificity labels");
  assert(syncSource.includes("input_context_completeness_band"), "DuckDB forecast score mart missing input context completeness band");
  assert(syncSource.includes("input_requested_forecast_type"), "DuckDB forecast score mart missing requested forecast type");
  assert(syncSource.includes("input_requested_forecast_type_band"), "DuckDB forecast score mart missing requested forecast type band");
  assert(syncSource.includes("input_routed_forecast_type"), "DuckDB forecast score mart missing routed forecast type");
  assert(syncSource.includes("input_routed_forecast_type_band"), "DuckDB forecast score mart missing routed forecast type band");
  assert(syncSource.includes("input_requested_routed_type_band"), "DuckDB forecast score mart missing requested/routed type band");
  assert(syncSource.includes("input_routing_confidence"), "DuckDB forecast score mart missing input routing confidence");
  assert(syncSource.includes("input_routing_confidence_band"), "DuckDB forecast score mart missing input routing confidence band");
  assert(syncSource.includes("input_source"), "DuckDB forecast score mart missing input source");
  assert(syncSource.includes("input_source_band"), "DuckDB forecast score mart missing input source band");
  assert(syncSource.includes("input_resolution_criteria_length"), "DuckDB forecast score mart missing input resolution criteria length");
  assert(syncSource.includes("input_resolution_criteria_length_band"), "DuckDB forecast score mart missing input resolution criteria length band");
  assert(syncSource.includes("input_has_evidence_as_of_date"), "DuckDB forecast score mart missing evidence as-of flag");
  assert(syncSource.includes("input_evidence_as_of_date_band"), "DuckDB forecast score mart missing evidence as-of band");
  assert(syncSource.includes("input_resolution_horizon_days"), "DuckDB forecast score mart missing input resolution horizon days");
  assert(syncSource.includes("input_resolution_horizon_band"), "DuckDB forecast score mart missing input resolution horizon band");
  assert(syncSource.includes("input_background_length"), "DuckDB forecast score mart missing input background length");
  assert(syncSource.includes("input_background_length_band"), "DuckDB forecast score mart missing input background length band");
  assert(syncSource.includes("input_market_price_age_days"), "DuckDB forecast score mart missing input market price age days");
  assert(syncSource.includes("input_market_price_age_band"), "DuckDB forecast score mart missing input market price age band");
  assert(syncSource.includes("input_market_url"), "DuckDB forecast score mart missing input market URL");
  assert(syncSource.includes("input_market_creation_age_days"), "DuckDB forecast score mart missing input market creation age days");
  assert(syncSource.includes("input_market_creation_age_band"), "DuckDB forecast score mart missing input market creation age band");
  assert(syncSource.includes("input_market_metadata_band"), "DuckDB forecast score mart missing input market metadata band");
  assert(syncSource.includes("input_category_count_band"), "DuckDB forecast score mart missing input category count band");
  assert(syncSource.includes("input_categories_exhaustive"), "DuckDB forecast score mart missing input categories exhaustive flag");
  assert(syncSource.includes("input_category_coverage_band"), "DuckDB forecast score mart missing input category coverage band");
  assert(syncSource.includes("input_threshold_count_band"), "DuckDB forecast score mart missing input threshold count band");
  assert(syncSource.includes("input_threshold_value_count"), "DuckDB forecast score mart missing input threshold value count");
  assert(syncSource.includes("input_threshold_value_coverage_band"), "DuckDB forecast score mart missing input threshold value coverage band");
  assert(syncSource.includes("input_threshold_direction"), "DuckDB forecast score mart missing input threshold direction");
  assert(syncSource.includes("input_threshold_direction_band"), "DuckDB forecast score mart missing input threshold direction band");
  assert(syncSource.includes("input_condition_criteria_band"), "DuckDB forecast score mart missing input condition criteria band");
  assert(syncSource.includes("input_condition_length_band"), "DuckDB forecast score mart missing input condition-depth band");
  assert(syncSource.includes("input_condition_resolution_criteria_length_band"), "DuckDB forecast score mart missing input condition-criteria-depth band");
  assert(syncSource.includes("input_unit"), "DuckDB forecast score mart missing input unit");
  assert(syncSource.includes("input_unit_specificity_band"), "DuckDB forecast score mart missing input unit specificity band");
  assert(syncSource.includes("input_has_resolution_criteria"), "DuckDB forecast score mart missing resolution criteria flag");
  assert(dashboardSource.includes("Input requested-type outcomes"), "lab dashboard does not render input requested type outcomes");
  assert(dashboardSource.includes("Input routed-type outcomes"), "lab dashboard does not render input routed type outcomes");
  assert(dashboardSource.includes("Input type-alignment outcomes"), "lab dashboard does not render input type-alignment outcomes");
  assert(dashboardSource.includes("Input routing-confidence outcomes"), "lab dashboard does not render input routing confidence outcomes");
  assert(dashboardSource.includes("Input source outcomes"), "lab dashboard does not render input source outcomes");
  assert(dashboardSource.includes("Input context outcomes"), "lab dashboard does not render input context outcomes");
  assert(dashboardSource.includes("Input evidence-as-of outcomes"), "lab dashboard does not render input evidence as-of outcomes");
  assert(dashboardSource.includes("Input resolution-criteria outcomes"), "lab dashboard does not render input resolution criteria outcomes");
  assert(dashboardSource.includes("Input horizon outcomes"), "lab dashboard does not render input horizon outcomes");
  assert(dashboardSource.includes("Input background outcomes"), "lab dashboard does not render input background outcomes");
  assert(dashboardSource.includes("Input market outcomes"), "lab dashboard does not render input market outcomes");
  assert(dashboardSource.includes("Input market-recency outcomes"), "lab dashboard does not render input market-recency outcomes");
  assert(dashboardSource.includes("Input market-metadata outcomes"), "lab dashboard does not render input market metadata outcomes");
  assert(dashboardSource.includes("Input market-creation outcomes"), "lab dashboard does not render input market creation outcomes");
  assert(dashboardSource.includes("Input category outcomes"), "lab dashboard does not render input category outcomes");
  assert(dashboardSource.includes("Input category-coverage outcomes"), "lab dashboard does not render input category coverage outcomes");
  assert(dashboardSource.includes("Input threshold outcomes"), "lab dashboard does not render input threshold outcomes");
  assert(dashboardSource.includes("Input threshold-value outcomes"), "lab dashboard does not render input threshold value outcomes");
  assert(dashboardSource.includes("Input threshold-direction outcomes"), "lab dashboard does not render input threshold direction outcomes");
  assert(dashboardSource.includes("Input condition-criteria outcomes"), "lab dashboard does not render input condition-criteria outcomes");
  assert(dashboardSource.includes("Input condition-depth outcomes"), "lab dashboard does not render input condition-depth outcomes");
  assert(dashboardSource.includes("Input condition-criteria-depth outcomes"), "lab dashboard does not render input condition-criteria-depth outcomes");
  assert(dashboardSource.includes("Input unit outcomes"), "lab dashboard does not render input unit outcomes");
  return "forecast input context is persisted and visible in resolved score analytics";
});

await check("forecast run metadata reaches resolved score analytics", async () => {
  const snapshot = readForecastRunSnapshot({
    workflowVersion: "abc123",
    workflowVariantId: "variant-1",
    experimentLabel: "holdout-a",
    startedAt: "2026-07-09T00:00:00.000Z",
    completedAt: "2026-07-09T00:12:30.000Z",
  });
  assert(snapshot?.workflowVersion === "abc123", "run metadata workflow version mismatch");
  assert(snapshot?.workflowVariantId === "variant-1", "run metadata workflow variant mismatch");
  assert(snapshot?.experimentLabel === "holdout-a", "run metadata experiment label mismatch");
  assert(snapshot?.durationSeconds === 750, "run metadata duration mismatch");
  assert(snapshot?.durationBand === "slow", "run metadata duration band mismatch");
  const persistedSnapshot = readForecastRunSnapshot({ runMetadata: snapshot });
  assert(persistedSnapshot?.durationBand === "slow", "persisted run metadata snapshot was not readable");
  assert(persistedSnapshot?.experimentLabel === "holdout-a", "persisted run metadata experiment mismatch");

  const resolutionSource = await readFile(resolve(root, "packages/backend/src/resolution-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(resolutionSource.includes("readForecastRunSnapshot(task)"), "resolution scoring does not persist run metadata from task rows");
  assert(resolutionSource.includes("byRunDuration"), "performance report does not group by run duration");
  assert(resolutionSource.includes("byRunWorkflowVersion"), "performance report does not group by workflow version");
  assert(resolutionSource.includes("byRunWorkflowVariant"), "performance report does not group by workflow variant");
  assert(resolutionSource.includes("byRunExperiment"), "performance report does not group by run experiment");
  assert(metricsSource.includes("open_superforecaster_run_metadata_scores_total"), "metrics missing run metadata score counts");
  assert(metricsSource.includes("workflow_version_status"), "metrics missing workflow version status labels");
  assert(metricsSource.includes("workflow_variant_status"), "metrics missing workflow variant status labels");
  assert(syncSource.includes("run_workflow_version"), "DuckDB forecast score mart missing workflow version");
  assert(syncSource.includes("run_workflow_variant_id"), "DuckDB forecast score mart missing workflow variant");
  assert(syncSource.includes("run_duration_band"), "DuckDB forecast score mart missing duration band");
  assert(dashboardSource.includes("Run duration outcomes"), "lab dashboard does not render run duration outcomes");
  assert(dashboardSource.includes("Run workflow-version outcomes"), "lab dashboard does not render run workflow-version outcomes");
  assert(dashboardSource.includes("Run workflow-variant outcomes"), "lab dashboard does not render run workflow-variant outcomes");
  assert(dashboardSource.includes("Run experiment outcomes"), "lab dashboard does not render run experiment outcomes");
  return "forecast run metadata is persisted and visible in resolved score analytics";
});

await check("binary aggregate quality metadata is visible before resolution", async () => {
  const reportSource = await readFile(resolve(root, "packages/backend/src/run-service.ts"), "utf8");
  const panelSource = await readFile(resolve(root, "apps/web/src/components/run-workspace/panels.tsx"), "utf8");
  assert(reportSource.includes("readAggregateQualitySnapshot(output)"), "run report quality summary does not use aggregate quality metadata reader");
  assert(reportSource.includes("aggregateQuality"), "run report quality payload missing aggregate quality");
  assert(reportSource.includes("readReportAggregateQuality"), "generated report Markdown missing aggregate quality renderer");
  assert(reportSource.includes("## Uncertainty"), "run report Markdown shape changed unexpectedly");
  assert(reportSource.includes("Aggregate quality"), "run report Markdown missing aggregate quality section label");
  assert(panelSource.includes("aggregate quality"), "run workspace does not render aggregate quality");
  assert(panelSource.includes("readAggregateQualityRecord"), "run workspace does not normalize raw aggregate quality metadata");
  assert(panelSource.includes("finalReviewRationale"), "run workspace does not render final review rationale");
  assert(panelSource.includes("qualityIssues"), "run workspace does not count raw quality issues");
  return "binary aggregate quality metadata is visible in run reports before resolution";
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
    sourceQualityFindings: { sourceLeakageCases: 1, informationAdvantageCases: 1, dominantSourceDomainCases: 1, lowQualityFinalSourceEntries: 1 },
    traceQualityFindings: { weakTraceCompletenessCases: 1, missingProbabilityCases: 1, missingScoreRowsCases: 1, missingAggregateRationaleCases: 1 },
  });
  assert(qualityBlocked.status === "needs_more_evidence", "analysis quality findings should block promotion review");
  assert(qualityBlocked.blockers.includes("missing_baseline_sanity"), "baseline sanity blocker missing");
  assert(qualityBlocked.blockers.includes("unexplained_component_disagreement"), "component disagreement blocker missing");
  assert(qualityBlocked.blockers.includes("large_probability_misses"), "large miss blocker missing");
  assert(qualityBlocked.blockers.includes("worse_than_baseline_cases"), "worse-than-baseline blocker missing");
  assert(qualityBlocked.blockers.includes("source_cutoff_leakage"), "source cutoff leakage blocker missing");
  assert(qualityBlocked.blockers.includes("human_forecast_leakage"), "human forecast leakage blocker missing");
  assert(qualityBlocked.blockers.includes("source_concentration"), "source concentration blocker missing");
  assert(qualityBlocked.blockers.includes("low_quality_sources"), "low-quality source blocker missing");
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

await check("benchmark analysis summarizes measured cost findings", async () => {
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(backendSource.includes("costLatencyFindingsForRun"), "benchmark analysis does not build measured cost/latency findings");
  assert(backendSource.includes("readSmithersTokenUsage"), "benchmark cost analysis does not use the shared durable-log parser");
  assert(backendSource.includes("summarizeSmithersTokenUsage"), "benchmark cost analysis does not use the shared token summary reducer");
  assert(backendSource.includes("totalAgentCalls"), "benchmark cost analysis missing total agent calls");
  assert(backendSource.includes("medianTokensPerMeasuredCase"), "benchmark cost analysis missing median token summary");
  assert(backendSource.includes("heaviestCases"), "benchmark cost analysis missing heaviest case list");
  assert(backendSource.includes("benchmarkCostOutlierEvidence"), "benchmark proposal generator does not derive cost outlier evidence");
  assert(backendSource.includes("costLatencyFindings: input.costLatencyFindings"), "benchmark improvement preview does not pass cost findings into proposals");
  assert(backendSource.includes("costLatencyFindings,") && backendSource.includes("workflowChangeProposalsForAnalysis({"), "benchmark proposal generator does not receive cost/latency findings");
  assert(backendSource.includes("heaviest/slowest outlier lists"), "benchmark cost proposal validation does not mention outlier lists");
  assert(backendSource.includes("costLatencyFindings,"), "benchmark list rows do not expose cost/latency findings");
  assert(metricsSource.includes("costLatencyFindings"), "metrics exporter does not read benchmark cost/latency findings");
  assert(metricsSource.includes("open_superforecaster_benchmark_cost_summary_present"), "benchmark cost summary-present metric missing");
  assert(metricsSource.includes("open_superforecaster_benchmark_cost_agent_calls_total"), "benchmark cost agent-call metric missing");
  assert(metricsSource.includes("open_superforecaster_benchmark_cost_token_total"), "benchmark cost token metric missing");
  assert(metricsSource.includes("open_superforecaster_benchmark_cost_tokens_by_status"), "benchmark cost status metric missing");
  assert(metricsSource.includes("emitBenchmarkCostOutlierMetrics"), "benchmark cost outlier metrics helper missing");
  assert(metricsSource.includes("open_superforecaster_benchmark_cost_outlier_tokens"), "benchmark cost outlier token metric missing");
  assert(metricsSource.includes("open_superforecaster_benchmark_cost_outlier_duration_seconds"), "benchmark cost outlier duration metric missing");
  assert(metricsSource.includes("open_superforecaster_benchmark_cost_outlier_agent_calls"), "benchmark cost outlier agent-call metric missing");
  assert(metricsSource.includes("outlier_rank"), "benchmark cost outlier metrics missing rank label");
  assert(metricsSource.includes("benchmark_case_result_id"), "benchmark cost outlier metrics missing case result label");
  assert(dashboardSource.includes("costLatencyFindings"), "lab dashboard does not read benchmark cost/latency findings");
  assert(dashboardSource.includes("cost {formatCount"), "lab dashboard does not surface benchmark cost summaries");
  assert(dashboardSource.includes("heaviestCases"), "lab dashboard does not read heaviest benchmark cost cases");
  assert(dashboardSource.includes("slowestCases"), "lab dashboard does not read slowest benchmark cost cases");
  assert(dashboardSource.includes("BenchmarkCostOutlierSummary"), "lab dashboard does not render benchmark cost outlier summaries");
  assert(dashboardSource.includes("Heaviest cost cases"), "lab dashboard does not label heaviest benchmark cost cases");
  assert(dashboardSource.includes("Slowest cost cases"), "lab dashboard does not label slowest benchmark cost cases");
  return "benchmark analysis, metrics, and lab dashboard expose measured cost findings";
});

await check("benchmark promotion blocks source independence failures", async () => {
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const promotionPolicySource = await readFile(resolve(root, "packages/backend/src/benchmark-promotion-policy.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  const smokeSource = await readFile(resolve(root, "scripts/smoke-check.ts"), "utf8");
  assert(backendSource.includes("sourceQualityFindings"), "benchmark promotion gate does not read source quality findings");
  assert(promotionPolicySource.includes("source_cutoff_leakage"), "source cutoff leakage blocker missing");
  assert(promotionPolicySource.includes("human_forecast_leakage"), "human forecast leakage blocker missing");
  assert(promotionPolicySource.includes("source_concentration"), "source concentration blocker missing");
  assert(promotionPolicySource.includes("low_quality_sources"), "low-quality source blocker missing");
  assert(backendSource.includes("blockerSourceCutoffLeakage") && backendSource.includes("blockerHumanForecastLeakage"), "benchmark gate does not use shared source-risk blockers");
  assert(backendSource.includes("summarizeSourceDomainCounts"), "benchmark source audit does not reuse the shared source-domain reducer");
  assert(backendSource.includes("./source-domain-summary"), "benchmark source audit does not import shared source-domain utilities");
  assert(!backendSource.includes("function sourceDomainCountsForAudit"), "benchmark source audit should not keep a local source-domain reducer");
  assert(backendSource.includes("dominantSourceDomainCases"), "benchmark source quality findings missing dominant-domain case count");
  assert(backendSource.includes("lowQualitySourceEntries"), "benchmark source quality findings missing low-quality source count");
  assert(backendSource.includes("lowQualityFinalSourceEntries"), "benchmark source quality findings missing final-use low-quality source count");
  assert(metricsSource.includes("sourceQualityFindings"), "metrics promotion gate does not read source quality findings");
  assert(metricsSource.includes("emitBenchmarkSourceQualityMetrics"), "metrics exporter does not emit benchmark source-quality risk gauges");
  assert(metricsSource.includes("open_superforecaster_benchmark_source_top_domain_share"), "metrics exporter missing benchmark top source-domain share");
  assert(metricsSource.includes("open_superforecaster_benchmark_source_low_quality_final_entries"), "metrics exporter missing benchmark final-use low-quality source count");
  assert(dashboardSource.includes("source quality"), "lab dashboard does not surface source quality findings");
  assert(dashboardSource.includes("dominantSourceDomainCases"), "lab dashboard does not surface dominant source-domain cases");
  assert(dashboardSource.includes("lowQualityFinalSourceEntries"), "lab dashboard does not surface final-use low-quality source count");
  assert(smokeSource.includes("assertSourceRiskFindings"), "smoke check does not validate source-risk blocker findings");
  assert(smokeSource.includes("source_concentration") && smokeSource.includes("low_quality_sources"), "smoke check does not preserve source-risk blocker names");
  assert(smokeSource.includes("dominantSourceDomainCases") && smokeSource.includes("lowQualityFinalSourceEntries"), "smoke check does not require source-risk finding counts");
  return "source leakage and human forecast leakage block benchmark promotion";
});

await check("benchmark promotion blocks trace and schema failures", async () => {
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const promotionPolicySource = await readFile(resolve(root, "packages/backend/src/benchmark-promotion-policy.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(backendSource.includes("traceQualityFindings"), "benchmark promotion gate does not read trace quality findings");
  assert(backendSource.includes("missingScoreRowsCases"), "trace quality summary does not count missing score rows");
  assert(backendSource.includes("missingAggregateRationaleCases"), "trace quality summary does not count missing rationale");
  assert(promotionPolicySource.includes("schema_or_scoring_failures"), "schema/scoring blocker missing");
  assert(backendSource.includes("blockerSchemaOrScoringFailures"), "benchmark gate does not use shared schema/scoring blocker");
  assert(metricsSource.includes("traceQualityFindings"), "metrics promotion gate does not read trace quality findings");
  assert(dashboardSource.includes("trace quality"), "lab dashboard does not surface trace quality findings");
  return "trace completeness, schema, scoring, and rationale failures block benchmark promotion";
});

await check("benchmark promotion requires held-out case evidence", async () => {
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const promotionPolicySource = await readFile(resolve(root, "packages/backend/src/benchmark-promotion-policy.ts"), "utf8");
  const importerSource = await readFile(resolve(root, "packages/backend/src/btf2-importer.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(backendSource.includes("benchmarkSplitSummaryForResults"), "benchmark split summary helper missing");
  assert(backendSource.includes("pairedHoldoutCaseCount"), "paired comparison does not count held-out cases");
  assert(backendSource.includes("needs_holdout_evidence"), "comparison recommendation does not require holdout evidence");
  assert(importerSource.includes('split: "test"'), "BTF import does not persist dataset split metadata");
  assert(dashboardSource.includes("holdout evidence"), "lab dashboard does not surface holdout evidence");
  for (const splitId of benchmarkHoldoutSplitIds) {
    assert(promotionPolicySource.includes(splitId), `benchmark holdout split ${splitId} missing from backend contract`);
  }
  assert(backendSource.includes("benchmarkHoldoutSplitIds"), "benchmark split evaluation does not use shared holdout split policy");
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
  assert(backendSource.includes("primaryBaselinePairedCaseCount"), "comparison recommendation does not report primary paired case count");
  assert(backendSource.includes("primaryBaselinePairedHoldoutCaseCount"), "comparison recommendation does not report primary paired holdout count");
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
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const metricsSource = await readFile(resolve(root, "packages/backend/src/metrics-service.ts"), "utf8");
  const backendIndexSource = await readFile(resolve(root, "packages/backend/src/index.ts"), "utf8");
  const smokeSource = await readFile(resolve(root, "scripts/smoke-check.ts"), "utf8");
  assert(metricsSource.includes("open_superforecaster_benchmark_promotion_gate_status"), "promotion gate status metric missing");
  assert(metricsSource.includes("open_superforecaster_benchmark_promotion_gate_blocker"), "promotion gate blocker metric missing");
  assert(metricsSource.includes("summarizeBenchmarkPromotionGateEvidence"), "metrics exporter does not use shared promotion gate helper");
  assert(metricsSource.includes("summarizeBenchmarkCaseResultStatuses"), "metrics exporter does not use shared benchmark case result status counts");
  assert(backendSource.includes("summarizeBenchmarkCaseResultStatuses"), "benchmark service does not use shared benchmark case result status counts");
  assert(backendSource.includes("isBenchmarkCaseResultPendingStatus"), "benchmark service does not use shared benchmark case pending status policy");
  assert(backendIndexSource.includes("benchmark-case-result-policy"), "backend package barrel does not export benchmark case result policy");
  assert(smokeSource.includes("open_superforecaster_benchmark_promotion_gate_status"), "smoke check does not require promotion gate status metric");
  assert(smokeSource.includes("open_superforecaster_benchmark_cost_summary_present"), "smoke check does not require benchmark cost summary presence metric");
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
  assert(metricsSource.includes("validation_primary_paired_case_count"), "workflow proposal metric missing validation recommendation paired case label");
  assert(metricsSource.includes("validation_primary_paired_holdout_case_count"), "workflow proposal metric missing validation recommendation paired holdout label");
  assert(metricsSource.includes("validation_result_status"), "workflow proposal metric missing validation result status");
  assert(metricsSource.includes("validation_gate_status"), "workflow proposal metric missing validation gate status");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposal_validation_completed_cases"), "workflow proposal metric missing validation completed cases");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposal_validation_coverage_ratio"), "workflow proposal metric missing validation coverage ratio");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposal_validation_passed"), "workflow proposal metric missing validation pass state");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposal_validation_blocker"), "workflow proposal metric missing per-proposal validation blockers");
  assert(metricsSource.includes("for (const blocker of validationReadiness.blockers)"), "workflow proposal blocker metric does not reuse computed validation readiness blockers");
  assert(metricsSource.includes("workflowProposalReadinessRows"), "workflow proposal metrics do not share computed readiness rows");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposal_readiness_active"), "workflow proposal metric missing active readiness count");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposal_readiness_blocked"), "workflow proposal metric missing blocked readiness count");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposal_readiness_validated"), "workflow proposal metric missing validated readiness count");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposal_readiness_blocker"), "workflow proposal metric missing readiness blocker counts");
  assert(metricsSource.includes("workflowProposalValidationCoverage"), "workflow proposal metric does not reuse shared validation coverage helper");
  assert(metricsSource.includes("workflowProposalValidationReadiness"), "workflow proposal metric does not reuse shared validation readiness helper");
  assert(smokeSource.includes("open_superforecaster_workflow_change_proposal_readiness_blocked"), "smoke check does not require aggregate proposal readiness metrics");
  assert(smokeSource.includes("open_superforecaster_workflow_change_proposal_validation_blocker"), "smoke check does not require per-proposal readiness blocker metrics");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposal_validation_cost_total_tokens_delta"), "workflow proposal metric missing validation token cost delta");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposal_validation_cost_agent_calls_delta"), "workflow proposal metric missing validation agent-call delta");
  assert(metricsSource.includes("open_superforecaster_workflow_change_proposal_validation_cost_mean_duration_seconds_delta"), "workflow proposal metric missing validation duration delta");
  assert(metricsSource.includes("reviewed_by"), "workflow proposal metric missing reviewer label");
  assert(metricsSource.includes("source_benchmark_run_id"), "workflow proposal metric missing source benchmark label");
  assert(smokeSource.includes("open_superforecaster_workflow_change_proposals_total"), "smoke check does not require workflow proposal metric");
  return "workflow proposal lifecycle state is visible in Prometheus metrics";
});

await check("benchmark promotion gate blockers are exported to DuckDB", async () => {
  const syncSource = await readFile(resolve(root, "scripts/sync-duckdb.ts"), "utf8");
  assert(syncSource.includes("../packages/backend/src/benchmark-promotion-policy"), "DuckDB sync does not import shared benchmark promotion policy");
  assert(syncSource.includes("../packages/backend/src/benchmark-case-result-policy"), "DuckDB sync does not import shared benchmark case result policy");
  assert(syncSource.includes("minimumPromotionResultCases"), "DuckDB sync does not use shared minimum result case policy");
  assert(syncSource.includes("minimumPromotionHoldoutCases"), "DuckDB sync does not use shared minimum holdout case policy");
  assert(syncSource.includes("benchmarkPromotionGateStatusReview"), "DuckDB sync does not use shared promotion review status");
  assert(syncSource.includes("benchmarkPromotionGateStatusNeedsMoreEvidence"), "DuckDB sync does not use shared promotion blocked status");
  assert(syncSource.includes("promotion_gate_status"), "DuckDB benchmark run mart missing promotion gate status");
  assert(syncSource.includes("promotion_gate_blockers"), "DuckDB benchmark run mart missing promotion gate blockers");
  assert(syncSource.includes("benchmarkCaseResultStatusFailed") && syncSource.includes("benchmarkCaseResultStatusNeedsReview"), "DuckDB promotion gate review/fail count does not use shared benchmark case result statuses");
  assert(syncSource.includes("missing_baseline_sanity_cases"), "DuckDB benchmark run mart missing baseline sanity count");
  assert(syncSource.includes("unexplained_component_disagreement_cases"), "DuckDB benchmark run mart missing component disagreement count");
  assert(syncSource.includes("large_probability_miss_cases"), "DuckDB benchmark run mart missing large miss count");
  assert(syncSource.includes("worse_than_baseline_cases"), "DuckDB benchmark run mart missing worse-than-baseline count");
  assert(syncSource.includes("holdout_case_results"), "DuckDB benchmark run mart missing holdout evidence count");
  assert(syncSource.includes("required_holdout_case_results"), "DuckDB benchmark run mart missing required holdout evidence count");
  assert(syncSource.includes("source_leakage_cases"), "DuckDB benchmark run mart missing source leakage count");
  assert(syncSource.includes("information_advantage_cases"), "DuckDB benchmark run mart missing information advantage count");
  assert(syncSource.includes("human_forecast_source_cases"), "DuckDB benchmark run mart missing human forecast source count");
  assert(syncSource.includes("dominant_source_domain_cases"), "DuckDB benchmark run mart missing dominant source-domain case count");
  assert(syncSource.includes("top_source_domain_share"), "DuckDB benchmark run mart missing top source-domain share");
  assert(syncSource.includes("low_quality_source_entries"), "DuckDB benchmark run mart missing low-quality source entries");
  assert(syncSource.includes("low_quality_final_source_entries"), "DuckDB benchmark run mart missing final-use low-quality source entries");
  assert(syncSource.includes("blockerSourceConcentration"), "DuckDB promotion gate export missing source concentration blocker");
  assert(syncSource.includes("blockerLowQualitySources"), "DuckDB promotion gate export missing low-quality source blocker");
  assert(syncSource.includes("weak_trace_completeness_cases"), "DuckDB benchmark run mart missing weak trace count");
  assert(syncSource.includes("missing_probability_cases"), "DuckDB benchmark run mart missing missing probability count");
  assert(syncSource.includes("missing_score_rows_cases"), "DuckDB benchmark run mart missing missing score rows count");
  assert(syncSource.includes("missing_aggregate_rationale_cases"), "DuckDB benchmark run mart missing missing rationale count");
  assert(syncSource.includes("cost_measured_cases"), "DuckDB benchmark run mart missing cost measured case count");
  assert(syncSource.includes("cost_missing_usage_cases"), "DuckDB benchmark run mart missing missing cost usage count");
  assert(syncSource.includes("cost_agent_calls"), "DuckDB benchmark run mart missing cost agent calls");
  assert(syncSource.includes("cost_total_tokens"), "DuckDB benchmark run mart missing total token cost");
  assert(syncSource.includes("cost_mean_duration_seconds"), "DuckDB benchmark run mart missing mean duration cost");
  assert(syncSource.includes("costLatencyFindings,totalTokens"), "DuckDB benchmark run mart does not read cost findings from analysis artifact");
  assert(syncSource.includes("osf_benchmark_cost_status"), "DuckDB sync missing benchmark cost status mart");
  assert(syncSource.includes("costLatencyFindings,byStatus"), "DuckDB benchmark cost status mart does not read by-status cost findings");
  assert(syncSource.includes("case_status"), "DuckDB benchmark cost status mart missing case status");
  assert(syncSource.includes("mean_tokens_per_measured_case"), "DuckDB benchmark cost status mart missing status-level token mean");
  assert(syncSource.includes("mean_duration_seconds"), "DuckDB benchmark cost status mart missing status-level duration mean");
  assert(syncSource.includes("osf_benchmark_cost_outliers"), "DuckDB sync missing benchmark cost outlier mart");
  assert(syncSource.includes("costLatencyFindings,heaviestCases"), "DuckDB benchmark cost outlier mart does not read heaviest cases");
  assert(syncSource.includes("costLatencyFindings,slowestCases"), "DuckDB benchmark cost outlier mart does not read slowest cases");
  assert(syncSource.includes("outlier_kind"), "DuckDB benchmark cost outlier mart missing outlier kind");
  assert(syncSource.includes("outlier_rank"), "DuckDB benchmark cost outlier mart missing outlier rank");
  assert(syncSource.includes("benchmark_case_result_id"), "DuckDB benchmark cost outlier mart missing case result id");
  assert(syncSource.includes("paired_mean_brier_delta, cost_total_tokens"), "DuckDB benchmark examples do not join benchmark quality and cost columns");
  assert(syncSource.includes("from osf_benchmark_cost_status"), "DuckDB examples do not show status-level benchmark cost queries");
  assert(syncSource.includes("from osf_benchmark_cost_outliers"), "DuckDB examples do not show benchmark cost outlier queries");
  for (const blockerId of benchmarkPromotionGateBlockerIds) {
    const constName = blockerId.replace(/(^|_)([a-z])/g, (_match, _separator, letter: string) => letter.toUpperCase());
    assert(syncSource.includes(`blocker${constName}`), `DuckDB promotion gate export missing blocker ${blockerId}`);
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
  assert(syncSource.includes("validation_cost_total_tokens_delta"), "workflow proposal mart missing validation total-token delta");
  assert(syncSource.includes("validation_cost_agent_calls_delta"), "workflow proposal mart missing validation agent-call delta");
  assert(syncSource.includes("validation_cost_mean_duration_seconds_delta"), "workflow proposal mart missing validation duration delta");
  assert(syncSource.includes("validation_cost_summary"), "workflow proposal mart missing validation cost summary");
  assert(syncSource.includes("validation_completed_cases"), "workflow proposal mart missing validation completed case count");
  assert(syncSource.includes("source_benchmark_case_count"), "workflow proposal mart missing source benchmark case count");
  assert(syncSource.includes("validation_required_cases"), "workflow proposal mart missing required validation case count");
  assert(syncSource.includes("validation_coverage_ratio"), "workflow proposal mart missing validation coverage ratio");
  assert(syncSource.includes("validation_passed"), "workflow proposal mart missing validation pass state");
  assert(syncSource.includes("validation_readiness_blockers_json"), "workflow proposal mart missing validation readiness blockers");
  assert(syncSource.includes("validation_readiness_blockers.blockers_json::text"), "workflow proposal mart does not export shared readiness blockers");
  assert(syncSource.includes("jsonb_array_length(validation_readiness_blockers.blockers_json) = 0"), "workflow proposal mart pass state is not derived from readiness blockers");
  assert(syncSource.includes("wcp.validation_completed_cases is null") && syncSource.includes("wcp.validation_completed_cases::double precision"), "workflow proposal mart missing validation coverage ratio");
  assert(syncSource.includes("coalesce(wcp.validation_completed_cases, 0) >= greatest(coalesce(sbr.case_count, 1), 1)"), "workflow proposal mart pass state does not require source-sized coverage");
  assert(syncSource.includes("vcr.row_json #>> '{recommendation,status}' = 'candidate_better'"), "workflow proposal mart pass state does not require better validation comparison");
  assert(syncSource.includes("primaryBaselinePairedCaseCount}', '')::integer, 0) >= ${minimumPromotionPairedCases}"), "workflow proposal mart pass state does not require primary paired cases");
  assert(syncSource.includes("primaryBaselinePairedHoldoutCaseCount}', '')::integer, 0) >= ${minimumPromotionHoldoutCases}"), "workflow proposal mart pass state does not require primary paired holdout cases");
  for (const blockerId of workflowProposalValidationReadinessBlockerIds) {
    const constName = blockerId.replace(/(^|_)([a-z])/g, (_match, _separator, letter: string) => letter.toUpperCase());
    assert(syncSource.includes(`blocker${constName}`), `workflow proposal mart does not use shared readiness blocker ${blockerId}`);
  }
  assert(syncSource.includes("validation_gate_status"), "workflow proposal mart missing validation gate status");
  assert(syncSource.includes("validation_gate_blockers_json"), "workflow proposal mart missing validation gate blockers");
  assert(syncSource.includes("validation_comparison_report_artifact_id"), "workflow proposal mart missing validation comparison artifact id");
  assert(syncSource.includes("validation_recommendation_status"), "workflow proposal mart missing validation recommendation status");
  assert(syncSource.includes("validation_recommendation_paired_case_count"), "workflow proposal mart missing validation recommendation paired case count");
  assert(syncSource.includes("validation_recommendation_paired_holdout_case_count"), "workflow proposal mart missing validation recommendation paired holdout count");
  assert(syncSource.includes("validation_primary_baseline_benchmark_run_id"), "workflow proposal mart missing validation primary baseline id");
  assert(syncSource.includes("validation_paired_mean_brier_delta"), "workflow proposal mart missing validation paired Brier delta");
  assert(syncSource.includes("validation_paired_brier_ci_lower"), "workflow proposal mart missing validation paired uncertainty interval");
  return "benchmark-derived workflow proposals are visible in local DuckDB analytics";
});

await check("workflow change proposals are visible in the lab dashboard", async () => {
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const dashboardSource = await readFile(resolve(root, "apps/web/src/components/lab-dashboard/panels.tsx"), "utf8");
  assert(backendSource.includes("workflowChangeProposalWithValidationReadiness"), "backend does not enrich workflow proposals with shared validation readiness");
  assert(backendSource.includes("validationReadiness: workflowProposalValidationReadiness"), "backend proposal read model does not use shared validation readiness helper");
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
  assert(dashboardSource.includes("validationCostTotalTokensDelta"), "lab dashboard proposal section missing validation token cost delta");
  assert(dashboardSource.includes("validationCostAgentCallsDelta"), "lab dashboard proposal section missing validation agent-call delta");
  assert(dashboardSource.includes("validationCostMeanDurationSecondsDelta"), "lab dashboard proposal section missing validation duration delta");
  assert(dashboardSource.includes("validationCostSummary"), "lab dashboard proposal section missing validation cost summary");
  assert(dashboardSource.includes("validationComparisonReport"), "lab dashboard proposal section missing validation comparison report");
  assert(dashboardSource.includes("validationRecommendationStatus"), "lab dashboard proposal section missing validation recommendation status");
  assert(dashboardSource.includes("validationPairedMeanBrierDelta"), "lab dashboard proposal section missing validation paired Brier delta");
  assert(dashboardSource.includes("validationPrimaryPairedCaseCount"), "lab dashboard proposal section missing validation paired case count");
  assert(dashboardSource.includes("validationPrimaryPairedHoldoutCaseCount"), "lab dashboard proposal section missing validation paired holdout count");
  assert(dashboardSource.includes("validationGateStatus"), "lab dashboard proposal section missing validation gate status");
  assert(dashboardSource.includes("validationGateBlockers"), "lab dashboard proposal section missing validation gate blockers");
  assert(dashboardSource.includes("canMarkImplemented"), "lab dashboard does not gate implemented action on validation result");
  assert(dashboardSource.includes("proposal.validationReadiness"), "lab dashboard does not consume backend proposal validation readiness");
  assert(dashboardSource.includes("validationReadinessBlockers"), "lab dashboard does not explain blocked implementation readiness");
  assert(dashboardSource.includes("implementation blocked"), "lab dashboard does not render implementation readiness blockers");
  assert(dashboardSource.includes("validationReadiness?.passed === true"), "lab dashboard does not gate implemented action on backend validation readiness");
  assert(!dashboardSource.includes("const requiredValidationPairedCases = 10"), "lab dashboard should not hardcode paired validation thresholds");
  assert(!dashboardSource.includes("hasPrimaryPairedEvidence"), "lab dashboard should not duplicate backend paired evidence readiness logic");
  assert(!dashboardSource.includes("hasPrimaryPairedHoldoutEvidence"), "lab dashboard should not duplicate backend holdout evidence readiness logic");
  return "benchmark-derived workflow proposals are visible where promotion blockers are reviewed";
});

await check("workflow change proposal lifecycle is auditable", async () => {
  const schemaSource = await readFile(resolve(root, "packages/db/src/schema.ts"), "utf8");
  const backendSource = await readFile(resolve(root, "packages/backend/src/benchmark-service.ts"), "utf8");
  const workflowProposalPolicySource = await readFile(resolve(root, "packages/backend/src/workflow-proposal-policy.ts"), "utf8");
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
  assert(schemaSource.includes("validationCostTotalTokensDelta: doublePrecision(\"validation_cost_total_tokens_delta\")"), "workflow proposal schema missing validation token cost delta");
  assert(schemaSource.includes("validationCostAgentCallsDelta: doublePrecision(\"validation_cost_agent_calls_delta\")"), "workflow proposal schema missing validation agent-call delta");
  assert(schemaSource.includes("validationCostMeanDurationSecondsDelta: doublePrecision(\"validation_cost_mean_duration_seconds_delta\")"), "workflow proposal schema missing validation duration delta");
  assert(schemaSource.includes("validationCostSummary: text(\"validation_cost_summary\")"), "workflow proposal schema missing validation cost summary");
  assert(schemaSource.includes("validationGateStatus: text(\"validation_gate_status\")"), "workflow proposal schema missing validation gate status");
  assert(schemaSource.includes("validationGateBlockers: jsonb(\"validation_gate_blockers\")"), "workflow proposal schema missing validation gate blockers");
  assert(workflowProposalPolicySource.includes("workflowChangeProposalStatuses"), "backend missing shared workflow proposal status set");
  assert(workflowProposalPolicySource.includes("workflowChangeProposalImplementationStatuses"), "backend missing shared implementation status set");
  assert(backendSource.includes("from \"./workflow-proposal-policy\""), "backend does not import shared workflow proposal policy");
  for (const status of workflowChangeProposalStatuses) {
    assert(workflowProposalPolicySource.includes(`"${status}"`), `backend missing workflow proposal status ${status}`);
  }
  for (const status of workflowChangeProposalImplementationStatuses) {
    assert(workflowProposalPolicySource.includes(`"${status}"`), `backend missing workflow proposal implementation status ${status}`);
  }
  assert(backendSource.includes("updateWorkflowChangeProposalStatus"), "backend missing workflow proposal lifecycle function");
  assert(backendSource.includes("eq(workflowChangeProposals.sourceBenchmarkRunId, input.benchmarkRunId)"), "proposal update does not verify benchmark ownership");
  assert(backendSource.includes("assertWorkflowChangeProposalStatusTransitionAllowed"), "backend missing workflow proposal transition guard");
  assert(backendSource.includes("assertWorkflowChangeProposalImplementationStatusAllowed"), "backend missing workflow proposal implementation status guard");
  assert(backendSource.includes("validationResultStatus !== \"completed\""), "backend implemented transition does not require completed validation");
  assert(backendSource.includes("validationGateStatus !== benchmarkPromotionGateStatusReview"), "backend implemented transition does not require a passing validation gate");
  assert(backendSource.includes("workflowProposalValidationGatePassed"), "backend missing shared validation gate pass helper");
  assert(backendSource.includes("workflowProposalValidationReadiness"), "backend missing shared validation readiness helper");
  assert(backendSource.includes("workflowProposalValidationPrimaryEvidence"), "backend missing primary paired validation evidence helper");
  for (const blockerId of workflowProposalValidationReadinessBlockerIds) {
    assert(workflowProposalPolicySource.includes(`"${blockerId}"`), `workflow proposal policy missing readiness blocker ${blockerId}`);
  }
  assert(backendSource.includes("blockerValidationRecommendationNotCandidateBetter"), "backend readiness does not require a better validation comparison");
  assert(backendSource.includes("blockerInsufficientPrimaryPairedCases"), "backend readiness does not require primary paired validation cases");
  assert(backendSource.includes("blockerInsufficientPrimaryPairedHoldoutCases"), "backend readiness does not require primary paired holdout validation cases");
  assert(backendSource.includes("implementationStatus: validationReadiness.passed ? \"validated\" : \"in_progress\""), "backend marks proposal validated without full validation readiness");
  assert(backendSource.includes("Validation passed: ${input.resultSummary}"), "backend validation sync does not distinguish passed validation from completed validation");
  assert(backendSource.includes("requestedImplementationStatus === \"validated\""), "backend explicit validated transition does not require validation evidence");
  assert(backendSource.includes("Cannot mark workflow change proposal validated until validation passes"), "backend explicit validated transition is not blocked by failed validation gate");
  assert(backendSource.includes("status === \"implemented\" && implementationStatus !== \"validated\""), "backend implemented transition can drift from validated implementation status");
  assert(backendSource.includes("Source benchmark run not found for workflow change proposal"), "backend implemented transition does not load source benchmark case count");
  assert(backendSource.includes("workflowProposalValidationCoverage"), "backend missing shared validation coverage helper");
  assert(backendSource.includes("requiredCases = Math.max(input.sourceBenchmarkCaseCount ?? 1, 1)"), "backend implemented transition does not require source-sized validation coverage");
  assert(backendSource.includes("completedCases = input.completedCases ?? 0"), "backend implemented transition does not check completed validation case count");
  assert(backendSource.includes("validationGateBlockers") && backendSource.includes("validation gate blockers remain"), "backend implemented transition does not block remaining validation blockers");
  assert(backendSource.includes("Cannot mark workflow change proposal implemented until validation has primary paired holdout evidence"), "backend implemented transition does not block thin paired holdout validation evidence");
  assert(backendSource.includes("Cannot mark workflow change proposal validated until validation has primary paired holdout evidence"), "backend validated transition does not block thin paired holdout validation evidence");
  assert(backendSource.includes("implementationStatusForProposalTransition"), "backend missing proposal implementation transition helper");
  assert(backendSource.includes("proposal-${existing.id.slice(0, 8)}"), "backend missing deterministic proposal experiment label");
  assert(backendSource.includes("startWorkflowChangeProposalValidation"), "backend missing proposal validation launcher");
  assert(backendSource.includes("evalModeForProposalTargetWorkflow"), "backend missing proposal target workflow mapper");
  assert(backendSource.includes("suiteId: sourceRun.suiteId"), "proposal validation does not reuse source benchmark suite");
  assert(backendSource.includes("validationMaxCases = input.maxCases ?? Math.max(sourceRun.caseCount, 1)"), "proposal validation does not default to source benchmark case count");
  assert(backendSource.includes("launched with up to ${validationMaxCases} case(s)"), "proposal validation launch note does not record validation case count");
  assert(backendSource.includes("validationBenchmarkRunId"), "backend missing validation benchmark linkage");
  assert(backendSource.includes("already has validation benchmark run"), "backend does not block duplicate proposal validation launches");
  assert(backendSource.includes("createWorkflowProposalValidationComparison"), "backend missing proposal validation comparison helper");
  assert(backendSource.includes("baselineBenchmarkRunIds: [proposal.sourceBenchmarkRunId]"), "proposal validation comparison does not use source benchmark as baseline");
  assert(backendSource.includes("syncWorkflowProposalValidationEvidence"), "backend missing proposal validation evidence sync");
  assert(backendSource.includes("validationMeanBrierDelta"), "backend missing validation Brier delta sync");
  assert(backendSource.includes("workflowProposalValidationCostEvidence"), "backend missing proposal validation cost evidence sync");
  assert(backendSource.includes("validationCostTotalTokensDelta"), "backend missing validation token cost delta sync");
  assert(backendSource.includes("validationCostMeanDurationSecondsDelta"), "backend missing validation duration delta sync");
  assert(backendSource.includes("gateBlockers: validationGate.blockers"), "backend missing validation gate blocker sync");
  assert(routeSource.includes("updateWorkflowChangeProposalStatus"), "proposal lifecycle API route missing backend update call");
  assert(routeSource.includes("reviewNote"), "proposal lifecycle API route missing review note");
  assert(routeSource.includes("implementationStatus"), "proposal lifecycle API route missing implementation status");
  assert(validationRouteSource.includes("startWorkflowChangeProposalValidation"), "proposal validation API route missing backend launch call");
  assert(validationRouteSource.includes("maxCases: Number.isFinite(Number(body.maxCases)) ? Number(body.maxCases) : undefined"), "proposal validation API route should allow backend default case coverage");
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
