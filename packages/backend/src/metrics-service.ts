import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { desc, eq, inArray } from "drizzle-orm";
import {
  artifactRows,
  benchmarkCaseResults,
  benchmarkRuns,
  forecastResolutions,
  forecastScores,
  sourceBankEntries,
  tasks,
  workflowChangeProposals,
  workflowPromotionDecisions,
  workflowVariants,
  type createDb,
} from "@open-superforecaster/db";
import { summarizeBenchmarkPromotionGateEvidence } from "./benchmark-service";
import { readAggregateQualitySnapshot } from "./aggregate-quality-metadata";
import { aggregateSideAgreementBand, attemptCountBand, readAggregateStatsSnapshot } from "./aggregate-stats-metadata";
import { readBaselineSanitySnapshot } from "./baseline-sanity-metadata";
import { readBinaryConfidenceSnapshot } from "./binary-confidence-metadata";
import { buildCalibrationGuardImpact } from "./calibration-guard-impact";
import { readCalibrationGuardSnapshot } from "./calibration-guard-metadata";
import { readCategoricalForecastSnapshot } from "./categorical-forecast-metadata";
import { readComponentWeightingSnapshot } from "./component-weighting-metadata";
import { readConditionalForecastSnapshot } from "./conditional-forecast-metadata";
import { readDateForecastSnapshot } from "./date-forecast-metadata";
import { readEvidenceCoverageSnapshot } from "./evidence-coverage-metadata";
import { readLatestForecastBatchHealth } from "./forecast-batch-health";
import { readForecastInputContextSnapshot } from "./forecast-input-context-metadata";
import { readForecastRunSnapshot } from "./forecast-run-metadata";
import { readMarketAnchorSnapshot } from "./market-anchor-metadata";
import { readNumericForecastSnapshot } from "./numeric-forecast-metadata";
import { buildBinaryCalibrationReport } from "./performance-calibration";
import { readResolutionBoundarySnapshot } from "./resolution-boundary-metadata";
import { readSmithersTokenUsage, summarizeSmithersTokenUsage } from "./smithers-usage";
import { summarizeSourceDomains } from "./source-domain-summary";
import { readThresholdedForecastSnapshot } from "./thresholded-forecast-metadata";
import { readUncertaintyRangeSnapshot } from "./uncertainty-range-metadata";

type Db = ReturnType<typeof createDb>["db"];

type CalibrationGuardValidationMetricRow = {
  reportPath: string;
  generatedAt: string | null;
  validationMode: string | null;
  proposalId: string | null;
  sourceCandidateGuardId: string | null;
  bucketLabel: string | null;
  matchedRows: number | null;
  brierDelta: number | null;
  calibrationErrorDelta: number | null;
  recommendation: string | null;
};

type CalibrationGuardDefaultPlanMetricRow = {
  reportPath: string;
  generatedAt: string | null;
  proposalId: string | null;
  sourceCandidateGuardId: string | null;
  bucketLabel: string | null;
  suggestedAdjustment: number | null;
  matchedRows: number | null;
  brierDelta: number | null;
  calibrationErrorDelta: number | null;
  targetWorkflowId: string | null;
  targetFile: string | null;
  implementationStatus: string | null;
};

type ForecastAttentionMetricRow = {
  reportPath: string;
  batchId: string | null;
  generatedAt: string | null;
  attentionItemId: string | null;
  reviewStatus: string | null;
  severity: string | null;
  kind: string | null;
  metric: string | null;
  score: number | null;
  delta: number | null;
  forecastType: string | null;
  taskId: string | null;
};

export async function renderPrometheusMetrics(db: Db, options: { root?: string } = {}) {
  const [
    taskRows,
    recentTasks,
    benchmarkRunRows,
    recentBenchmarkCases,
    scoreRows,
    resolutionRows,
    sourceRows,
    workflowProposalRows,
    workflowVariantRows,
    promotionDecisionRows,
  ] = await Promise.all([
    db
      .select({
        status: tasks.status,
        operationMode: tasks.operationMode,
        operationSubmode: tasks.operationSubmode,
      })
      .from(tasks),
    db
      .select({
        id: tasks.id,
        smithersRunId: tasks.smithersRunId,
        operationMode: tasks.operationMode,
        operationSubmode: tasks.operationSubmode,
        status: tasks.status,
        benchmarkRunId: tasks.benchmarkRunId,
        workflowVariantId: tasks.workflowVariantId,
        startedAt: tasks.startedAt,
        completedAt: tasks.completedAt,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .orderBy(desc(tasks.createdAt))
      .limit(50),
    db
      .select({
        id: benchmarkRuns.id,
        evalMode: benchmarkRuns.evalMode,
        status: benchmarkRuns.status,
        workflowVariantId: benchmarkRuns.workflowVariantId,
        caseCount: benchmarkRuns.caseCount,
        comparisonReportArtifactId: benchmarkRuns.comparisonReportArtifactId,
        analysisReportArtifactId: benchmarkRuns.analysisReportArtifactId,
        promotionDecisionId: benchmarkRuns.promotionDecisionId,
        startedAt: benchmarkRuns.startedAt,
        completedAt: benchmarkRuns.completedAt,
        createdAt: benchmarkRuns.createdAt,
      })
      .from(benchmarkRuns)
      .orderBy(desc(benchmarkRuns.createdAt))
      .limit(50),
    db
      .select({
        id: benchmarkCaseResults.id,
        benchmarkRunId: benchmarkCaseResults.benchmarkRunId,
        benchmarkCaseId: benchmarkCaseResults.benchmarkCaseId,
        taskId: benchmarkCaseResults.taskId,
        smithersRunId: benchmarkCaseResults.smithersRunId,
        workflowVariantId: benchmarkCaseResults.workflowVariantId,
        status: benchmarkCaseResults.status,
        failureLabels: benchmarkCaseResults.failureLabels,
        traceBundleUri: benchmarkCaseResults.traceBundleUri,
      })
      .from(benchmarkCaseResults)
      .orderBy(desc(benchmarkCaseResults.createdAt))
      .limit(100),
    db
      .select({
        scoreType: forecastScores.scoreType,
        scoreValue: forecastScores.scoreValue,
        scoreConfig: forecastScores.scoreConfig,
        forecastAggregateId: forecastScores.forecastAggregateId,
        resolutionId: forecastScores.resolutionId,
        createdAt: forecastScores.createdAt,
      })
      .from(forecastScores),
    db.select({ id: forecastResolutions.id, annulled: forecastResolutions.annulled }).from(forecastResolutions),
    db
      .select({
        id: sourceBankEntries.id,
        taskId: sourceBankEntries.taskId,
        sourceType: sourceBankEntries.sourceType,
        usedInFinal: sourceBankEntries.usedInFinal,
        domain: sourceBankEntries.domain,
        qualityScore: sourceBankEntries.qualityScore,
      })
      .from(sourceBankEntries),
    db
      .select({
        id: workflowChangeProposals.id,
        sourceBenchmarkRunId: workflowChangeProposals.sourceBenchmarkRunId,
        targetWorkflowId: workflowChangeProposals.targetWorkflowId,
        status: workflowChangeProposals.status,
        reviewedBy: workflowChangeProposals.reviewedBy,
        reviewedAt: workflowChangeProposals.reviewedAt,
        implementationStatus: workflowChangeProposals.implementationStatus,
        implementationExperimentLabel: workflowChangeProposals.implementationExperimentLabel,
        validationBenchmarkRunId: workflowChangeProposals.validationBenchmarkRunId,
        validationComparisonReportArtifactId: benchmarkRuns.comparisonReportArtifactId,
        validationResultStatus: workflowChangeProposals.validationResultStatus,
        validationCompletedCases: workflowChangeProposals.validationCompletedCases,
        validationCostTotalTokensDelta: workflowChangeProposals.validationCostTotalTokensDelta,
        validationCostAgentCallsDelta: workflowChangeProposals.validationCostAgentCallsDelta,
        validationCostMeanDurationSecondsDelta: workflowChangeProposals.validationCostMeanDurationSecondsDelta,
        validationGateStatus: workflowChangeProposals.validationGateStatus,
        validationGateBlockers: workflowChangeProposals.validationGateBlockers,
        createdAt: workflowChangeProposals.createdAt,
      })
      .from(workflowChangeProposals)
      .leftJoin(benchmarkRuns, eq(workflowChangeProposals.validationBenchmarkRunId, benchmarkRuns.id))
      .orderBy(desc(workflowChangeProposals.createdAt))
      .limit(100),
    db
      .select({
        id: workflowVariants.id,
        workflowId: workflowVariants.workflowId,
        workflowSourceHash: workflowVariants.workflowSourceHash,
        promotionState: workflowVariants.promotionState,
      })
      .from(workflowVariants),
    db
      .select({
        id: workflowPromotionDecisions.id,
        state: workflowPromotionDecisions.state,
        workflowVariantId: workflowPromotionDecisions.workflowVariantId,
        benchmarkRunId: workflowPromotionDecisions.benchmarkRunId,
      })
      .from(workflowPromotionDecisions),
  ]);
  const workflowVariantById = new Map(workflowVariantRows.map((variant) => [variant.id, variant]));
  const benchmarkRunIds = benchmarkRunRows.map((run) => run.id);
  const recentRunCaseRows = benchmarkRunIds.length
    ? await db
        .select({
          benchmarkRunId: benchmarkCaseResults.benchmarkRunId,
          status: benchmarkCaseResults.status,
          traceBundleUri: benchmarkCaseResults.traceBundleUri,
        })
        .from(benchmarkCaseResults)
        .where(inArray(benchmarkCaseResults.benchmarkRunId, benchmarkRunIds))
    : [];
  const reportArtifactIds = uniqueStrings(benchmarkRunRows.flatMap((run) => [
    run.comparisonReportArtifactId,
    run.analysisReportArtifactId,
  ].filter((id): id is string => Boolean(id))).concat(
    workflowProposalRows.map((proposal) => proposal.validationComparisonReportArtifactId).filter((id): id is string => Boolean(id)),
  ));
  const reportRows = reportArtifactIds.length
    ? await db
        .select({
          artifactId: artifactRows.artifactId,
          rowJson: artifactRows.rowJson,
        })
        .from(artifactRows)
        .where(inArray(artifactRows.artifactId, reportArtifactIds))
    : [];
  const reportRowsByArtifactId = new Map(reportRows.map((row) => [row.artifactId, row.rowJson]));
  const recentCasesByRunId = groupBy(recentRunCaseRows, (row) => row.benchmarkRunId);
  const benchmarkRunCaseCountById = new Map(benchmarkRunRows.map((run) => [run.id, run.caseCount]));

  const metrics = new MetricsBuilder();
  metrics.gauge("open_superforecaster_up", "Open Superforecaster metrics endpoint health.", 1);
  metrics.gauge("open_superforecaster_tasks_total", "Task count by status and operation.", taskRows.length);
  for (const [key, count] of countBy(taskRows, (row) =>
    labelKey({
      status: row.status,
      operation_mode: row.operationMode,
      operation_submode: row.operationSubmode ?? "default",
    }),
  )) {
    metrics.gauge("open_superforecaster_tasks_total", "Task count by status and operation.", count, parseLabelKey(key));
  }

  for (const task of recentTasks) {
    const labels = {
      task_id: task.id,
      smithers_run_id: task.smithersRunId ?? "pending",
      operation_mode: task.operationMode,
      operation_submode: task.operationSubmode ?? "default",
      status: task.status,
      benchmark_run_id: task.benchmarkRunId ?? "none",
      workflow_variant_id: task.workflowVariantId ?? "none",
    };
    metrics.gauge("open_superforecaster_task_info", "Recent task metadata for local trace correlation.", 1, labels);
    const duration = durationSeconds(task.startedAt ?? task.createdAt, task.completedAt);
    if (duration !== null) {
      metrics.gauge("open_superforecaster_task_duration_seconds", "Recent completed task duration in seconds.", duration, labels);
    }
  }

  if (options.root) {
    const usageByTask = await Promise.all(
      recentTasks
        .filter((task) => task.smithersRunId)
        .map(async (task) => ({
          task,
          usage: await readSmithersTokenUsage(options.root!, task.smithersRunId!),
        })),
    );

    for (const { task, usage } of usageByTask) {
      if (usage.length === 0 || !task.smithersRunId) {
        continue;
      }
      const summary = summarizeSmithersTokenUsage(usage);
      const baseLabels = {
        task_id: task.id,
        smithers_run_id: task.smithersRunId,
        operation_mode: task.operationMode,
        operation_submode: task.operationSubmode ?? "default",
        status: task.status,
        benchmark_run_id: task.benchmarkRunId ?? "none",
        workflow_variant_id: task.workflowVariantId ?? "none",
      };
      metrics.gauge(
        "open_superforecaster_smithers_agent_calls_total",
        "Recent Smithers agent call count parsed from durable run logs.",
        summary.calls,
        baseLabels,
      );
      for (const [tokenType, value] of Object.entries({
        input: summary.inputTokens,
        cached_input: summary.cachedInputTokens,
        output: summary.outputTokens,
        reasoning_output: summary.reasoningOutputTokens,
        total: summary.totalTokens,
      })) {
        metrics.gauge(
          "open_superforecaster_smithers_token_total",
          "Recent Smithers token usage parsed from durable run logs.",
          value,
          {
            ...baseLabels,
            token_type: tokenType,
          },
        );
      }
    }
  }

  for (const [key, count] of countBy(benchmarkRunRows, (row) =>
    labelKey({
      status: row.status,
      eval_mode: row.evalMode,
    }),
  )) {
    metrics.gauge("open_superforecaster_benchmark_runs_total", "Benchmark run count by status and eval mode.", count, parseLabelKey(key));
  }
  for (const run of benchmarkRunRows) {
    const workflowVariant = workflowVariantById.get(run.workflowVariantId);
    const labels = {
      benchmark_run_id: run.id,
      eval_mode: run.evalMode,
      status: run.status,
      workflow_variant_id: run.workflowVariantId,
      workflow_id: workflowVariant?.workflowId ?? "unknown",
      promotion_state: workflowVariant?.promotionState ?? "unknown",
      comparison_report_artifact_id: run.comparisonReportArtifactId ?? "none",
      promotion_decision_id: run.promotionDecisionId ?? "none",
    };
    metrics.gauge("open_superforecaster_benchmark_run_info", "Recent benchmark run metadata.", 1, labels);
    metrics.gauge("open_superforecaster_benchmark_cases_expected", "Expected case count per recent benchmark run.", run.caseCount, labels);
    const caseRows = recentCasesByRunId.get(run.id) ?? [];
    const comparisonReport = run.comparisonReportArtifactId ? reportRowsByArtifactId.get(run.comparisonReportArtifactId) ?? null : null;
    const analysisReport = run.analysisReportArtifactId ? reportRowsByArtifactId.get(run.analysisReportArtifactId) ?? null : null;
    const promotionGate = summarizeBenchmarkPromotionGateEvidence({
      runStatus: run.status,
      resultCount: caseRows.length,
      traceMissing: caseRows.filter((row) => !row.traceBundleUri).length,
      reviewOrFailed: caseRows.filter((row) => row.status === "failed" || row.status === "needs_review").length,
      comparisonStatus: readComparisonRecommendationStatus(comparisonReport),
      baselineSanityFindings: readRecord(analysisReport, "baselineSanityFindings", "baseline_sanity_findings"),
      componentDisagreementFindings: readRecord(analysisReport, "componentDisagreementFindings", "component_disagreement_findings"),
      forecastErrorFindings: readRecord(analysisReport, "forecastErrorFindings", "forecast_error_findings"),
      splitFindings: readRecord(analysisReport, "splitFindings", "split_findings"),
      sourceQualityFindings: readRecord(analysisReport, "sourceQualityFindings", "source_quality_findings"),
      traceQualityFindings: readRecord(analysisReport, "traceQualityFindings", "trace_quality_findings"),
    });
    const costLatencyFindings = readRecord(analysisReport, "costLatencyFindings", "cost_latency_findings");
    metrics.gauge("open_superforecaster_benchmark_promotion_gate_status", "Recent benchmark promotion gate status.", 1, {
      ...labels,
      gate_status: promotionGate.status,
      recommendation_status: promotionGate.recommendationStatus ?? "none",
    });
    for (const blocker of promotionGate.blockers) {
      metrics.gauge("open_superforecaster_benchmark_promotion_gate_blocker", "Recent benchmark promotion gate blockers.", 1, {
        ...labels,
        blocker,
      });
    }
    const duration = durationSeconds(run.startedAt ?? run.createdAt, run.completedAt);
    if (duration !== null) {
      metrics.gauge("open_superforecaster_benchmark_run_duration_seconds", "Recent benchmark run duration in seconds.", duration, labels);
    }
    emitBenchmarkCostLatencyMetrics(metrics, labels, costLatencyFindings);
  }

  for (const caseResult of recentBenchmarkCases) {
    metrics.gauge("open_superforecaster_benchmark_case_info", "Recent benchmark case metadata for local trace correlation.", 1, {
      benchmark_run_id: caseResult.benchmarkRunId,
      benchmark_case_id: caseResult.benchmarkCaseId,
      benchmark_case_result_id: caseResult.id,
      task_id: caseResult.taskId ?? "none",
      smithers_run_id: caseResult.smithersRunId ?? "none",
      workflow_variant_id: caseResult.workflowVariantId,
      status: caseResult.status,
      failure_labels: caseResult.failureLabels.length ? caseResult.failureLabels.join(",") : "none",
      trace_bundle_uri: caseResult.traceBundleUri ?? "none",
    });
  }

  for (const variant of workflowVariantRows) {
    metrics.gauge("open_superforecaster_workflow_variant_info", "Workflow variant metadata and promotion state.", 1, {
      workflow_variant_id: variant.id,
      workflow_id: variant.workflowId,
      workflow_source_hash: variant.workflowSourceHash.slice(0, 12),
      promotion_state: variant.promotionState,
    });
  }
  for (const [key, count] of countBy(workflowVariantRows, (row) => labelKey({ promotion_state: row.promotionState, workflow_id: row.workflowId }))) {
    metrics.gauge("open_superforecaster_workflow_variants_total", "Workflow variant count by promotion state.", count, parseLabelKey(key));
  }
  for (const [key, count] of countBy(promotionDecisionRows, (row) => labelKey({ state: row.state }))) {
    metrics.gauge("open_superforecaster_workflow_promotion_decisions_total", "Workflow promotion decision count by state.", count, parseLabelKey(key));
  }
  metrics.gauge("open_superforecaster_workflow_change_proposals_total", "Workflow change proposal count by lifecycle, implementation status, and target workflow.", workflowProposalRows.length);
  for (const [key, count] of countBy(workflowProposalRows, (row) =>
    labelKey({
      status: row.status,
      implementation_status: row.implementationStatus,
      target_workflow_id: row.targetWorkflowId,
    }),
  )) {
    metrics.gauge("open_superforecaster_workflow_change_proposals_total", "Workflow change proposal count by lifecycle, implementation status, and target workflow.", count, parseLabelKey(key));
  }
  for (const proposal of workflowProposalRows.slice(0, 50)) {
    const validationComparisonReport = proposal.validationComparisonReportArtifactId
      ? reportRowsByArtifactId.get(proposal.validationComparisonReportArtifactId) ?? null
      : null;
    metrics.gauge("open_superforecaster_workflow_change_proposal_info", "Recent workflow change proposal lifecycle metadata.", 1, {
      proposal_id: proposal.id,
      source_benchmark_run_id: proposal.sourceBenchmarkRunId ?? "none",
      target_workflow_id: proposal.targetWorkflowId,
      status: proposal.status,
      implementation_status: proposal.implementationStatus,
      implementation_experiment_label: proposal.implementationExperimentLabel ?? "none",
      validation_benchmark_run_id: proposal.validationBenchmarkRunId ?? "none",
      validation_comparison_report_artifact_id: proposal.validationComparisonReportArtifactId ?? "none",
      validation_recommendation_status: readComparisonRecommendationStatus(validationComparisonReport) ?? "none",
      validation_result_status: proposal.validationResultStatus ?? "none",
      validation_gate_status: proposal.validationGateStatus ?? "none",
      reviewed_by: proposal.reviewedBy ?? "none",
      reviewed: proposal.reviewedAt ? "true" : "false",
    });
    const proposalLabels = {
      proposal_id: proposal.id,
      source_benchmark_run_id: proposal.sourceBenchmarkRunId ?? "none",
      target_workflow_id: proposal.targetWorkflowId,
      validation_benchmark_run_id: proposal.validationBenchmarkRunId ?? "none",
    };
    const sourceCaseCount = proposal.sourceBenchmarkRunId ? benchmarkRunCaseCountById.get(proposal.sourceBenchmarkRunId) ?? null : null;
    const requiredValidationCases = Math.max(sourceCaseCount ?? 1, 1);
    const validationCompletedCases = proposal.validationCompletedCases ?? 0;
    const validationGateBlockers = Array.isArray(proposal.validationGateBlockers)
      ? proposal.validationGateBlockers.filter((blocker): blocker is string => typeof blocker === "string" && blocker.trim().length > 0)
      : [];
    metrics.gauge(
      "open_superforecaster_workflow_change_proposal_validation_completed_cases",
      "Completed validation benchmark cases for a workflow change proposal.",
      validationCompletedCases,
      proposalLabels,
    );
    metrics.gauge(
      "open_superforecaster_workflow_change_proposal_validation_coverage_ratio",
      "Completed validation cases divided by required source benchmark case coverage for a workflow change proposal.",
      requiredValidationCases === 0 ? 0 : validationCompletedCases / requiredValidationCases,
      proposalLabels,
    );
    metrics.gauge(
      "open_superforecaster_workflow_change_proposal_validation_passed",
      "Whether proposal validation completed with a passing gate and no blockers.",
      proposal.validationResultStatus === "completed" && proposal.validationGateStatus === "review_for_promotion" && validationGateBlockers.length === 0 ? 1 : 0,
      proposalLabels,
    );
    emitOptionalGauge(
      metrics,
      "open_superforecaster_workflow_change_proposal_validation_cost_total_tokens_delta",
      "Validation benchmark total-token delta versus the source benchmark for a workflow proposal.",
      proposal.validationCostTotalTokensDelta,
      proposalLabels,
    );
    emitOptionalGauge(
      metrics,
      "open_superforecaster_workflow_change_proposal_validation_cost_agent_calls_delta",
      "Validation benchmark agent-call delta versus the source benchmark for a workflow proposal.",
      proposal.validationCostAgentCallsDelta,
      proposalLabels,
    );
    emitOptionalGauge(
      metrics,
      "open_superforecaster_workflow_change_proposal_validation_cost_mean_duration_seconds_delta",
      "Validation benchmark mean-duration delta versus the source benchmark for a workflow proposal.",
      proposal.validationCostMeanDurationSecondsDelta,
      proposalLabels,
    );
  }

  for (const [key, count] of countBy(scoreRows, (row) =>
    labelKey({
      score_type: row.scoreType,
      source: scoreSource(row.scoreConfig),
      target: scoreTarget(row.scoreConfig),
    }),
  )) {
    metrics.gauge("open_superforecaster_forecast_scores_total", "Forecast score row count by score type and source.", count, parseLabelKey(key));
  }
  for (const [key, rows] of groupBy(scoreRows, (row) =>
    labelKey({
      score_type: row.scoreType,
      source: scoreSource(row.scoreConfig),
      target: scoreTarget(row.scoreConfig),
    }),
  )) {
    metrics.gauge(
      "open_superforecaster_forecast_score_mean",
      "Mean score value by score type and source.",
      mean(rows.map((row) => row.scoreValue)),
      parseLabelKey(key),
    );
  }
  const baselineSanityScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readBaselineSanitySnapshot(row.scoreConfig) !== null
  );
  if (baselineSanityScoreRows.length === 0) {
    const labels = { baseline_sanity_status: "none", score_type: "all" };
    metrics.gauge(
      "open_superforecaster_baseline_sanity_scores_total",
      "Product aggregate forecast score rows by baseline sanity status.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_baseline_sanity_score_mean",
      "Mean product aggregate forecast score by baseline sanity status.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(baselineSanityScoreRows, (row) =>
    labelKey({
      score_type: row.scoreType,
      baseline_sanity_status: readBaselineSanitySnapshot(row.scoreConfig)?.status ?? "unknown",
    }),
  )) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_baseline_sanity_scores_total",
      "Product aggregate forecast score rows by baseline sanity status.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_baseline_sanity_score_mean",
      "Mean product aggregate forecast score by baseline sanity status.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const marketAnchorScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readMarketAnchorSnapshot(row.scoreConfig) !== null
  );
  if (marketAnchorScoreRows.length === 0) {
    const labels = { market_anchor_status: "none", market_platform: "unknown", score_type: "all" };
    metrics.gauge(
      "open_superforecaster_market_anchor_scores_total",
      "Product aggregate forecast score rows by market-anchor divergence status.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_market_anchor_score_mean",
      "Mean product aggregate forecast score by market-anchor divergence status.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(marketAnchorScoreRows, (row) => {
    const marketAnchor = readMarketAnchorSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      market_anchor_status: marketAnchor?.status ?? "unknown",
      market_platform: marketAnchor?.marketPlatform ?? "unknown",
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_market_anchor_scores_total",
      "Product aggregate forecast score rows by market-anchor divergence status.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_market_anchor_score_mean",
      "Mean product aggregate forecast score by market-anchor divergence status.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const resolutionBoundaryScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readResolutionBoundarySnapshot(row.scoreConfig) !== null
  );
  if (resolutionBoundaryScoreRows.length === 0) {
    const labels = { resolution_boundary_status: "none", score_type: "all" };
    metrics.gauge(
      "open_superforecaster_resolution_boundary_scores_total",
      "Product aggregate forecast score rows by resolution-boundary status.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_resolution_boundary_score_mean",
      "Mean product aggregate forecast score by resolution-boundary status.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(resolutionBoundaryScoreRows, (row) => {
    const resolutionBoundary = readResolutionBoundarySnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      resolution_boundary_status: resolutionBoundary?.status ?? "unknown",
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_resolution_boundary_scores_total",
      "Product aggregate forecast score rows by resolution-boundary status.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_resolution_boundary_score_mean",
      "Mean product aggregate forecast score by resolution-boundary status.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const uncertaintyRangeScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readUncertaintyRangeSnapshot(row.scoreConfig) !== null
  );
  if (uncertaintyRangeScoreRows.length === 0) {
    const labels = { uncertainty_range_status: "none", score_type: "all" };
    metrics.gauge(
      "open_superforecaster_uncertainty_range_scores_total",
      "Product aggregate forecast score rows by uncertainty-range status.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_uncertainty_range_score_mean",
      "Mean product aggregate forecast score by uncertainty-range status.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(uncertaintyRangeScoreRows, (row) => {
    const uncertaintyRange = readUncertaintyRangeSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      uncertainty_range_status: uncertaintyRange?.status ?? "unknown",
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_uncertainty_range_scores_total",
      "Product aggregate forecast score rows by uncertainty-range status.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_uncertainty_range_score_mean",
      "Mean product aggregate forecast score by uncertainty-range status.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const componentWeightingScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readComponentWeightingSnapshot(row.scoreConfig) !== null
  );
  if (componentWeightingScoreRows.length === 0) {
    const labels = { component_weighting_status: "none", score_type: "all" };
    metrics.gauge(
      "open_superforecaster_component_weighting_scores_total",
      "Product aggregate forecast score rows by component-weighting status.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_component_weighting_score_mean",
      "Mean product aggregate forecast score by component-weighting status.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(componentWeightingScoreRows, (row) => {
    const componentWeighting = readComponentWeightingSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      component_weighting_status: componentWeighting?.status ?? "unknown",
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_component_weighting_scores_total",
      "Product aggregate forecast score rows by component-weighting status.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_component_weighting_score_mean",
      "Mean product aggregate forecast score by component-weighting status.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const aggregateQualityScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readAggregateQualitySnapshot(row.scoreConfig) !== null
  );
  if (aggregateQualityScoreRows.length === 0) {
    const labels = {
      aggregate_convergence_status: "none",
      aggregate_quality_approved: "unknown",
      aggregate_max_iterations_reached: "unknown",
      aggregate_rounds_used_band: "unknown",
      aggregate_quality_issue_count_band: "unknown",
      score_type: "all",
    };
    metrics.gauge(
      "open_superforecaster_aggregate_quality_scores_total",
      "Product aggregate forecast score rows by aggregate quality status.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_aggregate_quality_score_mean",
      "Mean product aggregate forecast score by aggregate quality status.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(aggregateQualityScoreRows, (row) => {
    const aggregateQuality = readAggregateQualitySnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      aggregate_convergence_status: aggregateQuality?.convergenceStatus ?? "unknown",
      aggregate_quality_approved: String(aggregateQuality?.qualityApproved ?? "unknown"),
      aggregate_max_iterations_reached: String(aggregateQuality?.maxIterationsReached ?? "unknown"),
      aggregate_rounds_used_band: aggregateQuality?.roundsUsedBand ?? "unknown",
      aggregate_quality_issue_count_band: aggregateQuality?.qualityIssueCountBand ?? "unknown",
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_aggregate_quality_scores_total",
      "Product aggregate forecast score rows by aggregate quality status.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_aggregate_quality_score_mean",
      "Mean product aggregate forecast score by aggregate quality status.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const binaryConfidenceScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readString(asRecord(row.scoreConfig), "forecastType") === "binary" &&
    readBinaryConfidenceSnapshot(row.scoreConfig) !== null
  );
  if (binaryConfidenceScoreRows.length === 0) {
    const labels = {
      score_type: "all",
      confidence_band: "none",
      forecast_side: "unknown",
    };
    metrics.gauge(
      "open_superforecaster_binary_confidence_scores_total",
      "Product binary aggregate forecast score rows by final probability confidence band.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_binary_confidence_score_mean",
      "Mean product binary aggregate forecast score by final probability confidence band.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(binaryConfidenceScoreRows, (row) => {
    const confidence = readBinaryConfidenceSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      confidence_band: confidence?.confidenceBand ?? "unknown",
      forecast_side: confidence?.forecastSide ?? "unknown",
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_binary_confidence_scores_total",
      "Product binary aggregate forecast score rows by final probability confidence band.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_binary_confidence_score_mean",
      "Mean product binary aggregate forecast score by final probability confidence band.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const aggregateStatsScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readAggregateStatsSnapshot(row.scoreConfig) !== null
  );
  if (aggregateStatsScoreRows.length === 0) {
    const labels = {
      component_disagreement_band: "none",
      final_component_position_band: "unknown",
      aggregate_side_agreement: "unknown",
      mean_confidence_distance_band: "unknown",
      final_confidence_shift_band: "unknown",
      inside_view_delta_band: "unknown",
      final_inside_view_delta_band: "unknown",
      final_adjustment_direction: "unknown",
      adjustment_from_median_band: "unknown",
      aggregate_attempt_count_band: "unknown",
      aggregation_anchor: "unknown",
      score_type: "all",
    };
    metrics.gauge(
      "open_superforecaster_aggregate_stats_scores_total",
      "Product aggregate forecast score rows by aggregate-stats diagnostic bands.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_aggregate_stats_score_mean",
      "Mean product aggregate forecast score by aggregate-stats diagnostic bands.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(aggregateStatsScoreRows, (row) => {
    const aggregateStats = readAggregateStatsSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      component_disagreement_band: aggregateStats?.disagreementBand ?? "unknown",
      final_component_position_band: aggregateStats?.finalComponentPositionBand ?? "unknown",
      aggregate_side_agreement: aggregateStats
        ? aggregateSideAgreementBand(readCalibrationProbability(row.scoreConfig), aggregateStats.meanProbability)
        : "unknown",
      mean_confidence_distance_band: aggregateStats?.meanConfidenceDistanceBand ?? "unknown",
      final_confidence_shift_band: aggregateStats?.finalConfidenceShiftBand ?? "unknown",
      inside_view_delta_band: aggregateStats?.insideViewDeltaBand ?? "unknown",
      final_inside_view_delta_band: aggregateStats?.finalInsideViewDeltaBand ?? "unknown",
      final_adjustment_direction: aggregateStats?.finalAdjustmentDirection ?? "unknown",
      adjustment_from_median_band: aggregateStats?.adjustmentFromMedianBand ?? "unknown",
      aggregate_attempt_count_band: aggregateStats?.attemptCountBand ?? "unknown",
      aggregation_anchor: aggregateStats?.aggregationAnchor ?? "unknown",
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_aggregate_stats_scores_total",
      "Product aggregate forecast score rows by aggregate-stats diagnostic bands.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_aggregate_stats_score_mean",
      "Mean product aggregate forecast score by aggregate-stats diagnostic bands.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const aggregatePlanScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readAggregateQualitySnapshot(row.scoreConfig) !== null
  );
  if (aggregatePlanScoreRows.length === 0) {
    const labels = {
      research_depth: "none",
      forecaster_count: "unknown",
      complexity_score: "unknown",
      score_type: "all",
    };
    metrics.gauge(
      "open_superforecaster_aggregate_plan_scores_total",
      "Product aggregate forecast score rows by selected binary forecast plan shape.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_aggregate_plan_score_mean",
      "Mean product aggregate forecast score by selected binary forecast plan shape.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(aggregatePlanScoreRows, (row) => {
    const aggregateQuality = readAggregateQualitySnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      research_depth: aggregateQuality?.researchDepth ?? "unknown",
      forecaster_count: String(aggregateQuality?.forecasterCount ?? "unknown"),
      complexity_score: String(aggregateQuality?.complexityScore ?? "unknown"),
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_aggregate_plan_scores_total",
      "Product aggregate forecast score rows by selected binary forecast plan shape.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_aggregate_plan_score_mean",
      "Mean product aggregate forecast score by selected binary forecast plan shape.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const conditionalScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readString(asRecord(row.scoreConfig), "forecastType") === "conditional"
  );
  if (conditionalScoreRows.length === 0) {
    const labels = {
      score_type: "all",
      conditional_branch: "none",
      conditional_effect_band: "unknown",
      conditional_branch_disagreement_band: "unknown",
      conditional_effect_direction_agreement: "unknown",
      conditional_resolved_branch_placement: "unknown",
      conditional_resolved_branch_probability_band: "unknown",
      attempt_count_band: "unknown",
    };
    metrics.gauge(
      "open_superforecaster_conditional_scores_total",
      "Product conditional aggregate forecast score rows by branch and condition-effect band.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_conditional_score_mean",
      "Mean product conditional aggregate forecast score by branch and condition-effect band.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(conditionalScoreRows, (row) => {
    const config = asRecord(row.scoreConfig);
    const conditionalForecast = readConditionalForecastSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      conditional_branch: readString(config, "branch") ?? (row.scoreType.startsWith("condition_") ? "condition_probability" : "unknown"),
      conditional_effect_band: conditionalForecast?.effectBand ?? "unknown",
      conditional_branch_disagreement_band: conditionalForecast?.branchDisagreementBand ?? "unknown",
      conditional_effect_direction_agreement: conditionalForecast?.effectDirectionAgreement ?? "unknown",
      conditional_resolved_branch_placement: conditionalForecast?.resolvedBranchPlacement ?? "unknown",
      conditional_resolved_branch_probability_band: conditionalForecast?.resolvedBranchProbabilityBand ?? "unknown",
      attempt_count_band: attemptCountBand(conditionalForecast?.attemptCount ?? null),
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_conditional_scores_total",
      "Product conditional aggregate forecast score rows by branch and condition-effect band.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_conditional_score_mean",
      "Mean product conditional aggregate forecast score by branch and condition-effect band.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const thresholdedScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readString(asRecord(row.scoreConfig), "forecastType") === "thresholded"
  );
  if (thresholdedScoreRows.length === 0) {
    const labels = {
      score_type: "all",
      threshold_direction: "none",
      threshold_source: "unknown",
      monotonicity_repaired: "unknown",
      probability_spread_band: "unknown",
      component_disagreement_band: "unknown",
      resolved_threshold_band: "unknown",
      attempt_count_band: "unknown",
    };
    metrics.gauge(
      "open_superforecaster_thresholded_scores_total",
      "Product thresholded aggregate forecast score rows by direction, source, and monotonicity repair.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_thresholded_score_mean",
      "Mean product thresholded aggregate forecast score by direction, source, and monotonicity repair.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(thresholdedScoreRows, (row) => {
    const thresholdedForecast = readThresholdedForecastSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      threshold_direction: thresholdedForecast?.thresholdDirection ?? "unknown",
      threshold_source: thresholdedForecast?.thresholdSource ?? "unknown",
      monotonicity_repaired: String(thresholdedForecast?.monotonicityRepaired ?? "unknown"),
      probability_spread_band: thresholdedForecast?.probabilitySpreadBand ?? "unknown",
      component_disagreement_band: thresholdedForecast?.componentDisagreementBand ?? "unknown",
      resolved_threshold_band: thresholdedForecast?.resolvedThresholdBand ?? "unknown",
      attempt_count_band: attemptCountBand(thresholdedForecast?.attemptCount ?? null),
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_thresholded_scores_total",
      "Product thresholded aggregate forecast score rows by direction, source, and monotonicity repair.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_thresholded_score_mean",
      "Mean product thresholded aggregate forecast score by direction, source, and monotonicity repair.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const numericScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readString(asRecord(row.scoreConfig), "forecastType") === "numeric"
  );
  if (numericScoreRows.length === 0) {
    const labels = {
      score_type: "all",
      numeric_interval_band: "none",
      unit: "unknown",
      p50_disagreement_band: "unknown",
      p50_error_band: "unknown",
      resolved_position_band: "unknown",
      attempt_count_band: "unknown",
    };
    metrics.gauge(
      "open_superforecaster_numeric_distribution_scores_total",
      "Product numeric aggregate forecast score rows by interval width band and unit.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_numeric_distribution_score_mean",
      "Mean product numeric aggregate forecast score by interval width band and unit.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(numericScoreRows, (row) => {
    const numericForecast = readNumericForecastSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      numeric_interval_band: numericForecast?.intervalWidthBand ?? "unknown",
      unit: numericForecast?.unit ?? "unknown",
      p50_disagreement_band: numericForecast?.p50DisagreementBand ?? "unknown",
      p50_error_band: numericForecast?.p50ErrorBand ?? "unknown",
      resolved_position_band: numericForecast?.resolvedPositionBand ?? "unknown",
      attempt_count_band: attemptCountBand(numericForecast?.attemptCount ?? null),
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_numeric_distribution_scores_total",
      "Product numeric aggregate forecast score rows by interval width band and unit.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_numeric_distribution_score_mean",
      "Mean product numeric aggregate forecast score by interval width band and unit.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const dateScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readString(asRecord(row.scoreConfig), "forecastType") === "date"
  );
  if (dateScoreRows.length === 0) {
    const labels = {
      score_type: "all",
      date_interval_band: "none",
      never_probability_band: "unknown",
      p50_disagreement_band: "unknown",
      p50_error_band: "unknown",
      resolved_position_band: "unknown",
      attempt_count_band: "unknown",
    };
    metrics.gauge(
      "open_superforecaster_date_distribution_scores_total",
      "Product date aggregate forecast score rows by interval width and never-probability band.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_date_distribution_score_mean",
      "Mean product date aggregate forecast score by interval width and never-probability band.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(dateScoreRows, (row) => {
    const dateForecast = readDateForecastSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      date_interval_band: dateForecast?.intervalBand ?? "unknown",
      never_probability_band: dateForecast?.neverProbabilityBand ?? "unknown",
      p50_disagreement_band: dateForecast?.p50DisagreementBand ?? "unknown",
      p50_error_band: dateForecast?.p50ErrorBand ?? "unknown",
      resolved_position_band: dateForecast?.resolvedPositionBand ?? "unknown",
      attempt_count_band: attemptCountBand(dateForecast?.attemptCount ?? null),
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_date_distribution_scores_total",
      "Product date aggregate forecast score rows by interval width and never-probability band.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_date_distribution_score_mean",
      "Mean product date aggregate forecast score by interval width and never-probability band.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const categoricalScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readString(asRecord(row.scoreConfig), "forecastType") === "categorical"
  );
  if (categoricalScoreRows.length === 0) {
    const labels = {
      score_type: "all",
      top_probability_band: "none",
      entropy_band: "unknown",
      category_source: "unknown",
      category_coverage_band: "unknown",
      top_category_agreement_band: "unknown",
      resolved_category_band: "unknown",
      attempt_count_band: "unknown",
    };
    metrics.gauge(
      "open_superforecaster_categorical_distribution_scores_total",
      "Product categorical aggregate forecast score rows by confidence, entropy, and category source.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_categorical_distribution_score_mean",
      "Mean product categorical aggregate forecast score by confidence, entropy, and category source.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(categoricalScoreRows, (row) => {
    const categoricalForecast = readCategoricalForecastSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      top_probability_band: categoricalForecast?.topProbabilityBand ?? "unknown",
      entropy_band: categoricalForecast?.entropyBand ?? "unknown",
      category_source: categoricalForecast?.categorySource ?? "unknown",
      category_coverage_band: categoricalForecast?.categoryCoverageBand ?? "unknown",
      top_category_agreement_band: categoricalForecast?.topCategoryAgreementBand ?? "unknown",
      resolved_category_band: categoricalForecast?.resolvedCategoryBand ?? "unknown",
      attempt_count_band: attemptCountBand(categoricalForecast?.attemptCount ?? null),
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_categorical_distribution_scores_total",
      "Product categorical aggregate forecast score rows by confidence, entropy, and category source.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_categorical_distribution_score_mean",
      "Mean product categorical aggregate forecast score by confidence, entropy, and category source.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const evidenceScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readEvidenceCoverageSnapshot(row.scoreConfig) !== null
  );
  if (evidenceScoreRows.length === 0) {
    const labels = {
      score_type: "all",
      source_count_band: "none",
      source_diversity_band: "unknown",
      source_concentration_band: "unknown",
      source_date_coverage_band: "unknown",
      source_freshness_band: "unknown",
      source_timing_band: "unknown",
      uncertainty_count_band: "unknown",
      rationale_length_band: "unknown",
    };
    metrics.gauge(
      "open_superforecaster_evidence_coverage_scores_total",
      "Product aggregate forecast score rows by evidence coverage bands.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_evidence_coverage_score_mean",
      "Mean product aggregate forecast score by evidence coverage bands.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(evidenceScoreRows, (row) => {
    const evidenceCoverage = readEvidenceCoverageSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      source_count_band: evidenceCoverage?.sourceCountBand ?? "unknown",
      source_diversity_band: evidenceCoverage?.sourceDiversityBand ?? "unknown",
      source_concentration_band: evidenceCoverage?.sourceConcentrationBand ?? "unknown",
      source_date_coverage_band: evidenceCoverage?.sourceDateCoverageBand ?? "unknown",
      source_freshness_band: evidenceCoverage?.sourceFreshnessBand ?? "unknown",
      source_timing_band: evidenceCoverage?.sourceTimingBand ?? "unknown",
      uncertainty_count_band: evidenceCoverage?.uncertaintyCountBand ?? "unknown",
      rationale_length_band: evidenceCoverage?.rationaleLengthBand ?? "unknown",
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_evidence_coverage_scores_total",
      "Product aggregate forecast score rows by evidence coverage bands.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_evidence_coverage_score_mean",
      "Mean product aggregate forecast score by evidence coverage bands.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const inputContextScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readForecastInputContextSnapshot(row.scoreConfig) !== null
  );
  if (inputContextScoreRows.length === 0) {
    const labels = {
      score_type: "all",
      requested_forecast_type: "none",
      requested_forecast_type_band: "unknown",
      routed_forecast_type: "none",
      routed_forecast_type_band: "unknown",
      requested_routed_type_band: "unknown",
      routing_confidence_band: "unknown",
      input_source_band: "unknown",
      context_completeness_band: "none",
      evidence_as_of_date_band: "unknown",
      resolution_criteria_length_band: "unknown",
      resolution_horizon_band: "unknown",
      background_length_band: "unknown",
      market_price_band: "unknown",
      market_price_age_band: "unknown",
      market_creation_age_band: "unknown",
      market_metadata_band: "unknown",
      question_length_band: "unknown",
      category_count_band: "unknown",
      category_coverage_band: "unknown",
      threshold_count_band: "unknown",
      threshold_value_coverage_band: "unknown",
      threshold_direction_band: "unknown",
      condition_criteria_band: "unknown",
      condition_length_band: "unknown",
      condition_resolution_criteria_length_band: "unknown",
      unit_specificity_band: "unknown",
    };
    metrics.gauge(
      "open_superforecaster_input_context_scores_total",
      "Product aggregate forecast score rows by input context bands.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_input_context_score_mean",
      "Mean product aggregate forecast score by input context bands.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(inputContextScoreRows, (row) => {
    const inputContext = readForecastInputContextSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      requested_forecast_type: inputContext?.requestedForecastType ?? "none",
      requested_forecast_type_band: inputContext?.requestedForecastTypeBand ?? "unknown",
      routed_forecast_type: inputContext?.routedForecastType ?? "none",
      routed_forecast_type_band: inputContext?.routedForecastTypeBand ?? "unknown",
      requested_routed_type_band: inputContext?.requestedRoutedTypeBand ?? "unknown",
      routing_confidence_band: inputContext?.routingConfidenceBand ?? "unknown",
      input_source_band: inputContext?.inputSourceBand ?? "unknown",
      context_completeness_band: inputContext?.contextCompletenessBand ?? "unknown",
      evidence_as_of_date_band: inputContext?.evidenceAsOfDateBand ?? "unknown",
      resolution_criteria_length_band: inputContext?.resolutionCriteriaLengthBand ?? "unknown",
      resolution_horizon_band: inputContext?.resolutionHorizonBand ?? "unknown",
      background_length_band: inputContext?.backgroundLengthBand ?? "unknown",
      market_price_band: inputContext?.hasMarketPrice ? inputContext.marketPriceBand : "none",
      market_price_age_band: inputContext?.hasMarketPrice ? inputContext.marketPriceAgeBand : "none",
      market_creation_age_band: inputContext?.marketCreationAgeBand ?? "unknown",
      market_metadata_band: inputContext?.marketMetadataBand ?? "unknown",
      question_length_band: inputContext?.questionLengthBand ?? "unknown",
      category_count_band: inputContext?.categoryCountBand ?? "unknown",
      category_coverage_band: inputContext?.categoryCoverageBand ?? "unknown",
      threshold_count_band: inputContext?.thresholdCountBand ?? "unknown",
      threshold_value_coverage_band: inputContext?.thresholdValueCoverageBand ?? "unknown",
      threshold_direction_band: inputContext?.thresholdDirectionBand ?? "unknown",
      condition_criteria_band: inputContext?.conditionCriteriaBand ?? "unknown",
      condition_length_band: inputContext?.conditionLengthBand ?? "unknown",
      condition_resolution_criteria_length_band: inputContext?.conditionResolutionCriteriaLengthBand ?? "unknown",
      unit_specificity_band: inputContext?.unitSpecificityBand ?? "unknown",
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_input_context_scores_total",
      "Product aggregate forecast score rows by input context bands.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_input_context_score_mean",
      "Mean product aggregate forecast score by input context bands.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const runMetadataScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readForecastRunSnapshot(row.scoreConfig) !== null
  );
  if (runMetadataScoreRows.length === 0) {
    const labels = {
      score_type: "all",
      duration_band: "none",
      workflow_version_status: "none",
      workflow_variant_status: "none",
      experiment_label_status: "none",
    };
    metrics.gauge(
      "open_superforecaster_run_metadata_scores_total",
      "Product aggregate forecast score rows by run metadata bands.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_run_metadata_score_mean",
      "Mean product aggregate forecast score by run metadata bands.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(runMetadataScoreRows, (row) => {
    const runMetadata = readForecastRunSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      duration_band: runMetadata?.durationBand ?? "unknown",
      workflow_version_status: runMetadata?.workflowVersion ? "recorded" : "missing",
      workflow_variant_status: runMetadata?.workflowVariantId ? "recorded" : "missing",
      experiment_label_status: runMetadata?.experimentLabel ? "recorded" : "missing",
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_run_metadata_scores_total",
      "Product aggregate forecast score rows by run metadata bands.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_run_metadata_score_mean",
      "Mean product aggregate forecast score by run metadata bands.",
      mean(rows.map((row) => row.scoreValue)),
      labels,
    );
  }
  const productAggregateBrierRows = scoreRows.filter((row) =>
    row.scoreType === "brier" &&
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig)
  );
  const productResolutionIds = uniqueStrings(
    scoreRows
      .filter((row) => isProductScoreConfig(row.scoreConfig))
      .map((row) => row.resolutionId)
      .filter((id): id is string => Boolean(id)),
  );
  const calibrationReport = buildBinaryCalibrationReport(
    productAggregateBrierRows.map((row) => ({
      probability: readCalibrationProbability(row.scoreConfig),
      resolved: readCalibrationResolved(row.scoreConfig),
      score: row.scoreValue,
    })),
    productResolutionIds.length,
  );
  const calibrationGuardImpact = buildCalibrationGuardImpact(productAggregateBrierRows.map((row) => ({
    score: row.scoreValue,
    taskId: readString(asRecord(row.scoreConfig), "taskId"),
    calibrationGuard: readCalibrationGuardSnapshot(row.scoreConfig),
  })));
  metrics.gauge("open_superforecaster_binary_calibration_status", "Binary aggregate calibration fitting status.", 1, {
    status: calibrationReport.calibrationSummary.status,
  });
  metrics.gauge("open_superforecaster_calibration_guard_impact_status", "Calibration guard impact status from resolved aggregate Brier rows.", 1, {
    status: calibrationGuardImpact.status,
  });
  metrics.gauge("open_superforecaster_calibration_guard_impact_guarded_rows", "Guarded aggregate Brier rows in calibration guard impact summary.", calibrationGuardImpact.guardedRows);
  metrics.gauge("open_superforecaster_calibration_guard_impact_unguarded_rows", "Unguarded aggregate Brier rows in calibration guard impact summary.", calibrationGuardImpact.unguardedRows);
  metrics.gauge("open_superforecaster_calibration_guard_impact_guarded_resolved_tasks", "Guarded resolved tasks in calibration guard impact summary.", calibrationGuardImpact.guardedResolvedTasks);
  metrics.gauge("open_superforecaster_calibration_guard_impact_unguarded_resolved_tasks", "Unguarded resolved tasks in calibration guard impact summary.", calibrationGuardImpact.unguardedResolvedTasks);
  if (calibrationGuardImpact.guardedMeanBrier !== null) {
    metrics.gauge("open_superforecaster_calibration_guard_impact_guarded_mean_brier", "Mean Brier for guarded aggregate forecasts.", calibrationGuardImpact.guardedMeanBrier);
  }
  if (calibrationGuardImpact.unguardedMeanBrier !== null) {
    metrics.gauge("open_superforecaster_calibration_guard_impact_unguarded_mean_brier", "Mean Brier for unguarded aggregate forecasts.", calibrationGuardImpact.unguardedMeanBrier);
  }
  if (calibrationGuardImpact.brierDelta !== null) {
    metrics.gauge("open_superforecaster_calibration_guard_impact_brier_delta", "Guarded minus unguarded mean Brier.", calibrationGuardImpact.brierDelta);
  }
  for (const ruleImpact of calibrationGuardImpact.byRule) {
    const labels = { rule_id: ruleImpact.ruleId, status: ruleImpact.status };
    metrics.gauge("open_superforecaster_calibration_guard_rule_impact_status", "Calibration guard impact status by applied rule id.", 1, labels);
    metrics.gauge("open_superforecaster_calibration_guard_rule_impact_guarded_rows", "Guarded aggregate Brier rows by applied calibration guard rule.", ruleImpact.guardedRows, labels);
    metrics.gauge("open_superforecaster_calibration_guard_rule_impact_guarded_resolved_tasks", "Guarded resolved tasks by applied calibration guard rule.", ruleImpact.guardedResolvedTasks, labels);
    if (ruleImpact.guardedMeanBrier !== null) {
      metrics.gauge("open_superforecaster_calibration_guard_rule_impact_guarded_mean_brier", "Mean Brier by applied calibration guard rule.", ruleImpact.guardedMeanBrier, labels);
    }
    if (ruleImpact.brierDelta !== null) {
      metrics.gauge("open_superforecaster_calibration_guard_rule_impact_brier_delta", "Rule guarded minus unguarded mean Brier.", ruleImpact.brierDelta, labels);
    }
  }
  metrics.gauge(
    "open_superforecaster_binary_calibration_sample_size",
    "Binary aggregate calibration sample size.",
    calibrationReport.calibrationSummary.sampleSize,
  );
  metrics.gauge(
    "open_superforecaster_binary_calibration_resolved_forecasts",
    "Resolved product forecast count used to decide calibration fitting readiness.",
    calibrationReport.calibrationSummary.resolvedForecastCount,
  );
  metrics.gauge(
    "open_superforecaster_binary_calibration_minimum_for_fitting",
    "Minimum resolved product forecast count before candidate calibration fitting is considered ready.",
    calibrationReport.calibrationSummary.minimumForFitting,
  );
  if (calibrationReport.calibrationSummary.expectedCalibrationError !== null) {
    metrics.gauge(
      "open_superforecaster_binary_calibration_expected_error",
      "Expected calibration error for binary aggregate forecasts, in percentage points.",
      calibrationReport.calibrationSummary.expectedCalibrationError,
    );
  }
  if (calibrationReport.calibrationSummary.maxBucketCalibrationError !== null) {
    metrics.gauge(
      "open_superforecaster_binary_calibration_max_bucket_error",
      "Largest binary aggregate calibration bucket error, in percentage points.",
      calibrationReport.calibrationSummary.maxBucketCalibrationError,
    );
  }
  for (const bucket of calibrationReport.calibrationBuckets) {
    const labels = { bucket: bucket.label };
    metrics.gauge("open_superforecaster_binary_calibration_bucket_count", "Binary aggregate calibration bucket row count.", bucket.count, labels);
    if (bucket.meanForecast !== null) {
      metrics.gauge("open_superforecaster_binary_calibration_bucket_mean_forecast", "Binary aggregate calibration bucket mean forecast.", bucket.meanForecast, labels);
    }
    if (bucket.observedRate !== null) {
      metrics.gauge("open_superforecaster_binary_calibration_bucket_observed_rate", "Binary aggregate calibration bucket observed rate.", bucket.observedRate, labels);
    }
    if (bucket.calibrationError !== null) {
      metrics.gauge("open_superforecaster_binary_calibration_bucket_error", "Binary aggregate calibration bucket error.", bucket.calibrationError, labels);
    }
  }
  for (const diagnostic of calibrationReport.calibrationDiagnostics) {
    metrics.gauge("open_superforecaster_binary_calibration_diagnostic", "Binary aggregate calibration diagnostic requiring review.", 1, {
      bucket: diagnostic.bucketLabel,
      severity: diagnostic.severity,
      direction: diagnostic.direction,
    });
  }
  metrics.gauge(
    "open_superforecaster_binary_calibration_candidate_guard_rules_total",
    "Candidate binary calibration guard rule count derived from resolved forecast calibration.",
    calibrationReport.candidateCalibrationGuardRules.length,
  );
  for (const rule of calibrationReport.candidateCalibrationGuardRules) {
    metrics.gauge("open_superforecaster_binary_calibration_candidate_guard_rule", "Candidate binary calibration guard rule requiring review.", 1, {
      bucket: rule.bucketLabel,
      direction: rule.direction,
      activation_status: rule.activationStatus,
    });
  }

  if (options.root) {
    const validationRows = await readCalibrationGuardValidationMetricRows(options.root);
    const defaultPlanRows = await readCalibrationGuardDefaultPlanMetricRows(options.root);
    const attentionRows = await readForecastAttentionMetricRows(options.root);
    const batchHealth = readLatestForecastBatchHealth(options.root);
    const validationReportPaths = uniqueStrings(validationRows.map((row) => row.reportPath));
    const defaultPlanReportPaths = uniqueStrings(defaultPlanRows.map((row) => row.reportPath));
    const attentionReportPaths = uniqueStrings(attentionRows.map((row) => row.reportPath));
    const batchHealthLabels = {
      batch_id: batchHealth.batchId ?? "none",
      status: batchHealth.status,
    };
    metrics.gauge(
      "open_superforecaster_forecast_batch_health_report_present",
      "Whether the latest local forecast batch health report exists.",
      batchHealth.exists ? 1 : 0,
      batchHealthLabels,
    );
    metrics.gauge(
      "open_superforecaster_forecast_batch_health_status",
      "Latest local forecast batch health status.",
      1,
      batchHealthLabels,
    );
    emitOptionalGauge(
      metrics,
      "open_superforecaster_forecast_batch_health_unresolved_attention_items",
      "Unresolved attention item count in the latest local forecast batch health report.",
      batchHealth.summary.unresolvedAttentionItems,
      batchHealthLabels,
    );
    emitOptionalGauge(
      metrics,
      "open_superforecaster_forecast_batch_health_open_attention_items",
      "Open attention item count in the latest local forecast batch health report.",
      batchHealth.summary.openAttentionItems,
      batchHealthLabels,
    );
    emitOptionalGauge(
      metrics,
      "open_superforecaster_forecast_batch_health_deferred_attention_items",
      "Deferred attention item count in the latest local forecast batch health report.",
      batchHealth.summary.deferredAttentionItems,
      batchHealthLabels,
    );
    emitOptionalGauge(
      metrics,
      "open_superforecaster_forecast_batch_health_unresolved_candidate_guard_rules",
      "Unresolved candidate calibration guard rule count in the latest local forecast batch health report.",
      batchHealth.summary.unresolvedCandidateCalibrationGuardRules,
      batchHealthLabels,
    );
    emitOptionalGauge(
      metrics,
      "open_superforecaster_forecast_batch_health_score_regression_items",
      "Score-regression attention item count in the latest local forecast batch health report.",
      batchHealth.summary.scoreRegressionItems,
      batchHealthLabels,
    );
    emitOptionalGauge(
      metrics,
      "open_superforecaster_forecast_batch_health_calibration_guard_regression_items",
      "Calibration-guard regression attention item count in the latest local forecast batch health report.",
      batchHealth.summary.calibrationGuardRegressionItems,
      batchHealthLabels,
    );
    metrics.gauge(
      "open_superforecaster_forecast_batch_health_missing_phases_total",
      "Missing phase count in the latest local forecast batch health report.",
      batchHealth.missingPhases.length,
      batchHealthLabels,
    );
    metrics.gauge(
      "open_superforecaster_forecast_batch_health_issues_total",
      "Issue count in the latest local forecast batch health report.",
      batchHealth.issues.length,
      batchHealthLabels,
    );
    for (const [key, count] of countBy(batchHealth.issues, (issue) =>
      labelKey({
        ...batchHealthLabels,
        severity: issue.severity,
        kind: issue.kind,
      }),
    )) {
      metrics.gauge(
        "open_superforecaster_forecast_batch_health_issues_total",
        "Issue count in the latest local forecast batch health report.",
        count,
        parseLabelKey(key),
      );
    }
    metrics.gauge(
      "open_superforecaster_forecast_attention_reports_total",
      "Local forecast batch index report count containing forecast attention items.",
      attentionReportPaths.length,
    );
    metrics.gauge(
      "open_superforecaster_forecast_attention_items_total",
      "Local forecast attention item count by review status, severity, kind, and forecast type.",
      attentionRows.length,
    );
    for (const [key, count] of countBy(attentionRows, (row) =>
      labelKey({
        review_status: row.reviewStatus ?? "unknown",
        severity: row.severity ?? "unknown",
        kind: row.kind ?? "unknown",
        forecast_type: row.forecastType ?? "unknown",
      }),
    )) {
      metrics.gauge(
        "open_superforecaster_forecast_attention_items_total",
        "Local forecast attention item count by review status, severity, kind, and forecast type.",
        count,
        parseLabelKey(key),
      );
    }
    for (const item of attentionRows.slice(-50)) {
      const labels = {
        batch_id: item.batchId ?? "unknown",
        attention_item_id: item.attentionItemId ?? "unknown",
        review_status: item.reviewStatus ?? "unknown",
        severity: item.severity ?? "unknown",
        kind: item.kind ?? "unknown",
        metric: item.metric ?? "unknown",
        forecast_type: item.forecastType ?? "unknown",
        task_id: item.taskId ?? "none",
      };
      metrics.gauge("open_superforecaster_forecast_attention_item_info", "Recent forecast attention item metadata.", 1, labels);
      if (item.score !== null) {
        metrics.gauge("open_superforecaster_forecast_attention_item_score", "Recent forecast attention item score.", item.score, labels);
      }
      if (item.delta !== null) {
        metrics.gauge("open_superforecaster_forecast_attention_item_delta", "Recent forecast attention item delta.", item.delta, labels);
      }
    }
    metrics.gauge(
      "open_superforecaster_calibration_guard_validation_reports_total",
      "Local calibration guard validation report count.",
      validationReportPaths.length,
    );
    metrics.gauge(
      "open_superforecaster_calibration_guard_validations_total",
      "Local calibration guard validation row count by recommendation.",
      validationRows.length,
    );
    for (const [key, count] of countBy(validationRows, (row) =>
      labelKey({
        recommendation: row.recommendation ?? "unknown",
      }),
    )) {
      metrics.gauge(
        "open_superforecaster_calibration_guard_validations_total",
        "Local calibration guard validation row count by recommendation.",
        count,
        parseLabelKey(key),
      );
    }
    for (const validation of validationRows.slice(-50)) {
      const labels = {
        validation_mode: validation.validationMode ?? "unknown",
        proposal_id: validation.proposalId ?? "unknown",
        source_candidate_guard_id: validation.sourceCandidateGuardId ?? "unknown",
        bucket: validation.bucketLabel ?? "unknown",
        recommendation: validation.recommendation ?? "unknown",
      };
      metrics.gauge("open_superforecaster_calibration_guard_validation_info", "Recent calibration guard validation metadata.", 1, labels);
      if (validation.matchedRows !== null) {
        metrics.gauge("open_superforecaster_calibration_guard_validation_matched_rows", "Rows matched by a calibration guard validation.", validation.matchedRows, labels);
      }
      if (validation.brierDelta !== null) {
        metrics.gauge("open_superforecaster_calibration_guard_validation_brier_delta", "Candidate minus baseline mean Brier in calibration guard validation.", validation.brierDelta, labels);
      }
      if (validation.calibrationErrorDelta !== null) {
        metrics.gauge(
          "open_superforecaster_calibration_guard_validation_calibration_error_delta",
          "Candidate minus baseline bucket calibration error in calibration guard validation.",
          validation.calibrationErrorDelta,
          labels,
        );
      }
    }
    metrics.gauge(
      "open_superforecaster_calibration_guard_default_plan_reports_total",
      "Local calibration guard default plan report count.",
      defaultPlanReportPaths.length,
    );
    metrics.gauge(
      "open_superforecaster_calibration_guard_default_plan_candidates_total",
      "Local calibration guard default implementation candidate count.",
      defaultPlanRows.length,
    );
    for (const candidate of defaultPlanRows.slice(-50)) {
      const labels = {
        proposal_id: candidate.proposalId ?? "unknown",
        source_candidate_guard_id: candidate.sourceCandidateGuardId ?? "unknown",
        bucket: candidate.bucketLabel ?? "unknown",
        target_workflow_id: candidate.targetWorkflowId ?? "unknown",
        implementation_status: candidate.implementationStatus ?? "unknown",
      };
      metrics.gauge("open_superforecaster_calibration_guard_default_plan_candidate_info", "Recent calibration guard default plan candidate metadata.", 1, labels);
      if (candidate.suggestedAdjustment !== null) {
        metrics.gauge(
          "open_superforecaster_calibration_guard_default_plan_candidate_adjustment",
          "Suggested percentage-point adjustment for a calibration guard default plan candidate.",
          candidate.suggestedAdjustment,
          labels,
        );
      }
      if (candidate.matchedRows !== null) {
        metrics.gauge(
          "open_superforecaster_calibration_guard_default_plan_candidate_matched_rows",
          "Held-out rows matched by a calibration guard default plan candidate.",
          candidate.matchedRows,
          labels,
        );
      }
      if (candidate.brierDelta !== null) {
        metrics.gauge(
          "open_superforecaster_calibration_guard_default_plan_candidate_brier_delta",
          "Candidate minus baseline mean Brier for a calibration guard default plan candidate.",
          candidate.brierDelta,
          labels,
        );
      }
      if (candidate.calibrationErrorDelta !== null) {
        metrics.gauge(
          "open_superforecaster_calibration_guard_default_plan_candidate_calibration_error_delta",
          "Candidate minus baseline bucket calibration error for a calibration guard default plan candidate.",
          candidate.calibrationErrorDelta,
          labels,
        );
      }
    }
  }

  metrics.gauge("open_superforecaster_resolutions_total", "Forecast resolution count.", resolutionRows.length);
  metrics.gauge("open_superforecaster_resolutions_total", "Forecast resolution count.", resolutionRows.filter((row) => !row.annulled).length, {
    annulled: "false",
  });
  metrics.gauge("open_superforecaster_resolutions_total", "Forecast resolution count.", resolutionRows.filter((row) => row.annulled).length, {
    annulled: "true",
  });

  for (const [key, count] of countBy(sourceRows, (row) =>
    labelKey({
      source_type: row.sourceType,
      used_in_final: String(row.usedInFinal),
    }),
  )) {
    metrics.gauge("open_superforecaster_source_bank_entries_total", "Source bank entry count by source type.", count, parseLabelKey(key));
  }
  const sourceDomainRows = summarizeSourceDomains(sourceRows);
  metrics.gauge("open_superforecaster_source_bank_domains_total", "Distinct source-bank domains.", sourceDomainRows.length);
  for (const row of sourceDomainRows.slice(0, 20)) {
    const labels = { domain: row.domain };
    metrics.gauge("open_superforecaster_source_bank_domain_entries", "Top source-bank domain entry count.", row.entries, labels);
    metrics.gauge("open_superforecaster_source_bank_domain_used_in_final_entries", "Top source-bank domain final-use entry count.", row.usedInFinalEntries, labels);
    metrics.gauge("open_superforecaster_source_bank_domain_task_count", "Top source-bank domain task count.", row.taskCount, labels);
    if (row.meanQualityScore !== null) {
      metrics.gauge("open_superforecaster_source_bank_domain_quality_score_mean", "Top source-bank domain mean quality score.", row.meanQualityScore, labels);
    }
  }

  return metrics.render();
}

class MetricsBuilder {
  private readonly lines: string[] = [];
  private readonly declared = new Set<string>();

  gauge(name: string, help: string, value: number, labels?: Record<string, string>) {
    if (!this.declared.has(name)) {
      this.lines.push(`# HELP ${name} ${help}`);
      this.lines.push(`# TYPE ${name} gauge`);
      this.declared.add(name);
    }
    this.lines.push(`${name}${formatLabels(labels)} ${formatMetricNumber(value)}`);
  }

  render() {
    return `${this.lines.join("\n")}\n`;
  }
}

function countBy<T>(rows: T[], keyFn: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function groupBy<T>(rows: T[], keyFn: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function labelKey(labels: Record<string, string>) {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u001f");
}

function parseLabelKey(key: string) {
  return Object.fromEntries(
    key.split("\u001f").filter(Boolean).map((entry) => {
      const index = entry.indexOf("=");
      return [entry.slice(0, index), entry.slice(index + 1)];
    }),
  );
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function emitBenchmarkCostLatencyMetrics(
  metrics: MetricsBuilder,
  labels: Record<string, string>,
  findings: Record<string, unknown> | null,
) {
  metrics.gauge("open_superforecaster_benchmark_cost_summary_present", "Whether a benchmark run has persisted cost/latency findings.", findings ? 1 : 0, labels);
  if (!findings) {
    return;
  }
  emitOptionalGauge(
    metrics,
    "open_superforecaster_benchmark_cost_measured_cases",
    "Benchmark cases with measured durable-log token usage.",
    readNumber(findings, "measuredCases"),
    labels,
  );
  emitOptionalGauge(
    metrics,
    "open_superforecaster_benchmark_cost_missing_usage_cases",
    "Benchmark cases with a run id but no parsed durable-log token usage.",
    readNumber(findings, "missingUsageCases"),
    labels,
  );
  emitOptionalGauge(
    metrics,
    "open_superforecaster_benchmark_cost_agent_calls_total",
    "Benchmark agent calls parsed from durable run logs.",
    readNumber(findings, "totalAgentCalls"),
    labels,
  );
  for (const [tokenType, key] of Object.entries({
    input: "totalInputTokens",
    cached_input: "totalCachedInputTokens",
    output: "totalOutputTokens",
    reasoning_output: "totalReasoningOutputTokens",
    total: "totalTokens",
  })) {
    emitOptionalGauge(
      metrics,
      "open_superforecaster_benchmark_cost_token_total",
      "Benchmark token usage parsed from durable run logs.",
      readNumber(findings, key),
      { ...labels, token_type: tokenType },
    );
  }
  emitOptionalGauge(
    metrics,
    "open_superforecaster_benchmark_cost_mean_tokens_per_case",
    "Mean token usage per measured benchmark case.",
    readNumber(findings, "meanTokensPerMeasuredCase"),
    labels,
  );
  emitOptionalGauge(
    metrics,
    "open_superforecaster_benchmark_cost_median_tokens_per_case",
    "Median token usage per measured benchmark case.",
    readNumber(findings, "medianTokensPerMeasuredCase"),
    labels,
  );
  emitOptionalGauge(
    metrics,
    "open_superforecaster_benchmark_cost_mean_duration_seconds",
    "Mean task duration for benchmark cases with completed task timestamps.",
    readNumber(findings, "meanDurationSeconds"),
    labels,
  );
  emitOptionalGauge(
    metrics,
    "open_superforecaster_benchmark_cost_median_duration_seconds",
    "Median task duration for benchmark cases with completed task timestamps.",
    readNumber(findings, "medianDurationSeconds"),
    labels,
  );
  for (const row of readRecordArray(findings, "byStatus")) {
    const status = readString(row, "status") ?? "unknown";
    const statusLabels = { ...labels, case_status: status };
    emitOptionalGauge(metrics, "open_superforecaster_benchmark_cost_cases_by_status", "Benchmark cases by status in cost analysis.", readNumber(row, "cases"), statusLabels);
    emitOptionalGauge(metrics, "open_superforecaster_benchmark_cost_measured_cases_by_status", "Benchmark measured cases by status in cost analysis.", readNumber(row, "measuredCases"), statusLabels);
    emitOptionalGauge(metrics, "open_superforecaster_benchmark_cost_agent_calls_by_status", "Benchmark agent calls by case status.", readNumber(row, "agentCalls"), statusLabels);
    emitOptionalGauge(metrics, "open_superforecaster_benchmark_cost_tokens_by_status", "Benchmark token usage by case status.", readNumber(row, "totalTokens"), statusLabels);
  }
  emitBenchmarkCostOutlierMetrics(metrics, labels, "heaviest", readRecordArray(findings, "heaviestCases"));
  emitBenchmarkCostOutlierMetrics(metrics, labels, "slowest", readRecordArray(findings, "slowestCases"));
}

function emitBenchmarkCostOutlierMetrics(
  metrics: MetricsBuilder,
  labels: Record<string, string>,
  outlierKind: "heaviest" | "slowest",
  rows: Record<string, unknown>[],
) {
  rows.slice(0, 5).forEach((row, index) => {
    const outlierLabels = {
      ...labels,
      outlier_kind: outlierKind,
      outlier_rank: String(index + 1),
      benchmark_case_result_id: readString(row, "benchmarkCaseResultId") ?? "none",
      benchmark_case_id: readString(row, "benchmarkCaseId") ?? "none",
      task_id: readString(row, "taskId") ?? "none",
      smithers_run_id: readString(row, "smithersRunId") ?? "none",
      case_status: readString(row, "status") ?? "unknown",
    };
    emitOptionalGauge(
      metrics,
      "open_superforecaster_benchmark_cost_outlier_tokens",
      "Token usage for capped benchmark cost outlier cases.",
      readNumber(row, "totalTokens"),
      outlierLabels,
    );
    emitOptionalGauge(
      metrics,
      "open_superforecaster_benchmark_cost_outlier_duration_seconds",
      "Task duration for capped benchmark cost outlier cases.",
      readNumber(row, "durationSeconds"),
      outlierLabels,
    );
    emitOptionalGauge(
      metrics,
      "open_superforecaster_benchmark_cost_outlier_agent_calls",
      "Agent calls for capped benchmark cost outlier cases.",
      readNumber(row, "agentCalls"),
      outlierLabels,
    );
  });
}

function emitOptionalGauge(
  metrics: MetricsBuilder,
  name: string,
  help: string,
  value: number | null,
  labels?: Record<string, string>,
) {
  if (value !== null) {
    metrics.gauge(name, help, value, labels);
  }
}

function readRecord(value: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  for (const key of keys) {
    const raw = value[key];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
  }
  return null;
}

async function readCalibrationGuardValidationMetricRows(root: string): Promise<CalibrationGuardValidationMetricRow[]> {
  const reportPaths = await listFilesNamed(resolve(root, "data/reports/forecast-calibration-guard-validation"), "calibration-guard-validation.json");
  const rows: CalibrationGuardValidationMetricRow[] = [];
  for (const reportPath of reportPaths) {
    let payload: Record<string, unknown> | null;
    try {
      payload = asRecord(JSON.parse(await readFile(reportPath, "utf8")));
    } catch {
      continue;
    }
    const generatedAt = readString(payload, "generatedAt");
    for (const validation of readRecordArray(payload, "validations")) {
      rows.push({
        reportPath,
        generatedAt,
        validationMode: readString(validation, "validationMode"),
        proposalId: readString(validation, "proposalId"),
        sourceCandidateGuardId: readString(validation, "sourceCandidateGuardId"),
        bucketLabel: readString(validation, "bucketLabel"),
        matchedRows: readNumber(validation, "matchedRows"),
        brierDelta: readNumber(validation, "brierDelta"),
        calibrationErrorDelta: readNumber(validation, "calibrationErrorDelta"),
        recommendation: readString(validation, "recommendation"),
      });
    }
  }
  return rows.sort((left, right) =>
    String(left.generatedAt ?? "").localeCompare(String(right.generatedAt ?? ""))
    || String(left.proposalId ?? "").localeCompare(String(right.proposalId ?? ""))
    || left.reportPath.localeCompare(right.reportPath)
  );
}

async function readCalibrationGuardDefaultPlanMetricRows(root: string): Promise<CalibrationGuardDefaultPlanMetricRow[]> {
  const reportPaths = await listFilesNamed(resolve(root, "data/reports/forecast-calibration-guard-default-plan"), "calibration-guard-default-plan.json");
  const rows: CalibrationGuardDefaultPlanMetricRow[] = [];
  for (const reportPath of reportPaths) {
    let payload: Record<string, unknown> | null;
    try {
      payload = asRecord(JSON.parse(await readFile(reportPath, "utf8")));
    } catch {
      continue;
    }
    const generatedAt = readString(payload, "generatedAt");
    for (const candidate of readRecordArray(payload, "defaultCandidates")) {
      rows.push({
        reportPath,
        generatedAt,
        proposalId: readString(candidate, "proposalId"),
        sourceCandidateGuardId: readString(candidate, "sourceCandidateGuardId"),
        bucketLabel: readString(candidate, "bucketLabel"),
        suggestedAdjustment: readNumber(candidate, "suggestedAdjustment"),
        matchedRows: readNumber(candidate, "matchedRows"),
        brierDelta: readNumber(candidate, "brierDelta"),
        calibrationErrorDelta: readNumber(candidate, "calibrationErrorDelta"),
        targetWorkflowId: readString(candidate, "targetWorkflowId"),
        targetFile: readString(candidate, "targetFile"),
        implementationStatus: readString(candidate, "implementationStatus"),
      });
    }
  }
  return rows.sort((left, right) =>
    String(left.generatedAt ?? "").localeCompare(String(right.generatedAt ?? ""))
    || String(left.proposalId ?? "").localeCompare(String(right.proposalId ?? ""))
    || left.reportPath.localeCompare(right.reportPath)
  );
}

async function readForecastAttentionMetricRows(root: string): Promise<ForecastAttentionMetricRow[]> {
  const reportPaths = await listFilesNamed(resolve(root, "data/reports/forecast-batches"), "batch-index.json");
  const rowsByKey = new Map<string, ForecastAttentionMetricRow>();
  for (const reportPath of reportPaths) {
    let payload: Record<string, unknown> | null;
    try {
      payload = asRecord(JSON.parse(await readFile(reportPath, "utf8")));
    } catch {
      continue;
    }
    const batchId = readString(payload, "batchId");
    const generatedAt = readString(payload, "generatedAt");
    for (const item of readRecordArray(payload, "attentionItems")) {
      const attentionItemId = readString(item, "id");
      if (!batchId || !attentionItemId) {
        continue;
      }
      rowsByKey.set(`${batchId}:${attentionItemId}`, {
        reportPath,
        batchId,
        generatedAt,
        attentionItemId,
        reviewStatus: readString(item, "reviewStatus"),
        severity: readString(item, "severity"),
        kind: readString(item, "kind"),
        metric: readString(item, "metric"),
        score: readNumber(item, "score"),
        delta: readNumber(item, "delta"),
        forecastType: readString(item, "forecastType"),
        taskId: readString(item, "taskId"),
      });
    }
  }
  return [...rowsByKey.values()].sort((left, right) =>
    String(left.generatedAt ?? "").localeCompare(String(right.generatedAt ?? ""))
    || String(left.batchId ?? "").localeCompare(String(right.batchId ?? ""))
    || String(left.attentionItemId ?? "").localeCompare(String(right.attentionItemId ?? ""))
    || left.reportPath.localeCompare(right.reportPath)
  );
}

async function listFilesNamed(path: string, name: string): Promise<string[]> {
  try {
    const info = await stat(path);
    if (info.isFile()) {
      return path.endsWith(name) ? [path] : [];
    }
    if (!info.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const children = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    children.map((child) => {
      const childPath = resolve(path, child.name);
      return child.isDirectory()
        ? listFilesNamed(childPath, name)
        : child.name === name
          ? Promise.resolve([childPath])
          : Promise.resolve([]);
    }),
  );
  return nested.flat();
}

function readRecordArray(value: Record<string, unknown> | null | undefined, key: string) {
  const raw = value?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))) : [];
}

function readString(value: Record<string, unknown> | null | undefined, key: string) {
  const raw = value?.[key];
  return typeof raw === "string" ? raw : null;
}

function readNumber(value: Record<string, unknown> | null | undefined, key: string) {
  const raw = value?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function readComparisonRecommendationStatus(comparison: Record<string, unknown> | null) {
  const recommendation = readRecord(comparison, "recommendation");
  const status = recommendation?.status;
  return typeof status === "string" ? status : null;
}

function isProductScoreConfig(value: unknown) {
  const config = asRecord(value);
  return config?.source === "manual_resolution" && typeof config.taskId === "string" && !("benchmarkRunId" in config);
}

function readCalibrationProbability(value: unknown) {
  const config = asRecord(value);
  const raw = config?.probability ?? config?.probability_pct ?? config?.probabilityPct;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readCalibrationResolved(value: unknown) {
  const config = asRecord(value);
  return typeof config?.resolved === "boolean" ? config.resolved : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function formatLabels(labels?: Record<string, string>) {
  if (!labels || Object.keys(labels).length === 0) {
    return "";
  }
  return `{${Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(",")}}`;
}

function escapeLabelValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function formatMetricNumber(value: number) {
  return Number.isFinite(value) ? String(value) : "0";
}

function durationSeconds(start: Date | null, end: Date | null) {
  if (!start || !end) {
    return null;
  }
  return Math.max(0, (end.getTime() - start.getTime()) / 1000);
}

function scoreSource(value: Record<string, unknown>) {
  const source = value.source;
  return typeof source === "string" ? source : "unknown";
}

function scoreTarget(value: Record<string, unknown>) {
  const target = value.target;
  return typeof target === "string" ? target : "unknown";
}

function mean(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
