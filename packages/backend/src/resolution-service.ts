import { and, desc, eq, inArray } from "drizzle-orm";
import {
  artifactRows,
  calibrationModels,
  forecastAggregates,
  forecastAttempts,
  forecastResolutions,
  forecastScores,
  tasks,
  type createDb,
} from "@open-superforecaster/db";
import { scoreBinaryForecast } from "@open-superforecaster/evals";
import { readAggregateQualitySnapshot, type AggregateQualitySnapshot } from "./aggregate-quality-metadata";
import { readAggregateStatsSnapshot, type AggregateStatsSnapshot } from "./aggregate-stats-metadata";
import { readBaselineSanitySnapshot, type BaselineSanitySnapshot } from "./baseline-sanity-metadata";
import { buildBinaryConfidenceSnapshot, readBinaryConfidenceSnapshot, type BinaryConfidenceSnapshot } from "./binary-confidence-metadata";
import { buildCalibrationGuardImpact, type CalibrationGuardImpact, type CalibrationGuardRuleImpact } from "./calibration-guard-impact";
import { readCalibrationGuardSnapshot, type CalibrationGuardSnapshot } from "./calibration-guard-metadata";
import { readCategoricalForecastSnapshot, type CategoricalForecastSnapshot } from "./categorical-forecast-metadata";
import { readComponentWeightingSnapshot, type ComponentWeightingSnapshot } from "./component-weighting-metadata";
import { readConditionalForecastSnapshot, type ConditionalForecastSnapshot } from "./conditional-forecast-metadata";
import { readDateForecastSnapshot, type DateForecastSnapshot } from "./date-forecast-metadata";
import { readEvidenceCoverageSnapshot, type EvidenceCoverageSnapshot } from "./evidence-coverage-metadata";
import { readForecastInputContextSnapshot, type ForecastInputContextSnapshot } from "./forecast-input-context-metadata";
import { readForecastRunSnapshot, type ForecastRunSnapshot } from "./forecast-run-metadata";
import { readMarketAnchorSnapshot, type MarketAnchorSnapshot } from "./market-anchor-metadata";
import { readNumericForecastSnapshot, type NumericForecastSnapshot } from "./numeric-forecast-metadata";
import { buildBinaryCalibrationReport, type BinaryCalibrationReport } from "./performance-calibration";
import { readResolutionBoundarySnapshot, type ResolutionBoundarySnapshot } from "./resolution-boundary-metadata";
import { readThresholdedForecastSnapshot, type ThresholdedForecastSnapshot } from "./thresholded-forecast-metadata";
import { readUncertaintyRangeSnapshot, type UncertaintyRangeSnapshot } from "./uncertainty-range-metadata";

type Db = ReturnType<typeof createDb>["db"];

type BinaryResolutionInput = {
  taskId: string;
  resolved: boolean;
  resolutionSource?: string;
  resolutionExplanation?: string;
  resolvedAt?: Date;
  annulled?: boolean;
  forceNew?: boolean;
};

type ScoreTarget = "aggregate" | "attempt";
type ForecastResolutionInput = {
  taskId: string;
  resolvedValue: Record<string, unknown>;
  resolutionSource?: string;
  resolutionExplanation?: string;
  resolvedAt?: Date;
  annulled?: boolean;
  forceNew?: boolean;
};

type ScoreRowInput = {
  scoreType: string;
  scoreValue: number;
  scoreConfig?: Record<string, unknown>;
};

type PerformanceGroup = {
  key: string;
  label: string;
  scoreRows: number;
  resolvedTasks: number;
  meanScores: Record<string, number>;
  primaryMetric: string | null;
  primaryMean: number | null;
};

type PerformanceCase = {
  taskId: string;
  taskLabel: string;
  forecastType: string;
  primaryMetric: string;
  primaryScore: number;
  scoreRows: number;
  scores: Record<string, number>;
  resolvedValue: Record<string, unknown> | null;
  probability: number | null;
  resolved: boolean | null;
  binaryConfidence: BinaryConfidenceSnapshot | null;
  calibrationGuard: CalibrationGuardSnapshot | null;
  baselineSanity: BaselineSanitySnapshot | null;
  marketAnchor: MarketAnchorSnapshot | null;
  resolutionBoundary: ResolutionBoundarySnapshot | null;
  uncertaintyRange: UncertaintyRangeSnapshot | null;
  componentWeighting: ComponentWeightingSnapshot | null;
  aggregateQuality: AggregateQualitySnapshot | null;
  aggregateStats: AggregateStatsSnapshot | null;
  conditionalForecast: ConditionalForecastSnapshot | null;
  thresholdedForecast: ThresholdedForecastSnapshot | null;
  numericForecast: NumericForecastSnapshot | null;
  dateForecast: DateForecastSnapshot | null;
  categoricalForecast: CategoricalForecastSnapshot | null;
  evidenceCoverage: EvidenceCoverageSnapshot | null;
  inputContext: ForecastInputContextSnapshot | null;
  runMetadata: ForecastRunSnapshot | null;
  resolutionId: string | null;
  forecastAggregateId: string | null;
  createdAt: Date;
};

type PerformanceTrend = {
  key: string;
  label: string;
  metric: string;
  recentDays: number;
  recentCount: number;
  baselineCount: number;
  recentMean: number | null;
  baselineMean: number | null;
  delta: number | null;
  direction: "improved" | "worse" | "flat" | "insufficient_data";
};

type PerformanceAttentionItem = {
  id: string;
  kind:
    | "poor_resolved_forecast"
    | "worsening_trend"
    | "calibration_mismatch"
    | "calibration_guard_regression"
    | "baseline_sanity_miss"
    | "binary_confidence_miss"
    | "market_anchor_miss"
    | "resolution_boundary_miss"
    | "uncertainty_range_miss"
    | "component_weighting_miss"
    | "aggregate_quality_miss"
    | "component_disagreement_miss"
    | "evidence_coverage_miss"
    | "input_context_miss"
    | "run_metadata_miss";
  severity: "high" | "medium";
  reason: string;
  recommendedActions: string[];
  metric: string;
  score: number | null;
  delta: number | null;
  taskId: string | null;
  taskLabel: string | null;
  forecastType: string | null;
};

export async function resolveBinaryForecastTask(db: Db, input: BinaryResolutionInput) {
  return resolveForecastTask(db, {
    taskId: input.taskId,
    resolvedValue: {
      resolved: input.resolved,
    },
    resolutionSource: input.resolutionSource,
    resolutionExplanation: input.resolutionExplanation,
    resolvedAt: input.resolvedAt,
    annulled: input.annulled,
    forceNew: input.forceNew,
  });
}

export async function resolveForecastTask(db: Db, input: ForecastResolutionInput) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }
  if (task.operationMode !== "forecast" || !isResolvableForecastSubmode(task.operationSubmode)) {
    throw new Error("Manual resolution is only enabled for completed product forecast tasks.");
  }
  if (task.benchmarkRunId) {
    throw new Error("Benchmark tasks must be resolved through benchmark imports, not manual product resolution.");
  }
  if (task.status !== "completed") {
    throw new Error(`Task must be completed before resolution; current status is ${task.status}.`);
  }
  if (!task.smithersRunId) {
    throw new Error("Task has no Smithers run id, so forecast attempts cannot be linked.");
  }

  const forecastType = forecastTypeFromSubmode(task.operationSubmode);
  validateResolvedValue(forecastType, input.resolvedValue);
  const resolutionSource = input.resolutionSource?.trim() || "manual";
  const inputContext = readForecastInputContextSnapshot(task.configJson);
  const runMetadata = readForecastRunSnapshot(task);
  const existing = input.forceNew
    ? null
    : await findExistingResolution(db, {
        taskId: task.id,
        resolvedValue: input.resolvedValue,
        resolutionSource,
      });
  const resolution =
    existing ??
    (await insertResolution(db, {
      taskId: task.id,
      smithersRunId: task.smithersRunId,
      resolvedValue: input.resolvedValue,
      resolutionSource,
      resolutionExplanation: input.resolutionExplanation,
      resolvedAt: input.resolvedAt ?? new Date(),
      annulled: input.annulled ?? false,
    }));

  const attempts = await db
    .select()
    .from(forecastAttempts)
    .where(and(eq(forecastAttempts.researchPassId, task.smithersRunId), eq(forecastAttempts.forecastType, forecastType)));
  const attemptIds = attempts.map((attempt) => attempt.id);
  if (attemptIds.length === 0) {
    throw new Error(`No ${forecastType} forecast attempts are available to score.`);
  }

  const allAggregates = await db
    .select()
    .from(forecastAggregates)
    .where(eq(forecastAggregates.forecastType, forecastType));
  const aggregates = allAggregates.filter((aggregate) =>
    aggregate.componentAttemptIds.some((attemptId) => attemptIds.includes(attemptId)),
  );

  if (resolution.annulled) {
    return {
      resolutionId: resolution.id,
      createdResolution: !existing,
      insertedScores: 0,
      skippedScores: attempts.length + aggregates.length,
      note: "Resolution is annulled; no scores were written.",
    };
  }

  const insertedScores = [];
  let skippedScores = 0;

  for (const aggregate of aggregates) {
    const scoreRows = scoreForecastPrediction({
      forecastType,
      prediction: aggregate.calibratedAggregate ?? aggregate.rawAggregate,
      resolvedValue: input.resolvedValue,
    });
    if (scoreRows.length === 0) {
      skippedScores += 1;
      continue;
    }
    insertedScores.push(
      ...(await insertForecastScoreRows(db, {
        target: "aggregate",
        targetId: aggregate.id,
        resolutionId: resolution.id,
        scoreRows,
        scoreConfig: {
          source: "manual_resolution",
          taskId: task.id,
          smithersRunId: task.smithersRunId,
          target: "aggregate",
          forecastType,
          resolutionSource,
          ...(inputContext ? { inputContext } : {}),
          ...(runMetadata ? { runMetadata } : {}),
        },
      })),
    );
  }

  for (const attempt of attempts) {
    const scoreRows = scoreForecastPrediction({
      forecastType,
      prediction: attempt.parsedPrediction,
      resolvedValue: input.resolvedValue,
    });
    if (scoreRows.length === 0) {
      skippedScores += 1;
      continue;
    }
    insertedScores.push(
      ...(await insertForecastScoreRows(db, {
        target: "attempt",
        targetId: attempt.id,
        resolutionId: resolution.id,
        scoreRows,
        scoreConfig: {
          source: "manual_resolution",
          taskId: task.id,
          smithersRunId: task.smithersRunId,
          target: "attempt",
          forecastType,
          forecasterLabel: attempt.forecasterLabel,
          resolutionSource,
          ...(inputContext ? { inputContext } : {}),
          ...(runMetadata ? { runMetadata } : {}),
        },
      })),
    );
  }

  return {
    resolutionId: resolution.id,
    createdResolution: !existing,
    insertedScores: insertedScores.length,
    skippedScores,
    aggregateCount: aggregates.length,
    attemptCount: attempts.length,
  };
}

export async function getResolutionDashboard(db: Db) {
  const [scoreRows, resolutionRows, calibrationRows] = await Promise.all([
    db.select().from(forecastScores),
    db.select().from(forecastResolutions).orderBy(desc(forecastResolutions.createdAt)),
    db.select().from(calibrationModels).orderBy(desc(calibrationModels.createdAt)),
  ]);

  const productScores = scoreRows.filter(isProductScore);
  const benchmarkScores = scoreRows.filter(isBenchmarkScore);
  const aggregateScores = productScores.filter((score) => score.forecastAggregateId);
  const aggregateBrier = aggregateScores.filter((score) => score.scoreType === "brier");
  const aggregateLog = aggregateScores.filter((score) => score.scoreType === "log");
  const attemptScores = productScores.filter((score) => score.forecastAttemptId);
  const productResolutionIds = new Set(productScores.map((score) => score.resolutionId).filter(Boolean));
  const pendingForecasts = await listPendingBinaryForecasts(db, productScores);
  const taskLabels = await taskLabelsById(db, productScores);
  const calibrationReport = buildBinaryCalibrationReport(scoreRowsForCalibration(aggregateBrier), productResolutionIds.size);

  return {
    summary: {
      productResolvedForecasts: productResolutionIds.size,
      pendingBinaryForecasts: pendingForecasts.length,
      aggregateScoreRows: aggregateScores.length,
      binaryAggregateScoreRows: aggregateBrier.length + aggregateLog.length,
      attemptScoreRows: attemptScores.length,
      meanAggregateBrier: meanScore(aggregateBrier),
      meanAggregateLog: meanScore(aggregateLog),
      benchmarkScoreRows: benchmarkScores.length,
      calibrationModels: calibrationRows.length,
      activeCalibrationModels: calibrationRows.filter((model) => model.active).length,
      calibrationStatus: calibrationReport.calibrationSummary.status,
      calibrationSampleSize: calibrationReport.calibrationSummary.sampleSize,
      expectedCalibrationError: calibrationReport.calibrationSummary.expectedCalibrationError,
      maxBucketCalibrationError: calibrationReport.calibrationSummary.maxBucketCalibrationError,
      calibrationMinimumForFitting: calibrationReport.calibrationSummary.minimumForFitting,
    },
    calibrationBuckets: calibrationReport.calibrationBuckets,
    calibrationSummary: calibrationReport.calibrationSummary,
    candidateCalibrationGuardRules: calibrationReport.candidateCalibrationGuardRules,
    pendingForecasts,
    recentResolutions: resolutionRows.slice(0, 8).map((resolution) => ({
      id: resolution.id,
      taskId: readScoreTaskIdFromResolution(resolution.resolvedValue),
      resolved: readResolved(resolution.resolvedValue),
      resolutionSource: resolution.resolutionSource,
      annulled: resolution.annulled,
      resolvedAt: resolution.resolvedAt,
      createdAt: resolution.createdAt,
    })),
    recentScores: productScores
      .filter((score) => score.scoreType === "brier" && score.forecastAggregateId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 8)
      .map((score) => {
        const taskId = readScoreTaskId(score.scoreConfig);
        return {
          id: score.id,
          taskId,
          taskLabel: taskId ? taskLabels.get(taskId) ?? taskId : "Unknown task",
          scoreType: score.scoreType,
          scoreValue: score.scoreValue,
          probability: readProbability(score.scoreConfig),
          resolved: readResolved(score.scoreConfig),
          createdAt: score.createdAt,
        };
      }),
  };
}

export async function getForecastPerformanceReport(db: Db) {
  const [scoreRows, resolutionRows, taskRows] = await Promise.all([
    db.select().from(forecastScores),
    db.select().from(forecastResolutions).orderBy(desc(forecastResolutions.resolvedAt)),
    db.select({ id: tasks.id, label: tasks.label, operationSubmode: tasks.operationSubmode }).from(tasks),
  ]);
  const taskMeta = new Map(taskRows.map((task) => [task.id, task]));
  const resolutionById = new Map(resolutionRows.map((resolution) => [resolution.id, resolution]));
  const productScores = scoreRows.filter(isProductScore);
  const aggregateScores = productScores.filter((score) => score.forecastAggregateId);
  const aggregateBrierScores = aggregateScores.filter((score) => score.scoreType === "brier");
  const attemptScores = productScores.filter((score) => score.forecastAttemptId);
  const productResolutionIds = new Set(productScores.map((score) => score.resolutionId).filter(Boolean));
  const resolvedTaskIds = new Set(productScores.map((score) => readScoreTaskId(score.scoreConfig)).filter((id): id is string => Boolean(id)));
  const byForecastType = groupScores(productScores, (score) => readString(score.scoreConfig, "forecastType") ?? "unknown");
  const byTarget = groupScores(productScores, (score) => readString(score.scoreConfig, "target") ?? "unknown");
  const byForecaster = groupScores(attemptScores, (score) => readString(score.scoreConfig, "forecasterLabel") ?? "unknown");
  const byForecastTypeAndTarget = groupScores(productScores, (score) => {
    const forecastType = readString(score.scoreConfig, "forecastType") ?? "unknown";
    const target = readString(score.scoreConfig, "target") ?? "unknown";
    return `${forecastType}:${target}`;
  });
  const byCalibrationGuard = groupScores(aggregateScores, calibrationGuardGroupKey);
  const byBinaryConfidence = groupScores(aggregateScores, binaryConfidenceGroupKey);
  const byBinaryForecastSide = groupScores(aggregateScores, binaryForecastSideGroupKey);
  const byBaselineSanity = groupScores(aggregateScores, baselineSanityGroupKey);
  const byMarketAnchor = groupScores(aggregateScores, marketAnchorGroupKey);
  const byResolutionBoundary = groupScores(aggregateScores, resolutionBoundaryGroupKey);
  const byUncertaintyRange = groupScores(aggregateScores, uncertaintyRangeGroupKey);
  const byComponentWeighting = groupScores(aggregateScores, componentWeightingGroupKey);
  const byAggregateQuality = groupScores(aggregateScores, aggregateQualityGroupKey);
  const byAggregateDisagreement = groupScores(aggregateScores, aggregateDisagreementGroupKey);
  const byAggregationAnchor = groupScores(aggregateScores, aggregationAnchorGroupKey);
  const byResearchDepth = groupScores(aggregateScores, researchDepthGroupKey);
  const byForecasterPanelSize = groupScores(aggregateScores, forecasterPanelSizeGroupKey);
  const byComplexityScore = groupScores(aggregateScores, complexityScoreGroupKey);
  const byConditionalBranch = groupScores(aggregateScores, conditionalBranchGroupKey);
  const byConditionalEffect = groupScores(aggregateScores, conditionalEffectGroupKey);
  const byConditionalBranchDisagreement = groupScores(aggregateScores, conditionalBranchDisagreementGroupKey);
  const byThresholdedDirection = groupScores(aggregateScores, thresholdedDirectionGroupKey);
  const byThresholdedSource = groupScores(aggregateScores, thresholdedSourceGroupKey);
  const byThresholdedRepair = groupScores(aggregateScores, thresholdedRepairGroupKey);
  const byThresholdedCurveSpread = groupScores(aggregateScores, thresholdedCurveSpreadGroupKey);
  const byThresholdedComponentDisagreement = groupScores(aggregateScores, thresholdedComponentDisagreementGroupKey);
  const byNumericInterval = groupScores(aggregateScores, numericIntervalGroupKey);
  const byNumericUnit = groupScores(aggregateScores, numericUnitGroupKey);
  const byNumericP50Disagreement = groupScores(aggregateScores, numericP50DisagreementGroupKey);
  const byNumericResolvedPosition = groupScores(aggregateScores, numericResolvedPositionGroupKey);
  const byDateInterval = groupScores(aggregateScores, dateIntervalGroupKey);
  const byDateNeverProbability = groupScores(aggregateScores, dateNeverProbabilityGroupKey);
  const byDateP50Disagreement = groupScores(aggregateScores, dateP50DisagreementGroupKey);
  const byDateResolvedPosition = groupScores(aggregateScores, dateResolvedPositionGroupKey);
  const byCategoricalConfidence = groupScores(aggregateScores, categoricalConfidenceGroupKey);
  const byCategoricalEntropy = groupScores(aggregateScores, categoricalEntropyGroupKey);
  const byCategoricalSource = groupScores(aggregateScores, categoricalSourceGroupKey);
  const byCategoricalCoverage = groupScores(aggregateScores, categoricalCoverageGroupKey);
  const byCategoricalTopAgreement = groupScores(aggregateScores, categoricalTopAgreementGroupKey);
  const byEvidenceSourceCount = groupScores(aggregateScores, evidenceSourceCountGroupKey);
  const byEvidenceSourceDiversity = groupScores(aggregateScores, evidenceSourceDiversityGroupKey);
  const byEvidenceSourceConcentration = groupScores(aggregateScores, evidenceSourceConcentrationGroupKey);
  const byEvidenceSourceDateCoverage = groupScores(aggregateScores, evidenceSourceDateCoverageGroupKey);
  const byEvidenceSourceFreshness = groupScores(aggregateScores, evidenceSourceFreshnessGroupKey);
  const byEvidenceSourceTiming = groupScores(aggregateScores, evidenceSourceTimingGroupKey);
  const byEvidenceUncertaintyCount = groupScores(aggregateScores, evidenceUncertaintyCountGroupKey);
  const byEvidenceRationaleLength = groupScores(aggregateScores, evidenceRationaleLengthGroupKey);
  const byInputContextCompleteness = groupScores(aggregateScores, inputContextCompletenessGroupKey);
  const byInputMarketContext = groupScores(aggregateScores, inputMarketContextGroupKey);
  const byInputQuestionLength = groupScores(aggregateScores, inputQuestionLengthGroupKey);
  const byInputCategoryCount = groupScores(aggregateScores, inputCategoryCountGroupKey);
  const byInputThresholdCount = groupScores(aggregateScores, inputThresholdCountGroupKey);
  const byRunDuration = groupScores(aggregateScores, runDurationGroupKey);
  const byRunExperiment = groupScores(aggregateScores, runExperimentGroupKey);
  const calibrationGuardImpact = buildCalibrationGuardImpact(scoreRowsForCalibrationGuardImpact(aggregateBrierScores));
  const rankedAggregateCases = rankAggregateCases(aggregateScores, taskMeta, resolutionById);
  const bestResolvedForecasts = rankedAggregateCases.slice(0, 8);
  const worstResolvedForecasts = [...rankedAggregateCases].reverse().slice(0, 8);
  const scoreTrends = buildScoreTrends(aggregateScores);
  const calibrationReport = buildBinaryCalibrationReport(scoreRowsForCalibration(aggregateBrierScores), productResolutionIds.size);
  const needsAttention = buildNeedsAttentionQueue(worstResolvedForecasts, scoreTrends, calibrationReport, calibrationGuardImpact);

  return {
    reportType: "forecast_performance_report",
    generatedAt: new Date().toISOString(),
    summary: {
      resolvedTasks: resolvedTaskIds.size,
      productResolutions: productResolutionIds.size,
      productScoreRows: productScores.length,
      aggregateScoreRows: aggregateScores.length,
      attemptScoreRows: attemptScores.length,
      meanScores: meanScoresByType(productScores),
      aggregateMeanScores: meanScoresByType(aggregateScores),
      attemptMeanScores: meanScoresByType(attemptScores),
      calibrationStatus: calibrationReport.calibrationSummary.status,
      calibrationSampleSize: calibrationReport.calibrationSummary.sampleSize,
      expectedCalibrationError: calibrationReport.calibrationSummary.expectedCalibrationError,
      maxBucketCalibrationError: calibrationReport.calibrationSummary.maxBucketCalibrationError,
    },
    calibrationBuckets: calibrationReport.calibrationBuckets,
    calibrationSummary: calibrationReport.calibrationSummary,
    calibrationDiagnostics: calibrationReport.calibrationDiagnostics,
    candidateCalibrationGuardRules: calibrationReport.candidateCalibrationGuardRules,
    calibrationGuardImpact,
    calibrationReplayRows: calibrationReplayRows(aggregateBrierScores),
    groups: {
      byForecastType,
      byTarget,
      byForecaster,
      byForecastTypeAndTarget,
      byCalibrationGuard,
      byBinaryConfidence,
      byBinaryForecastSide,
      byBaselineSanity,
      byMarketAnchor,
      byResolutionBoundary,
      byUncertaintyRange,
      byComponentWeighting,
      byAggregateQuality,
      byAggregateDisagreement,
      byAggregationAnchor,
      byResearchDepth,
      byForecasterPanelSize,
      byComplexityScore,
      byConditionalBranch,
      byConditionalEffect,
      byConditionalBranchDisagreement,
      byThresholdedDirection,
      byThresholdedSource,
      byThresholdedRepair,
      byThresholdedCurveSpread,
      byThresholdedComponentDisagreement,
      byNumericInterval,
      byNumericUnit,
      byNumericP50Disagreement,
      byNumericResolvedPosition,
      byDateInterval,
      byDateNeverProbability,
      byDateP50Disagreement,
      byDateResolvedPosition,
      byCategoricalConfidence,
      byCategoricalEntropy,
      byCategoricalSource,
      byCategoricalCoverage,
      byCategoricalTopAgreement,
      byEvidenceSourceCount,
      byEvidenceSourceDiversity,
      byEvidenceSourceConcentration,
      byEvidenceSourceDateCoverage,
      byEvidenceSourceFreshness,
      byEvidenceSourceTiming,
      byEvidenceUncertaintyCount,
      byEvidenceRationaleLength,
      byInputContextCompleteness,
      byInputMarketContext,
      byInputQuestionLength,
      byInputCategoryCount,
      byInputThresholdCount,
      byRunDuration,
      byRunExperiment,
    },
    bestResolvedForecasts,
    worstResolvedForecasts,
    scoreTrends,
    needsAttention,
    recentResolvedTasks: resolutionRows.slice(0, 12).map((resolution) => {
      const taskId = readScoreTaskIdFromResolution(resolution.resolvedValue);
      const task = taskId ? taskMeta.get(taskId) : null;
      return {
        resolutionId: resolution.id,
        taskId,
        taskLabel: task?.label ?? taskId ?? "Unknown task",
        forecastType: task?.operationSubmode ? forecastTypeFromSubmode(task.operationSubmode) : null,
        resolutionSource: resolution.resolutionSource,
        resolvedValue: resolution.resolvedValue,
        annulled: resolution.annulled,
        resolvedAt: resolution.resolvedAt,
        createdAt: resolution.createdAt,
      };
    }),
    markdown: renderPerformanceMarkdown({
      resolvedTasks: resolvedTaskIds.size,
      productScoreRows: productScores.length,
      byForecastType,
      byTarget,
      byForecaster,
      byCalibrationGuard,
      byBinaryConfidence,
      byBinaryForecastSide,
      byBaselineSanity,
      byMarketAnchor,
      byResolutionBoundary,
      byUncertaintyRange,
      byComponentWeighting,
      byAggregateQuality,
      byAggregateDisagreement,
      byAggregationAnchor,
      byResearchDepth,
      byForecasterPanelSize,
      byComplexityScore,
      byConditionalBranch,
      byConditionalEffect,
      byConditionalBranchDisagreement,
      byThresholdedDirection,
      byThresholdedSource,
      byThresholdedRepair,
      byThresholdedCurveSpread,
      byThresholdedComponentDisagreement,
      byNumericInterval,
      byNumericUnit,
      byNumericP50Disagreement,
      byNumericResolvedPosition,
      byDateInterval,
      byDateNeverProbability,
      byDateP50Disagreement,
      byDateResolvedPosition,
      byCategoricalConfidence,
      byCategoricalEntropy,
      byCategoricalSource,
      byCategoricalCoverage,
      byCategoricalTopAgreement,
      byEvidenceSourceCount,
      byEvidenceSourceDiversity,
      byEvidenceSourceConcentration,
      byEvidenceSourceDateCoverage,
      byEvidenceSourceFreshness,
      byEvidenceSourceTiming,
      byEvidenceUncertaintyCount,
      byEvidenceRationaleLength,
      byInputContextCompleteness,
      byInputMarketContext,
      byInputQuestionLength,
      byInputCategoryCount,
      byInputThresholdCount,
      byRunDuration,
      byRunExperiment,
      bestResolvedForecasts,
      worstResolvedForecasts,
      scoreTrends,
      needsAttention,
      calibrationBuckets: calibrationReport.calibrationBuckets,
      calibrationSummary: calibrationReport.calibrationSummary,
      candidateCalibrationGuardRules: calibrationReport.candidateCalibrationGuardRules,
      calibrationGuardImpact,
    }),
  };
}

async function findExistingResolution(
  db: Db,
  input: {
    taskId: string;
    resolvedValue: Record<string, unknown>;
    resolutionSource: string;
  },
) {
  const candidates = await db
    .select()
    .from(forecastResolutions)
    .where(eq(forecastResolutions.resolutionSource, input.resolutionSource));
  return (
    candidates.find(
      (candidate) =>
        readScoreTaskIdFromResolution(candidate.resolvedValue) === input.taskId &&
        resolvedValueMatches(candidate.resolvedValue, input.resolvedValue),
    ) ?? null
  );
}

async function insertResolution(
  db: Db,
  input: {
    taskId: string;
    smithersRunId: string;
    resolvedValue: Record<string, unknown>;
    resolutionSource: string;
    resolutionExplanation?: string;
    resolvedAt: Date;
    annulled: boolean;
  },
) {
  const [resolution] = await db
    .insert(forecastResolutions)
    .values({
      resolvedValue: {
        taskId: input.taskId,
        smithersRunId: input.smithersRunId,
        ...input.resolvedValue,
        status: input.annulled ? "annulled" : "resolved",
        explanation: input.resolutionExplanation ?? null,
      },
      resolutionSource: input.resolutionSource,
      resolverTraceIds: [],
      annulled: input.annulled,
      resolvedAt: input.resolvedAt,
    })
    .returning();
  return resolution;
}

async function insertBinaryScoreRows(
  db: Db,
  input: {
    target: ScoreTarget;
    targetId: string;
    resolutionId: string;
    resolved: boolean;
    probability: number;
    scoreConfig: Record<string, unknown>;
  },
) {
  const existing = await db
    .select({ id: forecastScores.id })
    .from(forecastScores)
    .where(
      and(
        eq(forecastScores.resolutionId, input.resolutionId),
        input.target === "aggregate"
          ? eq(forecastScores.forecastAggregateId, input.targetId)
          : eq(forecastScores.forecastAttemptId, input.targetId),
      ),
    );
  if (existing.length > 0) {
    return [];
  }

  const scores = scoreBinaryForecast({ probability: input.probability, resolved: input.resolved });
  return db
    .insert(forecastScores)
    .values(
      Object.entries(scores).map(([scoreType, scoreValue]) => ({
        forecastAggregateId: input.target === "aggregate" ? input.targetId : null,
        forecastAttemptId: input.target === "attempt" ? input.targetId : null,
        resolutionId: input.resolutionId,
        scoreType,
        scoreValue,
        scoreConfig: {
          ...input.scoreConfig,
          probability: input.probability,
          resolved: input.resolved,
        },
      })),
    )
    .returning({ id: forecastScores.id });
}

async function insertForecastScoreRows(
  db: Db,
  input: {
    target: ScoreTarget;
    targetId: string;
    resolutionId: string;
    scoreRows: ScoreRowInput[];
    scoreConfig: Record<string, unknown>;
  },
) {
  const existing = await db
    .select({ id: forecastScores.id })
    .from(forecastScores)
    .where(
      and(
        eq(forecastScores.resolutionId, input.resolutionId),
        input.target === "aggregate"
          ? eq(forecastScores.forecastAggregateId, input.targetId)
          : eq(forecastScores.forecastAttemptId, input.targetId),
      ),
    );
  if (existing.length > 0) {
    return [];
  }

  return db
    .insert(forecastScores)
    .values(
      input.scoreRows.map((row) => ({
        forecastAggregateId: input.target === "aggregate" ? input.targetId : null,
        forecastAttemptId: input.target === "attempt" ? input.targetId : null,
        resolutionId: input.resolutionId,
        scoreType: row.scoreType,
        scoreValue: row.scoreValue,
        scoreConfig: {
          ...input.scoreConfig,
          ...(row.scoreConfig ?? {}),
        },
      })),
    )
    .returning({ id: forecastScores.id });
}

function scoreForecastPrediction(input: {
  forecastType: "binary" | "date" | "numeric" | "categorical" | "thresholded" | "conditional";
  prediction: Record<string, unknown>;
  resolvedValue: Record<string, unknown>;
}): ScoreRowInput[] {
  const evidenceCoverage = readEvidenceCoverageSnapshot(input.prediction);
  const evidenceConfig = evidenceCoverage ? { evidenceCoverage } : {};
  if (input.forecastType === "binary") {
    const probability = readProbability(input.prediction);
    const resolved = readResolved(input.resolvedValue);
    if (probability === null || resolved === null) {
      return [];
    }
    const calibrationGuard = readCalibrationGuardSnapshot(input.prediction);
    const baselineSanity = readBaselineSanitySnapshot(input.prediction);
    const marketAnchor = readMarketAnchorSnapshot(input.prediction);
    const resolutionBoundary = readResolutionBoundarySnapshot(input.prediction);
    const uncertaintyRange = readUncertaintyRangeSnapshot(input.prediction);
    const componentWeighting = readComponentWeightingSnapshot(input.prediction);
    const aggregateQuality = readAggregateQualitySnapshot(input.prediction);
    const aggregateStats = readAggregateStatsSnapshot(input.prediction);
    const binaryConfidence = buildBinaryConfidenceSnapshot(probability);
    return Object.entries(scoreBinaryForecast({ probability, resolved })).map(([scoreType, scoreValue]) => ({
      scoreType,
      scoreValue,
      scoreConfig: {
        probability,
        resolved,
        ...(binaryConfidence ? { binaryConfidence } : {}),
        ...(calibrationGuard ? { calibrationGuard } : {}),
        ...(baselineSanity ? { baselineSanity } : {}),
        ...(marketAnchor ? { marketAnchor } : {}),
        ...(resolutionBoundary ? { resolutionBoundary } : {}),
        ...(uncertaintyRange ? { uncertaintyRange } : {}),
        ...(componentWeighting ? { componentWeighting } : {}),
        ...(aggregateQuality ? { aggregateQuality } : {}),
        ...(aggregateStats ? { aggregateStats } : {}),
        ...evidenceConfig,
      },
    }));
  }

  if (input.forecastType === "numeric") {
    const predicted = readNumber(input.prediction, "value");
    const actual = readNumber(input.resolvedValue, "value", "actual", "resolvedNumeric");
    if (predicted === null || actual === null) {
      return [];
    }
    const numericForecast = readNumericForecastSnapshot({ ...input.prediction, actualValue: actual });
    const error = predicted - actual;
    const absoluteError = Math.abs(error);
    const rows: ScoreRowInput[] = [
      {
        scoreType: "absolute_error",
        scoreValue: absoluteError,
        scoreConfig: { predicted, actual, error, ...(numericForecast ? { numericForecast } : {}), ...evidenceConfig },
      },
      {
        scoreType: "squared_error",
        scoreValue: error ** 2,
        scoreConfig: { predicted, actual, error, ...(numericForecast ? { numericForecast } : {}), ...evidenceConfig },
      },
    ];
    if (actual !== 0) {
      rows.push({
        scoreType: "absolute_percentage_error",
        scoreValue: absoluteError / Math.abs(actual),
        scoreConfig: { predicted, actual, error, ...(numericForecast ? { numericForecast } : {}), ...evidenceConfig },
      });
    }
    return rows;
  }

  if (input.forecastType === "date") {
    const predicted = readDate(input.prediction, "targetDate", "target_date");
    const actual = readDate(input.resolvedValue, "date", "targetDate", "target_date", "resolvedDate", "resolved_date");
    if (!predicted || !actual) {
      return [];
    }
    const actualDate = actual.toISOString().slice(0, 10);
    const dateForecast = readDateForecastSnapshot({ ...input.prediction, actualDate });
    const errorDays = Math.round(((predicted.getTime() - actual.getTime()) / 86_400_000) * 100) / 100;
    const absoluteDays = Math.abs(errorDays);
    return [
      {
        scoreType: "absolute_days_error",
        scoreValue: absoluteDays,
        scoreConfig: {
          predictedDate: predicted.toISOString().slice(0, 10),
          actualDate,
          errorDays,
          ...(dateForecast ? { dateForecast } : {}),
          ...evidenceConfig,
        },
      },
      {
        scoreType: "squared_days_error",
        scoreValue: errorDays ** 2,
        scoreConfig: {
          predictedDate: predicted.toISOString().slice(0, 10),
          actualDate,
          errorDays,
          ...(dateForecast ? { dateForecast } : {}),
          ...evidenceConfig,
        },
      },
    ];
  }

  if (input.forecastType === "categorical") {
    const actualCategory = readString(input.resolvedValue, "category", "actual", "resolvedCategory", "resolved_category");
    if (!actualCategory) {
      return [];
    }
    const distribution = normalizedCategoryDistribution(input.prediction);
    if (distribution.length === 0) {
      return [];
    }
    const categoricalForecast = readCategoricalForecastSnapshot(input.prediction);
    const categories = uniqueStrings([...distribution.map((item) => item.category), actualCategory]);
    const probabilityByCategory = new Map(distribution.map((item) => [item.category, item.probability]));
    const brier = categories.reduce((sum, category) => {
      const predicted = probabilityByCategory.get(category) ?? 0;
      const observed = category === actualCategory ? 1 : 0;
      return sum + (predicted - observed) ** 2;
    }, 0);
    const actualProbability = probabilityByCategory.get(actualCategory) ?? 0;
    return [
      {
        scoreType: "categorical_brier",
        scoreValue: brier,
        scoreConfig: { actualCategory, distribution, ...(categoricalForecast ? { categoricalForecast } : {}), ...evidenceConfig },
      },
      {
        scoreType: "categorical_log",
        scoreValue: -Math.log(Math.max(1e-6, actualProbability)),
        scoreConfig: { actualCategory, actualProbability, distribution, ...(categoricalForecast ? { categoricalForecast } : {}), ...evidenceConfig },
      },
    ];
  }

  if (input.forecastType === "thresholded") {
    const actual = readNumber(input.resolvedValue, "value", "actual", "resolvedNumeric");
    if (actual === null) {
      return [];
    }
    const thresholdedForecast = readThresholdedForecastSnapshot(input.prediction);
    const direction = readString(input.prediction, "thresholdDirection", "threshold_direction") === "at_most"
      ? "at_most"
      : "at_least";
    const points = readRecordArray(input.prediction, "probabilities").flatMap((item) => {
      const threshold = readString(item, "threshold");
      const probability = readProbability(item);
      const thresholdValue = threshold ? parseFirstNumber(threshold) : null;
      if (!threshold || probability === null || thresholdValue === null) {
        return [];
      }
      const resolved = direction === "at_most" ? actual <= thresholdValue : actual >= thresholdValue;
      return [{
        threshold,
        thresholdValue,
        probability,
        resolved,
        scores: scoreBinaryForecast({ probability, resolved }),
      }];
    });
    if (points.length === 0) {
      return [];
    }
    return [
      {
        scoreType: "thresholded_brier",
        scoreValue: meanNumber(points.map((point) => point.scores.brier)),
        scoreConfig: { actual, direction, points, ...(thresholdedForecast ? { thresholdedForecast } : {}), ...evidenceConfig },
      },
      {
        scoreType: "thresholded_log",
        scoreValue: meanNumber(points.map((point) => point.scores.log)),
        scoreConfig: { actual, direction, points, ...(thresholdedForecast ? { thresholdedForecast } : {}), ...evidenceConfig },
      },
    ];
  }

  const conditionResolved = readBoolean(input.resolvedValue, "conditionResolved", "condition_resolved", "condition");
  const outcomeResolved = readBoolean(input.resolvedValue, "outcomeResolved", "outcome_resolved", "resolved", "outcome");
  if (conditionResolved === null || outcomeResolved === null) {
    return [];
  }
  const conditionalForecast = readConditionalForecastSnapshot(input.prediction);
  const branch = conditionResolved ? "condition" : "not_condition";
  const probability = conditionResolved
    ? readNumber(input.prediction, "probabilityGivenCondition", "probability_given_condition")
    : readNumber(input.prediction, "probabilityGivenNotCondition", "probability_given_not_condition");
  if (probability === null) {
    return [];
  }
  const branchScores = scoreBinaryForecast({ probability, resolved: outcomeResolved });
  const rows: ScoreRowInput[] = Object.entries(branchScores).map(([scoreType, scoreValue]) => ({
    scoreType: `conditional_${scoreType}`,
    scoreValue,
    scoreConfig: {
      branch,
      probability,
      conditionResolved,
      outcomeResolved,
      ...(conditionalForecast ? { conditionalForecast } : {}),
      ...evidenceConfig,
    },
  }));
  const conditionProbability = readNumber(input.prediction, "conditionProbability", "condition_probability");
  if (conditionProbability !== null) {
    const conditionScores = scoreBinaryForecast({ probability: conditionProbability, resolved: conditionResolved });
    rows.push(
      {
        scoreType: "condition_brier",
        scoreValue: conditionScores.brier,
        scoreConfig: { probability: conditionProbability, conditionResolved, ...(conditionalForecast ? { conditionalForecast } : {}), ...evidenceConfig },
      },
      {
        scoreType: "condition_log",
        scoreValue: conditionScores.log,
        scoreConfig: { probability: conditionProbability, conditionResolved, ...(conditionalForecast ? { conditionalForecast } : {}), ...evidenceConfig },
      },
    );
  }
  return rows;
}

function validateResolvedValue(
  forecastType: "binary" | "date" | "numeric" | "categorical" | "thresholded" | "conditional",
  value: Record<string, unknown>,
) {
  if (forecastType === "binary" && readResolved(value) === null) {
    throw new Error("Binary resolution expects { resolved: boolean }.");
  }
  if ((forecastType === "numeric" || forecastType === "thresholded") && readNumber(value, "value", "actual", "resolvedNumeric") === null) {
    throw new Error(`${forecastType} resolution expects { value: number }.`);
  }
  if (forecastType === "date" && !readDate(value, "date", "targetDate", "target_date", "resolvedDate", "resolved_date")) {
    throw new Error("Date resolution expects { date: \"YYYY-MM-DD\" }.");
  }
  if (forecastType === "categorical" && !readString(value, "category", "actual", "resolvedCategory", "resolved_category")) {
    throw new Error("Categorical resolution expects { category: string }.");
  }
  if (
    forecastType === "conditional" &&
    (readBoolean(value, "conditionResolved", "condition_resolved", "condition") === null ||
      readBoolean(value, "outcomeResolved", "outcome_resolved", "resolved", "outcome") === null)
  ) {
    throw new Error("Conditional resolution expects { conditionResolved: boolean, outcomeResolved: boolean }.");
  }
}

async function listPendingBinaryForecasts(db: Db, productScores: Array<typeof forecastScores.$inferSelect>) {
  const scoredTaskIds = new Set(
    productScores
      .filter((score) => score.scoreType === "brier" && score.forecastAggregateId)
      .map((score) => readScoreTaskId(score.scoreConfig))
      .filter((taskId): taskId is string => Boolean(taskId)),
  );
  const forecastTasks = await db
    .select({
      id: tasks.id,
      label: tasks.label,
      benchmarkRunId: tasks.benchmarkRunId,
      outputArtifactId: tasks.outputArtifactId,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.operationMode, "forecast"), eq(tasks.operationSubmode, "binary_forecast"), eq(tasks.status, "completed")))
    .orderBy(desc(tasks.createdAt))
    .limit(20);

  const pending = [];
  for (const task of forecastTasks) {
    if (task.benchmarkRunId || scoredTaskIds.has(task.id)) {
      continue;
    }
    const [outputRow] = task.outputArtifactId
      ? await db
          .select({ rowJson: artifactRows.rowJson })
          .from(artifactRows)
          .where(and(eq(artifactRows.artifactId, task.outputArtifactId), eq(artifactRows.rowIndex, 0)))
          .limit(1)
      : [];
    pending.push({
      taskId: task.id,
      label: task.label,
      probability: readProbability(outputRow?.rowJson ?? null),
      createdAt: task.createdAt,
      completedAt: task.completedAt,
    });
  }
  return pending;
}

async function taskLabelsById(db: Db, productScores: Array<typeof forecastScores.$inferSelect>) {
  const taskIds = [
    ...new Set(
      productScores
        .map((score) => readScoreTaskId(score.scoreConfig))
        .filter((taskId): taskId is string => Boolean(taskId)),
    ),
  ];
  if (taskIds.length === 0) {
    return new Map<string, string>();
  }
  const rows = await db.select({ id: tasks.id, label: tasks.label }).from(tasks).where(inArray(tasks.id, taskIds));
  return new Map(rows.map((row) => [row.id, row.label]));
}

function isProductScore(score: typeof forecastScores.$inferSelect) {
  const config = asRecord(score.scoreConfig);
  return config?.source === "manual_resolution" && typeof config.taskId === "string" && !("benchmarkRunId" in config);
}

function isBenchmarkScore(score: typeof forecastScores.$inferSelect) {
  const config = asRecord(score.scoreConfig);
  return Boolean(config?.benchmarkRunId);
}

function scoreRowsForCalibration(rows: Array<typeof forecastScores.$inferSelect>) {
  return rows.map((row) => ({
    probability: readProbability(row.scoreConfig),
    resolved: readResolved(row.scoreConfig),
    score: row.scoreValue,
  }));
}

function scoreRowsForCalibrationGuardImpact(rows: Array<typeof forecastScores.$inferSelect>) {
  return rows.map((row) => ({
    score: row.scoreValue,
    taskId: readScoreTaskId(row.scoreConfig),
    calibrationGuard: readCalibrationGuardSnapshot(row.scoreConfig),
  }));
}

function calibrationReplayRows(rows: Array<typeof forecastScores.$inferSelect>) {
  return rows.flatMap((row) => {
    const probability = readProbability(row.scoreConfig);
    const resolved = readResolved(row.scoreConfig);
    if (probability === null || resolved === null) {
      return [];
    }
    return [{
      id: row.id,
      taskId: readScoreTaskId(row.scoreConfig),
      probability,
      resolved,
      score: row.scoreValue,
      createdAt: row.createdAt,
    }];
  });
}

function readScoreTaskId(value: unknown) {
  const record = asRecord(value);
  return typeof record?.taskId === "string" ? record.taskId : null;
}

function readScoreTaskIdFromResolution(value: unknown) {
  const record = asRecord(value);
  return typeof record?.taskId === "string" ? record.taskId : null;
}

function readProbability(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const raw = record.probability ?? record.probability_pct ?? record.probabilityPct;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readNumber(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === "string") {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function readString(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

function readBoolean(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "boolean") {
      return raw;
    }
    if (typeof raw === "string") {
      if (raw.toLowerCase() === "true") {
        return true;
      }
      if (raw.toLowerCase() === "false") {
        return false;
      }
    }
  }
  return null;
}

function readDate(value: unknown, ...keys: string[]) {
  const raw = readString(value, ...keys);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readResolved(value: unknown) {
  const record = asRecord(value);
  return typeof record?.resolved === "boolean" ? record.resolved : null;
}

function meanScore(rows: Array<typeof forecastScores.$inferSelect>) {
  if (rows.length === 0) {
    return null;
  }
  return rows.reduce((sum, row) => sum + row.scoreValue, 0) / rows.length;
}

function meanScoresByType(rows: Array<typeof forecastScores.$inferSelect>) {
  const scores: Record<string, number> = {};
  for (const scoreType of uniqueStrings(rows.map((row) => row.scoreType)).sort()) {
    const matchingRows = rows.filter((row) => row.scoreType === scoreType);
    scores[scoreType] = meanNumber(matchingRows.map((row) => row.scoreValue));
  }
  return scores;
}

function groupScores(
  rows: Array<typeof forecastScores.$inferSelect>,
  keyForScore: (score: typeof forecastScores.$inferSelect) => string,
): PerformanceGroup[] {
  const grouped = new Map<string, Array<typeof forecastScores.$inferSelect>>();
  for (const row of rows) {
    const key = keyForScore(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.entries()]
    .map(([key, groupRows]) => {
      const meanScores = meanScoresByType(groupRows);
      const primaryMetric = selectPrimaryMetric(meanScores);
      return {
        key,
        label: formatPerformanceGroupLabel(key),
        scoreRows: groupRows.length,
        resolvedTasks: new Set(groupRows.map((row) => readScoreTaskId(row.scoreConfig)).filter(Boolean)).size,
        meanScores,
        primaryMetric,
        primaryMean: primaryMetric ? meanScores[primaryMetric] ?? null : null,
      };
    })
    .sort((left, right) => {
      if (left.primaryMean !== null && right.primaryMean !== null && left.primaryMean !== right.primaryMean) {
        return left.primaryMean - right.primaryMean;
      }
      return right.scoreRows - left.scoreRows;
    });
}

function calibrationGuardGroupKey(score: typeof forecastScores.$inferSelect) {
  const guard = readCalibrationGuardSnapshot(score.scoreConfig);
  if (!guard || guard.appliedRules.length === 0) {
    return "unguarded";
  }
  return `guard:${guard.appliedRules.map((rule) => rule.id).sort().join("+")}`;
}

function binaryConfidenceGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "binary") {
    return "binary_confidence:not_binary";
  }
  const confidence = readBinaryConfidenceSnapshot(score.scoreConfig);
  return `binary_confidence:${confidence?.confidenceBand ?? "unrecorded"}`;
}

function binaryForecastSideGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "binary") {
    return "binary_side:not_binary";
  }
  const confidence = readBinaryConfidenceSnapshot(score.scoreConfig);
  return `binary_side:${confidence?.forecastSide ?? "unrecorded"}`;
}

function baselineSanityGroupKey(score: typeof forecastScores.$inferSelect) {
  const baselineSanity = readBaselineSanitySnapshot(score.scoreConfig);
  return baselineSanity ? `baseline:${baselineSanity.status}` : "baseline:unrecorded";
}

function marketAnchorGroupKey(score: typeof forecastScores.$inferSelect) {
  const marketAnchor = readMarketAnchorSnapshot(score.scoreConfig);
  return marketAnchor ? `market_anchor:${marketAnchor.status}` : "market_anchor:unrecorded";
}

function resolutionBoundaryGroupKey(score: typeof forecastScores.$inferSelect) {
  const resolutionBoundary = readResolutionBoundarySnapshot(score.scoreConfig);
  return resolutionBoundary ? `resolution_boundary:${resolutionBoundary.status}` : "resolution_boundary:unrecorded";
}

function uncertaintyRangeGroupKey(score: typeof forecastScores.$inferSelect) {
  const uncertaintyRange = readUncertaintyRangeSnapshot(score.scoreConfig);
  return uncertaintyRange ? `uncertainty_range:${uncertaintyRange.status}` : "uncertainty_range:unrecorded";
}

function componentWeightingGroupKey(score: typeof forecastScores.$inferSelect) {
  const componentWeighting = readComponentWeightingSnapshot(score.scoreConfig);
  return componentWeighting ? `component_weighting:${componentWeighting.status}` : "component_weighting:unrecorded";
}

function aggregateQualityGroupKey(score: typeof forecastScores.$inferSelect) {
  const aggregateQuality = readAggregateQualitySnapshot(score.scoreConfig);
  if (!aggregateQuality) {
    return "aggregate_quality:unrecorded";
  }
  return `aggregate_quality:${aggregateQuality.convergenceStatus}`;
}

function aggregateDisagreementGroupKey(score: typeof forecastScores.$inferSelect) {
  const aggregateStats = readAggregateStatsSnapshot(score.scoreConfig);
  return `component_disagreement:${aggregateStats?.disagreementBand ?? "unrecorded"}`;
}

function aggregationAnchorGroupKey(score: typeof forecastScores.$inferSelect) {
  const aggregateStats = readAggregateStatsSnapshot(score.scoreConfig);
  return aggregateStats?.aggregationAnchor ? `aggregation_anchor:${aggregateStats.aggregationAnchor}` : "aggregation_anchor:unrecorded";
}

function researchDepthGroupKey(score: typeof forecastScores.$inferSelect) {
  const aggregateQuality = readAggregateQualitySnapshot(score.scoreConfig);
  return aggregateQuality?.researchDepth ? `research_depth:${aggregateQuality.researchDepth}` : "research_depth:unrecorded";
}

function forecasterPanelSizeGroupKey(score: typeof forecastScores.$inferSelect) {
  const aggregateQuality = readAggregateQualitySnapshot(score.scoreConfig);
  return aggregateQuality?.forecasterCount === null || aggregateQuality?.forecasterCount === undefined
    ? "forecaster_panel:unrecorded"
    : `forecaster_panel:${aggregateQuality.forecasterCount}`;
}

function complexityScoreGroupKey(score: typeof forecastScores.$inferSelect) {
  const aggregateQuality = readAggregateQualitySnapshot(score.scoreConfig);
  return aggregateQuality?.complexityScore === null || aggregateQuality?.complexityScore === undefined
    ? "complexity:unrecorded"
    : `complexity:${aggregateQuality.complexityScore}`;
}

function conditionalBranchGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "conditional") {
    return "conditional_branch:not_conditional";
  }
  const branch = readString(score.scoreConfig, "branch");
  return branch ? `conditional_branch:${branch}` : "conditional_branch:condition_probability";
}

function conditionalEffectGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "conditional") {
    return "conditional_effect:not_conditional";
  }
  const conditionalForecast = readConditionalForecastSnapshot(score.scoreConfig);
  return conditionalForecast ? `conditional_effect:${conditionalForecast.effectBand}` : "conditional_effect:unrecorded";
}

function conditionalBranchDisagreementGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "conditional") {
    return "conditional_branch_disagreement:not_conditional";
  }
  const conditionalForecast = readConditionalForecastSnapshot(score.scoreConfig);
  return conditionalForecast
    ? `conditional_branch_disagreement:${conditionalForecast.branchDisagreementBand}:${conditionalForecast.effectDirectionAgreement}`
    : "conditional_branch_disagreement:unrecorded";
}

function thresholdedDirectionGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "thresholded") {
    return "thresholded_direction:not_thresholded";
  }
  const thresholdedForecast = readThresholdedForecastSnapshot(score.scoreConfig);
  return `thresholded_direction:${thresholdedForecast?.thresholdDirection ?? "unrecorded"}`;
}

function thresholdedSourceGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "thresholded") {
    return "thresholded_source:not_thresholded";
  }
  const thresholdedForecast = readThresholdedForecastSnapshot(score.scoreConfig);
  return `thresholded_source:${thresholdedForecast?.thresholdSource ?? "unrecorded"}`;
}

function thresholdedRepairGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "thresholded") {
    return "thresholded_repair:not_thresholded";
  }
  const thresholdedForecast = readThresholdedForecastSnapshot(score.scoreConfig);
  return thresholdedForecast?.monotonicityRepaired === null || thresholdedForecast?.monotonicityRepaired === undefined
    ? "thresholded_repair:unrecorded"
    : `thresholded_repair:${thresholdedForecast.monotonicityRepaired ? "repaired" : "clean"}`;
}

function thresholdedCurveSpreadGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "thresholded") {
    return "thresholded_curve_spread:not_thresholded";
  }
  const thresholdedForecast = readThresholdedForecastSnapshot(score.scoreConfig);
  return `thresholded_curve_spread:${thresholdedForecast?.probabilitySpreadBand ?? "unrecorded"}`;
}

function thresholdedComponentDisagreementGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "thresholded") {
    return "thresholded_component_disagreement:not_thresholded";
  }
  const thresholdedForecast = readThresholdedForecastSnapshot(score.scoreConfig);
  return `thresholded_component_disagreement:${thresholdedForecast?.componentDisagreementBand ?? "unrecorded"}`;
}

function numericIntervalGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "numeric") {
    return "numeric_interval:not_numeric";
  }
  const numericForecast = readNumericForecastSnapshot(score.scoreConfig);
  return `numeric_interval:${numericForecast?.intervalWidthBand ?? "unrecorded"}`;
}

function numericUnitGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "numeric") {
    return "numeric_unit:not_numeric";
  }
  const numericForecast = readNumericForecastSnapshot(score.scoreConfig);
  return numericForecast?.unit ? `numeric_unit:${numericForecast.unit}` : "numeric_unit:unrecorded";
}

function numericP50DisagreementGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "numeric") {
    return "numeric_p50_disagreement:not_numeric";
  }
  const numericForecast = readNumericForecastSnapshot(score.scoreConfig);
  return `numeric_p50_disagreement:${numericForecast?.p50DisagreementBand ?? "unrecorded"}`;
}

function numericResolvedPositionGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "numeric") {
    return "numeric_resolved_position:not_numeric";
  }
  const numericForecast = readNumericForecastSnapshot(score.scoreConfig);
  return `numeric_resolved_position:${numericForecast?.resolvedPositionBand ?? "unrecorded"}`;
}

function dateIntervalGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "date") {
    return "date_interval:not_date";
  }
  const dateForecast = readDateForecastSnapshot(score.scoreConfig);
  return `date_interval:${dateForecast?.intervalBand ?? "unrecorded"}`;
}

function dateNeverProbabilityGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "date") {
    return "date_never_probability:not_date";
  }
  const dateForecast = readDateForecastSnapshot(score.scoreConfig);
  return `date_never_probability:${dateForecast?.neverProbabilityBand ?? "unrecorded"}`;
}

function dateP50DisagreementGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "date") {
    return "date_p50_disagreement:not_date";
  }
  const dateForecast = readDateForecastSnapshot(score.scoreConfig);
  return `date_p50_disagreement:${dateForecast?.p50DisagreementBand ?? "unrecorded"}`;
}

function dateResolvedPositionGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "date") {
    return "date_resolved_position:not_date";
  }
  const dateForecast = readDateForecastSnapshot(score.scoreConfig);
  return `date_resolved_position:${dateForecast?.resolvedPositionBand ?? "unrecorded"}`;
}

function categoricalConfidenceGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "categorical") {
    return "categorical_confidence:not_categorical";
  }
  const categoricalForecast = readCategoricalForecastSnapshot(score.scoreConfig);
  return `categorical_confidence:${categoricalForecast?.topProbabilityBand ?? "unrecorded"}`;
}

function categoricalEntropyGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "categorical") {
    return "categorical_entropy:not_categorical";
  }
  const categoricalForecast = readCategoricalForecastSnapshot(score.scoreConfig);
  return `categorical_entropy:${categoricalForecast?.entropyBand ?? "unrecorded"}`;
}

function categoricalSourceGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "categorical") {
    return "categorical_source:not_categorical";
  }
  const categoricalForecast = readCategoricalForecastSnapshot(score.scoreConfig);
  return `categorical_source:${categoricalForecast?.categorySource ?? "unrecorded"}`;
}

function categoricalCoverageGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "categorical") {
    return "categorical_coverage:not_categorical";
  }
  const categoricalForecast = readCategoricalForecastSnapshot(score.scoreConfig);
  return `categorical_coverage:${categoricalForecast?.categoryCoverageBand ?? "unrecorded"}`;
}

function categoricalTopAgreementGroupKey(score: typeof forecastScores.$inferSelect) {
  if (readString(score.scoreConfig, "forecastType") !== "categorical") {
    return "categorical_top_agreement:not_categorical";
  }
  const categoricalForecast = readCategoricalForecastSnapshot(score.scoreConfig);
  return `categorical_top_agreement:${categoricalForecast?.topCategoryAgreementBand ?? "unrecorded"}`;
}

function evidenceSourceCountGroupKey(score: typeof forecastScores.$inferSelect) {
  const evidenceCoverage = readEvidenceCoverageSnapshot(score.scoreConfig);
  return `evidence_sources:${evidenceCoverage?.sourceCountBand ?? "unrecorded"}`;
}

function evidenceSourceDiversityGroupKey(score: typeof forecastScores.$inferSelect) {
  const evidenceCoverage = readEvidenceCoverageSnapshot(score.scoreConfig);
  return `evidence_source_diversity:${evidenceCoverage?.sourceDiversityBand ?? "unrecorded"}`;
}

function evidenceSourceConcentrationGroupKey(score: typeof forecastScores.$inferSelect) {
  const evidenceCoverage = readEvidenceCoverageSnapshot(score.scoreConfig);
  return `evidence_source_concentration:${evidenceCoverage?.sourceConcentrationBand ?? "unrecorded"}`;
}

function evidenceSourceDateCoverageGroupKey(score: typeof forecastScores.$inferSelect) {
  const evidenceCoverage = readEvidenceCoverageSnapshot(score.scoreConfig);
  return `evidence_source_dates:${evidenceCoverage?.sourceDateCoverageBand ?? "unrecorded"}`;
}

function evidenceSourceFreshnessGroupKey(score: typeof forecastScores.$inferSelect) {
  const evidenceCoverage = readEvidenceCoverageSnapshot(score.scoreConfig);
  return `evidence_source_freshness:${evidenceCoverage?.sourceFreshnessBand ?? "unrecorded"}`;
}

function evidenceSourceTimingGroupKey(score: typeof forecastScores.$inferSelect) {
  const evidenceCoverage = readEvidenceCoverageSnapshot(score.scoreConfig);
  return `evidence_source_timing:${evidenceCoverage?.sourceTimingBand ?? "unrecorded"}`;
}

function evidenceUncertaintyCountGroupKey(score: typeof forecastScores.$inferSelect) {
  const evidenceCoverage = readEvidenceCoverageSnapshot(score.scoreConfig);
  return `evidence_uncertainties:${evidenceCoverage?.uncertaintyCountBand ?? "unrecorded"}`;
}

function evidenceRationaleLengthGroupKey(score: typeof forecastScores.$inferSelect) {
  const evidenceCoverage = readEvidenceCoverageSnapshot(score.scoreConfig);
  return `evidence_rationale:${evidenceCoverage?.rationaleLengthBand ?? "unrecorded"}`;
}

function inputContextCompletenessGroupKey(score: typeof forecastScores.$inferSelect) {
  const inputContext = readForecastInputContextSnapshot(score.scoreConfig);
  return `input_context:${inputContext?.contextCompletenessBand ?? "unrecorded"}`;
}

function inputMarketContextGroupKey(score: typeof forecastScores.$inferSelect) {
  const inputContext = readForecastInputContextSnapshot(score.scoreConfig);
  if (!inputContext) {
    return "input_market:unrecorded";
  }
  if (!inputContext.hasMarketPrice) {
    return "input_market:none";
  }
  return `input_market:${inputContext.marketPriceBand}`;
}

function inputQuestionLengthGroupKey(score: typeof forecastScores.$inferSelect) {
  const inputContext = readForecastInputContextSnapshot(score.scoreConfig);
  return `input_question:${inputContext?.questionLengthBand ?? "unrecorded"}`;
}

function inputCategoryCountGroupKey(score: typeof forecastScores.$inferSelect) {
  const inputContext = readForecastInputContextSnapshot(score.scoreConfig);
  return `input_categories:${inputContext?.categoryCountBand ?? "unrecorded"}`;
}

function inputThresholdCountGroupKey(score: typeof forecastScores.$inferSelect) {
  const inputContext = readForecastInputContextSnapshot(score.scoreConfig);
  return `input_thresholds:${inputContext?.thresholdCountBand ?? "unrecorded"}`;
}

function runDurationGroupKey(score: typeof forecastScores.$inferSelect) {
  const runMetadata = readForecastRunSnapshot(score.scoreConfig);
  return `run_duration:${runMetadata?.durationBand ?? "unrecorded"}`;
}

function runExperimentGroupKey(score: typeof forecastScores.$inferSelect) {
  const runMetadata = readForecastRunSnapshot(score.scoreConfig);
  return runMetadata?.experimentLabel ? `run_experiment:${runMetadata.experimentLabel}` : "run_experiment:unrecorded";
}

function rankAggregateCases(
  rows: Array<typeof forecastScores.$inferSelect>,
  taskMeta: Map<string, { id: string; label: string; operationSubmode: string | null }>,
  resolutionById: Map<string, typeof forecastResolutions.$inferSelect>,
): PerformanceCase[] {
  const grouped = new Map<string, Array<typeof forecastScores.$inferSelect>>();
  for (const row of rows) {
    const taskId = readScoreTaskId(row.scoreConfig);
    if (!taskId) {
      continue;
    }
    grouped.set(taskId, [...(grouped.get(taskId) ?? []), row]);
  }

  return [...grouped.entries()]
    .flatMap(([taskId, groupRows]) => {
      const scores = meanScoresByType(groupRows);
      const primaryMetric = selectPrimaryMetric(scores);
      const primaryScore = primaryMetric ? scores[primaryMetric] : null;
      if (!primaryMetric || primaryScore === null) {
        return [];
      }
      const latest = groupRows.reduce((currentLatest, row) =>
        row.createdAt.getTime() > currentLatest.createdAt.getTime() ? row : currentLatest,
      groupRows[0]);
      const task = taskMeta.get(taskId);
      const resolution = latest.resolutionId ? resolutionById.get(latest.resolutionId) : null;
      return [{
        taskId,
        taskLabel: task?.label ?? taskId,
        forecastType: readString(latest.scoreConfig, "forecastType") ?? (task?.operationSubmode ? forecastTypeFromSubmode(task.operationSubmode) : "unknown"),
        primaryMetric,
        primaryScore,
        scoreRows: groupRows.length,
        scores,
        resolvedValue: asRecord(resolution?.resolvedValue ?? null),
        probability: readProbability(latest.scoreConfig),
        resolved: readResolved(latest.scoreConfig),
        binaryConfidence: readBinaryConfidenceSnapshot(latest.scoreConfig),
        calibrationGuard: readCalibrationGuardSnapshot(latest.scoreConfig),
        baselineSanity: readBaselineSanitySnapshot(latest.scoreConfig),
        marketAnchor: readMarketAnchorSnapshot(latest.scoreConfig),
        resolutionBoundary: readResolutionBoundarySnapshot(latest.scoreConfig),
        uncertaintyRange: readUncertaintyRangeSnapshot(latest.scoreConfig),
        componentWeighting: readComponentWeightingSnapshot(latest.scoreConfig),
        aggregateQuality: readAggregateQualitySnapshot(latest.scoreConfig),
        aggregateStats: readAggregateStatsSnapshot(latest.scoreConfig),
        conditionalForecast: readConditionalForecastSnapshot(latest.scoreConfig),
        thresholdedForecast: readThresholdedForecastSnapshot(latest.scoreConfig),
        numericForecast: readNumericForecastSnapshot(latest.scoreConfig),
        dateForecast: readDateForecastSnapshot(latest.scoreConfig),
        categoricalForecast: readCategoricalForecastSnapshot(latest.scoreConfig),
        evidenceCoverage: readEvidenceCoverageSnapshot(latest.scoreConfig),
        inputContext: readForecastInputContextSnapshot(latest.scoreConfig),
        runMetadata: readForecastRunSnapshot(latest.scoreConfig),
        resolutionId: latest.resolutionId,
        forecastAggregateId: latest.forecastAggregateId,
        createdAt: latest.createdAt,
      }];
    })
    .sort((left, right) => {
      if (left.primaryScore !== right.primaryScore) {
        return left.primaryScore - right.primaryScore;
      }
      return left.taskLabel.localeCompare(right.taskLabel);
    });
}

function buildScoreTrends(rows: Array<typeof forecastScores.$inferSelect>): PerformanceTrend[] {
  const windows = [
    { key: "last_7_days", label: "Last 7 days", days: 7 },
    { key: "last_30_days", label: "Last 30 days", days: 30 },
    { key: "last_90_days", label: "Last 90 days", days: 90 },
  ];
  const metricKeys = uniqueStrings(rows.map((row) => row.scoreType)).sort();
  const now = new Date();
  return windows.flatMap((window) =>
    metricKeys.map((metric) => {
      const metricRows = rows.filter((row) => row.scoreType === metric);
      const cutoff = now.getTime() - window.days * 86_400_000;
      const recentRows = metricRows.filter((row) => row.createdAt.getTime() >= cutoff);
      const baselineRows = metricRows.filter((row) => row.createdAt.getTime() < cutoff);
      const recentMean = meanScore(recentRows);
      const baselineMean = meanScore(baselineRows);
      const delta = recentMean === null || baselineMean === null ? null : recentMean - baselineMean;
      return {
        key: `${window.key}:${metric}`,
        label: window.label,
        metric,
        recentDays: window.days,
        recentCount: recentRows.length,
        baselineCount: baselineRows.length,
        recentMean,
        baselineMean,
        delta,
        direction: trendDirection(delta),
      };
    }),
  );
}

function trendDirection(delta: number | null): PerformanceTrend["direction"] {
  if (delta === null) {
    return "insufficient_data";
  }
  if (Math.abs(delta) < 0.0001) {
    return "flat";
  }
  return delta < 0 ? "improved" : "worse";
}

function buildNeedsAttentionQueue(
  worstCases: PerformanceCase[],
  trends: PerformanceTrend[],
  calibrationReport: BinaryCalibrationReport,
  calibrationGuardImpact: CalibrationGuardImpact,
): PerformanceAttentionItem[] {
  const caseItems = worstCases.slice(0, 5).map((item, index) => {
    const threshold = poorScoreThreshold(item.primaryMetric);
    const exceedsThreshold = threshold !== null && item.primaryScore >= threshold;
    const reason = exceedsThreshold
      ? `${item.primaryMetric} ${roundMetric(item.primaryScore)} exceeds review threshold ${threshold}`
      : `Among the worst resolved aggregate forecasts by ${item.primaryMetric}`;
    return {
      id: `poor:${item.taskId}:${item.primaryMetric}`,
      kind: "poor_resolved_forecast" as const,
      severity: exceedsThreshold ? "high" as const : "medium" as const,
      reason,
      recommendedActions: recommendAttentionActions({
        kind: "poor_resolved_forecast",
        metric: item.primaryMetric,
        severity: exceedsThreshold ? "high" : "medium",
        forecastType: item.forecastType,
      }),
      metric: item.primaryMetric,
      score: item.primaryScore,
      delta: null,
      taskId: item.taskId,
      taskLabel: item.taskLabel,
      forecastType: item.forecastType,
      rank: index,
    };
  });

  const trendItems = trends
    .filter((trend) => trend.direction === "worse" && trend.delta !== null && trend.recentCount > 0 && trend.baselineCount > 0)
    .map((trend) => ({
      id: `trend:${trend.key}`,
      kind: "worsening_trend" as const,
      severity: Math.abs(trend.delta ?? 0) >= trendDeltaHighThreshold(trend.metric) ? "high" as const : "medium" as const,
      reason: `${trend.metric} worsened over ${trend.label}: recent ${formatNullableMetric(trend.recentMean)}, baseline ${formatNullableMetric(trend.baselineMean)}`,
      recommendedActions: recommendAttentionActions({
        kind: "worsening_trend",
        metric: trend.metric,
        severity: Math.abs(trend.delta ?? 0) >= trendDeltaHighThreshold(trend.metric) ? "high" : "medium",
        forecastType: null,
      }),
      metric: trend.metric,
      score: trend.recentMean,
      delta: trend.delta,
      taskId: null,
      taskLabel: null,
      forecastType: null,
      rank: 100 + trend.recentDays,
    }));

  const baselineSanityCandidates = worstCases.flatMap((item) => {
    const threshold = poorScoreThreshold(item.primaryMetric);
    if (
      item.forecastType !== "binary" ||
      item.baselineSanity === null ||
      !["moderate_delta", "large_delta"].includes(item.baselineSanity.status) ||
      threshold === null ||
      item.primaryScore < threshold
    ) {
      return [];
    }
    return [{ item, baselineSanity: item.baselineSanity }];
  });
  const baselineSanityItems = baselineSanityCandidates
    .slice(0, 5)
    .map(({ item, baselineSanity }, index) => ({
      id: `baseline-sanity:${item.taskId}:${item.primaryMetric}`,
      kind: "baseline_sanity_miss" as const,
      severity: baselineSanity.status === "large_delta" ? "high" as const : "medium" as const,
      reason:
        `${item.primaryMetric} ${roundMetric(item.primaryScore)} followed a ${baselineSanity.status.replace(/_/g, " ")} of ${formatSignedMetric(baselineSanity.baselineDelta ?? 0)} points from the component base-rate anchor.`,
      recommendedActions: recommendAttentionActions({
        kind: "baseline_sanity_miss",
        metric: item.primaryMetric,
        severity: baselineSanity.status === "large_delta" ? "high" : "medium",
        forecastType: item.forecastType,
      }),
      metric: item.primaryMetric,
      score: item.primaryScore,
      delta: baselineSanity.baselineDelta,
      taskId: item.taskId,
      taskLabel: item.taskLabel,
      forecastType: item.forecastType,
      rank: 50 + index,
    }));

  const marketAnchorCandidates = worstCases.flatMap((item) => {
    const threshold = poorScoreThreshold(item.primaryMetric);
    if (
      item.forecastType !== "binary" ||
      item.marketAnchor === null ||
      !["moderate_delta", "large_delta"].includes(item.marketAnchor.status) ||
      threshold === null ||
      item.primaryScore < threshold
    ) {
      return [];
    }
    return [{ item, marketAnchor: item.marketAnchor }];
  });
  const marketAnchorItems = marketAnchorCandidates
    .slice(0, 5)
    .map(({ item, marketAnchor }, index) => ({
      id: `market-anchor:${item.taskId}:${item.primaryMetric}`,
      kind: "market_anchor_miss" as const,
      severity: marketAnchor.status === "large_delta" ? "high" as const : "medium" as const,
      reason:
        `${item.primaryMetric} ${roundMetric(item.primaryScore)} followed a ${marketAnchor.status.replace(/_/g, " ")} of ${formatSignedMetric(marketAnchor.marketDelta ?? 0)} points from the structured market-price anchor.`,
      recommendedActions: recommendAttentionActions({
        kind: "market_anchor_miss",
        metric: item.primaryMetric,
        severity: marketAnchor.status === "large_delta" ? "high" : "medium",
        forecastType: item.forecastType,
      }),
      metric: item.primaryMetric,
      score: item.primaryScore,
      delta: marketAnchor.marketDelta,
      taskId: item.taskId,
      taskLabel: item.taskLabel,
      forecastType: item.forecastType,
      rank: 55 + index,
    }));

  const resolutionBoundaryCandidates = worstCases.flatMap((item) => {
    const threshold = poorScoreThreshold(item.primaryMetric);
    if (
      item.forecastType !== "binary" ||
      item.resolutionBoundary === null ||
      item.resolutionBoundary.status !== "material_ambiguity" ||
      threshold === null ||
      item.primaryScore < threshold
    ) {
      return [];
    }
    return [{ item, resolutionBoundary: item.resolutionBoundary }];
  });
  const resolutionBoundaryItems = resolutionBoundaryCandidates
    .slice(0, 5)
    .map(({ item, resolutionBoundary }, index) => ({
      id: `resolution-boundary:${item.taskId}:${item.primaryMetric}`,
      kind: "resolution_boundary_miss" as const,
      severity: "high" as const,
      reason:
        `${item.primaryMetric} ${roundMetric(item.primaryScore)} followed material resolution-boundary ambiguity with ${resolutionBoundary.ambiguityFlagCount ?? 0} component flag(s).`,
      recommendedActions: recommendAttentionActions({
        kind: "resolution_boundary_miss",
        metric: item.primaryMetric,
        severity: "high",
        forecastType: item.forecastType,
      }),
      metric: item.primaryMetric,
      score: item.primaryScore,
      delta: resolutionBoundary.ambiguityFlagCount,
      taskId: item.taskId,
      taskLabel: item.taskLabel,
      forecastType: item.forecastType,
      rank: 58 + index,
    }));

  const uncertaintyRangeCandidates = worstCases.flatMap((item) => {
    const threshold = poorScoreThreshold(item.primaryMetric);
    if (
      item.forecastType !== "binary" ||
      item.uncertaintyRange === null ||
      item.uncertaintyRange.status !== "narrow" ||
      threshold === null ||
      item.primaryScore < threshold
    ) {
      return [];
    }
    return [{ item, uncertaintyRange: item.uncertaintyRange }];
  });
  const uncertaintyRangeItems = uncertaintyRangeCandidates
    .slice(0, 5)
    .map(({ item, uncertaintyRange }, index) => ({
      id: `uncertainty-range:${item.taskId}:${item.primaryMetric}`,
      kind: "uncertainty_range_miss" as const,
      severity: "medium" as const,
      reason:
        `${item.primaryMetric} ${roundMetric(item.primaryScore)} followed narrow component uncertainty ranges with median width ${formatNullableMetric(uncertaintyRange.medianRangeWidth)} points.`,
      recommendedActions: recommendAttentionActions({
        kind: "uncertainty_range_miss",
        metric: item.primaryMetric,
        severity: "medium",
        forecastType: item.forecastType,
      }),
      metric: item.primaryMetric,
      score: item.primaryScore,
      delta: uncertaintyRange.medianRangeWidth,
      taskId: item.taskId,
      taskLabel: item.taskLabel,
      forecastType: item.forecastType,
      rank: 59 + index,
    }));

  const componentWeightingCandidates = worstCases.flatMap((item) => {
    const threshold = poorScoreThreshold(item.primaryMetric);
    if (
      item.forecastType !== "binary" ||
      item.componentWeighting === null ||
      !["has_downweight", "mixed_weights"].includes(item.componentWeighting.status) ||
      threshold === null ||
      item.primaryScore < threshold
    ) {
      return [];
    }
    return [{ item, componentWeighting: item.componentWeighting }];
  });
  const componentWeightingItems = componentWeightingCandidates
    .slice(0, 5)
    .map(({ item, componentWeighting }, index) => ({
      id: `component-weighting:${item.taskId}:${item.primaryMetric}`,
      kind: "component_weighting_miss" as const,
      severity: componentWeighting.status === "mixed_weights" ? "high" as const : "medium" as const,
      reason:
        `${item.primaryMetric} ${roundMetric(item.primaryScore)} followed ${componentWeighting.status.replace(/_/g, " ")} in component audits (${componentWeighting.downweightCount} downweighted, ${componentWeighting.upweightCount} upweighted).`,
      recommendedActions: recommendAttentionActions({
        kind: "component_weighting_miss",
        metric: item.primaryMetric,
        severity: componentWeighting.status === "mixed_weights" ? "high" : "medium",
        forecastType: item.forecastType,
      }),
      metric: item.primaryMetric,
      score: item.primaryScore,
      delta: componentWeighting.downweightCount,
      taskId: item.taskId,
      taskLabel: item.taskLabel,
      forecastType: item.forecastType,
      rank: 61 + index,
    }));

  const aggregateQualityCandidates = worstCases.flatMap((item) => {
    const threshold = poorScoreThreshold(item.primaryMetric);
    if (
      item.forecastType !== "binary" ||
      item.aggregateQuality === null ||
      threshold === null ||
      item.primaryScore < threshold ||
      (item.aggregateQuality.qualityApproved !== false && item.aggregateQuality.maxIterationsReached !== true)
    ) {
      return [];
    }
    return [{ item, aggregateQuality: item.aggregateQuality }];
  });
  const aggregateQualityItems = aggregateQualityCandidates
    .slice(0, 5)
    .map(({ item, aggregateQuality }, index) => ({
      id: `aggregate-quality:${item.taskId}:${item.primaryMetric}`,
      kind: "aggregate_quality_miss" as const,
      severity: aggregateQuality.maxIterationsReached ? "high" as const : "medium" as const,
      reason:
        `${item.primaryMetric} ${roundMetric(item.primaryScore)} came from a ${aggregateQuality.convergenceStatus.replace(/_/g, " ")} binary aggregate after ${aggregateQuality.roundsUsed ?? "unknown"} review round(s).`,
      recommendedActions: recommendAttentionActions({
        kind: "aggregate_quality_miss",
        metric: item.primaryMetric,
        severity: aggregateQuality.maxIterationsReached ? "high" : "medium",
        forecastType: item.forecastType,
      }),
      metric: item.primaryMetric,
      score: item.primaryScore,
      delta: null,
      taskId: item.taskId,
      taskLabel: item.taskLabel,
      forecastType: item.forecastType,
      rank: 60 + index,
    }));

  const binaryConfidenceCandidates = worstCases.flatMap((item) => {
    const threshold = poorScoreThreshold(item.primaryMetric);
    const signal = binaryConfidenceMissSignal(item);
    if (signal === null || threshold === null || item.primaryScore < threshold) {
      return [];
    }
    return [{ item, signal }];
  });
  const binaryConfidenceItems = binaryConfidenceCandidates
    .slice(0, 5)
    .map(({ item, signal }, index) => ({
      id: `binary-confidence:${item.taskId}:${item.primaryMetric}`,
      kind: "binary_confidence_miss" as const,
      severity: signal.severity,
      reason: signal.reason,
      recommendedActions: recommendAttentionActions({
        kind: "binary_confidence_miss",
        metric: item.primaryMetric,
        severity: signal.severity,
        forecastType: item.forecastType,
      }),
      metric: item.primaryMetric,
      score: item.primaryScore,
      delta: signal.delta,
      taskId: item.taskId,
      taskLabel: item.taskLabel,
      forecastType: item.forecastType,
      rank: 59 + index,
    }));

  const componentDisagreementCandidates = worstCases.flatMap((item) => {
    const threshold = poorScoreThreshold(item.primaryMetric);
    const signal = componentDisagreementMissSignal(item);
    if (signal === null || threshold === null || item.primaryScore < threshold) {
      return [];
    }
    return [{ item, signal }];
  });
  const componentDisagreementItems = componentDisagreementCandidates
    .slice(0, 5)
    .map(({ item, signal }, index) => ({
      id: `component-disagreement:${item.taskId}:${item.primaryMetric}`,
      kind: "component_disagreement_miss" as const,
      severity: signal.severity,
      reason: `${item.primaryMetric} ${roundMetric(item.primaryScore)} followed ${signal.reason}.`,
      recommendedActions: recommendAttentionActions({
        kind: "component_disagreement_miss",
        metric: item.primaryMetric,
        severity: signal.severity,
        forecastType: item.forecastType,
      }),
      metric: item.primaryMetric,
      score: item.primaryScore,
      delta: signal.delta,
      taskId: item.taskId,
      taskLabel: item.taskLabel,
      forecastType: item.forecastType,
      rank: 70 + index,
    }));

  const evidenceCoverageItems = buildMetadataAttentionItems({
    worstCases,
    idPrefix: "evidence-coverage",
    kind: "evidence_coverage_miss",
    rankStart: 80,
    signal: evidenceCoverageMissSignal,
  });
  const inputContextItems = buildMetadataAttentionItems({
    worstCases,
    idPrefix: "input-context",
    kind: "input_context_miss",
    rankStart: 90,
    signal: inputContextMissSignal,
  });
  const runMetadataItems = buildMetadataAttentionItems({
    worstCases,
    idPrefix: "run-metadata",
    kind: "run_metadata_miss",
    rankStart: 100,
    signal: runMetadataMissSignal,
  });

  const calibrationItems = calibrationReport.calibrationDiagnostics.map((diagnostic) => ({
    id: diagnostic.id,
    kind: "calibration_mismatch" as const,
    severity: diagnostic.severity,
    reason: diagnostic.reason,
    recommendedActions: diagnostic.recommendedActions,
    metric: diagnostic.metric,
    score: diagnostic.score,
    delta: diagnostic.delta,
    taskId: null,
    taskLabel: `${diagnostic.bucketLabel} calibration bucket`,
    forecastType: "binary",
    rank: 200 - diagnostic.score,
  }));

  const overallGuardImpactItems = calibrationGuardImpact.status === "worse" && calibrationGuardImpact.brierDelta !== null
    ? [{
        id: "calibration-guard-impact:worse-brier",
        kind: "calibration_guard_regression" as const,
        severity: "high" as const,
        reason:
          `Guarded aggregate forecasts have worse mean Brier than unguarded aggregates by ${formatSignedMetric(calibrationGuardImpact.brierDelta)}.`,
        recommendedActions: recommendAttentionActions({
          kind: "calibration_guard_regression",
          metric: "brier",
          severity: "high",
          forecastType: "binary",
        }),
        metric: "brier",
        score: calibrationGuardImpact.guardedMeanBrier,
        delta: calibrationGuardImpact.brierDelta,
        taskId: null,
        taskLabel: "Calibration guard impact",
        forecastType: "binary",
        rank: 150,
      }]
    : [];
  const ruleGuardImpactItems = calibrationGuardImpact.byRule
    .filter((impact) => impact.status === "worse" && impact.brierDelta !== null)
    .slice(0, 5)
    .map((impact, index) => ({
      id: `calibration-guard-impact:${impact.ruleId}:worse-brier`,
      kind: "calibration_guard_regression" as const,
      severity: "high" as const,
      reason:
        `${impact.ruleId} guarded aggregate forecasts have worse mean Brier than unguarded aggregates by ${formatSignedMetric(impact.brierDelta ?? 0)}.`,
      recommendedActions: recommendAttentionActions({
        kind: "calibration_guard_regression",
        metric: "brier",
        severity: "high",
        forecastType: "binary",
      }),
      metric: "brier",
      score: impact.guardedMeanBrier,
      delta: impact.brierDelta,
      taskId: null,
      taskLabel: `Calibration guard rule: ${impact.ruleId}`,
      forecastType: "binary",
      rank: 151 + index,
    }));

  return [
    ...caseItems,
    ...baselineSanityItems,
    ...marketAnchorItems,
    ...resolutionBoundaryItems,
    ...uncertaintyRangeItems,
    ...componentWeightingItems,
    ...aggregateQualityItems,
    ...binaryConfidenceItems,
    ...componentDisagreementItems,
    ...evidenceCoverageItems,
    ...inputContextItems,
    ...runMetadataItems,
    ...trendItems,
    ...overallGuardImpactItems,
    ...ruleGuardImpactItems,
    ...calibrationItems,
  ]
    .sort((left, right) => {
      const severityDelta = severityRank(right.severity) - severityRank(left.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return left.rank - right.rank;
    })
    .slice(0, 10)
    .map(({ rank: _rank, ...item }) => item);
}

function componentDisagreementMissSignal(item: PerformanceCase): { reason: string; delta: number | null; severity: "high" | "medium" } | null {
  if (
    item.forecastType === "binary" &&
    item.aggregateStats !== null &&
    ["high", "extreme"].includes(item.aggregateStats.disagreementBand)
  ) {
    return {
      reason: `${item.aggregateStats.disagreementBand} component disagreement of ${formatNullableMetric(item.aggregateStats.disagreement)} points`,
      delta: item.aggregateStats.disagreement,
      severity: item.aggregateStats.disagreementBand === "extreme" ? "high" : "medium",
    };
  }

  if (
    item.forecastType === "conditional" &&
    item.conditionalForecast !== null &&
    (
      ["moderate", "wide"].includes(item.conditionalForecast.branchDisagreementBand) ||
      item.conditionalForecast.effectDirectionAgreement === "mixed"
    )
  ) {
    const severity = item.conditionalForecast.branchDisagreementBand === "wide" ||
      item.conditionalForecast.effectDirectionAgreement === "mixed"
      ? "high" as const
      : "medium" as const;
    return {
      reason:
        `${item.conditionalForecast.branchDisagreementBand} conditional branch disagreement with ${item.conditionalForecast.effectDirectionAgreement.replace(/_/g, " ")} effect direction`,
      delta: item.conditionalForecast.effectDisagreement,
      severity,
    };
  }

  if (
    item.forecastType === "thresholded" &&
    item.thresholdedForecast !== null &&
    ["moderate", "wide"].includes(item.thresholdedForecast.componentDisagreementBand)
  ) {
    return {
      reason:
        `${item.thresholdedForecast.componentDisagreementBand} threshold-curve component disagreement of ${formatNullableMetric(item.thresholdedForecast.componentProbabilityDisagreement)} points`,
      delta: item.thresholdedForecast.componentProbabilityDisagreement,
      severity: item.thresholdedForecast.componentDisagreementBand === "wide" ? "high" : "medium",
    };
  }

  if (
    item.forecastType === "numeric" &&
    item.numericForecast !== null &&
    (item.numericForecast.resolvedPositionBand === "below_p10" || item.numericForecast.resolvedPositionBand === "above_p90")
  ) {
    return {
      reason:
        `resolved value was ${item.numericForecast.resolvedPositionBand.replace(/_/g, " ")} for numeric forecast interval ${formatNullableMetric(item.numericForecast.p10)}-${formatNullableMetric(item.numericForecast.p90)} ${item.numericForecast.unit ?? "units"}`,
      delta: item.numericForecast.actualValue,
      severity: "high",
    };
  }

  if (
    item.forecastType === "numeric" &&
    item.numericForecast !== null &&
    ["moderate", "wide"].includes(item.numericForecast.p50DisagreementBand)
  ) {
    return {
      reason:
        `${item.numericForecast.p50DisagreementBand} numeric component-value disagreement of ${formatNullableMetric(item.numericForecast.p50Disagreement)} ${item.numericForecast.unit ?? "units"}`,
      delta: item.numericForecast.p50Disagreement,
      severity: item.numericForecast.p50DisagreementBand === "wide" ? "high" : "medium",
    };
  }

  if (
    item.forecastType === "date" &&
    item.dateForecast !== null &&
    (item.dateForecast.resolvedPositionBand === "before_p10" || item.dateForecast.resolvedPositionBand === "after_p90")
  ) {
    return {
      reason:
        `resolved date was ${item.dateForecast.resolvedPositionBand.replace(/_/g, " ")} for date forecast interval ${item.dateForecast.p10 ?? "unknown"}-${item.dateForecast.p90 ?? "unknown"}`,
      delta: item.dateForecast.intervalDays,
      severity: "high",
    };
  }

  if (
    item.forecastType === "date" &&
    item.dateForecast !== null &&
    ["moderate", "wide"].includes(item.dateForecast.p50DisagreementBand)
  ) {
    return {
      reason:
        `${item.dateForecast.p50DisagreementBand} component median-date disagreement of ${formatNullableMetric(item.dateForecast.p50DisagreementDays)} days`,
      delta: item.dateForecast.p50DisagreementDays,
      severity: item.dateForecast.p50DisagreementBand === "wide" ? "high" : "medium",
    };
  }

  if (
    item.forecastType === "categorical" &&
    item.categoricalForecast !== null &&
    ["split", "none"].includes(item.categoricalForecast.topCategoryAgreementBand)
  ) {
    return {
      reason:
        `${item.categoricalForecast.topCategoryAgreementBand} component agreement on the aggregate top category (${formatNullableMetric(item.categoricalForecast.topCategoryVoteShare)}% vote share)`,
      delta: item.categoricalForecast.topCategoryVoteShare,
      severity: item.categoricalForecast.topCategoryAgreementBand === "none" ? "high" : "medium",
    };
  }

  return null;
}

function buildMetadataAttentionItems(input: {
  worstCases: PerformanceCase[];
  idPrefix: string;
  kind: PerformanceAttentionItem["kind"];
  rankStart: number;
  signal: (item: PerformanceCase) => { reason: string; delta: number | null; severity: "high" | "medium" } | null;
}) {
  return input.worstCases
    .flatMap((item) => {
      const threshold = poorScoreThreshold(item.primaryMetric);
      const signal = input.signal(item);
      if (signal === null || threshold === null || item.primaryScore < threshold) {
        return [];
      }
      return [{ item, signal }];
    })
    .slice(0, 5)
    .map(({ item, signal }, index) => ({
      id: `${input.idPrefix}:${item.taskId}:${item.primaryMetric}`,
      kind: input.kind,
      severity: signal.severity,
      reason: `${item.primaryMetric} ${roundMetric(item.primaryScore)} followed ${signal.reason}.`,
      recommendedActions: recommendAttentionActions({
        kind: input.kind,
        metric: item.primaryMetric,
        severity: signal.severity,
        forecastType: item.forecastType,
      }),
      metric: item.primaryMetric,
      score: item.primaryScore,
      delta: signal.delta,
      taskId: item.taskId,
      taskLabel: item.taskLabel,
      forecastType: item.forecastType,
      rank: input.rankStart + index,
    }));
}

function evidenceCoverageMissSignal(item: PerformanceCase): { reason: string; delta: number | null; severity: "high" | "medium" } | null {
  const evidence = item.evidenceCoverage;
  if (!evidence) {
    return null;
  }
  if (evidence.sourceTimingBand === "post_as_of") {
    return {
      reason: `${evidence.postAsOfSourceCount ?? 0} cited source(s) published after the evidence as-of date`,
      delta: evidence.postAsOfSourceCount,
      severity: "high",
    };
  }
  if (evidence.sourceCountBand === "none" || evidence.sourceCountBand === "sparse") {
    return {
      reason: `${evidence.sourceCountBand} evidence coverage with ${evidence.sourceCount ?? 0} cited source(s)`,
      delta: evidence.sourceCount,
      severity: evidence.sourceCountBand === "none" ? "high" : "medium",
    };
  }
  if (evidence.sourceDiversityBand === "single_domain") {
    return {
      reason: `all cited evidence came from one source domain across ${evidence.sourceCount ?? 0} cited source(s)`,
      delta: evidence.sourceDomainCount,
      severity: "medium",
    };
  }
  if (evidence.sourceConcentrationBand === "dominant" || evidence.sourceConcentrationBand === "concentrated") {
    return {
      reason: `${evidence.sourceConcentrationBand} evidence concentration: top source domain supplied ${formatNullableMetric(evidence.topSourceDomainShare === null ? null : evidence.topSourceDomainShare * 100)}% of cited source(s)`,
      delta: evidence.topSourceDomainShare,
      severity: evidence.sourceConcentrationBand === "dominant" ? "high" : "medium",
    };
  }
  if (evidence.sourceDateCoverageBand === "none" || evidence.sourceDateCoverageBand === "partial") {
    return {
      reason: `${evidence.sourceDateCoverageBand} source-date coverage across ${evidence.sourceCount ?? 0} cited source(s)`,
      delta: evidence.datedSourceCount,
      severity: evidence.sourceDateCoverageBand === "none" ? "high" : "medium",
    };
  }
  if (evidence.sourceFreshnessBand === "old" || evidence.sourceFreshnessBand === "stale") {
    return {
      reason: `${evidence.sourceFreshnessBand} newest cited source (${evidence.newestSourceAgeDays ?? 0} days old)`,
      delta: evidence.newestSourceAgeDays,
      severity: evidence.sourceFreshnessBand === "old" ? "high" : "medium",
    };
  }
  if (evidence.uncertaintyCountBand === "none") {
    return {
      reason: "no explicit uncertainty factors in the forecast rationale",
      delta: evidence.uncertaintyCount,
      severity: "medium",
    };
  }
  if (evidence.rationaleLengthBand === "absent" || evidence.rationaleLengthBand === "short") {
    return {
      reason: `${evidence.rationaleLengthBand} forecast rationale (${evidence.rationaleLength ?? 0} words)`,
      delta: evidence.rationaleLength,
      severity: evidence.rationaleLengthBand === "absent" ? "high" : "medium",
    };
  }
  return null;
}

function binaryConfidenceMissSignal(item: PerformanceCase): { reason: string; delta: number | null; severity: "high" | "medium" } | null {
  const confidence = item.binaryConfidence;
  if (item.forecastType !== "binary" || !confidence) {
    return null;
  }
  if (confidence.confidenceBand === "extreme" || confidence.confidenceBand === "very_likely") {
    return {
      reason: `${confidence.confidenceBand.replace(/_/g, " ")} binary forecast on the ${confidence.forecastSide} side (${confidence.probability ?? "unknown"}%)`,
      delta: confidence.distanceFromEven,
      severity: confidence.confidenceBand === "extreme" ? "high" : "medium",
    };
  }
  return null;
}

function inputContextMissSignal(item: PerformanceCase): { reason: string; delta: number | null; severity: "high" | "medium" } | null {
  const context = item.inputContext;
  if (!context) {
    return null;
  }
  if (context.contextCompletenessBand === "sparse") {
    return {
      reason: `sparse input context with ${context.contextCompleteness} populated context field(s)`,
      delta: context.contextCompleteness,
      severity: "high",
    };
  }
  if (!context.hasResolutionCriteria || !context.hasResolutionDate) {
    const missing = [
      !context.hasResolutionCriteria ? "resolution criteria" : null,
      !context.hasResolutionDate ? "resolution date" : null,
    ].filter((part): part is string => Boolean(part));
    return {
      reason: `missing ${missing.join(" and ")} in the forecast input`,
      delta: context.contextCompleteness,
      severity: !context.hasResolutionCriteria ? "high" : "medium",
    };
  }
  if (context.questionLengthBand === "short" || context.questionLengthBand === "long") {
    return {
      reason: `${context.questionLengthBand} question text (${context.questionLength ?? 0} words)`,
      delta: context.questionLength,
      severity: "medium",
    };
  }
  return null;
}

function runMetadataMissSignal(item: PerformanceCase): { reason: string; delta: number | null; severity: "high" | "medium" } | null {
  const run = item.runMetadata;
  if (!run) {
    return null;
  }
  if (run.durationBand === "fast" || run.durationBand === "very_slow") {
    return {
      reason: `${run.durationBand.replace(/_/g, " ")} workflow duration (${formatNullableMetric(run.durationSeconds)} seconds)`,
      delta: run.durationSeconds,
      severity: run.durationBand === "fast" ? "high" : "medium",
    };
  }
  return null;
}

function recommendAttentionActions(input: {
  kind: PerformanceAttentionItem["kind"];
  metric: string;
  severity: PerformanceAttentionItem["severity"];
  forecastType: string | null;
}) {
  const actions = new Set<string>();
  if (input.kind === "poor_resolved_forecast") {
    actions.add("Open the run report and compare the final answer against the written resolution criteria.");
    actions.add("Inspect component disagreement and final calibration notes before changing prompts or defaults.");
  } else if (input.kind === "baseline_sanity_miss") {
    actions.add("Audit why the aggregate moved away from the component base-rate anchor before changing prompts or calibration defaults.");
    actions.add("Compare the component base-rate estimates, inside-view deltas, and final rationale against the resolved outcome.");
  } else if (input.kind === "market_anchor_miss") {
    actions.add("Audit whether the forecast had a valid evidence or resolution-boundary reason to diverge from the structured market-price anchor.");
    actions.add("Compare resolved outcomes for similar market-anchor divergence bands before turning this into a deterministic adjustment.");
  } else if (input.kind === "resolution_boundary_miss") {
    actions.add("Review whether the forecast should have widened uncertainty or changed probability because of resolution-boundary ambiguity.");
    actions.add("Tighten the question template or resolution criteria before using similar cases for calibration changes.");
  } else if (input.kind === "uncertainty_range_miss") {
    actions.add("Review whether component forecasts were overconfident; compare probability ranges against the actual resolved miss.");
    actions.add("Tighten prompts or review rules if narrow ranges repeatedly accompany poor resolved forecasts.");
  } else if (input.kind === "component_weighting_miss") {
    actions.add("Review whether the aggregate downweighted the component that best matched the resolved outcome.");
    actions.add("Compare component audits, aggregation anchor, and final rationale before changing role weights or prompts.");
  } else if (input.kind === "aggregate_quality_miss") {
    actions.add("Review the final quality issues and review rationale before changing prompts or defaults.");
    actions.add("Compare max-iteration cases against approved cases to decide whether the review loop needs another round or sharper rejection criteria.");
  } else if (input.kind === "binary_confidence_miss") {
    actions.add("Check whether the evidence justified the final probability distance from 50%.");
    actions.add("Compare the final side against base-rate, inside-view, and skeptical component probabilities.");
  } else if (input.kind === "component_disagreement_miss") {
    actions.add("Inspect component forecasts before changing aggregation defaults; identify whether one role captured the resolved signal or all roles missed different parts.");
    actions.add("Compare mean, median, aggregation anchor, and final rationale to see whether disagreement was explained or over-smoothed.");
  } else if (input.kind === "evidence_coverage_miss") {
    actions.add("Audit cited sources, dated-source coverage, uncertainty notes, and rationale depth before changing model or aggregation defaults.");
    actions.add("Add a benchmark case if sparse evidence repeatedly accompanies poor resolved forecasts in this forecast type.");
  } else if (input.kind === "input_context_miss") {
    actions.add("Tighten the input template before tuning prompts: require resolution criteria, resolution timing, and enough background for this forecast type.");
    actions.add("Compare misses with richer-context cases to separate weak input setup from model reasoning failure.");
  } else if (input.kind === "run_metadata_miss") {
    actions.add("Inspect the run trace for premature completion, tool failures, retries, or unusually long loops before changing forecast prompts.");
    actions.add("Compare duration bands against resolved score groups to decide whether runtime limits or workflow orchestration need adjustment.");
  } else if (input.kind === "worsening_trend") {
    actions.add("Review recent resolved runs in this metric before treating the trend as a workflow regression.");
    actions.add("Compare recent cases against older baseline cases for domain mix or resolution-source drift.");
  } else if (input.kind === "calibration_mismatch") {
    actions.add("Review the affected calibration bucket before changing prompts or defaults.");
    actions.add("Compare mean forecast probability against observed outcome rate for resolved binary aggregates.");
  } else {
    actions.add("Review guarded aggregate forecasts before adding or promoting more default calibration guard rules.");
    actions.add("Compare guarded cases against unguarded resolved cases for domain mix, sample size, and rule-specific failure patterns.");
    actions.add("Defer default guard promotion until the guarded-vs-unguarded Brier delta recovers on later resolved forecasts.");
  }

  if (isProbabilityMetric(input.metric)) {
    actions.add("Check for overconfidence: compare predicted probability, resolved outcome, and calibration bucket.");
  }
  if (input.metric.includes("log")) {
    actions.add("Look for near-zero or near-one probabilities that made the log score fragile.");
  }
  if (input.metric.includes("absolute") || input.forecastType === "numeric" || input.forecastType === "date") {
    actions.add("Inspect units, target date/value parsing, and whether the forecast should have used a quantile distribution.");
  }
  if (input.forecastType === "categorical") {
    actions.add("Check whether the resolved category was present in the allowed option set and assigned non-trivial mass.");
  }
  if (input.forecastType === "thresholded") {
    actions.add("Review threshold ordering and whether the curve was monotonic around the resolved value.");
  }
  if (input.forecastType === "conditional") {
    actions.add("Separate condition resolution from outcome resolution before judging the conditional forecast.");
  }
  if (input.severity === "high") {
    actions.add("Add or update a benchmark case that captures this failure before promoting related workflow changes.");
  }
  return [...actions].slice(0, 5);
}

function isProbabilityMetric(metric: string) {
  return metric.includes("brier") || metric.includes("log") || metric === "condition_brier" || metric === "condition_log";
}

function poorScoreThreshold(metric: string) {
  if (metric === "brier" || metric === "categorical_brier" || metric === "thresholded_brier" || metric === "conditional_brier") {
    return 0.25;
  }
  if (metric === "log" || metric === "categorical_log" || metric === "thresholded_log" || metric === "conditional_log") {
    return 0.69;
  }
  if (metric === "absolute_percentage_error") {
    return 0.25;
  }
  if (metric === "absolute_days_error") {
    return 30;
  }
  return null;
}

function trendDeltaHighThreshold(metric: string) {
  return poorScoreThreshold(metric) ? (poorScoreThreshold(metric) ?? 0) / 2 : 0.1;
}

function severityRank(severity: PerformanceAttentionItem["severity"]) {
  return severity === "high" ? 2 : 1;
}

function formatNullableMetric(value: number | null) {
  return value === null ? "unknown" : String(roundMetric(value));
}

function formatSignedMetric(value: number) {
  return `${value >= 0 ? "+" : ""}${roundMetric(value)}`;
}

function selectPrimaryMetric(meanScores: Record<string, number>) {
  const preference = [
    "brier",
    "categorical_brier",
    "thresholded_brier",
    "conditional_brier",
    "absolute_error",
    "absolute_days_error",
    "absolute_percentage_error",
  ];
  return preference.find((metric) => metric in meanScores) ?? Object.keys(meanScores).sort()[0] ?? null;
}

function formatPerformanceGroupLabel(key: string) {
  return key
    .split(":")
    .map((part) => part.replace(/_/g, " "))
    .join(" / ");
}

function renderPerformanceMarkdown(input: {
  resolvedTasks: number;
  productScoreRows: number;
  byForecastType: PerformanceGroup[];
  byTarget: PerformanceGroup[];
  byForecaster: PerformanceGroup[];
  byCalibrationGuard: PerformanceGroup[];
  byBinaryConfidence: PerformanceGroup[];
  byBinaryForecastSide: PerformanceGroup[];
  byBaselineSanity: PerformanceGroup[];
  byMarketAnchor: PerformanceGroup[];
  byResolutionBoundary: PerformanceGroup[];
  byUncertaintyRange: PerformanceGroup[];
  byComponentWeighting: PerformanceGroup[];
  byAggregateQuality: PerformanceGroup[];
  byAggregateDisagreement: PerformanceGroup[];
  byAggregationAnchor: PerformanceGroup[];
  byResearchDepth: PerformanceGroup[];
  byForecasterPanelSize: PerformanceGroup[];
  byComplexityScore: PerformanceGroup[];
  byConditionalBranch: PerformanceGroup[];
  byConditionalEffect: PerformanceGroup[];
  byConditionalBranchDisagreement: PerformanceGroup[];
  byThresholdedDirection: PerformanceGroup[];
  byThresholdedSource: PerformanceGroup[];
  byThresholdedRepair: PerformanceGroup[];
  byThresholdedCurveSpread: PerformanceGroup[];
  byThresholdedComponentDisagreement: PerformanceGroup[];
  byNumericInterval: PerformanceGroup[];
  byNumericUnit: PerformanceGroup[];
  byNumericP50Disagreement: PerformanceGroup[];
  byNumericResolvedPosition: PerformanceGroup[];
  byDateInterval: PerformanceGroup[];
  byDateNeverProbability: PerformanceGroup[];
  byDateP50Disagreement: PerformanceGroup[];
  byDateResolvedPosition: PerformanceGroup[];
  byCategoricalConfidence: PerformanceGroup[];
  byCategoricalEntropy: PerformanceGroup[];
  byCategoricalSource: PerformanceGroup[];
  byCategoricalCoverage: PerformanceGroup[];
  byCategoricalTopAgreement: PerformanceGroup[];
  byEvidenceSourceCount: PerformanceGroup[];
  byEvidenceSourceDiversity: PerformanceGroup[];
  byEvidenceSourceConcentration: PerformanceGroup[];
  byEvidenceSourceDateCoverage: PerformanceGroup[];
  byEvidenceSourceFreshness: PerformanceGroup[];
  byEvidenceSourceTiming: PerformanceGroup[];
  byEvidenceUncertaintyCount: PerformanceGroup[];
  byEvidenceRationaleLength: PerformanceGroup[];
  byInputContextCompleteness: PerformanceGroup[];
  byInputMarketContext: PerformanceGroup[];
  byInputQuestionLength: PerformanceGroup[];
  byInputCategoryCount: PerformanceGroup[];
  byInputThresholdCount: PerformanceGroup[];
  byRunDuration: PerformanceGroup[];
  byRunExperiment: PerformanceGroup[];
  bestResolvedForecasts: PerformanceCase[];
  worstResolvedForecasts: PerformanceCase[];
  scoreTrends: PerformanceTrend[];
  needsAttention: PerformanceAttentionItem[];
  calibrationBuckets: BinaryCalibrationReport["calibrationBuckets"];
  calibrationSummary: BinaryCalibrationReport["calibrationSummary"];
  candidateCalibrationGuardRules: BinaryCalibrationReport["candidateCalibrationGuardRules"];
  calibrationGuardImpact: CalibrationGuardImpact;
}) {
  const lines = [
    "# Forecast performance report",
    "",
    `Resolved tasks: ${input.resolvedTasks}`,
    `Product score rows: ${input.productScoreRows}`,
    "",
    "## Forecast types",
    ...renderGroupTable(input.byForecastType),
    "",
    "## Targets",
    ...renderGroupTable(input.byTarget),
    "",
    "## Forecasters",
    ...renderGroupTable(input.byForecaster),
    "",
    "## Calibration guard groups",
    ...renderGroupTable(input.byCalibrationGuard),
    "",
    "## Binary confidence groups",
    ...renderGroupTable(input.byBinaryConfidence),
    "",
    "## Binary side groups",
    ...renderGroupTable(input.byBinaryForecastSide),
    "",
    "## Baseline sanity groups",
    ...renderGroupTable(input.byBaselineSanity),
    "",
    "## Market-anchor groups",
    ...renderGroupTable(input.byMarketAnchor),
    "",
    "## Resolution-boundary groups",
    ...renderGroupTable(input.byResolutionBoundary),
    "",
    "## Uncertainty-range groups",
    ...renderGroupTable(input.byUncertaintyRange),
    "",
    "## Component-weighting groups",
    ...renderGroupTable(input.byComponentWeighting),
    "",
    "## Aggregate quality groups",
    ...renderGroupTable(input.byAggregateQuality),
    "",
    "## Component disagreement groups",
    ...renderGroupTable(input.byAggregateDisagreement),
    "",
    "## Aggregation anchor groups",
    ...renderGroupTable(input.byAggregationAnchor),
    "",
    "## Research depth groups",
    ...renderGroupTable(input.byResearchDepth),
    "",
    "## Forecaster panel size groups",
    ...renderGroupTable(input.byForecasterPanelSize),
    "",
    "## Complexity score groups",
    ...renderGroupTable(input.byComplexityScore),
    "",
    "## Conditional branch groups",
    ...renderGroupTable(input.byConditionalBranch),
    "",
    "## Conditional effect groups",
    ...renderGroupTable(input.byConditionalEffect),
    "",
    "## Conditional branch disagreement groups",
    ...renderGroupTable(input.byConditionalBranchDisagreement),
    "",
    "## Thresholded direction groups",
    ...renderGroupTable(input.byThresholdedDirection),
    "",
    "## Thresholded source groups",
    ...renderGroupTable(input.byThresholdedSource),
    "",
    "## Thresholded monotonicity groups",
    ...renderGroupTable(input.byThresholdedRepair),
    "",
    "## Thresholded curve-spread groups",
    ...renderGroupTable(input.byThresholdedCurveSpread),
    "",
    "## Thresholded component-disagreement groups",
    ...renderGroupTable(input.byThresholdedComponentDisagreement),
    "",
    "## Numeric interval groups",
    ...renderGroupTable(input.byNumericInterval),
    "",
    "## Numeric unit groups",
    ...renderGroupTable(input.byNumericUnit),
    "",
    "## Numeric component-value groups",
    ...renderGroupTable(input.byNumericP50Disagreement),
    "",
    "## Numeric resolved-position groups",
    ...renderGroupTable(input.byNumericResolvedPosition),
    "",
    "## Date interval groups",
    ...renderGroupTable(input.byDateInterval),
    "",
    "## Date never-probability groups",
    ...renderGroupTable(input.byDateNeverProbability),
    "",
    "## Date component timing groups",
    ...renderGroupTable(input.byDateP50Disagreement),
    "",
    "## Date resolved-position groups",
    ...renderGroupTable(input.byDateResolvedPosition),
    "",
    "## Categorical confidence groups",
    ...renderGroupTable(input.byCategoricalConfidence),
    "",
    "## Categorical entropy groups",
    ...renderGroupTable(input.byCategoricalEntropy),
    "",
    "## Categorical source groups",
    ...renderGroupTable(input.byCategoricalSource),
    "",
    "## Categorical coverage groups",
    ...renderGroupTable(input.byCategoricalCoverage),
    "",
    "## Categorical top-agreement groups",
    ...renderGroupTable(input.byCategoricalTopAgreement),
    "",
    "## Evidence source-count groups",
    ...renderGroupTable(input.byEvidenceSourceCount),
    "",
    "## Evidence source-diversity groups",
    ...renderGroupTable(input.byEvidenceSourceDiversity),
    "",
    "## Evidence source-concentration groups",
    ...renderGroupTable(input.byEvidenceSourceConcentration),
    "",
    "## Evidence source-date groups",
    ...renderGroupTable(input.byEvidenceSourceDateCoverage),
    "",
    "## Evidence source-freshness groups",
    ...renderGroupTable(input.byEvidenceSourceFreshness),
    "",
    "## Evidence source-timing groups",
    ...renderGroupTable(input.byEvidenceSourceTiming),
    "",
    "## Evidence uncertainty-count groups",
    ...renderGroupTable(input.byEvidenceUncertaintyCount),
    "",
    "## Evidence rationale-length groups",
    ...renderGroupTable(input.byEvidenceRationaleLength),
    "",
    "## Input context-completeness groups",
    ...renderGroupTable(input.byInputContextCompleteness),
    "",
    "## Input market-context groups",
    ...renderGroupTable(input.byInputMarketContext),
    "",
    "## Input question-length groups",
    ...renderGroupTable(input.byInputQuestionLength),
    "",
    "## Input category-count groups",
    ...renderGroupTable(input.byInputCategoryCount),
    "",
    "## Input threshold-count groups",
    ...renderGroupTable(input.byInputThresholdCount),
    "",
    "## Run duration groups",
    ...renderGroupTable(input.byRunDuration),
    "",
    "## Run experiment groups",
    ...renderGroupTable(input.byRunExperiment),
    "",
    "## Calibration guard impact",
    ...renderCalibrationGuardImpact(input.calibrationGuardImpact),
    "",
    "## Best resolved forecasts",
    ...renderCaseTable(input.bestResolvedForecasts),
    "",
    "## Worst resolved forecasts",
    ...renderCaseTable(input.worstResolvedForecasts),
    "",
    "## Score trends",
    ...renderTrendTable(input.scoreTrends),
    "",
    "## Calibration",
    ...renderCalibrationTable(input.calibrationBuckets, input.calibrationSummary),
    "",
    "## Candidate calibration guards",
    ...renderCandidateCalibrationGuardTable(input.candidateCalibrationGuardRules),
    "",
    "## Needs attention",
    ...renderAttentionTable(input.needsAttention),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderCalibrationGuardImpact(impact: CalibrationGuardImpact) {
  return [
    `Status: ${impact.status}`,
    `Guarded aggregate Brier rows: ${impact.guardedRows}`,
    `Unguarded aggregate Brier rows: ${impact.unguardedRows}`,
    `Guarded mean Brier: ${formatNullableMetric(impact.guardedMeanBrier)}`,
    `Unguarded mean Brier: ${formatNullableMetric(impact.unguardedMeanBrier)}`,
    `Guarded minus unguarded Brier: ${impact.brierDelta === null ? "unknown" : formatSignedMetric(impact.brierDelta)}`,
    "",
    ...renderCalibrationGuardRuleImpactTable(impact.byRule),
  ];
}

function renderCalibrationGuardRuleImpactTable(ruleImpacts: CalibrationGuardRuleImpact[]) {
  if (ruleImpacts.length === 0) {
    return ["No applied calibration guard rules have resolved Brier rows yet."];
  }
  return [
    "| Rule | Status | Guarded rows | Guarded tasks | Guarded mean Brier | Delta vs unguarded |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...ruleImpacts.map((impact) =>
      `| ${impact.ruleId} | ${impact.status} | ${impact.guardedRows} | ${impact.guardedResolvedTasks} | ${formatNullableMetric(impact.guardedMeanBrier)} | ${impact.brierDelta === null ? "unknown" : formatSignedMetric(impact.brierDelta)} |`,
    ),
  ];
}

function renderCandidateCalibrationGuardTable(
  rules: BinaryCalibrationReport["candidateCalibrationGuardRules"],
) {
  if (rules.length === 0) {
    return ["No candidate calibration guard rules yet."];
  }
  return [
    "| Bucket | Direction | Suggested adjustment | Sample size | Mean forecast | Observed rate | Status |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ...rules.map((rule) =>
      `| ${rule.bucketLabel} | ${rule.direction} | ${formatSignedMetric(rule.suggestedAdjustment)} | ${rule.sampleSize} | ${roundMetric(rule.meanForecast)} | ${roundMetric(rule.observedRate)} | ${rule.activationStatus} |`,
    ),
  ];
}

function renderCalibrationTable(
  buckets: BinaryCalibrationReport["calibrationBuckets"],
  summary: BinaryCalibrationReport["calibrationSummary"],
) {
  if (buckets.every((bucket) => bucket.count === 0)) {
    return ["No binary aggregate calibration rows yet."];
  }
  return [
    `Status: ${summary.status}`,
    `Expected calibration error: ${summary.expectedCalibrationError === null ? "unknown" : roundMetric(summary.expectedCalibrationError)} percentage points`,
    "",
    "| Forecast bucket | Count | Mean forecast | Observed rate | Calibration error | Mean Brier |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...buckets.map((bucket) =>
      `| ${bucket.label} | ${bucket.count} | ${bucket.meanForecast === null ? "" : roundMetric(bucket.meanForecast)} | ${
        bucket.observedRate === null ? "" : roundMetric(bucket.observedRate)
      } | ${bucket.calibrationError === null ? "" : roundMetric(bucket.calibrationError)} | ${
        bucket.meanBrier === null ? "" : roundMetric(bucket.meanBrier)
      } |`,
    ),
  ];
}

function renderGroupTable(groups: PerformanceGroup[]) {
  if (groups.length === 0) {
    return ["No resolved score rows yet."];
  }
  return [
    "| Group | Resolved tasks | Score rows | Primary metric | Mean |",
    "| --- | ---: | ---: | --- | ---: |",
    ...groups.map((group) =>
      `| ${escapeMarkdownCell(group.label)} | ${group.resolvedTasks} | ${group.scoreRows} | ${group.primaryMetric ?? ""} | ${
        group.primaryMean === null ? "" : roundMetric(group.primaryMean)
      } |`,
    ),
  ];
}

function renderCaseTable(cases: PerformanceCase[]) {
  if (cases.length === 0) {
    return ["No aggregate resolved forecasts yet."];
  }
  return [
    "| Task | Forecast type | Primary metric | Score | Guard | Task id |",
    "| --- | --- | --- | ---: | --- | --- |",
    ...cases.map((item) =>
      `| ${escapeMarkdownCell(item.taskLabel)} | ${escapeMarkdownCell(item.forecastType)} | ${item.primaryMetric} | ${roundMetric(item.primaryScore)} | ${
        escapeMarkdownCell(formatCalibrationGuard(item.calibrationGuard))
      } | ${item.taskId} |`,
    ),
  ];
}

function formatCalibrationGuard(guard: CalibrationGuardSnapshot | null) {
  if (!guard || guard.appliedRules.length === 0) {
    return "";
  }
  const adjustment = guard.adjustment === null ? "" : `${guard.adjustment >= 0 ? "+" : ""}${roundMetric(guard.adjustment)} pts`;
  const ruleIds = guard.appliedRules.map((rule) => rule.id).join(", ");
  return [adjustment, ruleIds].filter(Boolean).join(" ");
}

function renderTrendTable(trends: PerformanceTrend[]) {
  if (trends.length === 0) {
    return ["No aggregate score trends yet."];
  }
  return [
    "| Window | Metric | Recent count | Baseline count | Recent mean | Baseline mean | Delta | Direction |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...trends.map((trend) =>
      `| ${trend.label} | ${trend.metric} | ${trend.recentCount} | ${trend.baselineCount} | ${
        trend.recentMean === null ? "" : roundMetric(trend.recentMean)
      } | ${trend.baselineMean === null ? "" : roundMetric(trend.baselineMean)} | ${
        trend.delta === null ? "" : roundMetric(trend.delta)
      } | ${trend.direction} |`,
    ),
  ];
}

function renderAttentionTable(items: PerformanceAttentionItem[]) {
  if (items.length === 0) {
    return ["No attention items yet."];
  }
  return [
    "| Severity | Kind | Metric | Score | Delta | Task | Reason | Recommended action |",
    "| --- | --- | --- | ---: | ---: | --- | --- | --- |",
    ...items.map((item) =>
      `| ${item.severity} | ${item.kind} | ${item.metric} | ${item.score === null ? "" : roundMetric(item.score)} | ${
        item.delta === null ? "" : roundMetric(item.delta)
      } | ${escapeMarkdownCell(item.taskLabel ?? item.taskId ?? "")} | ${escapeMarkdownCell(item.reason)} | ${escapeMarkdownCell(item.recommendedActions[0] ?? "")} |`,
    ),
  ];
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|");
}

function roundMetric(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function meanNumber(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function readRecordArray(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  for (const key of keys) {
    const raw = record[key];
    if (Array.isArray(raw)) {
      return raw.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
        }
      } catch {
        continue;
      }
    }
  }
  return [];
}

function normalizedCategoryDistribution(prediction: Record<string, unknown>) {
  const rawDistribution = readRecordArray(prediction, "probabilities")
    .map((item) => ({
      category: readString(item, "category") ?? "",
      probability: readNumber(item, "probability") ?? 0,
    }))
    .filter((item) => item.category && item.probability > 0);
  const fallbackCategory = readString(prediction, "topCategory", "top_category");
  const distribution = rawDistribution.length || !fallbackCategory
    ? rawDistribution
    : [{ category: fallbackCategory, probability: 100 }];
  const total = distribution.reduce((sum, item) => sum + item.probability, 0);
  if (total <= 0) {
    return [];
  }
  return distribution.map((item) => ({
    category: item.category,
    probability: Math.max(0, Math.min(1, item.probability / total)),
  }));
}

function parseFirstNumber(value: string) {
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isResolvableForecastSubmode(operationSubmode: string | null) {
  return (
    operationSubmode === "binary_forecast" ||
    operationSubmode === "date_forecast" ||
    operationSubmode === "numeric_forecast" ||
    operationSubmode === "categorical_forecast" ||
    operationSubmode === "thresholded_forecast" ||
    operationSubmode === "conditional_forecast"
  );
}

function forecastTypeFromSubmode(operationSubmode: string | null): "binary" | "date" | "numeric" | "categorical" | "thresholded" | "conditional" {
  if (operationSubmode === "date_forecast") {
    return "date";
  }
  if (operationSubmode === "numeric_forecast") {
    return "numeric";
  }
  if (operationSubmode === "categorical_forecast") {
    return "categorical";
  }
  if (operationSubmode === "thresholded_forecast") {
    return "thresholded";
  }
  if (operationSubmode === "conditional_forecast") {
    return "conditional";
  }
  return "binary";
}

function resolvedValueMatches(existing: unknown, target: Record<string, unknown>) {
  const existingRecord = asRecord(existing);
  if (!existingRecord) {
    return false;
  }
  for (const [key, value] of Object.entries(target)) {
    if (existingRecord[key] !== value) {
      return false;
    }
  }
  return true;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
