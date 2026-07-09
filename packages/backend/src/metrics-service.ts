import { desc, inArray } from "drizzle-orm";
import {
  artifactRows,
  benchmarkCaseResults,
  benchmarkRuns,
  forecastResolutions,
  forecastScores,
  sourceBankEntries,
  tasks,
  workflowPromotionDecisions,
  workflowVariants,
  type createDb,
} from "@open-superforecaster/db";
import { summarizeBenchmarkPromotionGateEvidence } from "./benchmark-service";
import { readSmithersTokenUsage, summarizeSmithersTokenUsage } from "./smithers-usage";

type Db = ReturnType<typeof createDb>["db"];

export async function renderPrometheusMetrics(db: Db, options: { root?: string } = {}) {
  const [
    taskRows,
    recentTasks,
    benchmarkRunRows,
    recentBenchmarkCases,
    scoreRows,
    resolutionRows,
    sourceRows,
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
        createdAt: forecastScores.createdAt,
      })
      .from(forecastScores),
    db.select({ id: forecastResolutions.id, annulled: forecastResolutions.annulled }).from(forecastResolutions),
    db.select({ id: sourceBankEntries.id, sourceType: sourceBankEntries.sourceType, usedInFinal: sourceBankEntries.usedInFinal }).from(sourceBankEntries),
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
  ].filter((id): id is string => Boolean(id))));
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

function readComparisonRecommendationStatus(comparison: Record<string, unknown> | null) {
  const recommendation = readRecord(comparison, "recommendation");
  const status = recommendation?.status;
  return typeof status === "string" ? status : null;
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
