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
import { readAggregateStatsSnapshot } from "./aggregate-stats-metadata";
import { readBaselineSanitySnapshot } from "./baseline-sanity-metadata";
import { buildCalibrationGuardImpact } from "./calibration-guard-impact";
import { readCalibrationGuardSnapshot } from "./calibration-guard-metadata";
import { readConditionalForecastSnapshot } from "./conditional-forecast-metadata";
import { buildBinaryCalibrationReport } from "./performance-calibration";
import { readSmithersTokenUsage, summarizeSmithersTokenUsage } from "./smithers-usage";

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
    db.select({ id: sourceBankEntries.id, sourceType: sourceBankEntries.sourceType, usedInFinal: sourceBankEntries.usedInFinal }).from(sourceBankEntries),
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
        validationGateStatus: workflowChangeProposals.validationGateStatus,
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
  const aggregateStatsScoreRows = scoreRows.filter((row) =>
    row.forecastAggregateId &&
    isProductScoreConfig(row.scoreConfig) &&
    readAggregateStatsSnapshot(row.scoreConfig) !== null
  );
  if (aggregateStatsScoreRows.length === 0) {
    const labels = {
      component_disagreement_band: "none",
      aggregation_anchor: "unknown",
      score_type: "all",
    };
    metrics.gauge(
      "open_superforecaster_aggregate_stats_scores_total",
      "Product aggregate forecast score rows by component disagreement band and aggregation anchor.",
      0,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_aggregate_stats_score_mean",
      "Mean product aggregate forecast score by component disagreement band and aggregation anchor.",
      0,
      labels,
    );
  }
  for (const [key, rows] of groupBy(aggregateStatsScoreRows, (row) => {
    const aggregateStats = readAggregateStatsSnapshot(row.scoreConfig);
    return labelKey({
      score_type: row.scoreType,
      component_disagreement_band: aggregateStats?.disagreementBand ?? "unknown",
      aggregation_anchor: aggregateStats?.aggregationAnchor ?? "unknown",
    });
  })) {
    const labels = parseLabelKey(key);
    metrics.gauge(
      "open_superforecaster_aggregate_stats_scores_total",
      "Product aggregate forecast score rows by component disagreement band and aggregation anchor.",
      rows.length,
      labels,
    );
    metrics.gauge(
      "open_superforecaster_aggregate_stats_score_mean",
      "Mean product aggregate forecast score by component disagreement band and aggregation anchor.",
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
    const validationReportPaths = uniqueStrings(validationRows.map((row) => row.reportPath));
    const defaultPlanReportPaths = uniqueStrings(defaultPlanRows.map((row) => row.reportPath));
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
