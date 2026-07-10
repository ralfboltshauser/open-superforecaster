import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DuckDBInstance, type DuckDBAppender, type DuckDBConnection } from "@duckdb/node-api";
import postgres from "postgres";
import { readCalibrationDefaultPlanArtifacts } from "../packages/backend/src/calibration-default-plan-artifacts";
import { readCalibrationGuardValidationArtifacts } from "../packages/backend/src/calibration-guard-validation-artifacts";
import { buildCalibrationGuardImpact } from "../packages/backend/src/calibration-guard-impact";
import {
  benchmarkPromotionGateStatusNeedsMoreEvidence,
  benchmarkPromotionGateStatusReview,
  blockerBenchmarkStillRunning,
  blockerFailedOrReviewCasesPresent,
  blockerHumanForecastLeakage,
  blockerInsufficientHoldoutEvidence,
  blockerLargeProbabilityMisses,
  blockerLowQualitySources,
  blockerMissingAggregateRationale,
  blockerMissingBaselineSanity,
  blockerMissingComparisonReport,
  blockerMissingTraceBundles,
  blockerSchemaOrScoringFailures,
  blockerSourceConcentration,
  blockerSourceCutoffLeakage,
  blockerTooFewCasesForPromotion,
  blockerUnexplainedComponentDisagreement,
  blockerWeakTraceCompleteness,
  blockerWorseThanBaselineCases,
  minimumPromotionHoldoutCases,
  minimumPromotionPairedCases,
  minimumPromotionResultCases,
} from "../packages/backend/src/benchmark-promotion-policy";
import {
  blockerInsufficientPrimaryPairedCases,
  blockerInsufficientPrimaryPairedHoldoutCases,
  blockerInsufficientValidationCaseCoverage,
  blockerValidationGateNotPassing,
  blockerValidationRecommendationNotCandidateBetter,
  blockerValidationResultIncomplete,
} from "../packages/backend/src/workflow-proposal-policy";
import { isExportCompatibleAttentionBacklogArtifact } from "../packages/backend/src/forecast-attention-backlog";
import { readForecastAttentionBacklogArtifacts } from "../packages/backend/src/forecast-attention-backlog-artifacts";
import { readForecastBatchIndexArtifacts } from "../packages/backend/src/forecast-batch-index-artifacts";
import { readCalibrationGuardSnapshot } from "../packages/backend/src/calibration-guard-metadata";
import { readLatestForecastBatchHealth, type ForecastBatchHealthSnapshot } from "../packages/backend/src/forecast-batch-health";
import { buildBinaryCalibrationReport, type BinaryCalibrationInput } from "../packages/backend/src/performance-calibration";
import { readSmithersTokenUsage, summarizeSmithersTokenUsage } from "../packages/backend/src/smithers-usage";
import { summarizeSourceDomains } from "../packages/backend/src/source-domain-summary";
import { loadAppConfig } from "../packages/config/src/index";
import { readRecord, readString, type JsonRecord } from "./lib/forecast-script-utils";

const config = loadAppConfig();
const root = resolve(import.meta.dir, "..");

async function main() {
await mkdir(dirname(config.DUCKDB_PATH), { recursive: true });

const pg = postgres(config.DATABASE_URL);
const instance = await DuckDBInstance.create(config.DUCKDB_PATH);
const duck = await instance.connect();

try {
  await syncMetadata(duck);
  const tasks = await pg<TaskMartRow[]>`
    select
      id::text as task_id,
      smithers_run_id,
      operation_mode::text as operation_mode,
      operation_submode,
      status::text as status,
      label,
      output_artifact_id::text as output_artifact_id,
      benchmark_run_id::text as benchmark_run_id,
      workflow_variant_id::text as workflow_variant_id,
      experiment_label,
      created_at::text as created_at,
      started_at::text as started_at,
      completed_at::text as completed_at,
      extract(epoch from (completed_at - started_at))::double precision as duration_seconds,
      config_json::text as config_json
    from tasks
    order by created_at
  `;
  await replaceTable(duck, "osf_tasks", taskColumns, tasks);
  const smithersUsageMarts = await buildSmithersTokenUsageMarts(tasks);
  await replaceTable(duck, "osf_smithers_token_usage", smithersTokenUsageColumns, smithersUsageMarts.usageRows);
  await replaceTable(duck, "osf_smithers_token_usage_by_task", smithersTokenUsageByTaskColumns, smithersUsageMarts.summaryRows);

  const artifactRows = await pg<ArtifactRowMartRow[]>`
    select
      ar.id::text as artifact_row_id,
      ar.artifact_id::text as artifact_id,
      a.task_id::text as task_id,
      a.artifact_type::text as artifact_type,
      a.created_by,
      a.storage_uri,
      ar.row_index,
      ar.source_row_id,
      ar.status::text as status,
      ar.row_json::text as row_json,
      ar.completed_at::text as completed_at,
      ar.created_at::text as created_at
    from artifact_rows ar
    join artifacts a on a.id = ar.artifact_id
    order by a.created_at, ar.row_index
  `;
  await replaceTable(duck, "osf_artifact_rows", artifactRowColumns, artifactRows);

  const benchmarkRuns = await pg<BenchmarkRunMartRow[]>`
    select
      br.id::text as benchmark_run_id,
      br.suite_id::text as suite_id,
      bs.name as suite_name,
      bs.revision as suite_revision,
      br.eval_mode,
      br.workflow_variant_id::text as workflow_variant_id,
      wv.workflow_id,
      wv.workflow_source_hash,
      wv.promotion_state::text as promotion_state,
      br.status::text as status,
      br.case_count,
      br.comparison_report_artifact_id::text as comparison_report_artifact_id,
      br.analysis_report_artifact_id::text as analysis_report_artifact_id,
      br.promotion_decision_id::text as promotion_decision_id,
      wpd.state::text as promotion_decision_state,
      wpd.decision_note as promotion_decision_note,
      wpd.decided_by as promotion_decided_by,
      wpd.decided_at::text as promotion_decided_at,
      cr.row_json #>> '{recommendation,status}' as recommendation_status,
      cr.row_json #>> '{recommendation,summary}' as recommendation_summary,
      gate.result_count,
      gate.trace_missing_count,
      gate.review_or_failed_count,
      gate.missing_baseline_sanity_cases,
      gate.unexplained_component_disagreement_cases,
      gate.large_probability_miss_cases,
      gate.worse_than_baseline_cases,
      gate.holdout_case_results,
      gate.required_holdout_case_results,
      gate.unspecified_case_results,
      gate.source_leakage_cases,
      gate.information_advantage_cases,
      gate.post_cutoff_source_cases,
      gate.human_forecast_source_cases,
      gate.missing_published_at_cases,
      gate.dominant_source_domain_cases,
      gate.low_quality_source_cases,
      gate.source_entries,
      gate.used_in_final_source_entries,
      gate.source_domain_count,
      gate.top_source_domain,
      gate.top_source_domain_entries,
      gate.top_source_domain_share,
      gate.low_quality_source_entries,
      gate.low_quality_final_source_entries,
      gate.weak_trace_completeness_cases,
      gate.missing_probability_cases,
      gate.missing_score_rows_cases,
      gate.missing_aggregate_rationale_cases,
      gate.promotion_gate_status,
      gate.promotion_gate_blockers,
      nullif(ar.row_json #>> '{costLatencyFindings,caseCount}', '')::integer as cost_case_count,
      nullif(ar.row_json #>> '{costLatencyFindings,measuredCases}', '')::integer as cost_measured_cases,
      nullif(ar.row_json #>> '{costLatencyFindings,missingUsageCases}', '')::integer as cost_missing_usage_cases,
      nullif(ar.row_json #>> '{costLatencyFindings,totalAgentCalls}', '')::integer as cost_agent_calls,
      nullif(ar.row_json #>> '{costLatencyFindings,totalInputTokens}', '')::integer as cost_input_tokens,
      nullif(ar.row_json #>> '{costLatencyFindings,totalCachedInputTokens}', '')::integer as cost_cached_input_tokens,
      nullif(ar.row_json #>> '{costLatencyFindings,totalOutputTokens}', '')::integer as cost_output_tokens,
      nullif(ar.row_json #>> '{costLatencyFindings,totalReasoningOutputTokens}', '')::integer as cost_reasoning_output_tokens,
      nullif(ar.row_json #>> '{costLatencyFindings,totalTokens}', '')::integer as cost_total_tokens,
      nullif(ar.row_json #>> '{costLatencyFindings,meanAgentCallsPerMeasuredCase}', '')::double precision as cost_mean_agent_calls_per_measured_case,
      nullif(ar.row_json #>> '{costLatencyFindings,meanTokensPerMeasuredCase}', '')::double precision as cost_mean_tokens_per_measured_case,
      nullif(ar.row_json #>> '{costLatencyFindings,medianTokensPerMeasuredCase}', '')::double precision as cost_median_tokens_per_measured_case,
      nullif(ar.row_json #>> '{costLatencyFindings,meanDurationSeconds}', '')::double precision as cost_mean_duration_seconds,
      nullif(ar.row_json #>> '{costLatencyFindings,medianDurationSeconds}', '')::double precision as cost_median_duration_seconds,
      primary_baseline.row_json #>> '{baselineBenchmarkRunId}' as primary_baseline_benchmark_run_id,
      primary_baseline.row_json #>> '{baselineBenchmarkRunId}' as baseline_benchmark_run_id,
      nullif(primary_baseline.row_json #>> '{pairedCaseCount}', '')::integer as paired_case_count,
      nullif(primary_baseline.row_json #>> '{pairedMeanBrierDelta}', '')::double precision as paired_mean_brier_delta,
      nullif(primary_baseline.row_json #>> '{pairedMeanLogDelta}', '')::double precision as paired_mean_log_delta,
      nullif(primary_baseline.row_json #>> '{pairedUncertainty,brierDelta,lower}', '')::double precision as paired_brier_ci_lower,
      nullif(primary_baseline.row_json #>> '{pairedUncertainty,brierDelta,upper}', '')::double precision as paired_brier_ci_upper,
      br.created_at::text as created_at,
      br.started_at::text as started_at,
      br.completed_at::text as completed_at
    from benchmark_runs br
    left join benchmark_suites bs on bs.id = br.suite_id
    left join workflow_variants wv on wv.id = br.workflow_variant_id
    left join workflow_promotion_decisions wpd on wpd.id = br.promotion_decision_id
    left join artifact_rows cr on cr.artifact_id = br.comparison_report_artifact_id and cr.row_index = 0
    left join artifact_rows ar on ar.artifact_id = br.analysis_report_artifact_id and ar.row_index = 0
    left join lateral (
      select baseline.row_json
      from jsonb_array_elements(coalesce(cr.row_json #> '{baselines}', '[]'::jsonb)) as baseline(row_json)
      order by
        case
          when baseline.row_json #>> '{baselineBenchmarkRunId}' = coalesce(cr.row_json #>> '{recommendation,primaryBaselineBenchmarkRunId}', cr.row_json #>> '{baselines,0,baselineBenchmarkRunId}') then 0
          else 1
        end,
        baseline.row_json #>> '{baselineBenchmarkRunId}'
      limit 1
    ) primary_baseline on true
    left join lateral (
      with counts as (
        select
          count(*)::integer as result_count,
          count(*) filter (where bcr.trace_bundle_uri is null)::integer as trace_missing_count,
          count(*) filter (where bcr.status::text in ('failed', 'needs_review'))::integer as review_or_failed_count
        from benchmark_case_results bcr
        where bcr.benchmark_run_id = br.id
      ),
      findings as (
        select
          coalesce(nullif(ar.row_json #>> '{baselineSanityFindings,missingBaselineSanityCases}', '')::integer, 0) as missing_baseline_sanity_cases,
          coalesce(nullif(ar.row_json #>> '{componentDisagreementFindings,unexplainedHighDisagreementCases}', '')::integer, 0) as unexplained_component_disagreement_cases,
          coalesce(nullif(ar.row_json #>> '{forecastErrorFindings,largeProbabilityMissCases}', '')::integer, 0) as large_probability_miss_cases,
          coalesce(nullif(ar.row_json #>> '{forecastErrorFindings,worseThanBaselineCases}', '')::integer, 0) as worse_than_baseline_cases,
          coalesce(nullif(ar.row_json #>> '{splitFindings,holdoutCaseResults}', '')::integer, 0) as holdout_case_results,
          coalesce(nullif(ar.row_json #>> '{splitFindings,requiredHoldoutCaseResults}', '')::integer, ${minimumPromotionHoldoutCases}) as required_holdout_case_results,
          coalesce(nullif(ar.row_json #>> '{splitFindings,unspecifiedCaseResults}', '')::integer, 0) as unspecified_case_results,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,sourceLeakageCases}', '')::integer, 0) as source_leakage_cases,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,informationAdvantageCases}', '')::integer, 0) as information_advantage_cases,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,postCutoffSourceCases}', '')::integer, 0) as post_cutoff_source_cases,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,humanForecastSourceCases}', '')::integer, 0) as human_forecast_source_cases,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,missingPublishedAtCases}', '')::integer, 0) as missing_published_at_cases,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,dominantSourceDomainCases}', '')::integer, 0) as dominant_source_domain_cases,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,lowQualitySourceCases}', '')::integer, 0) as low_quality_source_cases,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,sourceEntries}', '')::integer, 0) as source_entries,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,usedInFinalSourceEntries}', '')::integer, 0) as used_in_final_source_entries,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,sourceDomainCount}', '')::integer, 0) as source_domain_count,
          ar.row_json #>> '{sourceQualityFindings,topSourceDomain}' as top_source_domain,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,topSourceDomainEntries}', '')::integer, 0) as top_source_domain_entries,
          nullif(ar.row_json #>> '{sourceQualityFindings,topSourceDomainShare}', '')::double precision as top_source_domain_share,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,lowQualitySourceEntries}', '')::integer, 0) as low_quality_source_entries,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,lowQualityFinalSourceEntries}', '')::integer, 0) as low_quality_final_source_entries,
          coalesce(nullif(ar.row_json #>> '{traceQualityFindings,weakTraceCompletenessCases}', '')::integer, 0) as weak_trace_completeness_cases,
          coalesce(nullif(ar.row_json #>> '{traceQualityFindings,missingProbabilityCases}', '')::integer, 0) as missing_probability_cases,
          coalesce(nullif(ar.row_json #>> '{traceQualityFindings,missingScoreRowsCases}', '')::integer, 0) as missing_score_rows_cases,
          coalesce(nullif(ar.row_json #>> '{traceQualityFindings,missingAggregateRationaleCases}', '')::integer, 0) as missing_aggregate_rationale_cases
      ),
      blockers as (
        select
          counts.*,
          findings.*,
          array_remove(array[
            case when br.status::text in ('running', 'queued') then ${blockerBenchmarkStillRunning} end,
            case when counts.result_count < ${minimumPromotionResultCases} then ${blockerTooFewCasesForPromotion} end,
            case when counts.trace_missing_count > 0 then ${blockerMissingTraceBundles} end,
            case when counts.review_or_failed_count > 0 then ${blockerFailedOrReviewCasesPresent} end,
            case when cr.row_json #>> '{recommendation,status}' is null then ${blockerMissingComparisonReport} end,
            case when cr.row_json #>> '{recommendation,status}' is not null and cr.row_json #>> '{recommendation,status}' <> 'candidate_better' then 'comparison_' || (cr.row_json #>> '{recommendation,status}') end,
            case when findings.missing_baseline_sanity_cases > 0 then ${blockerMissingBaselineSanity} end,
            case when findings.unexplained_component_disagreement_cases > 0 then ${blockerUnexplainedComponentDisagreement} end,
            case when findings.large_probability_miss_cases > 0 then ${blockerLargeProbabilityMisses} end,
            case when findings.worse_than_baseline_cases > 0 then ${blockerWorseThanBaselineCases} end,
            case when findings.holdout_case_results < findings.required_holdout_case_results then ${blockerInsufficientHoldoutEvidence} end,
            case when findings.source_leakage_cases > 0 or findings.post_cutoff_source_cases > 0 then ${blockerSourceCutoffLeakage} end,
            case when findings.information_advantage_cases > 0 or findings.human_forecast_source_cases > 0 then ${blockerHumanForecastLeakage} end,
            case when findings.dominant_source_domain_cases > 0 then ${blockerSourceConcentration} end,
            case when findings.low_quality_final_source_entries > 0 or findings.low_quality_source_cases > 0 then ${blockerLowQualitySources} end,
            case when findings.weak_trace_completeness_cases > 0 then ${blockerWeakTraceCompleteness} end,
            case when findings.missing_probability_cases > 0 or findings.missing_score_rows_cases > 0 then ${blockerSchemaOrScoringFailures} end,
            case when findings.missing_aggregate_rationale_cases > 0 then ${blockerMissingAggregateRationale} end
          ]::text[], null) as blocker_values
        from counts, findings
      )
      select
        result_count,
        trace_missing_count,
        review_or_failed_count,
        missing_baseline_sanity_cases,
        unexplained_component_disagreement_cases,
        large_probability_miss_cases,
        worse_than_baseline_cases,
        holdout_case_results,
        required_holdout_case_results,
        unspecified_case_results,
        source_leakage_cases,
        information_advantage_cases,
        post_cutoff_source_cases,
        human_forecast_source_cases,
        missing_published_at_cases,
        dominant_source_domain_cases,
        low_quality_source_cases,
        source_entries,
        used_in_final_source_entries,
        source_domain_count,
        top_source_domain,
        top_source_domain_entries,
        top_source_domain_share,
        low_quality_source_entries,
        low_quality_final_source_entries,
        weak_trace_completeness_cases,
        missing_probability_cases,
        missing_score_rows_cases,
        missing_aggregate_rationale_cases,
        case when cardinality(blocker_values) = 0 then ${benchmarkPromotionGateStatusReview} else ${benchmarkPromotionGateStatusNeedsMoreEvidence} end as promotion_gate_status,
        array_to_string(blocker_values, ',') as promotion_gate_blockers
      from blockers
    ) gate on true
    order by br.created_at
  `;
  await replaceTable(duck, "osf_benchmark_runs", benchmarkRunColumns, benchmarkRuns);

  const benchmarkCostStatus = await pg<BenchmarkCostStatusMartRow[]>`
    select
      br.id::text as benchmark_run_id,
      br.suite_id::text as suite_id,
      bs.name as suite_name,
      br.eval_mode,
      br.workflow_variant_id::text as workflow_variant_id,
      wv.workflow_id,
      br.status::text as run_status,
      cost_status.value #>> '{status}' as case_status,
      nullif(cost_status.value #>> '{cases}', '')::integer as cases,
      nullif(cost_status.value #>> '{measuredCases}', '')::integer as measured_cases,
      nullif(cost_status.value #>> '{agentCalls}', '')::integer as agent_calls,
      nullif(cost_status.value #>> '{totalTokens}', '')::integer as total_tokens,
      nullif(cost_status.value #>> '{meanTokensPerMeasuredCase}', '')::double precision as mean_tokens_per_measured_case,
      nullif(cost_status.value #>> '{meanDurationSeconds}', '')::double precision as mean_duration_seconds,
      br.created_at::text as created_at
    from benchmark_runs br
    left join benchmark_suites bs on bs.id = br.suite_id
    left join workflow_variants wv on wv.id = br.workflow_variant_id
    join artifact_rows ar on ar.artifact_id = br.analysis_report_artifact_id and ar.row_index = 0
    cross join lateral jsonb_array_elements(coalesce(ar.row_json #> '{costLatencyFindings,byStatus}', '[]'::jsonb)) as cost_status(value)
    order by br.created_at, case_status
  `;
  await replaceTable(duck, "osf_benchmark_cost_status", benchmarkCostStatusColumns, benchmarkCostStatus);

  const benchmarkCostOutliers = await pg<BenchmarkCostOutlierMartRow[]>`
    select
      br.id::text as benchmark_run_id,
      br.suite_id::text as suite_id,
      bs.name as suite_name,
      br.eval_mode,
      br.workflow_variant_id::text as workflow_variant_id,
      wv.workflow_id,
      br.status::text as run_status,
      outlier.outlier_kind,
      outlier.outlier_rank,
      outlier.row_json #>> '{benchmarkCaseResultId}' as benchmark_case_result_id,
      outlier.row_json #>> '{benchmarkCaseId}' as benchmark_case_id,
      outlier.row_json #>> '{taskId}' as task_id,
      outlier.row_json #>> '{smithersRunId}' as smithers_run_id,
      outlier.row_json #>> '{status}' as case_status,
      nullif(outlier.row_json #>> '{agentCalls}', '')::integer as agent_calls,
      nullif(outlier.row_json #>> '{totalTokens}', '')::integer as total_tokens,
      nullif(outlier.row_json #>> '{durationSeconds}', '')::double precision as duration_seconds,
      br.created_at::text as created_at
    from benchmark_runs br
    left join benchmark_suites bs on bs.id = br.suite_id
    left join workflow_variants wv on wv.id = br.workflow_variant_id
    join artifact_rows ar on ar.artifact_id = br.analysis_report_artifact_id and ar.row_index = 0
    cross join lateral (
      select
        'heaviest'::text as outlier_kind,
        heavy.ordinality::integer as outlier_rank,
        heavy.row_json
      from jsonb_array_elements(coalesce(ar.row_json #> '{costLatencyFindings,heaviestCases}', '[]'::jsonb)) with ordinality as heavy(row_json, ordinality)
      union all
      select
        'slowest'::text as outlier_kind,
        slow.ordinality::integer as outlier_rank,
        slow.row_json
      from jsonb_array_elements(coalesce(ar.row_json #> '{costLatencyFindings,slowestCases}', '[]'::jsonb)) with ordinality as slow(row_json, ordinality)
    ) outlier
    order by br.created_at, outlier.outlier_kind, outlier.outlier_rank
  `;
  await replaceTable(duck, "osf_benchmark_cost_outliers", benchmarkCostOutlierColumns, benchmarkCostOutliers);

  const benchmarkCases = await pg<BenchmarkCaseMartRow[]>`
    select
      bcr.id::text as benchmark_case_result_id,
      bcr.benchmark_run_id::text as benchmark_run_id,
      bcr.benchmark_case_id::text as benchmark_case_id,
      bc.external_id as benchmark_external_id,
      bcr.task_id::text as task_id,
      bcr.smithers_run_id,
      bcr.workflow_variant_id::text as workflow_variant_id,
      bcr.status::text as status,
      (
        select nullif(coalesce(score->>'scoreValue', score->>'score_value'), '')::double precision
        from jsonb_array_elements(bcr.score_rows) score
        where coalesce(score->>'scoreType', score->>'score_type') = 'brier'
        limit 1
      ) as brier,
      (
        select nullif(coalesce(score->>'scoreValue', score->>'score_value'), '')::double precision
        from jsonb_array_elements(bcr.score_rows) score
        where coalesce(score->>'scoreType', score->>'score_type') = 'log'
        limit 1
      ) as log_score,
      (
        select nullif(coalesce(score->>'scoreValue', score->>'score_value'), '')::double precision
        from jsonb_array_elements(bcr.score_rows) score
        where coalesce(score->>'scoreType', score->>'score_type') = 'baseline_brier'
        limit 1
      ) as baseline_brier,
      (
        select nullif(coalesce(score->>'scoreValue', score->>'score_value'), '')::double precision
        from jsonb_array_elements(bcr.score_rows) score
        where coalesce(score->>'scoreType', score->>'score_type') = 'baseline_delta_brier'
        limit 1
      ) as baseline_delta_brier,
      bcr.trace_bundle_uri,
      bcr.source_bundle_uri,
      bcr.leakage_flags::text as leakage_flags_json,
      bcr.failure_labels::text as failure_labels_json,
      bcr.score_rows::text as score_rows_json,
      bcr.created_at::text as created_at,
      bcr.updated_at::text as updated_at
    from benchmark_case_results bcr
    left join benchmark_cases bc on bc.id = bcr.benchmark_case_id
    order by bcr.created_at
  `;
  await replaceTable(duck, "osf_benchmark_case_results", benchmarkCaseColumns, benchmarkCases);

  const forecastScores = await pg<ForecastScoreMartRow[]>`
    select
      fs.id::text as forecast_score_id,
      fs.forecast_aggregate_id::text as forecast_aggregate_id,
      fs.forecast_attempt_id::text as forecast_attempt_id,
      fs.resolution_id::text as resolution_id,
      fs.score_config #>> '{taskId}' as task_id,
      coalesce(fs.score_config #>> '{forecastType}', fa.forecast_type::text, fat.forecast_type::text) as forecast_type,
      fs.score_config #>> '{target}' as target,
      fs.score_config #>> '{source}' as source,
      fs.score_type,
      fs.score_value,
      nullif(coalesce(fs.score_config #>> '{probability}', fs.score_config #>> '{probability_pct}', fs.score_config #>> '{probabilityPct}'), '')::double precision as probability,
      fs.score_config #>> '{binaryConfidence,confidenceBand}' as binary_confidence_band,
      fs.score_config #>> '{binaryConfidence,forecastSide}' as binary_forecast_side,
      nullif(fs.score_config #>> '{binaryConfidence,distanceFromEven}', '')::double precision as binary_distance_from_even,
      nullif(fs.score_config #>> '{resolved}', '')::boolean as resolved,
      nullif(fs.score_config #>> '{calibrationGuard,adjustment}', '')::double precision as calibration_guard_adjustment,
      (fs.score_config #> '{calibrationGuard,appliedRules}')::text as calibration_guard_rules_json,
      fs.score_config #>> '{baselineSanity,status}' as baseline_sanity_status,
      nullif(fs.score_config #>> '{baselineSanity,baselineProbability}', '')::double precision as baseline_probability,
      nullif(fs.score_config #>> '{baselineSanity,baselineDelta}', '')::double precision as baseline_delta,
      nullif(fs.score_config #>> '{baselineSanity,componentBaseRateCount}', '')::integer as component_base_rate_count,
      nullif(fs.score_config #>> '{baselineSanity,componentBaseRateDisagreement}', '')::double precision as component_base_rate_disagreement,
      fs.score_config #>> '{marketAnchor,status}' as market_anchor_status,
      nullif(fs.score_config #>> '{marketAnchor,marketPrice}', '')::double precision as market_anchor_price,
      nullif(fs.score_config #>> '{marketAnchor,finalProbability}', '')::double precision as market_anchor_final_probability,
      nullif(fs.score_config #>> '{marketAnchor,marketDelta}', '')::double precision as market_anchor_delta,
      fs.score_config #>> '{marketAnchor,marketPlatform}' as market_anchor_platform,
      fs.score_config #>> '{marketAnchor,marketPriceAsOf}' as market_anchor_price_as_of,
      fs.score_config #>> '{resolutionBoundary,status}' as resolution_boundary_status,
      nullif(fs.score_config #>> '{resolutionBoundary,componentBoundaryCount}', '')::integer as resolution_boundary_component_count,
      nullif(fs.score_config #>> '{resolutionBoundary,ambiguityFlagCount}', '')::integer as resolution_boundary_ambiguity_flag_count,
      nullif(fs.score_config #>> '{resolutionBoundary,qualityIssueCount}', '')::integer as resolution_boundary_quality_issue_count,
      nullif(fs.score_config #>> '{resolutionBoundary,plannerRiskCount}', '')::integer as resolution_boundary_planner_risk_count,
      fs.score_config #>> '{uncertaintyRange,status}' as uncertainty_range_status,
      nullif(fs.score_config #>> '{uncertaintyRange,componentRangeCount}', '')::integer as uncertainty_range_component_count,
      nullif(fs.score_config #>> '{uncertaintyRange,medianRangeWidth}', '')::double precision as uncertainty_range_median_width,
      nullif(fs.score_config #>> '{uncertaintyRange,meanRangeWidth}', '')::double precision as uncertainty_range_mean_width,
      nullif(fs.score_config #>> '{uncertaintyRange,widestRangeWidth}', '')::double precision as uncertainty_range_widest_width,
      nullif(fs.score_config #>> '{uncertaintyRange,narrowRangeCount}', '')::integer as uncertainty_range_narrow_count,
      fs.score_config #>> '{componentWeighting,status}' as component_weighting_status,
      nullif(fs.score_config #>> '{componentWeighting,auditedComponentCount}', '')::integer as component_weighting_audited_count,
      nullif(fs.score_config #>> '{componentWeighting,downweightCount}', '')::integer as component_weighting_downweight_count,
      nullif(fs.score_config #>> '{componentWeighting,upweightCount}', '')::integer as component_weighting_upweight_count,
      nullif(fs.score_config #>> '{componentWeighting,normalWeightCount}', '')::integer as component_weighting_normal_count,
      nullif(fs.score_config #>> '{componentWeighting,calibrationRiskCount}', '')::integer as component_weighting_calibration_risk_count,
      fs.score_config #>> '{aggregateQuality,convergenceStatus}' as aggregate_convergence_status,
      nullif(fs.score_config #>> '{aggregateQuality,qualityApproved}', '')::boolean as aggregate_quality_approved,
      nullif(fs.score_config #>> '{aggregateQuality,maxIterationsReached}', '')::boolean as aggregate_max_iterations_reached,
      nullif(fs.score_config #>> '{aggregateQuality,roundsUsed}', '')::integer as aggregate_rounds_used,
      case
        when nullif(fs.score_config #>> '{aggregateQuality,roundsUsed}', '')::integer >= 4 then 'many_rounds'
        when nullif(fs.score_config #>> '{aggregateQuality,roundsUsed}', '')::integer >= 2 then 'few_rounds'
        when nullif(fs.score_config #>> '{aggregateQuality,roundsUsed}', '')::integer >= 0 then 'single_round'
        else 'unknown'
      end as aggregate_rounds_used_band,
      nullif(fs.score_config #>> '{aggregateQuality,forecasterCount}', '')::integer as aggregate_forecaster_count,
      nullif(fs.score_config #>> '{aggregateQuality,complexityScore}', '')::integer as aggregate_complexity_score,
      fs.score_config #>> '{aggregateQuality,researchDepth}' as aggregate_research_depth,
      nullif(fs.score_config #>> '{aggregateQuality,qualityIssueCount}', '')::integer as aggregate_quality_issue_count,
      case
        when nullif(fs.score_config #>> '{aggregateQuality,qualityIssueCount}', '')::integer >= 3 then 'many_issues'
        when nullif(fs.score_config #>> '{aggregateQuality,qualityIssueCount}', '')::integer >= 1 then 'some_issues'
        when nullif(fs.score_config #>> '{aggregateQuality,qualityIssueCount}', '')::integer >= 0 then 'none'
        else 'unknown'
      end as aggregate_quality_issue_count_band,
      (fs.score_config #> '{aggregateQuality,roleIds}')::text as aggregate_role_ids_json,
      nullif(fs.score_config #>> '{aggregateStats,meanProbability}', '')::double precision as aggregate_mean_probability,
      nullif(fs.score_config #>> '{aggregateStats,medianProbability}', '')::double precision as aggregate_median_probability,
      nullif(fs.score_config #>> '{aggregateStats,componentMinProbability}', '')::double precision as aggregate_component_min_probability,
      nullif(fs.score_config #>> '{aggregateStats,componentMaxProbability}', '')::double precision as aggregate_component_max_probability,
      fs.score_config #>> '{aggregateStats,finalComponentPositionBand}' as aggregate_final_component_position_band,
      case
        when nullif(fs.score_config #>> '{probability}', '')::double precision is null
          or nullif(fs.score_config #>> '{aggregateStats,meanProbability}', '')::double precision is null then 'missing_components'
        when nullif(fs.score_config #>> '{aggregateStats,meanProbability}', '')::double precision >= 47
          and nullif(fs.score_config #>> '{aggregateStats,meanProbability}', '')::double precision <= 53 then 'mean_near_even'
        when nullif(fs.score_config #>> '{probability}', '')::double precision >= 47
          and nullif(fs.score_config #>> '{probability}', '')::double precision <= 53 then 'final_near_even'
        when nullif(fs.score_config #>> '{probability}', '')::double precision > 53
          and nullif(fs.score_config #>> '{aggregateStats,meanProbability}', '')::double precision > 53 then 'same_yes'
        when nullif(fs.score_config #>> '{probability}', '')::double precision < 47
          and nullif(fs.score_config #>> '{aggregateStats,meanProbability}', '')::double precision < 47 then 'same_no'
        when nullif(fs.score_config #>> '{probability}', '')::double precision > 53
          and nullif(fs.score_config #>> '{aggregateStats,meanProbability}', '')::double precision < 47 then 'final_flips_to_yes'
        when nullif(fs.score_config #>> '{probability}', '')::double precision < 47
          and nullif(fs.score_config #>> '{aggregateStats,meanProbability}', '')::double precision > 53 then 'final_flips_to_no'
        else 'unknown'
      end as aggregate_side_agreement,
      nullif(fs.score_config #>> '{aggregateStats,meanConfidenceDistance}', '')::double precision as aggregate_mean_confidence_distance,
      coalesce(
        fs.score_config #>> '{aggregateStats,meanConfidenceDistanceBand}',
        case
          when coalesce(
            nullif(fs.score_config #>> '{aggregateStats,meanConfidenceDistance}', '')::double precision,
            abs(nullif(fs.score_config #>> '{aggregateStats,meanProbability}', '')::double precision - 50)
          ) >= 40 then 'extreme'
          when coalesce(
            nullif(fs.score_config #>> '{aggregateStats,meanConfidenceDistance}', '')::double precision,
            abs(nullif(fs.score_config #>> '{aggregateStats,meanProbability}', '')::double precision - 50)
          ) >= 25 then 'very_likely'
          when coalesce(
            nullif(fs.score_config #>> '{aggregateStats,meanConfidenceDistance}', '')::double precision,
            abs(nullif(fs.score_config #>> '{aggregateStats,meanProbability}', '')::double precision - 50)
          ) >= 10 then 'likely'
          when coalesce(
            nullif(fs.score_config #>> '{aggregateStats,meanConfidenceDistance}', '')::double precision,
            abs(nullif(fs.score_config #>> '{aggregateStats,meanProbability}', '')::double precision - 50)
          ) >= 0 then 'near_even'
          else 'unknown'
        end
      ) as aggregate_mean_confidence_distance_band,
      nullif(fs.score_config #>> '{aggregateStats,finalConfidenceShift}', '')::double precision as aggregate_final_confidence_shift,
      fs.score_config #>> '{aggregateStats,finalConfidenceShiftBand}' as aggregate_final_confidence_shift_band,
      nullif(fs.score_config #>> '{aggregateStats,meanBaseRateProbability}', '')::double precision as aggregate_mean_base_rate_probability,
      nullif(fs.score_config #>> '{aggregateStats,meanInsideViewProbability}', '')::double precision as aggregate_mean_inside_view_probability,
      nullif(fs.score_config #>> '{aggregateStats,insideViewDelta}', '')::double precision as aggregate_inside_view_delta,
      fs.score_config #>> '{aggregateStats,insideViewDeltaBand}' as aggregate_inside_view_delta_band,
      nullif(fs.score_config #>> '{aggregateStats,finalInsideViewDelta}', '')::double precision as aggregate_final_inside_view_delta,
      fs.score_config #>> '{aggregateStats,finalInsideViewDeltaBand}' as aggregate_final_inside_view_delta_band,
      fs.score_config #>> '{aggregateStats,finalAdjustmentDirection}' as aggregate_final_adjustment_direction,
      nullif(fs.score_config #>> '{aggregateStats,disagreement}', '')::double precision as aggregate_component_disagreement,
      fs.score_config #>> '{aggregateStats,disagreementBand}' as aggregate_component_disagreement_band,
      fs.score_config #>> '{aggregateStats,aggregationAnchor}' as aggregation_anchor,
      nullif(fs.score_config #>> '{aggregateStats,adjustmentFromMedian}', '')::double precision as adjustment_from_median,
      fs.score_config #>> '{aggregateStats,adjustmentFromMedianBand}' as adjustment_from_median_band,
      nullif(fs.score_config #>> '{aggregateStats,attemptCount}', '')::integer as aggregate_attempt_count,
      coalesce(
        fs.score_config #>> '{aggregateStats,attemptCountBand}',
        case
          when nullif(fs.score_config #>> '{aggregateStats,attemptCount}', '')::integer >= 5 then 'many_attempts'
          when nullif(fs.score_config #>> '{aggregateStats,attemptCount}', '')::integer >= 2 then 'few_attempts'
          when nullif(fs.score_config #>> '{aggregateStats,attemptCount}', '')::integer >= 0 then 'single_attempt'
          else 'unknown'
        end
      ) as aggregate_attempt_count_band,
      fs.score_config #>> '{branch}' as conditional_branch,
      nullif(fs.score_config #>> '{conditionResolved}', '')::boolean as condition_resolved,
      nullif(fs.score_config #>> '{outcomeResolved}', '')::boolean as outcome_resolved,
      nullif(fs.score_config #>> '{conditionalForecast,conditionProbability}', '')::double precision as condition_probability,
      nullif(fs.score_config #>> '{conditionalForecast,probabilityGivenCondition}', '')::double precision as probability_given_condition,
      nullif(fs.score_config #>> '{conditionalForecast,probabilityGivenNotCondition}', '')::double precision as probability_given_not_condition,
      nullif(fs.score_config #>> '{conditionalForecast,probabilityDelta}', '')::double precision as conditional_probability_delta,
      fs.score_config #>> '{conditionalForecast,effectBand}' as conditional_effect_band,
      nullif(fs.score_config #>> '{conditionalForecast,resolvedBranchProbability}', '')::double precision as conditional_resolved_branch_probability,
      fs.score_config #>> '{conditionalForecast,resolvedBranchProbabilityBand}' as conditional_resolved_branch_probability_band,
      fs.score_config #>> '{conditionalForecast,resolvedBranchPlacement}' as conditional_resolved_branch_placement,
      nullif(fs.score_config #>> '{conditionalForecast,attemptCount}', '')::integer as conditional_attempt_count,
      case
        when nullif(fs.score_config #>> '{conditionalForecast,attemptCount}', '')::integer >= 5 then 'many_attempts'
        when nullif(fs.score_config #>> '{conditionalForecast,attemptCount}', '')::integer >= 2 then 'few_attempts'
        when nullif(fs.score_config #>> '{conditionalForecast,attemptCount}', '')::integer >= 0 then 'single_attempt'
        else 'unknown'
      end as conditional_attempt_count_band,
      nullif(fs.score_config #>> '{conditionalForecast,componentBranchCount}', '')::integer as conditional_component_branch_count,
      nullif(fs.score_config #>> '{conditionalForecast,givenConditionDisagreement}', '')::double precision as conditional_given_condition_disagreement,
      nullif(fs.score_config #>> '{conditionalForecast,givenNotConditionDisagreement}', '')::double precision as conditional_given_not_condition_disagreement,
      nullif(fs.score_config #>> '{conditionalForecast,effectDisagreement}', '')::double precision as conditional_effect_disagreement,
      fs.score_config #>> '{conditionalForecast,branchDisagreementBand}' as conditional_branch_disagreement_band,
      fs.score_config #>> '{conditionalForecast,effectDirectionAgreement}' as conditional_effect_direction_agreement,
      fs.score_config #>> '{thresholdedForecast,thresholdDirection}' as threshold_direction,
      fs.score_config #>> '{thresholdedForecast,thresholdSource}' as threshold_source,
      nullif(fs.score_config #>> '{thresholdedForecast,thresholdCount}', '')::integer as threshold_count,
      nullif(fs.score_config #>> '{thresholdedForecast,monotonicityRepaired}', '')::boolean as monotonicity_repaired,
      nullif(fs.score_config #>> '{thresholdedForecast,probabilitySpread}', '')::double precision as threshold_probability_spread,
      fs.score_config #>> '{thresholdedForecast,probabilitySpreadBand}' as threshold_probability_spread_band,
      nullif(fs.score_config #>> '{thresholdedForecast,actualValue}', '')::double precision as threshold_actual_value,
      nullif(fs.score_config #>> '{thresholdedForecast,nearestThresholdDistance}', '')::double precision as threshold_nearest_distance,
      fs.score_config #>> '{thresholdedForecast,resolvedThresholdBand}' as threshold_resolved_band,
      nullif(fs.score_config #>> '{thresholdedForecast,attemptCount}', '')::integer as thresholded_attempt_count,
      case
        when nullif(fs.score_config #>> '{thresholdedForecast,attemptCount}', '')::integer >= 5 then 'many_attempts'
        when nullif(fs.score_config #>> '{thresholdedForecast,attemptCount}', '')::integer >= 2 then 'few_attempts'
        when nullif(fs.score_config #>> '{thresholdedForecast,attemptCount}', '')::integer >= 0 then 'single_attempt'
        else 'unknown'
      end as thresholded_attempt_count_band,
      nullif(fs.score_config #>> '{thresholdedForecast,componentCurveCount}', '')::integer as thresholded_component_curve_count,
      nullif(fs.score_config #>> '{thresholdedForecast,componentProbabilityDisagreement}', '')::double precision as thresholded_component_probability_disagreement,
      fs.score_config #>> '{thresholdedForecast,componentDisagreementBand}' as thresholded_component_disagreement_band,
      fs.score_config #>> '{numericForecast,unit}' as numeric_unit,
      nullif(fs.score_config #>> '{numericForecast,p10}', '')::double precision as numeric_p10,
      nullif(fs.score_config #>> '{numericForecast,p50}', '')::double precision as numeric_p50,
      nullif(fs.score_config #>> '{numericForecast,p90}', '')::double precision as numeric_p90,
      nullif(fs.score_config #>> '{numericForecast,intervalWidth}', '')::double precision as numeric_interval_width,
      fs.score_config #>> '{numericForecast,intervalWidthBand}' as numeric_interval_width_band,
      nullif(fs.score_config #>> '{numericForecast,actualValue}', '')::double precision as numeric_actual_value,
      nullif(fs.score_config #>> '{numericForecast,p50Error}', '')::double precision as numeric_p50_error,
      nullif(fs.score_config #>> '{numericForecast,absoluteP50Error}', '')::double precision as numeric_absolute_p50_error,
      fs.score_config #>> '{numericForecast,p50ErrorBand}' as numeric_p50_error_band,
      fs.score_config #>> '{numericForecast,resolvedPositionBand}' as numeric_resolved_position_band,
      nullif(fs.score_config #>> '{numericForecast,attemptCount}', '')::integer as numeric_attempt_count,
      case
        when nullif(fs.score_config #>> '{numericForecast,attemptCount}', '')::integer >= 5 then 'many_attempts'
        when nullif(fs.score_config #>> '{numericForecast,attemptCount}', '')::integer >= 2 then 'few_attempts'
        when nullif(fs.score_config #>> '{numericForecast,attemptCount}', '')::integer >= 0 then 'single_attempt'
        else 'unknown'
      end as numeric_attempt_count_band,
      nullif(fs.score_config #>> '{numericForecast,componentValueCount}', '')::integer as numeric_component_value_count,
      nullif(fs.score_config #>> '{numericForecast,p50Disagreement}', '')::double precision as numeric_p50_disagreement,
      fs.score_config #>> '{numericForecast,p50DisagreementBand}' as numeric_p50_disagreement_band,
      nullif(fs.score_config #>> '{numericForecast,unitDisagreementCount}', '')::integer as numeric_unit_disagreement_count,
      fs.score_config #>> '{dateForecast,p10}' as date_p10,
      fs.score_config #>> '{dateForecast,p50}' as date_p50,
      fs.score_config #>> '{dateForecast,p90}' as date_p90,
      nullif(fs.score_config #>> '{dateForecast,intervalDays}', '')::integer as date_interval_days,
      fs.score_config #>> '{dateForecast,intervalBand}' as date_interval_band,
      fs.score_config #>> '{dateForecast,actualDate}' as date_actual_date,
      nullif(fs.score_config #>> '{dateForecast,p50ErrorDays}', '')::integer as date_p50_error_days,
      nullif(fs.score_config #>> '{dateForecast,absoluteP50ErrorDays}', '')::integer as date_absolute_p50_error_days,
      fs.score_config #>> '{dateForecast,p50ErrorBand}' as date_p50_error_band,
      fs.score_config #>> '{dateForecast,resolvedPositionBand}' as date_resolved_position_band,
      nullif(fs.score_config #>> '{dateForecast,neverProbability}', '')::double precision as date_never_probability,
      fs.score_config #>> '{dateForecast,neverProbabilityBand}' as date_never_probability_band,
      nullif(fs.score_config #>> '{dateForecast,attemptCount}', '')::integer as date_attempt_count,
      case
        when nullif(fs.score_config #>> '{dateForecast,attemptCount}', '')::integer >= 5 then 'many_attempts'
        when nullif(fs.score_config #>> '{dateForecast,attemptCount}', '')::integer >= 2 then 'few_attempts'
        when nullif(fs.score_config #>> '{dateForecast,attemptCount}', '')::integer >= 0 then 'single_attempt'
        else 'unknown'
      end as date_attempt_count_band,
      nullif(fs.score_config #>> '{dateForecast,componentDateCount}', '')::integer as date_component_date_count,
      nullif(fs.score_config #>> '{dateForecast,p50DisagreementDays}', '')::integer as date_p50_disagreement_days,
      fs.score_config #>> '{dateForecast,p50DisagreementBand}' as date_p50_disagreement_band,
      nullif(fs.score_config #>> '{dateForecast,neverProbabilityDisagreement}', '')::double precision as date_never_probability_disagreement,
      fs.score_config #>> '{categoricalForecast,topCategory}' as categorical_top_category,
      nullif(fs.score_config #>> '{categoricalForecast,topProbability}', '')::double precision as categorical_top_probability,
      fs.score_config #>> '{categoricalForecast,topProbabilityBand}' as categorical_top_probability_band,
      nullif(fs.score_config #>> '{categoricalForecast,categoryCount}', '')::integer as categorical_category_count,
      fs.score_config #>> '{categoricalForecast,categorySource}' as categorical_category_source,
      nullif(fs.score_config #>> '{categoricalForecast,categoriesExhaustive}', '')::boolean as categorical_categories_exhaustive,
      fs.score_config #>> '{categoricalForecast,categoryCoverageBand}' as categorical_category_coverage_band,
      nullif(fs.score_config #>> '{categoricalForecast,entropy}', '')::double precision as categorical_entropy,
      fs.score_config #>> '{categoricalForecast,entropyBand}' as categorical_entropy_band,
      nullif(fs.score_config #>> '{categoricalForecast,attemptCount}', '')::integer as categorical_attempt_count,
      case
        when nullif(fs.score_config #>> '{categoricalForecast,attemptCount}', '')::integer >= 5 then 'many_attempts'
        when nullif(fs.score_config #>> '{categoricalForecast,attemptCount}', '')::integer >= 2 then 'few_attempts'
        when nullif(fs.score_config #>> '{categoricalForecast,attemptCount}', '')::integer >= 0 then 'single_attempt'
        else 'unknown'
      end as categorical_attempt_count_band,
      nullif(fs.score_config #>> '{categoricalForecast,componentCategoryCount}', '')::integer as categorical_component_category_count,
      nullif(fs.score_config #>> '{categoricalForecast,uniqueTopCategoryCount}', '')::integer as categorical_unique_top_category_count,
      nullif(fs.score_config #>> '{categoricalForecast,topCategoryVoteShare}', '')::double precision as categorical_top_category_vote_share,
      fs.score_config #>> '{categoricalForecast,topCategoryAgreementBand}' as categorical_top_category_agreement_band,
      nullif(fs.score_config #>> '{categoricalForecast,topCategoryProbabilitySpread}', '')::double precision as categorical_top_category_probability_spread,
      fs.score_config #>> '{categoricalForecast,actualCategory}' as categorical_actual_category,
      nullif(fs.score_config #>> '{categoricalForecast,actualProbability}', '')::double precision as categorical_actual_probability,
      fs.score_config #>> '{categoricalForecast,actualProbabilityBand}' as categorical_actual_probability_band,
      fs.score_config #>> '{categoricalForecast,resolvedCategoryBand}' as categorical_resolved_category_band,
      nullif(fs.score_config #>> '{evidenceCoverage,sourceCount}', '')::integer as evidence_source_count,
      fs.score_config #>> '{evidenceCoverage,sourceCountBand}' as evidence_source_count_band,
      nullif(fs.score_config #>> '{evidenceCoverage,sourceDomainCount}', '')::integer as evidence_source_domain_count,
      fs.score_config #>> '{evidenceCoverage,sourceDiversityBand}' as evidence_source_diversity_band,
      nullif(fs.score_config #>> '{evidenceCoverage,topSourceDomainCount}', '')::integer as evidence_top_source_domain_count,
      nullif(fs.score_config #>> '{evidenceCoverage,topSourceDomainShare}', '')::double precision as evidence_top_source_domain_share,
      fs.score_config #>> '{evidenceCoverage,sourceConcentrationBand}' as evidence_source_concentration_band,
      nullif(fs.score_config #>> '{evidenceCoverage,datedSourceCount}', '')::integer as evidence_dated_source_count,
      nullif(fs.score_config #>> '{evidenceCoverage,undatedSourceCount}', '')::integer as evidence_undated_source_count,
      fs.score_config #>> '{evidenceCoverage,sourceDateCoverageBand}' as evidence_source_date_coverage_band,
      fs.score_config #>> '{evidenceCoverage,newestPublishedAt}' as evidence_newest_published_at,
      fs.score_config #>> '{evidenceCoverage,oldestPublishedAt}' as evidence_oldest_published_at,
      fs.score_config #>> '{evidenceCoverage,evidenceAsOfDate}' as evidence_as_of_date,
      nullif(fs.score_config #>> '{evidenceCoverage,postAsOfSourceCount}', '')::integer as evidence_post_as_of_source_count,
      fs.score_config #>> '{evidenceCoverage,sourceTimingBand}' as evidence_source_timing_band,
      nullif(fs.score_config #>> '{evidenceCoverage,newestSourceAgeDays}', '')::integer as evidence_newest_source_age_days,
      fs.score_config #>> '{evidenceCoverage,sourceFreshnessBand}' as evidence_source_freshness_band,
      nullif(fs.score_config #>> '{evidenceCoverage,uncertaintyCount}', '')::integer as evidence_uncertainty_count,
      fs.score_config #>> '{evidenceCoverage,uncertaintyCountBand}' as evidence_uncertainty_count_band,
      nullif(fs.score_config #>> '{evidenceCoverage,rationaleLength}', '')::integer as evidence_rationale_length,
      fs.score_config #>> '{evidenceCoverage,rationaleLengthBand}' as evidence_rationale_length_band,
      fs.score_config #>> '{evidenceCoverage,method}' as evidence_method,
      fs.score_config #>> '{inputContext,requestedForecastType}' as input_requested_forecast_type,
      fs.score_config #>> '{inputContext,requestedForecastTypeBand}' as input_requested_forecast_type_band,
      fs.score_config #>> '{inputContext,routedForecastType}' as input_routed_forecast_type,
      fs.score_config #>> '{inputContext,routedForecastTypeBand}' as input_routed_forecast_type_band,
      fs.score_config #>> '{inputContext,requestedRoutedTypeBand}' as input_requested_routed_type_band,
      nullif(fs.score_config #>> '{inputContext,routingConfidence}', '')::double precision as input_routing_confidence,
      fs.score_config #>> '{inputContext,routingConfidenceBand}' as input_routing_confidence_band,
      fs.score_config #>> '{inputContext,inputSource}' as input_source,
      fs.score_config #>> '{inputContext,inputSourceBand}' as input_source_band,
      nullif(fs.score_config #>> '{inputContext,questionLength}', '')::integer as input_question_length,
      fs.score_config #>> '{inputContext,questionLengthBand}' as input_question_length_band,
      nullif(fs.score_config #>> '{inputContext,hasResolutionCriteria}', '')::boolean as input_has_resolution_criteria,
      nullif(fs.score_config #>> '{inputContext,resolutionCriteriaLength}', '')::integer as input_resolution_criteria_length,
      fs.score_config #>> '{inputContext,resolutionCriteriaLengthBand}' as input_resolution_criteria_length_band,
      nullif(fs.score_config #>> '{inputContext,hasResolutionDate}', '')::boolean as input_has_resolution_date,
      fs.score_config #>> '{inputContext,resolutionDate}' as input_resolution_date,
      nullif(fs.score_config #>> '{inputContext,hasEvidenceAsOfDate}', '')::boolean as input_has_evidence_as_of_date,
      fs.score_config #>> '{inputContext,evidenceAsOfDate}' as input_evidence_as_of_date,
      fs.score_config #>> '{inputContext,evidenceAsOfDateBand}' as input_evidence_as_of_date_band,
      nullif(fs.score_config #>> '{inputContext,resolutionHorizonDays}', '')::integer as input_resolution_horizon_days,
      fs.score_config #>> '{inputContext,resolutionHorizonBand}' as input_resolution_horizon_band,
      nullif(fs.score_config #>> '{inputContext,hasBackground}', '')::boolean as input_has_background,
      nullif(fs.score_config #>> '{inputContext,backgroundLength}', '')::integer as input_background_length,
      fs.score_config #>> '{inputContext,backgroundLengthBand}' as input_background_length_band,
      nullif(fs.score_config #>> '{inputContext,hasMarketPrice}', '')::boolean as input_has_market_price,
      fs.score_config #>> '{inputContext,marketPriceBand}' as input_market_price_band,
      fs.score_config #>> '{inputContext,marketPriceAsOfDate}' as input_market_price_as_of_date,
      nullif(fs.score_config #>> '{inputContext,marketPriceAgeDays}', '')::integer as input_market_price_age_days,
      fs.score_config #>> '{inputContext,marketPriceAgeBand}' as input_market_price_age_band,
      fs.score_config #>> '{inputContext,marketPlatform}' as input_market_platform,
      fs.score_config #>> '{inputContext,marketUrl}' as input_market_url,
      nullif(fs.score_config #>> '{inputContext,hasMarketUrl}', '')::boolean as input_has_market_url,
      fs.score_config #>> '{inputContext,marketCreationDate}' as input_market_creation_date,
      nullif(fs.score_config #>> '{inputContext,marketCreationAgeDays}', '')::integer as input_market_creation_age_days,
      fs.score_config #>> '{inputContext,marketCreationAgeBand}' as input_market_creation_age_band,
      fs.score_config #>> '{inputContext,marketMetadataBand}' as input_market_metadata_band,
      nullif(fs.score_config #>> '{inputContext,categoryCount}', '')::integer as input_category_count,
      fs.score_config #>> '{inputContext,categoryCountBand}' as input_category_count_band,
      nullif(fs.score_config #>> '{inputContext,categoriesExhaustive}', '')::boolean as input_categories_exhaustive,
      fs.score_config #>> '{inputContext,categoryCoverageBand}' as input_category_coverage_band,
      nullif(fs.score_config #>> '{inputContext,thresholdCount}', '')::integer as input_threshold_count,
      fs.score_config #>> '{inputContext,thresholdCountBand}' as input_threshold_count_band,
      nullif(fs.score_config #>> '{inputContext,thresholdValueCount}', '')::integer as input_threshold_value_count,
      fs.score_config #>> '{inputContext,thresholdValueCoverageBand}' as input_threshold_value_coverage_band,
      fs.score_config #>> '{inputContext,thresholdDirection}' as input_threshold_direction,
      fs.score_config #>> '{inputContext,thresholdDirectionBand}' as input_threshold_direction_band,
      nullif(fs.score_config #>> '{inputContext,hasCondition}', '')::boolean as input_has_condition,
      nullif(fs.score_config #>> '{inputContext,conditionLength}', '')::integer as input_condition_length,
      fs.score_config #>> '{inputContext,conditionLengthBand}' as input_condition_length_band,
      nullif(fs.score_config #>> '{inputContext,hasConditionResolutionCriteria}', '')::boolean as input_has_condition_resolution_criteria,
      nullif(fs.score_config #>> '{inputContext,conditionResolutionCriteriaLength}', '')::integer as input_condition_resolution_criteria_length,
      fs.score_config #>> '{inputContext,conditionResolutionCriteriaLengthBand}' as input_condition_resolution_criteria_length_band,
      fs.score_config #>> '{inputContext,conditionCriteriaBand}' as input_condition_criteria_band,
      nullif(fs.score_config #>> '{inputContext,hasUnit}', '')::boolean as input_has_unit,
      fs.score_config #>> '{inputContext,unit}' as input_unit,
      fs.score_config #>> '{inputContext,unitSpecificityBand}' as input_unit_specificity_band,
      nullif(fs.score_config #>> '{inputContext,contextCompleteness}', '')::integer as input_context_completeness,
      fs.score_config #>> '{inputContext,contextCompletenessBand}' as input_context_completeness_band,
      fs.score_config #>> '{runMetadata,workflowVersion}' as run_workflow_version,
      fs.score_config #>> '{runMetadata,workflowVariantId}' as run_workflow_variant_id,
      fs.score_config #>> '{runMetadata,experimentLabel}' as run_experiment_label,
      nullif(fs.score_config #>> '{runMetadata,durationSeconds}', '')::integer as run_duration_seconds,
      fs.score_config #>> '{runMetadata,durationBand}' as run_duration_band,
      fs.score_config::text as score_config_json,
      fs.created_at::text as created_at
    from forecast_scores fs
    left join forecast_aggregates fa on fa.id = fs.forecast_aggregate_id
    left join forecast_attempts fat on fat.id = fs.forecast_attempt_id
    where fs.score_config #>> '{source}' = 'manual_resolution'
      and fs.score_config ? 'taskId'
      and not (fs.score_config ? 'benchmarkRunId')
    order by fs.created_at
  `;
  await replaceTable(duck, "osf_forecast_scores", forecastScoreColumns, forecastScores);

  const binaryCalibrationBuckets = buildBinaryCalibrationBucketMartRows(forecastScores);
  await replaceTable(duck, "osf_binary_calibration_buckets", binaryCalibrationBucketColumns, binaryCalibrationBuckets);
  const calibrationGuardImpact = [buildCalibrationGuardImpactMartRow(forecastScores, new Date().toISOString())];
  await replaceTable(duck, "osf_calibration_guard_impact", calibrationGuardImpactColumns, calibrationGuardImpact);
  const calibrationGuardRuleImpact = buildCalibrationGuardRuleImpactMartRows(forecastScores, new Date().toISOString());
  await replaceTable(duck, "osf_calibration_guard_rule_impact", calibrationGuardRuleImpactColumns, calibrationGuardRuleImpact);

  const workflowChangeProposals = await pg<WorkflowChangeProposalMartRow[]>`
    select
      wcp.id::text as workflow_change_proposal_id,
      wcp.source_benchmark_run_id::text as source_benchmark_run_id,
      wcp.target_workflow_id,
      wcp.problem_statement,
      wcp.evidence_case_ids::text as evidence_case_ids_json,
      wcp.proposed_change,
      wcp.expected_metric_effect,
      wcp.expected_cost_latency_effect,
      wcp.overfit_risk,
      wcp.validation_plan,
      wcp.status,
      wcp.review_note,
      wcp.reviewed_by,
      wcp.reviewed_at::text as reviewed_at,
      wcp.implementation_task_title,
      wcp.implementation_status,
      wcp.implementation_experiment_label,
      wcp.implementation_note,
      wcp.implementation_updated_by,
      wcp.implementation_updated_at::text as implementation_updated_at,
      wcp.validation_benchmark_run_id::text as validation_benchmark_run_id,
      wcp.validation_launched_by,
      wcp.validation_launched_at::text as validation_launched_at,
      wcp.validation_result_status,
      wcp.validation_result_summary,
      wcp.validation_mean_brier_delta,
      wcp.validation_completed_cases,
      sbr.case_count as source_benchmark_case_count,
      greatest(coalesce(sbr.case_count, 1), 1) as validation_required_cases,
      case
        when wcp.validation_completed_cases is null then null
        else wcp.validation_completed_cases::double precision / greatest(coalesce(sbr.case_count, 1), 1)
      end as validation_coverage_ratio,
      wcp.validation_cost_total_tokens_delta,
      wcp.validation_cost_agent_calls_delta,
      wcp.validation_cost_mean_duration_seconds_delta,
      wcp.validation_cost_summary,
      wcp.validation_gate_status,
      wcp.validation_gate_blockers::text as validation_gate_blockers_json,
      validation_readiness_blockers.blockers_json::text as validation_readiness_blockers_json,
      case when jsonb_array_length(validation_readiness_blockers.blockers_json) = 0 then 1 else 0 end as validation_passed,
      wcp.validation_completed_at::text as validation_completed_at,
      vbr.comparison_report_artifact_id::text as validation_comparison_report_artifact_id,
      vcr.row_json #>> '{recommendation,status}' as validation_recommendation_status,
      vcr.row_json #>> '{recommendation,summary}' as validation_recommendation_summary,
      nullif(vcr.row_json #>> '{recommendation,primaryBaselinePairedCaseCount}', '')::integer as validation_recommendation_paired_case_count,
      nullif(vcr.row_json #>> '{recommendation,primaryBaselinePairedHoldoutCaseCount}', '')::integer as validation_recommendation_paired_holdout_case_count,
      validation_primary_baseline.row_json #>> '{baselineBenchmarkRunId}' as validation_primary_baseline_benchmark_run_id,
      nullif(validation_primary_baseline.row_json #>> '{pairedCaseCount}', '')::integer as validation_paired_case_count,
      nullif(validation_primary_baseline.row_json #>> '{pairedMeanBrierDelta}', '')::double precision as validation_paired_mean_brier_delta,
      nullif(validation_primary_baseline.row_json #>> '{pairedMeanLogDelta}', '')::double precision as validation_paired_mean_log_delta,
      nullif(validation_primary_baseline.row_json #>> '{pairedUncertainty,brierDelta,lower}', '')::double precision as validation_paired_brier_ci_lower,
      nullif(validation_primary_baseline.row_json #>> '{pairedUncertainty,brierDelta,upper}', '')::double precision as validation_paired_brier_ci_upper,
      wcp.created_at::text as created_at,
      wcp.updated_at::text as updated_at
    from workflow_change_proposals wcp
    left join benchmark_runs sbr on sbr.id = wcp.source_benchmark_run_id
    left join benchmark_runs vbr on vbr.id = wcp.validation_benchmark_run_id
    left join artifact_rows vcr on vcr.artifact_id = vbr.comparison_report_artifact_id and vcr.row_index = 0
    left join lateral (
      select (
        to_jsonb(array_remove(array[
          case when wcp.validation_result_status = 'completed' then null::text else ${blockerValidationResultIncomplete} end,
          case when wcp.validation_gate_status = ${benchmarkPromotionGateStatusReview} then null::text else ${blockerValidationGateNotPassing} end
        ], null))
        || coalesce(wcp.validation_gate_blockers, '[]'::jsonb)
        || to_jsonb(array_remove(array[
          case
            when coalesce(wcp.validation_completed_cases, 0) >= greatest(coalesce(sbr.case_count, 1), 1) then null::text
            else ${blockerInsufficientValidationCaseCoverage}
          end,
          case
            when vcr.row_json #>> '{recommendation,status}' = 'candidate_better' then null::text
            else ${blockerValidationRecommendationNotCandidateBetter}
          end,
          case
            when coalesce(nullif(vcr.row_json #>> '{recommendation,primaryBaselinePairedCaseCount}', '')::integer, 0) >= ${minimumPromotionPairedCases} then null::text
            else ${blockerInsufficientPrimaryPairedCases}
          end,
          case
            when coalesce(nullif(vcr.row_json #>> '{recommendation,primaryBaselinePairedHoldoutCaseCount}', '')::integer, 0) >= ${minimumPromotionHoldoutCases} then null::text
            else ${blockerInsufficientPrimaryPairedHoldoutCases}
          end
        ], null))
      ) as blockers_json
    ) validation_readiness_blockers on true
    left join lateral (
      select baseline.row_json
      from jsonb_array_elements(coalesce(vcr.row_json #> '{baselines}', '[]'::jsonb)) as baseline(row_json)
      order by
        case
          when baseline.row_json #>> '{baselineBenchmarkRunId}' = coalesce(vcr.row_json #>> '{recommendation,primaryBaselineBenchmarkRunId}', vcr.row_json #>> '{baselines,0,baselineBenchmarkRunId}') then 0
          else 1
        end,
        baseline.row_json #>> '{baselineBenchmarkRunId}'
      limit 1
    ) validation_primary_baseline on true
    order by wcp.created_at
  `;
  await replaceTable(duck, "osf_workflow_change_proposals", workflowChangeProposalColumns, workflowChangeProposals);

  const sources = await pg<SourceMartRow[]>`
    select
      id::text as source_id,
      task_id::text as task_id,
      url,
      domain,
      title,
      content_summary,
      source_type,
      used_in_final,
      quality_score,
      retrieved_at::text as retrieved_at,
      published_at::text as published_at,
      created_at::text as created_at
    from source_bank_entries
    order by created_at
  `;
  await replaceTable(duck, "osf_source_bank_entries", sourceColumns, sources);
  const sourceDomains = buildSourceDomainMartRows(sources);
  await replaceTable(duck, "osf_source_bank_domains", sourceDomainColumns, sourceDomains);

  const calibrationGuardValidations = await readCalibrationGuardValidationRows(resolve(root, "data/reports/forecast-calibration-guard-validation"));
  await replaceTable(duck, "osf_calibration_guard_validations", calibrationGuardValidationColumns, calibrationGuardValidations);
  const calibrationGuardDefaultPlan = await readCalibrationGuardDefaultPlanRows(root);
  const calibrationGuardDefaultPlanCandidates = calibrationGuardDefaultPlan.candidateRows;
  const calibrationGuardDefaultPlanSkippedRows = calibrationGuardDefaultPlan.skippedRows;
  const calibrationGuardDefaultPlanIssues = calibrationGuardDefaultPlan.issueRows;
  await replaceTable(duck, "osf_calibration_guard_default_plan_candidates", calibrationGuardDefaultPlanColumns, calibrationGuardDefaultPlanCandidates);
  await replaceTable(duck, "osf_calibration_guard_default_plan_skipped_rows", calibrationGuardDefaultPlanSkippedColumns, calibrationGuardDefaultPlanSkippedRows);
  await replaceTable(duck, "osf_calibration_guard_default_plan_issues", calibrationGuardDefaultPlanIssueColumns, calibrationGuardDefaultPlanIssues);
  const forecastAttentionItems = await readForecastAttentionItemRows(root);
  await replaceTable(duck, "osf_forecast_attention_items", forecastAttentionItemColumns, forecastAttentionItems);
  const forecastBatchHealthSnapshot = readLatestForecastBatchHealth(root);
  const forecastBatchHealth = buildForecastBatchHealthMartRows(forecastBatchHealthSnapshot);
  await replaceTable(duck, "osf_forecast_batch_health", forecastBatchHealthColumns, forecastBatchHealth);
  const forecastBatchHealthIssues = buildForecastBatchHealthIssueMartRows(forecastBatchHealthSnapshot);
  await replaceTable(duck, "osf_forecast_batch_health_issues", forecastBatchHealthIssueColumns, forecastBatchHealthIssues);
  const forecastBatchHealthAttentionItems = buildForecastBatchHealthAttentionItemMartRows(forecastBatchHealthSnapshot);
  await replaceTable(duck, "osf_forecast_batch_health_attention_items", forecastBatchHealthAttentionItemColumns, forecastBatchHealthAttentionItems);
  const forecastBatchHealthAttentionKinds = buildForecastBatchHealthAttentionKindMartRows(forecastBatchHealthSnapshot);
  await replaceTable(duck, "osf_forecast_batch_health_attention_kinds", forecastBatchHealthAttentionKindColumns, forecastBatchHealthAttentionKinds);
  const forecastBatchHealthAttentionSeverities = buildForecastBatchHealthAttentionSeverityMartRows(forecastBatchHealthSnapshot);
  await replaceTable(duck, "osf_forecast_batch_health_attention_severities", forecastBatchHealthAttentionSeverityColumns, forecastBatchHealthAttentionSeverities);
  const forecastBatchHealthAttentionTypes = buildForecastBatchHealthAttentionTypeMartRows(forecastBatchHealthSnapshot);
  await replaceTable(duck, "osf_forecast_batch_health_attention_types", forecastBatchHealthAttentionTypeColumns, forecastBatchHealthAttentionTypes);
  const forecastBatchHealthCandidateGuards = buildForecastBatchHealthCandidateGuardMartRows(forecastBatchHealthSnapshot);
  await replaceTable(duck, "osf_forecast_batch_health_candidate_guards", forecastBatchHealthCandidateGuardColumns, forecastBatchHealthCandidateGuards);

  const counts = {
    osf_tasks: tasks.length,
    osf_artifact_rows: artifactRows.length,
    osf_benchmark_runs: benchmarkRuns.length,
    osf_benchmark_cost_status: benchmarkCostStatus.length,
    osf_benchmark_cost_outliers: benchmarkCostOutliers.length,
    osf_benchmark_case_results: benchmarkCases.length,
    osf_forecast_scores: forecastScores.length,
    osf_binary_calibration_buckets: binaryCalibrationBuckets.length,
    osf_calibration_guard_impact: calibrationGuardImpact.length,
    osf_calibration_guard_rule_impact: calibrationGuardRuleImpact.length,
    osf_workflow_change_proposals: workflowChangeProposals.length,
    osf_calibration_guard_validations: calibrationGuardValidations.length,
    osf_calibration_guard_default_plan_candidates: calibrationGuardDefaultPlanCandidates.length,
    osf_calibration_guard_default_plan_skipped_rows: calibrationGuardDefaultPlanSkippedRows.length,
    osf_calibration_guard_default_plan_issues: calibrationGuardDefaultPlanIssues.length,
    osf_forecast_attention_items: forecastAttentionItems.length,
    osf_forecast_batch_health: forecastBatchHealth.length,
    osf_forecast_batch_health_issues: forecastBatchHealthIssues.length,
    osf_forecast_batch_health_attention_items: forecastBatchHealthAttentionItems.length,
    osf_forecast_batch_health_attention_kinds: forecastBatchHealthAttentionKinds.length,
    osf_forecast_batch_health_attention_severities: forecastBatchHealthAttentionSeverities.length,
    osf_forecast_batch_health_attention_types: forecastBatchHealthAttentionTypes.length,
    osf_forecast_batch_health_candidate_guards: forecastBatchHealthCandidateGuards.length,
    osf_source_bank_domains: sourceDomains.length,
    osf_source_bank_entries: sources.length,
    osf_smithers_token_usage: smithersUsageMarts.usageRows.length,
    osf_smithers_token_usage_by_task: smithersUsageMarts.summaryRows.length,
  };
  console.log(JSON.stringify({
    ok: true,
    duckdbPath: config.DUCKDB_PATH,
    syncedAt: new Date().toISOString(),
    counts,
    exampleQueries: [
      "select * from osf_benchmark_runs order by created_at desc limit 5;",
      "select benchmark_run_id, paired_mean_brier_delta, paired_brier_ci_lower, paired_brier_ci_upper, recommendation_status from osf_benchmark_runs where comparison_report_artifact_id is not null;",
      "select benchmark_run_id, promotion_gate_status, promotion_gate_blockers from osf_benchmark_runs order by created_at desc limit 5;",
      "select benchmark_run_id, paired_mean_brier_delta, cost_total_tokens, cost_agent_calls, cost_mean_duration_seconds from osf_benchmark_runs where cost_measured_cases > 0 order by created_at desc limit 10;",
      "select benchmark_run_id, case_status, cases, measured_cases, total_tokens, mean_duration_seconds from osf_benchmark_cost_status order by created_at desc, total_tokens desc limit 20;",
      "select benchmark_run_id, outlier_kind, outlier_rank, benchmark_case_result_id, task_id, total_tokens, duration_seconds from osf_benchmark_cost_outliers order by created_at desc, outlier_kind, outlier_rank limit 20;",
      "select bucket_label, sample_size, calibration_error, candidate_guard_suggested_adjustment from osf_binary_calibration_buckets;",
      "select status, guarded_rows, unguarded_rows, brier_delta from osf_calibration_guard_impact;",
      "select rule_id, status, guarded_rows, brier_delta from osf_calibration_guard_rule_impact order by rule_id;",
      "select proposal_id, recommendation, brier_delta, calibration_error_delta from osf_calibration_guard_validations order by generated_at desc limit 5;",
      "select proposal_id, bucket_label, suggested_adjustment, brier_delta, calibration_error_delta, implementation_status from osf_calibration_guard_default_plan_candidates order by generated_at desc limit 5;",
      "select proposal_id, bucket_label, validation_mode, recommendation, reason from osf_calibration_guard_default_plan_skipped_rows order by generated_at desc limit 10;",
      "select severity, kind, validation_report_path, latest_validation_report_path from osf_calibration_guard_default_plan_issues order by generated_at desc, kind limit 10;",
      "select batch_id, review_status, severity, kind, metric, score, task_label from osf_forecast_attention_items order by generated_at desc, severity limit 10;",
      "select batch_id, status, unresolved_attention_items, unresolved_candidate_calibration_guard_rules, issue_count from osf_forecast_batch_health;",
      "select batch_id, severity, kind, message from osf_forecast_batch_health_issues order by severity, kind;",
      "select batch_id, review_status, severity, kind, metric, task_label, source_path from osf_forecast_batch_health_attention_items order by review_status, severity limit 10;",
      "select batch_id, kind, unresolved_items, high_items from osf_forecast_batch_health_attention_kinds order by unresolved_items desc, high_items desc;",
      "select batch_id, severity, unresolved_items from osf_forecast_batch_health_attention_severities order by unresolved_items desc;",
      "select batch_id, forecast_type, open_items, deferred_items, high_items from osf_forecast_batch_health_attention_types order by unresolved_items desc, high_items desc;",
      "select batch_id, review_status, bucket_label, direction, suggested_adjustment, calibration_error, review_note from osf_forecast_batch_health_candidate_guards order by review_status, calibration_error desc;",
      "select domain, entries, used_in_final_entries, task_count, mean_quality_score from osf_source_bank_domains order by entries desc, used_in_final_entries desc limit 20;",
      "select task_id, operation_mode, operation_submode, agent_calls, total_tokens from osf_smithers_token_usage_by_task order by total_tokens desc limit 20;",
      "select fs.forecast_type, avg(fs.score_value) as mean_score, avg(usage.total_tokens) as mean_tokens from osf_forecast_scores fs join osf_smithers_token_usage_by_task usage using (task_id) group by 1 order by 1;",
      "select source_benchmark_run_id, target_workflow_id, status, implementation_status, validation_passed, validation_readiness_blockers_json, validation_benchmark_run_id, validation_result_status, validation_recommendation_status, validation_paired_mean_brier_delta, validation_gate_status from osf_workflow_change_proposals order by created_at desc limit 5;",
      "select operation_mode, operation_submode, status, count(*) from osf_tasks group by 1,2,3 order by 4 desc;",
    ],
  }, null, 2));
} finally {
  duck.closeSync();
  await pg.end();
}
}

type DuckColumnType = "VARCHAR" | "INTEGER" | "DOUBLE" | "BOOLEAN";
type DuckColumn = { name: string; type: DuckColumnType };
type DuckRow = Record<string, unknown>;

const taskColumns = [
  { name: "task_id", type: "VARCHAR" },
  { name: "smithers_run_id", type: "VARCHAR" },
  { name: "operation_mode", type: "VARCHAR" },
  { name: "operation_submode", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "label", type: "VARCHAR" },
  { name: "output_artifact_id", type: "VARCHAR" },
  { name: "benchmark_run_id", type: "VARCHAR" },
  { name: "workflow_variant_id", type: "VARCHAR" },
  { name: "experiment_label", type: "VARCHAR" },
  { name: "created_at", type: "VARCHAR" },
  { name: "started_at", type: "VARCHAR" },
  { name: "completed_at", type: "VARCHAR" },
  { name: "duration_seconds", type: "DOUBLE" },
  { name: "config_json", type: "VARCHAR" },
] satisfies DuckColumn[];

const smithersTokenUsageColumns = [
  { name: "task_id", type: "VARCHAR" },
  { name: "smithers_run_id", type: "VARCHAR" },
  { name: "operation_mode", type: "VARCHAR" },
  { name: "operation_submode", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "benchmark_run_id", type: "VARCHAR" },
  { name: "workflow_variant_id", type: "VARCHAR" },
  { name: "experiment_label", type: "VARCHAR" },
  { name: "node_id", type: "VARCHAR" },
  { name: "iteration", type: "INTEGER" },
  { name: "attempt", type: "INTEGER" },
  { name: "model", type: "VARCHAR" },
  { name: "usage_source", type: "VARCHAR" },
  { name: "input_tokens", type: "INTEGER" },
  { name: "cached_input_tokens", type: "INTEGER" },
  { name: "output_tokens", type: "INTEGER" },
  { name: "reasoning_output_tokens", type: "INTEGER" },
  { name: "total_tokens", type: "INTEGER" },
  { name: "timestamp_ms", type: "DOUBLE" },
] satisfies DuckColumn[];

const smithersTokenUsageByTaskColumns = [
  { name: "task_id", type: "VARCHAR" },
  { name: "smithers_run_id", type: "VARCHAR" },
  { name: "operation_mode", type: "VARCHAR" },
  { name: "operation_submode", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "benchmark_run_id", type: "VARCHAR" },
  { name: "workflow_variant_id", type: "VARCHAR" },
  { name: "experiment_label", type: "VARCHAR" },
  { name: "agent_calls", type: "INTEGER" },
  { name: "input_tokens", type: "INTEGER" },
  { name: "cached_input_tokens", type: "INTEGER" },
  { name: "output_tokens", type: "INTEGER" },
  { name: "reasoning_output_tokens", type: "INTEGER" },
  { name: "total_tokens", type: "INTEGER" },
] satisfies DuckColumn[];

const artifactRowColumns = [
  { name: "artifact_row_id", type: "VARCHAR" },
  { name: "artifact_id", type: "VARCHAR" },
  { name: "task_id", type: "VARCHAR" },
  { name: "artifact_type", type: "VARCHAR" },
  { name: "created_by", type: "VARCHAR" },
  { name: "storage_uri", type: "VARCHAR" },
  { name: "row_index", type: "INTEGER" },
  { name: "source_row_id", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "row_json", type: "VARCHAR" },
  { name: "completed_at", type: "VARCHAR" },
  { name: "created_at", type: "VARCHAR" },
] satisfies DuckColumn[];

const benchmarkRunColumns = [
  { name: "benchmark_run_id", type: "VARCHAR" },
  { name: "suite_id", type: "VARCHAR" },
  { name: "suite_name", type: "VARCHAR" },
  { name: "suite_revision", type: "VARCHAR" },
  { name: "eval_mode", type: "VARCHAR" },
  { name: "workflow_variant_id", type: "VARCHAR" },
  { name: "workflow_id", type: "VARCHAR" },
  { name: "workflow_source_hash", type: "VARCHAR" },
  { name: "promotion_state", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "case_count", type: "INTEGER" },
  { name: "comparison_report_artifact_id", type: "VARCHAR" },
  { name: "analysis_report_artifact_id", type: "VARCHAR" },
  { name: "promotion_decision_id", type: "VARCHAR" },
  { name: "promotion_decision_state", type: "VARCHAR" },
  { name: "promotion_decision_note", type: "VARCHAR" },
  { name: "promotion_decided_by", type: "VARCHAR" },
  { name: "promotion_decided_at", type: "VARCHAR" },
  { name: "recommendation_status", type: "VARCHAR" },
  { name: "recommendation_summary", type: "VARCHAR" },
  { name: "result_count", type: "INTEGER" },
  { name: "trace_missing_count", type: "INTEGER" },
  { name: "review_or_failed_count", type: "INTEGER" },
  { name: "missing_baseline_sanity_cases", type: "INTEGER" },
  { name: "unexplained_component_disagreement_cases", type: "INTEGER" },
  { name: "large_probability_miss_cases", type: "INTEGER" },
  { name: "worse_than_baseline_cases", type: "INTEGER" },
  { name: "holdout_case_results", type: "INTEGER" },
  { name: "required_holdout_case_results", type: "INTEGER" },
  { name: "unspecified_case_results", type: "INTEGER" },
  { name: "source_leakage_cases", type: "INTEGER" },
  { name: "information_advantage_cases", type: "INTEGER" },
  { name: "post_cutoff_source_cases", type: "INTEGER" },
  { name: "human_forecast_source_cases", type: "INTEGER" },
  { name: "missing_published_at_cases", type: "INTEGER" },
  { name: "dominant_source_domain_cases", type: "INTEGER" },
  { name: "low_quality_source_cases", type: "INTEGER" },
  { name: "source_entries", type: "INTEGER" },
  { name: "used_in_final_source_entries", type: "INTEGER" },
  { name: "source_domain_count", type: "INTEGER" },
  { name: "top_source_domain", type: "VARCHAR" },
  { name: "top_source_domain_entries", type: "INTEGER" },
  { name: "top_source_domain_share", type: "DOUBLE" },
  { name: "low_quality_source_entries", type: "INTEGER" },
  { name: "low_quality_final_source_entries", type: "INTEGER" },
  { name: "weak_trace_completeness_cases", type: "INTEGER" },
  { name: "missing_probability_cases", type: "INTEGER" },
  { name: "missing_score_rows_cases", type: "INTEGER" },
  { name: "missing_aggregate_rationale_cases", type: "INTEGER" },
  { name: "promotion_gate_status", type: "VARCHAR" },
  { name: "promotion_gate_blockers", type: "VARCHAR" },
  { name: "cost_case_count", type: "INTEGER" },
  { name: "cost_measured_cases", type: "INTEGER" },
  { name: "cost_missing_usage_cases", type: "INTEGER" },
  { name: "cost_agent_calls", type: "INTEGER" },
  { name: "cost_input_tokens", type: "INTEGER" },
  { name: "cost_cached_input_tokens", type: "INTEGER" },
  { name: "cost_output_tokens", type: "INTEGER" },
  { name: "cost_reasoning_output_tokens", type: "INTEGER" },
  { name: "cost_total_tokens", type: "INTEGER" },
  { name: "cost_mean_agent_calls_per_measured_case", type: "DOUBLE" },
  { name: "cost_mean_tokens_per_measured_case", type: "DOUBLE" },
  { name: "cost_median_tokens_per_measured_case", type: "DOUBLE" },
  { name: "cost_mean_duration_seconds", type: "DOUBLE" },
  { name: "cost_median_duration_seconds", type: "DOUBLE" },
  { name: "primary_baseline_benchmark_run_id", type: "VARCHAR" },
  { name: "baseline_benchmark_run_id", type: "VARCHAR" },
  { name: "paired_case_count", type: "INTEGER" },
  { name: "paired_mean_brier_delta", type: "DOUBLE" },
  { name: "paired_mean_log_delta", type: "DOUBLE" },
  { name: "paired_brier_ci_lower", type: "DOUBLE" },
  { name: "paired_brier_ci_upper", type: "DOUBLE" },
  { name: "created_at", type: "VARCHAR" },
  { name: "started_at", type: "VARCHAR" },
  { name: "completed_at", type: "VARCHAR" },
] satisfies DuckColumn[];

const benchmarkCostStatusColumns = [
  { name: "benchmark_run_id", type: "VARCHAR" },
  { name: "suite_id", type: "VARCHAR" },
  { name: "suite_name", type: "VARCHAR" },
  { name: "eval_mode", type: "VARCHAR" },
  { name: "workflow_variant_id", type: "VARCHAR" },
  { name: "workflow_id", type: "VARCHAR" },
  { name: "run_status", type: "VARCHAR" },
  { name: "case_status", type: "VARCHAR" },
  { name: "cases", type: "INTEGER" },
  { name: "measured_cases", type: "INTEGER" },
  { name: "agent_calls", type: "INTEGER" },
  { name: "total_tokens", type: "INTEGER" },
  { name: "mean_tokens_per_measured_case", type: "DOUBLE" },
  { name: "mean_duration_seconds", type: "DOUBLE" },
  { name: "created_at", type: "VARCHAR" },
] satisfies DuckColumn[];

const benchmarkCostOutlierColumns = [
  { name: "benchmark_run_id", type: "VARCHAR" },
  { name: "suite_id", type: "VARCHAR" },
  { name: "suite_name", type: "VARCHAR" },
  { name: "eval_mode", type: "VARCHAR" },
  { name: "workflow_variant_id", type: "VARCHAR" },
  { name: "workflow_id", type: "VARCHAR" },
  { name: "run_status", type: "VARCHAR" },
  { name: "outlier_kind", type: "VARCHAR" },
  { name: "outlier_rank", type: "INTEGER" },
  { name: "benchmark_case_result_id", type: "VARCHAR" },
  { name: "benchmark_case_id", type: "VARCHAR" },
  { name: "task_id", type: "VARCHAR" },
  { name: "smithers_run_id", type: "VARCHAR" },
  { name: "case_status", type: "VARCHAR" },
  { name: "agent_calls", type: "INTEGER" },
  { name: "total_tokens", type: "INTEGER" },
  { name: "duration_seconds", type: "DOUBLE" },
  { name: "created_at", type: "VARCHAR" },
] satisfies DuckColumn[];

const benchmarkCaseColumns = [
  { name: "benchmark_case_result_id", type: "VARCHAR" },
  { name: "benchmark_run_id", type: "VARCHAR" },
  { name: "benchmark_case_id", type: "VARCHAR" },
  { name: "benchmark_external_id", type: "VARCHAR" },
  { name: "task_id", type: "VARCHAR" },
  { name: "smithers_run_id", type: "VARCHAR" },
  { name: "workflow_variant_id", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "brier", type: "DOUBLE" },
  { name: "log_score", type: "DOUBLE" },
  { name: "baseline_brier", type: "DOUBLE" },
  { name: "baseline_delta_brier", type: "DOUBLE" },
  { name: "trace_bundle_uri", type: "VARCHAR" },
  { name: "source_bundle_uri", type: "VARCHAR" },
  { name: "leakage_flags_json", type: "VARCHAR" },
  { name: "failure_labels_json", type: "VARCHAR" },
  { name: "score_rows_json", type: "VARCHAR" },
  { name: "created_at", type: "VARCHAR" },
  { name: "updated_at", type: "VARCHAR" },
] satisfies DuckColumn[];

const forecastScoreColumns = [
  { name: "forecast_score_id", type: "VARCHAR" },
  { name: "forecast_aggregate_id", type: "VARCHAR" },
  { name: "forecast_attempt_id", type: "VARCHAR" },
  { name: "resolution_id", type: "VARCHAR" },
  { name: "task_id", type: "VARCHAR" },
  { name: "forecast_type", type: "VARCHAR" },
  { name: "target", type: "VARCHAR" },
  { name: "source", type: "VARCHAR" },
  { name: "score_type", type: "VARCHAR" },
  { name: "score_value", type: "DOUBLE" },
  { name: "probability", type: "DOUBLE" },
  { name: "binary_confidence_band", type: "VARCHAR" },
  { name: "binary_forecast_side", type: "VARCHAR" },
  { name: "binary_distance_from_even", type: "DOUBLE" },
  { name: "resolved", type: "BOOLEAN" },
  { name: "calibration_guard_adjustment", type: "DOUBLE" },
  { name: "calibration_guard_rules_json", type: "VARCHAR" },
  { name: "baseline_sanity_status", type: "VARCHAR" },
  { name: "baseline_probability", type: "DOUBLE" },
  { name: "baseline_delta", type: "DOUBLE" },
  { name: "component_base_rate_count", type: "INTEGER" },
  { name: "component_base_rate_disagreement", type: "DOUBLE" },
  { name: "market_anchor_status", type: "VARCHAR" },
  { name: "market_anchor_price", type: "DOUBLE" },
  { name: "market_anchor_final_probability", type: "DOUBLE" },
  { name: "market_anchor_delta", type: "DOUBLE" },
  { name: "market_anchor_platform", type: "VARCHAR" },
  { name: "market_anchor_price_as_of", type: "VARCHAR" },
  { name: "resolution_boundary_status", type: "VARCHAR" },
  { name: "resolution_boundary_component_count", type: "INTEGER" },
  { name: "resolution_boundary_ambiguity_flag_count", type: "INTEGER" },
  { name: "resolution_boundary_quality_issue_count", type: "INTEGER" },
  { name: "resolution_boundary_planner_risk_count", type: "INTEGER" },
  { name: "uncertainty_range_status", type: "VARCHAR" },
  { name: "uncertainty_range_component_count", type: "INTEGER" },
  { name: "uncertainty_range_median_width", type: "DOUBLE" },
  { name: "uncertainty_range_mean_width", type: "DOUBLE" },
  { name: "uncertainty_range_widest_width", type: "DOUBLE" },
  { name: "uncertainty_range_narrow_count", type: "INTEGER" },
  { name: "component_weighting_status", type: "VARCHAR" },
  { name: "component_weighting_audited_count", type: "INTEGER" },
  { name: "component_weighting_downweight_count", type: "INTEGER" },
  { name: "component_weighting_upweight_count", type: "INTEGER" },
  { name: "component_weighting_normal_count", type: "INTEGER" },
  { name: "component_weighting_calibration_risk_count", type: "INTEGER" },
  { name: "aggregate_convergence_status", type: "VARCHAR" },
  { name: "aggregate_quality_approved", type: "BOOLEAN" },
  { name: "aggregate_max_iterations_reached", type: "BOOLEAN" },
  { name: "aggregate_rounds_used", type: "INTEGER" },
  { name: "aggregate_rounds_used_band", type: "VARCHAR" },
  { name: "aggregate_forecaster_count", type: "INTEGER" },
  { name: "aggregate_complexity_score", type: "INTEGER" },
  { name: "aggregate_research_depth", type: "VARCHAR" },
  { name: "aggregate_quality_issue_count", type: "INTEGER" },
  { name: "aggregate_quality_issue_count_band", type: "VARCHAR" },
  { name: "aggregate_role_ids_json", type: "VARCHAR" },
  { name: "aggregate_mean_probability", type: "DOUBLE" },
  { name: "aggregate_median_probability", type: "DOUBLE" },
  { name: "aggregate_component_min_probability", type: "DOUBLE" },
  { name: "aggregate_component_max_probability", type: "DOUBLE" },
  { name: "aggregate_final_component_position_band", type: "VARCHAR" },
  { name: "aggregate_side_agreement", type: "VARCHAR" },
  { name: "aggregate_mean_confidence_distance", type: "DOUBLE" },
  { name: "aggregate_mean_confidence_distance_band", type: "VARCHAR" },
  { name: "aggregate_final_confidence_shift", type: "DOUBLE" },
  { name: "aggregate_final_confidence_shift_band", type: "VARCHAR" },
  { name: "aggregate_mean_base_rate_probability", type: "DOUBLE" },
  { name: "aggregate_mean_inside_view_probability", type: "DOUBLE" },
  { name: "aggregate_inside_view_delta", type: "DOUBLE" },
  { name: "aggregate_inside_view_delta_band", type: "VARCHAR" },
  { name: "aggregate_final_inside_view_delta", type: "DOUBLE" },
  { name: "aggregate_final_inside_view_delta_band", type: "VARCHAR" },
  { name: "aggregate_final_adjustment_direction", type: "VARCHAR" },
  { name: "aggregate_component_disagreement", type: "DOUBLE" },
  { name: "aggregate_component_disagreement_band", type: "VARCHAR" },
  { name: "aggregation_anchor", type: "VARCHAR" },
  { name: "adjustment_from_median", type: "DOUBLE" },
  { name: "adjustment_from_median_band", type: "VARCHAR" },
  { name: "aggregate_attempt_count", type: "INTEGER" },
  { name: "aggregate_attempt_count_band", type: "VARCHAR" },
  { name: "conditional_branch", type: "VARCHAR" },
  { name: "condition_resolved", type: "BOOLEAN" },
  { name: "outcome_resolved", type: "BOOLEAN" },
  { name: "condition_probability", type: "DOUBLE" },
  { name: "probability_given_condition", type: "DOUBLE" },
  { name: "probability_given_not_condition", type: "DOUBLE" },
  { name: "conditional_probability_delta", type: "DOUBLE" },
  { name: "conditional_effect_band", type: "VARCHAR" },
  { name: "conditional_resolved_branch_probability", type: "DOUBLE" },
  { name: "conditional_resolved_branch_probability_band", type: "VARCHAR" },
  { name: "conditional_resolved_branch_placement", type: "VARCHAR" },
  { name: "conditional_attempt_count", type: "INTEGER" },
  { name: "conditional_attempt_count_band", type: "VARCHAR" },
  { name: "conditional_component_branch_count", type: "INTEGER" },
  { name: "conditional_given_condition_disagreement", type: "DOUBLE" },
  { name: "conditional_given_not_condition_disagreement", type: "DOUBLE" },
  { name: "conditional_effect_disagreement", type: "DOUBLE" },
  { name: "conditional_branch_disagreement_band", type: "VARCHAR" },
  { name: "conditional_effect_direction_agreement", type: "VARCHAR" },
  { name: "threshold_direction", type: "VARCHAR" },
  { name: "threshold_source", type: "VARCHAR" },
  { name: "threshold_count", type: "INTEGER" },
  { name: "monotonicity_repaired", type: "BOOLEAN" },
  { name: "threshold_probability_spread", type: "DOUBLE" },
  { name: "threshold_probability_spread_band", type: "VARCHAR" },
  { name: "threshold_actual_value", type: "DOUBLE" },
  { name: "threshold_nearest_distance", type: "DOUBLE" },
  { name: "threshold_resolved_band", type: "VARCHAR" },
  { name: "thresholded_attempt_count", type: "INTEGER" },
  { name: "thresholded_attempt_count_band", type: "VARCHAR" },
  { name: "thresholded_component_curve_count", type: "INTEGER" },
  { name: "thresholded_component_probability_disagreement", type: "DOUBLE" },
  { name: "thresholded_component_disagreement_band", type: "VARCHAR" },
  { name: "numeric_unit", type: "VARCHAR" },
  { name: "numeric_p10", type: "DOUBLE" },
  { name: "numeric_p50", type: "DOUBLE" },
  { name: "numeric_p90", type: "DOUBLE" },
  { name: "numeric_interval_width", type: "DOUBLE" },
  { name: "numeric_interval_width_band", type: "VARCHAR" },
  { name: "numeric_actual_value", type: "DOUBLE" },
  { name: "numeric_p50_error", type: "DOUBLE" },
  { name: "numeric_absolute_p50_error", type: "DOUBLE" },
  { name: "numeric_p50_error_band", type: "VARCHAR" },
  { name: "numeric_resolved_position_band", type: "VARCHAR" },
  { name: "numeric_attempt_count", type: "INTEGER" },
  { name: "numeric_attempt_count_band", type: "VARCHAR" },
  { name: "numeric_component_value_count", type: "INTEGER" },
  { name: "numeric_p50_disagreement", type: "DOUBLE" },
  { name: "numeric_p50_disagreement_band", type: "VARCHAR" },
  { name: "numeric_unit_disagreement_count", type: "INTEGER" },
  { name: "date_p10", type: "VARCHAR" },
  { name: "date_p50", type: "VARCHAR" },
  { name: "date_p90", type: "VARCHAR" },
  { name: "date_interval_days", type: "INTEGER" },
  { name: "date_interval_band", type: "VARCHAR" },
  { name: "date_actual_date", type: "VARCHAR" },
  { name: "date_p50_error_days", type: "INTEGER" },
  { name: "date_absolute_p50_error_days", type: "INTEGER" },
  { name: "date_p50_error_band", type: "VARCHAR" },
  { name: "date_resolved_position_band", type: "VARCHAR" },
  { name: "date_never_probability", type: "DOUBLE" },
  { name: "date_never_probability_band", type: "VARCHAR" },
  { name: "date_attempt_count", type: "INTEGER" },
  { name: "date_attempt_count_band", type: "VARCHAR" },
  { name: "date_component_date_count", type: "INTEGER" },
  { name: "date_p50_disagreement_days", type: "INTEGER" },
  { name: "date_p50_disagreement_band", type: "VARCHAR" },
  { name: "date_never_probability_disagreement", type: "DOUBLE" },
  { name: "categorical_top_category", type: "VARCHAR" },
  { name: "categorical_top_probability", type: "DOUBLE" },
  { name: "categorical_top_probability_band", type: "VARCHAR" },
  { name: "categorical_category_count", type: "INTEGER" },
  { name: "categorical_category_source", type: "VARCHAR" },
  { name: "categorical_categories_exhaustive", type: "BOOLEAN" },
  { name: "categorical_category_coverage_band", type: "VARCHAR" },
  { name: "categorical_entropy", type: "DOUBLE" },
  { name: "categorical_entropy_band", type: "VARCHAR" },
  { name: "categorical_attempt_count", type: "INTEGER" },
  { name: "categorical_attempt_count_band", type: "VARCHAR" },
  { name: "categorical_component_category_count", type: "INTEGER" },
  { name: "categorical_unique_top_category_count", type: "INTEGER" },
  { name: "categorical_top_category_vote_share", type: "DOUBLE" },
  { name: "categorical_top_category_agreement_band", type: "VARCHAR" },
  { name: "categorical_top_category_probability_spread", type: "DOUBLE" },
  { name: "categorical_actual_category", type: "VARCHAR" },
  { name: "categorical_actual_probability", type: "DOUBLE" },
  { name: "categorical_actual_probability_band", type: "VARCHAR" },
  { name: "categorical_resolved_category_band", type: "VARCHAR" },
  { name: "evidence_source_count", type: "INTEGER" },
  { name: "evidence_source_count_band", type: "VARCHAR" },
  { name: "evidence_source_domain_count", type: "INTEGER" },
  { name: "evidence_source_diversity_band", type: "VARCHAR" },
  { name: "evidence_top_source_domain_count", type: "INTEGER" },
  { name: "evidence_top_source_domain_share", type: "DOUBLE" },
  { name: "evidence_source_concentration_band", type: "VARCHAR" },
  { name: "evidence_dated_source_count", type: "INTEGER" },
  { name: "evidence_undated_source_count", type: "INTEGER" },
  { name: "evidence_source_date_coverage_band", type: "VARCHAR" },
  { name: "evidence_newest_published_at", type: "VARCHAR" },
  { name: "evidence_oldest_published_at", type: "VARCHAR" },
  { name: "evidence_as_of_date", type: "VARCHAR" },
  { name: "evidence_post_as_of_source_count", type: "INTEGER" },
  { name: "evidence_source_timing_band", type: "VARCHAR" },
  { name: "evidence_newest_source_age_days", type: "INTEGER" },
  { name: "evidence_source_freshness_band", type: "VARCHAR" },
  { name: "evidence_uncertainty_count", type: "INTEGER" },
  { name: "evidence_uncertainty_count_band", type: "VARCHAR" },
  { name: "evidence_rationale_length", type: "INTEGER" },
  { name: "evidence_rationale_length_band", type: "VARCHAR" },
  { name: "evidence_method", type: "VARCHAR" },
  { name: "input_requested_forecast_type", type: "VARCHAR" },
  { name: "input_requested_forecast_type_band", type: "VARCHAR" },
  { name: "input_routed_forecast_type", type: "VARCHAR" },
  { name: "input_routed_forecast_type_band", type: "VARCHAR" },
  { name: "input_requested_routed_type_band", type: "VARCHAR" },
  { name: "input_routing_confidence", type: "DOUBLE" },
  { name: "input_routing_confidence_band", type: "VARCHAR" },
  { name: "input_source", type: "VARCHAR" },
  { name: "input_source_band", type: "VARCHAR" },
  { name: "input_question_length", type: "INTEGER" },
  { name: "input_question_length_band", type: "VARCHAR" },
  { name: "input_has_resolution_criteria", type: "BOOLEAN" },
  { name: "input_resolution_criteria_length", type: "INTEGER" },
  { name: "input_resolution_criteria_length_band", type: "VARCHAR" },
  { name: "input_has_resolution_date", type: "BOOLEAN" },
  { name: "input_resolution_date", type: "VARCHAR" },
  { name: "input_has_evidence_as_of_date", type: "BOOLEAN" },
  { name: "input_evidence_as_of_date", type: "VARCHAR" },
  { name: "input_evidence_as_of_date_band", type: "VARCHAR" },
  { name: "input_resolution_horizon_days", type: "INTEGER" },
  { name: "input_resolution_horizon_band", type: "VARCHAR" },
  { name: "input_has_background", type: "BOOLEAN" },
  { name: "input_background_length", type: "INTEGER" },
  { name: "input_background_length_band", type: "VARCHAR" },
  { name: "input_has_market_price", type: "BOOLEAN" },
  { name: "input_market_price_band", type: "VARCHAR" },
  { name: "input_market_price_as_of_date", type: "VARCHAR" },
  { name: "input_market_price_age_days", type: "INTEGER" },
  { name: "input_market_price_age_band", type: "VARCHAR" },
  { name: "input_market_platform", type: "VARCHAR" },
  { name: "input_market_url", type: "VARCHAR" },
  { name: "input_has_market_url", type: "BOOLEAN" },
  { name: "input_market_creation_date", type: "VARCHAR" },
  { name: "input_market_creation_age_days", type: "INTEGER" },
  { name: "input_market_creation_age_band", type: "VARCHAR" },
  { name: "input_market_metadata_band", type: "VARCHAR" },
  { name: "input_category_count", type: "INTEGER" },
  { name: "input_category_count_band", type: "VARCHAR" },
  { name: "input_categories_exhaustive", type: "BOOLEAN" },
  { name: "input_category_coverage_band", type: "VARCHAR" },
  { name: "input_threshold_count", type: "INTEGER" },
  { name: "input_threshold_count_band", type: "VARCHAR" },
  { name: "input_threshold_value_count", type: "INTEGER" },
  { name: "input_threshold_value_coverage_band", type: "VARCHAR" },
  { name: "input_threshold_direction", type: "VARCHAR" },
  { name: "input_threshold_direction_band", type: "VARCHAR" },
  { name: "input_has_condition", type: "BOOLEAN" },
  { name: "input_condition_length", type: "INTEGER" },
  { name: "input_condition_length_band", type: "VARCHAR" },
  { name: "input_has_condition_resolution_criteria", type: "BOOLEAN" },
  { name: "input_condition_resolution_criteria_length", type: "INTEGER" },
  { name: "input_condition_resolution_criteria_length_band", type: "VARCHAR" },
  { name: "input_condition_criteria_band", type: "VARCHAR" },
  { name: "input_has_unit", type: "BOOLEAN" },
  { name: "input_unit", type: "VARCHAR" },
  { name: "input_unit_specificity_band", type: "VARCHAR" },
  { name: "input_context_completeness", type: "INTEGER" },
  { name: "input_context_completeness_band", type: "VARCHAR" },
  { name: "run_workflow_version", type: "VARCHAR" },
  { name: "run_workflow_variant_id", type: "VARCHAR" },
  { name: "run_experiment_label", type: "VARCHAR" },
  { name: "run_duration_seconds", type: "INTEGER" },
  { name: "run_duration_band", type: "VARCHAR" },
  { name: "score_config_json", type: "VARCHAR" },
  { name: "created_at", type: "VARCHAR" },
] satisfies DuckColumn[];

const binaryCalibrationBucketColumns = [
  { name: "bucket_label", type: "VARCHAR" },
  { name: "min_probability", type: "INTEGER" },
  { name: "max_probability", type: "INTEGER" },
  { name: "sample_size", type: "INTEGER" },
  { name: "mean_forecast", type: "DOUBLE" },
  { name: "observed_rate", type: "DOUBLE" },
  { name: "mean_brier", type: "DOUBLE" },
  { name: "calibration_error", type: "DOUBLE" },
  { name: "diagnostic_severity", type: "VARCHAR" },
  { name: "diagnostic_direction", type: "VARCHAR" },
  { name: "candidate_guard_id", type: "VARCHAR" },
  { name: "candidate_guard_suggested_adjustment", type: "DOUBLE" },
  { name: "candidate_guard_activation_status", type: "VARCHAR" },
  { name: "resolved_forecast_count", type: "INTEGER" },
  { name: "minimum_for_fitting", type: "INTEGER" },
] satisfies DuckColumn[];

const calibrationGuardImpactColumns = [
  { name: "generated_at", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "guarded_rows", type: "INTEGER" },
  { name: "unguarded_rows", type: "INTEGER" },
  { name: "guarded_resolved_tasks", type: "INTEGER" },
  { name: "unguarded_resolved_tasks", type: "INTEGER" },
  { name: "guarded_mean_brier", type: "DOUBLE" },
  { name: "unguarded_mean_brier", type: "DOUBLE" },
  { name: "brier_delta", type: "DOUBLE" },
] satisfies DuckColumn[];

const calibrationGuardRuleImpactColumns = [
  { name: "generated_at", type: "VARCHAR" },
  { name: "rule_id", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "guarded_rows", type: "INTEGER" },
  { name: "unguarded_rows", type: "INTEGER" },
  { name: "guarded_resolved_tasks", type: "INTEGER" },
  { name: "unguarded_resolved_tasks", type: "INTEGER" },
  { name: "guarded_mean_brier", type: "DOUBLE" },
  { name: "unguarded_mean_brier", type: "DOUBLE" },
  { name: "brier_delta", type: "DOUBLE" },
] satisfies DuckColumn[];

const workflowChangeProposalColumns = [
  { name: "workflow_change_proposal_id", type: "VARCHAR" },
  { name: "source_benchmark_run_id", type: "VARCHAR" },
  { name: "target_workflow_id", type: "VARCHAR" },
  { name: "problem_statement", type: "VARCHAR" },
  { name: "evidence_case_ids_json", type: "VARCHAR" },
  { name: "proposed_change", type: "VARCHAR" },
  { name: "expected_metric_effect", type: "VARCHAR" },
  { name: "expected_cost_latency_effect", type: "VARCHAR" },
  { name: "overfit_risk", type: "VARCHAR" },
  { name: "validation_plan", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "review_note", type: "VARCHAR" },
  { name: "reviewed_by", type: "VARCHAR" },
  { name: "reviewed_at", type: "VARCHAR" },
  { name: "implementation_task_title", type: "VARCHAR" },
  { name: "implementation_status", type: "VARCHAR" },
  { name: "implementation_experiment_label", type: "VARCHAR" },
  { name: "implementation_note", type: "VARCHAR" },
  { name: "implementation_updated_by", type: "VARCHAR" },
  { name: "implementation_updated_at", type: "VARCHAR" },
  { name: "validation_benchmark_run_id", type: "VARCHAR" },
  { name: "validation_launched_by", type: "VARCHAR" },
  { name: "validation_launched_at", type: "VARCHAR" },
  { name: "validation_result_status", type: "VARCHAR" },
  { name: "validation_result_summary", type: "VARCHAR" },
  { name: "validation_mean_brier_delta", type: "DOUBLE" },
  { name: "validation_completed_cases", type: "INTEGER" },
  { name: "source_benchmark_case_count", type: "INTEGER" },
  { name: "validation_required_cases", type: "INTEGER" },
  { name: "validation_coverage_ratio", type: "DOUBLE" },
  { name: "validation_cost_total_tokens_delta", type: "DOUBLE" },
  { name: "validation_cost_agent_calls_delta", type: "DOUBLE" },
  { name: "validation_cost_mean_duration_seconds_delta", type: "DOUBLE" },
  { name: "validation_cost_summary", type: "VARCHAR" },
  { name: "validation_gate_status", type: "VARCHAR" },
  { name: "validation_gate_blockers_json", type: "VARCHAR" },
  { name: "validation_readiness_blockers_json", type: "VARCHAR" },
  { name: "validation_passed", type: "INTEGER" },
  { name: "validation_completed_at", type: "VARCHAR" },
  { name: "validation_comparison_report_artifact_id", type: "VARCHAR" },
  { name: "validation_recommendation_status", type: "VARCHAR" },
  { name: "validation_recommendation_summary", type: "VARCHAR" },
  { name: "validation_recommendation_paired_case_count", type: "INTEGER" },
  { name: "validation_recommendation_paired_holdout_case_count", type: "INTEGER" },
  { name: "validation_primary_baseline_benchmark_run_id", type: "VARCHAR" },
  { name: "validation_paired_case_count", type: "INTEGER" },
  { name: "validation_paired_mean_brier_delta", type: "DOUBLE" },
  { name: "validation_paired_mean_log_delta", type: "DOUBLE" },
  { name: "validation_paired_brier_ci_lower", type: "DOUBLE" },
  { name: "validation_paired_brier_ci_upper", type: "DOUBLE" },
  { name: "created_at", type: "VARCHAR" },
  { name: "updated_at", type: "VARCHAR" },
] satisfies DuckColumn[];

const sourceColumns = [
  { name: "source_id", type: "VARCHAR" },
  { name: "task_id", type: "VARCHAR" },
  { name: "url", type: "VARCHAR" },
  { name: "domain", type: "VARCHAR" },
  { name: "title", type: "VARCHAR" },
  { name: "content_summary", type: "VARCHAR" },
  { name: "source_type", type: "VARCHAR" },
  { name: "used_in_final", type: "BOOLEAN" },
  { name: "quality_score", type: "DOUBLE" },
  { name: "retrieved_at", type: "VARCHAR" },
  { name: "published_at", type: "VARCHAR" },
  { name: "created_at", type: "VARCHAR" },
] satisfies DuckColumn[];

const sourceDomainColumns = [
  { name: "domain", type: "VARCHAR" },
  { name: "entries", type: "INTEGER" },
  { name: "used_in_final_entries", type: "INTEGER" },
  { name: "task_count", type: "INTEGER" },
  { name: "source_types_json", type: "VARCHAR" },
  { name: "mean_quality_score", type: "DOUBLE" },
] satisfies DuckColumn[];

const calibrationGuardValidationColumns = [
  { name: "report_path", type: "VARCHAR" },
  { name: "generated_at", type: "VARCHAR" },
  { name: "validation_mode", type: "VARCHAR" },
  { name: "proposal_id", type: "VARCHAR" },
  { name: "source_candidate_guard_id", type: "VARCHAR" },
  { name: "bucket_label", type: "VARCHAR" },
  { name: "suggested_adjustment", type: "DOUBLE" },
  { name: "matched_rows", type: "INTEGER" },
  { name: "baseline_mean_brier", type: "DOUBLE" },
  { name: "candidate_mean_brier", type: "DOUBLE" },
  { name: "brier_delta", type: "DOUBLE" },
  { name: "baseline_calibration_error", type: "DOUBLE" },
  { name: "candidate_calibration_error", type: "DOUBLE" },
  { name: "calibration_error_delta", type: "DOUBLE" },
  { name: "recommendation", type: "VARCHAR" },
  { name: "proposals_path", type: "VARCHAR" },
  { name: "performance_report_path", type: "VARCHAR" },
] satisfies DuckColumn[];

const calibrationGuardDefaultPlanColumns = [
  { name: "report_path", type: "VARCHAR" },
  { name: "generated_at", type: "VARCHAR" },
  { name: "proposal_id", type: "VARCHAR" },
  { name: "source_candidate_guard_id", type: "VARCHAR" },
  { name: "bucket_label", type: "VARCHAR" },
  { name: "suggested_adjustment", type: "DOUBLE" },
  { name: "matched_rows", type: "INTEGER" },
  { name: "brier_delta", type: "DOUBLE" },
  { name: "calibration_error_delta", type: "DOUBLE" },
  { name: "target_workflow_id", type: "VARCHAR" },
  { name: "target_file", type: "VARCHAR" },
  { name: "implementation_status", type: "VARCHAR" },
  { name: "recommended_action", type: "VARCHAR" },
  { name: "acceptance_criteria_json", type: "VARCHAR" },
  { name: "validation_report_path", type: "VARCHAR" },
] satisfies DuckColumn[];

const calibrationGuardDefaultPlanSkippedColumns = [
  { name: "report_path", type: "VARCHAR" },
  { name: "generated_at", type: "VARCHAR" },
  { name: "proposal_id", type: "VARCHAR" },
  { name: "bucket_label", type: "VARCHAR" },
  { name: "recommendation", type: "VARCHAR" },
  { name: "validation_mode", type: "VARCHAR" },
  { name: "reason", type: "VARCHAR" },
  { name: "validation_report_path", type: "VARCHAR" },
] satisfies DuckColumn[];

const calibrationGuardDefaultPlanIssueColumns = [
  { name: "report_path", type: "VARCHAR" },
  { name: "generated_at", type: "VARCHAR" },
  { name: "severity", type: "VARCHAR" },
  { name: "kind", type: "VARCHAR" },
  { name: "message", type: "VARCHAR" },
  { name: "validation_report_path", type: "VARCHAR" },
  { name: "latest_validation_report_path", type: "VARCHAR" },
] satisfies DuckColumn[];

const forecastAttentionItemColumns = [
  { name: "report_path", type: "VARCHAR" },
  { name: "batch_id", type: "VARCHAR" },
  { name: "generated_at", type: "VARCHAR" },
  { name: "attention_item_id", type: "VARCHAR" },
  { name: "review_status", type: "VARCHAR" },
  { name: "severity", type: "VARCHAR" },
  { name: "kind", type: "VARCHAR" },
  { name: "metric", type: "VARCHAR" },
  { name: "score", type: "DOUBLE" },
  { name: "delta", type: "DOUBLE" },
  { name: "forecast_type", type: "VARCHAR" },
  { name: "task_id", type: "VARCHAR" },
  { name: "task_label", type: "VARCHAR" },
  { name: "reason", type: "VARCHAR" },
  { name: "recommended_actions_json", type: "VARCHAR" },
  { name: "review_note", type: "VARCHAR" },
  { name: "reviewer", type: "VARCHAR" },
  { name: "reviewed_at", type: "VARCHAR" },
  { name: "source_path", type: "VARCHAR" },
] satisfies DuckColumn[];

const forecastBatchHealthColumns = [
  { name: "report_path", type: "VARCHAR" },
  { name: "report_exists", type: "BOOLEAN" },
  { name: "report_markdown_path", type: "VARCHAR" },
  { name: "batch_index_path", type: "VARCHAR" },
  { name: "batch_index_dir", type: "VARCHAR" },
  { name: "attention_backlog_path", type: "VARCHAR" },
  { name: "attention_backlog_dir", type: "VARCHAR" },
  { name: "batch_id", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "generated_at", type: "VARCHAR" },
  { name: "entries", type: "INTEGER" },
  { name: "forecast_ops", type: "INTEGER" },
  { name: "resolutions", type: "INTEGER" },
  { name: "performance_reports", type: "INTEGER" },
  { name: "completed_forecasts", type: "INTEGER" },
  { name: "failed_forecasts", type: "INTEGER" },
  { name: "resolved_cases", type: "INTEGER" },
  { name: "failed_resolutions", type: "INTEGER" },
  { name: "performance_score_rows", type: "INTEGER" },
  { name: "attention_items", type: "INTEGER" },
  { name: "open_attention_items", type: "INTEGER" },
  { name: "deferred_attention_items", type: "INTEGER" },
  { name: "reviewed_attention_items", type: "INTEGER" },
  { name: "unresolved_attention_items", type: "INTEGER" },
  { name: "score_regression_items", type: "INTEGER" },
  { name: "calibration_guard_regression_items", type: "INTEGER" },
  { name: "candidate_calibration_guard_rules", type: "INTEGER" },
  { name: "open_candidate_calibration_guard_rules", type: "INTEGER" },
  { name: "deferred_candidate_calibration_guard_rules", type: "INTEGER" },
  { name: "reviewed_candidate_calibration_guard_rules", type: "INTEGER" },
  { name: "unresolved_candidate_calibration_guard_rules", type: "INTEGER" },
  { name: "missing_phase_count", type: "INTEGER" },
  { name: "issue_count", type: "INTEGER" },
  { name: "missing_phases_json", type: "VARCHAR" },
] satisfies DuckColumn[];

const forecastBatchHealthIssueColumns = [
  { name: "report_path", type: "VARCHAR" },
  { name: "batch_id", type: "VARCHAR" },
  { name: "generated_at", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "severity", type: "VARCHAR" },
  { name: "kind", type: "VARCHAR" },
  { name: "message", type: "VARCHAR" },
] satisfies DuckColumn[];

const forecastBatchHealthAttentionItemColumns = [
  { name: "report_path", type: "VARCHAR" },
  { name: "batch_id", type: "VARCHAR" },
  { name: "generated_at", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "attention_item_id", type: "VARCHAR" },
  { name: "review_status", type: "VARCHAR" },
  { name: "severity", type: "VARCHAR" },
  { name: "kind", type: "VARCHAR" },
  { name: "metric", type: "VARCHAR" },
  { name: "score", type: "DOUBLE" },
  { name: "delta", type: "DOUBLE" },
  { name: "forecast_type", type: "VARCHAR" },
  { name: "task_id", type: "VARCHAR" },
  { name: "task_label", type: "VARCHAR" },
  { name: "reason", type: "VARCHAR" },
  { name: "recommended_action", type: "VARCHAR" },
  { name: "review_note", type: "VARCHAR" },
  { name: "reviewer", type: "VARCHAR" },
  { name: "reviewed_at", type: "VARCHAR" },
  { name: "source_path", type: "VARCHAR" },
] satisfies DuckColumn[];

const forecastBatchHealthAttentionKindColumns = [
  { name: "report_path", type: "VARCHAR" },
  { name: "batch_id", type: "VARCHAR" },
  { name: "generated_at", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "kind", type: "VARCHAR" },
  { name: "items", type: "INTEGER" },
  { name: "open_items", type: "INTEGER" },
  { name: "deferred_items", type: "INTEGER" },
  { name: "reviewed_items", type: "INTEGER" },
  { name: "unresolved_items", type: "INTEGER" },
  { name: "high_items", type: "INTEGER" },
  { name: "medium_items", type: "INTEGER" },
  { name: "low_items", type: "INTEGER" },
] satisfies DuckColumn[];

const forecastBatchHealthAttentionSeverityColumns = [
  { name: "report_path", type: "VARCHAR" },
  { name: "batch_id", type: "VARCHAR" },
  { name: "generated_at", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "severity", type: "VARCHAR" },
  { name: "items", type: "INTEGER" },
  { name: "open_items", type: "INTEGER" },
  { name: "deferred_items", type: "INTEGER" },
  { name: "reviewed_items", type: "INTEGER" },
  { name: "unresolved_items", type: "INTEGER" },
] satisfies DuckColumn[];

const forecastBatchHealthAttentionTypeColumns = [
  { name: "report_path", type: "VARCHAR" },
  { name: "batch_id", type: "VARCHAR" },
  { name: "generated_at", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "forecast_type", type: "VARCHAR" },
  { name: "items", type: "INTEGER" },
  { name: "open_items", type: "INTEGER" },
  { name: "deferred_items", type: "INTEGER" },
  { name: "reviewed_items", type: "INTEGER" },
  { name: "unresolved_items", type: "INTEGER" },
  { name: "high_items", type: "INTEGER" },
  { name: "medium_items", type: "INTEGER" },
  { name: "low_items", type: "INTEGER" },
] satisfies DuckColumn[];

const forecastBatchHealthCandidateGuardColumns = [
  { name: "report_path", type: "VARCHAR" },
  { name: "batch_id", type: "VARCHAR" },
  { name: "generated_at", type: "VARCHAR" },
  { name: "status", type: "VARCHAR" },
  { name: "rule_id", type: "VARCHAR" },
  { name: "review_status", type: "VARCHAR" },
  { name: "bucket_label", type: "VARCHAR" },
  { name: "direction", type: "VARCHAR" },
  { name: "suggested_adjustment", type: "DOUBLE" },
  { name: "sample_size", type: "INTEGER" },
  { name: "mean_forecast", type: "DOUBLE" },
  { name: "observed_rate", type: "DOUBLE" },
  { name: "calibration_error", type: "DOUBLE" },
  { name: "activation_status", type: "VARCHAR" },
  { name: "rationale", type: "VARCHAR" },
  { name: "review_note", type: "VARCHAR" },
  { name: "reviewer", type: "VARCHAR" },
  { name: "reviewed_at", type: "VARCHAR" },
] satisfies DuckColumn[];

type TaskMartRow = RowFor<typeof taskColumns>;
type SmithersTokenUsageMartRow = RowFor<typeof smithersTokenUsageColumns>;
type SmithersTokenUsageByTaskMartRow = RowFor<typeof smithersTokenUsageByTaskColumns>;
type ArtifactRowMartRow = RowFor<typeof artifactRowColumns>;
type BenchmarkRunMartRow = RowFor<typeof benchmarkRunColumns>;
type BenchmarkCostStatusMartRow = RowFor<typeof benchmarkCostStatusColumns>;
type BenchmarkCostOutlierMartRow = RowFor<typeof benchmarkCostOutlierColumns>;
type BenchmarkCaseMartRow = RowFor<typeof benchmarkCaseColumns>;
type ForecastScoreMartRow = RowFor<typeof forecastScoreColumns>;
type BinaryCalibrationBucketMartRow = RowFor<typeof binaryCalibrationBucketColumns>;
type CalibrationGuardImpactMartRow = RowFor<typeof calibrationGuardImpactColumns>;
type CalibrationGuardRuleImpactMartRow = RowFor<typeof calibrationGuardRuleImpactColumns>;
type WorkflowChangeProposalMartRow = RowFor<typeof workflowChangeProposalColumns>;
type SourceMartRow = RowFor<typeof sourceColumns>;
type SourceDomainMartRow = RowFor<typeof sourceDomainColumns>;
type CalibrationGuardValidationMartRow = RowFor<typeof calibrationGuardValidationColumns>;
type CalibrationGuardDefaultPlanMartRow = RowFor<typeof calibrationGuardDefaultPlanColumns>;
type CalibrationGuardDefaultPlanSkippedMartRow = RowFor<typeof calibrationGuardDefaultPlanSkippedColumns>;
type CalibrationGuardDefaultPlanIssueMartRow = RowFor<typeof calibrationGuardDefaultPlanIssueColumns>;
type ForecastAttentionItemMartRow = RowFor<typeof forecastAttentionItemColumns>;
type ForecastBatchHealthMartRow = RowFor<typeof forecastBatchHealthColumns>;
type ForecastBatchHealthIssueMartRow = RowFor<typeof forecastBatchHealthIssueColumns>;
type ForecastBatchHealthAttentionItemMartRow = RowFor<typeof forecastBatchHealthAttentionItemColumns>;
type ForecastBatchHealthAttentionKindMartRow = RowFor<typeof forecastBatchHealthAttentionKindColumns>;
type ForecastBatchHealthAttentionSeverityMartRow = RowFor<typeof forecastBatchHealthAttentionSeverityColumns>;
type ForecastBatchHealthAttentionTypeMartRow = RowFor<typeof forecastBatchHealthAttentionTypeColumns>;
type ForecastBatchHealthCandidateGuardMartRow = RowFor<typeof forecastBatchHealthCandidateGuardColumns>;
type RowFor<T extends readonly DuckColumn[]> = Record<T[number]["name"], unknown>;

async function syncMetadata(duck: DuckDBConnection) {
  await duck.run("create or replace table osf_sync_metadata(synced_at varchar, duckdb_path varchar, schema_version integer)");
  const appender = await duck.createAppender("osf_sync_metadata");
  appender.appendVarchar(new Date().toISOString());
  appender.appendVarchar(config.DUCKDB_PATH);
  appender.appendInteger(1);
  appender.endRow();
  appender.closeSync();
}

async function replaceTable<T extends DuckRow>(duck: DuckDBConnection, tableName: string, columns: readonly DuckColumn[], rows: T[]) {
  await duck.run(`create or replace table ${tableName}(${columns.map((column) => `${column.name} ${column.type}`).join(", ")})`);
  if (rows.length === 0) {
    return;
  }
  const appender = await duck.createAppender(tableName);
  for (const row of rows) {
    for (const column of columns) {
      appendValue(appender, column, row[column.name]);
    }
    appender.endRow();
  }
  appender.closeSync();
}

function appendValue(
  appender: DuckDBAppender,
  column: DuckColumn,
  value: unknown,
) {
  if (value === null || value === undefined) {
    appender.appendNull();
    return;
  }
  if (column.type === "INTEGER") {
    appender.appendInteger(Number(value));
    return;
  }
  if (column.type === "DOUBLE") {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) {
      appender.appendDouble(numberValue);
    } else {
      appender.appendNull();
    }
    return;
  }
  if (column.type === "BOOLEAN") {
    appender.appendBoolean(Boolean(value));
    return;
  }
  appender.appendVarchar(String(value));
}

function buildBinaryCalibrationBucketMartRows(forecastScores: ForecastScoreMartRow[]): BinaryCalibrationBucketMartRow[] {
  const productBrierScores = forecastScores.filter((score) => {
    const config = parseJsonRecord(score.score_config_json);
    return score.score_type === "brier" &&
      Boolean(score.forecast_aggregate_id) &&
      score.source === "manual_resolution" &&
      Boolean(readString(config, "taskId")) &&
      !readString(config, "benchmarkRunId");
  });
  const resolvedForecastCount = new Set(
    forecastScores
      .filter((score) => {
        const config = parseJsonRecord(score.score_config_json);
        return score.source === "manual_resolution" &&
          Boolean(readString(config, "taskId")) &&
          !readString(config, "benchmarkRunId") &&
          Boolean(score.resolution_id);
      })
      .map((score) => String(score.resolution_id)),
  ).size;
  const report = buildBinaryCalibrationReport(productBrierScores.map(scoreToCalibrationInput), resolvedForecastCount);
  return report.calibrationBuckets.map((bucket) => {
    const diagnostic = report.calibrationDiagnostics.find((item) => item.bucketLabel === bucket.label);
    const candidateGuard = report.candidateCalibrationGuardRules.find((item) => item.bucketLabel === bucket.label);
    return {
      bucket_label: bucket.label,
      min_probability: bucket.minProbability,
      max_probability: bucket.maxProbability,
      sample_size: bucket.count,
      mean_forecast: bucket.meanForecast,
      observed_rate: bucket.observedRate,
      mean_brier: bucket.meanBrier,
      calibration_error: bucket.calibrationError,
      diagnostic_severity: diagnostic?.severity ?? null,
      diagnostic_direction: diagnostic?.direction ?? null,
      candidate_guard_id: candidateGuard?.id ?? null,
      candidate_guard_suggested_adjustment: candidateGuard?.suggestedAdjustment ?? null,
      candidate_guard_activation_status: candidateGuard?.activationStatus ?? null,
      resolved_forecast_count: report.calibrationSummary.resolvedForecastCount,
      minimum_for_fitting: report.calibrationSummary.minimumForFitting,
    };
  });
}

function buildCalibrationGuardImpactMartRow(
  forecastScores: ForecastScoreMartRow[],
  generatedAt: string,
): CalibrationGuardImpactMartRow {
  const impact = buildCalibrationGuardImpact(calibrationGuardImpactInputs(forecastScores));
  return {
    generated_at: generatedAt,
    status: impact.status,
    guarded_rows: impact.guardedRows,
    unguarded_rows: impact.unguardedRows,
    guarded_resolved_tasks: impact.guardedResolvedTasks,
    unguarded_resolved_tasks: impact.unguardedResolvedTasks,
    guarded_mean_brier: impact.guardedMeanBrier,
    unguarded_mean_brier: impact.unguardedMeanBrier,
    brier_delta: impact.brierDelta,
  };
}

function buildCalibrationGuardRuleImpactMartRows(
  forecastScores: ForecastScoreMartRow[],
  generatedAt: string,
): CalibrationGuardRuleImpactMartRow[] {
  return buildCalibrationGuardImpact(calibrationGuardImpactInputs(forecastScores)).byRule.map((impact) => ({
    generated_at: generatedAt,
    rule_id: impact.ruleId,
    status: impact.status,
    guarded_rows: impact.guardedRows,
    unguarded_rows: impact.unguardedRows,
    guarded_resolved_tasks: impact.guardedResolvedTasks,
    unguarded_resolved_tasks: impact.unguardedResolvedTasks,
    guarded_mean_brier: impact.guardedMeanBrier,
    unguarded_mean_brier: impact.unguardedMeanBrier,
    brier_delta: impact.brierDelta,
  }));
}

function calibrationGuardImpactInputs(forecastScores: ForecastScoreMartRow[]) {
  const productAggregateBrierScores = forecastScores.filter((score) =>
    score.score_type === "brier" &&
    Boolean(score.forecast_aggregate_id) &&
    score.source === "manual_resolution" &&
    Boolean(score.task_id)
  );
  return productAggregateBrierScores.flatMap((score) => {
    if (typeof score.score_value !== "number" || !Number.isFinite(score.score_value)) {
      return [];
    }
    return [{
      score: score.score_value,
      taskId: typeof score.task_id === "string" ? score.task_id : null,
      calibrationGuard: readCalibrationGuardSnapshot(parseJsonRecord(score.score_config_json)),
    }];
  });
}

function scoreToCalibrationInput(score: ForecastScoreMartRow): BinaryCalibrationInput {
  const config = parseJsonRecord(score.score_config_json);
  return {
    probability: readNumber(config, "probability") ?? readNumber(config, "probability_pct") ?? readNumber(config, "probabilityPct"),
    resolved: readBoolean(config, "resolved"),
    score: typeof score.score_value === "number" && Number.isFinite(score.score_value) ? score.score_value : null,
  };
}

function buildSourceDomainMartRows(sources: SourceMartRow[]): SourceDomainMartRow[] {
  return summarizeSourceDomains(sources).map((row) => ({
    domain: row.domain,
    entries: row.entries,
    used_in_final_entries: row.usedInFinalEntries,
    task_count: row.taskCount,
    source_types_json: JSON.stringify(row.sourceTypes),
    mean_quality_score: row.meanQualityScore,
  }));
}

async function buildSmithersTokenUsageMarts(tasks: TaskMartRow[]): Promise<{
  usageRows: SmithersTokenUsageMartRow[];
  summaryRows: SmithersTokenUsageByTaskMartRow[];
}> {
  const entries = await Promise.all(
    tasks.map(async (task) => {
      const runId = readTaskString(task, "smithers_run_id");
      if (!runId) {
        return null;
      }
      return {
        task,
        runId,
        usage: await readSmithersTokenUsage(root, runId),
      };
    }),
  );

  const usageRows: SmithersTokenUsageMartRow[] = [];
  const summaryRows: SmithersTokenUsageByTaskMartRow[] = [];
  for (const entry of entries) {
    if (!entry || entry.usage.length === 0) {
      continue;
    }
    const taskLabels = smithersTaskLabels(entry.task, entry.runId);
    for (const usage of entry.usage) {
      usageRows.push({
        ...taskLabels,
        node_id: usage.nodeId,
        iteration: usage.iteration,
        attempt: usage.attempt,
        model: usage.model,
        usage_source: usage.source,
        input_tokens: usage.inputTokens,
        cached_input_tokens: usage.cachedInputTokens,
        output_tokens: usage.outputTokens,
        reasoning_output_tokens: usage.reasoningOutputTokens,
        total_tokens: usage.totalTokens,
        timestamp_ms: usage.timestampMs,
      });
    }
    const summary = summarizeSmithersTokenUsage(entry.usage);
    summaryRows.push({
      ...taskLabels,
      agent_calls: summary.calls,
      input_tokens: summary.inputTokens,
      cached_input_tokens: summary.cachedInputTokens,
      output_tokens: summary.outputTokens,
      reasoning_output_tokens: summary.reasoningOutputTokens,
      total_tokens: summary.totalTokens,
    });
  }
  return { usageRows, summaryRows };
}

function smithersTaskLabels(task: TaskMartRow, runId: string) {
  return {
    task_id: readTaskString(task, "task_id"),
    smithers_run_id: runId,
    operation_mode: readTaskString(task, "operation_mode"),
    operation_submode: readTaskString(task, "operation_submode"),
    status: readTaskString(task, "status"),
    benchmark_run_id: readTaskString(task, "benchmark_run_id"),
    workflow_variant_id: readTaskString(task, "workflow_variant_id"),
    experiment_label: readTaskString(task, "experiment_label"),
  };
}

function readTaskString(task: TaskMartRow, key: keyof TaskMartRow) {
  const value = task[key];
  return typeof value === "string" && value.trim() ? value : null;
}

async function readCalibrationGuardValidationRows(reportRoot: string): Promise<CalibrationGuardValidationMartRow[]> {
  const reports = await readCalibrationGuardValidationArtifacts(root, { reportRoot });
  const rows: CalibrationGuardValidationMartRow[] = [];
  for (const report of reports) {
    for (const validation of report.validations) {
      rows.push({
        report_path: report.reportPath,
        generated_at: report.generatedAt,
        validation_mode: validation.validationMode,
        proposal_id: validation.proposalId,
        source_candidate_guard_id: validation.sourceCandidateGuardId,
        bucket_label: validation.bucketLabel,
        suggested_adjustment: validation.suggestedAdjustment,
        matched_rows: validation.matchedRows,
        baseline_mean_brier: validation.baselineMeanBrier,
        candidate_mean_brier: validation.candidateMeanBrier,
        brier_delta: validation.brierDelta,
        baseline_calibration_error: validation.baselineCalibrationError,
        candidate_calibration_error: validation.candidateCalibrationError,
        calibration_error_delta: validation.calibrationErrorDelta,
        recommendation: validation.recommendation,
        proposals_path: report.paths.proposals,
        performance_report_path: report.paths.performanceReport,
      });
    }
  }
  return rows.sort((left, right) =>
    String(left.generated_at ?? "").localeCompare(String(right.generated_at ?? ""))
    || String(left.proposal_id ?? "").localeCompare(String(right.proposal_id ?? ""))
    || String(left.report_path ?? "").localeCompare(String(right.report_path ?? ""))
  );
}

async function readCalibrationGuardDefaultPlanRows(root: string): Promise<{
  candidateRows: CalibrationGuardDefaultPlanMartRow[];
  skippedRows: CalibrationGuardDefaultPlanSkippedMartRow[];
  issueRows: CalibrationGuardDefaultPlanIssueMartRow[];
}> {
  const reports = await readCalibrationDefaultPlanArtifacts(root);
  const candidateRows: CalibrationGuardDefaultPlanMartRow[] = [];
  const skippedRows: CalibrationGuardDefaultPlanSkippedMartRow[] = [];
  const issueRows: CalibrationGuardDefaultPlanIssueMartRow[] = [];
  for (const report of reports) {
    for (const candidate of report.defaultCandidates) {
      candidateRows.push({
        report_path: report.reportPath,
        generated_at: report.generatedAt,
        proposal_id: candidate.proposalId,
        source_candidate_guard_id: candidate.sourceCandidateGuardId,
        bucket_label: candidate.bucketLabel,
        suggested_adjustment: candidate.suggestedAdjustment,
        matched_rows: candidate.matchedRows,
        brier_delta: candidate.brierDelta,
        calibration_error_delta: candidate.calibrationErrorDelta,
        target_workflow_id: candidate.targetWorkflowId,
        target_file: candidate.targetFile,
        implementation_status: candidate.implementationStatus,
        recommended_action: candidate.recommendedAction,
        acceptance_criteria_json: JSON.stringify(candidate.acceptanceCriteria),
        validation_report_path: report.paths.validationReport,
      });
    }
    for (const skipped of report.skippedRows) {
      skippedRows.push({
        report_path: report.reportPath,
        generated_at: report.generatedAt,
        proposal_id: skipped.proposalId,
        bucket_label: skipped.bucketLabel,
        recommendation: skipped.recommendation,
        validation_mode: skipped.validationMode,
        reason: skipped.reason,
        validation_report_path: report.paths.validationReport,
      });
    }
    for (const issue of report.issues) {
      issueRows.push({
        report_path: report.reportPath,
        generated_at: report.generatedAt,
        severity: issue.severity,
        kind: issue.kind,
        message: issue.message,
        validation_report_path: issue.validationReport,
        latest_validation_report_path: issue.latestValidationReport,
      });
    }
  }
  const sortRows = <T extends CalibrationGuardDefaultPlanMartRow | CalibrationGuardDefaultPlanSkippedMartRow | CalibrationGuardDefaultPlanIssueMartRow>(rows: T[]) => rows.sort((left, right) =>
    String(left.generated_at ?? "").localeCompare(String(right.generated_at ?? ""))
    || String("proposal_id" in left ? left.proposal_id ?? "" : left.kind ?? "").localeCompare(String("proposal_id" in right ? right.proposal_id ?? "" : right.kind ?? ""))
    || String(left.report_path ?? "").localeCompare(String(right.report_path ?? ""))
  );
  return {
    candidateRows: sortRows(candidateRows),
    skippedRows: sortRows(skippedRows),
    issueRows: sortRows(issueRows),
  };
}

async function readForecastAttentionItemRows(root: string): Promise<ForecastAttentionItemMartRow[]> {
  const rowsByKey = new Map<string, ForecastAttentionItemMartRow>();
  for (const report of await readForecastBatchIndexArtifacts(root)) {
    for (const item of report.attentionItems) {
      const attentionItemId = item.id;
      if (!attentionItemId) {
        continue;
      }
      const key = `${report.batchId}:${attentionItemId}`;
      rowsByKey.set(key, {
        report_path: report.reportPath,
        batch_id: report.batchId,
        generated_at: report.generatedAt,
        attention_item_id: attentionItemId,
        review_status: item.reviewStatus,
        severity: item.severity,
        kind: item.kind,
        metric: item.metric,
        score: item.score,
        delta: item.delta,
        forecast_type: item.forecastType,
        task_id: item.taskId,
        task_label: item.taskLabel,
        reason: item.reason,
        recommended_actions_json: JSON.stringify(item.recommendedActions),
        review_note: item.reviewNote,
        reviewer: item.reviewer,
        reviewed_at: item.reviewedAt,
        source_path: report.reportPath,
      });
    }
  }
  for (const report of await readForecastAttentionBacklogArtifacts(root)) {
    if (!(await isExportCompatibleAttentionBacklogArtifact(root, report))) {
      continue;
    }
    for (const item of report.items) {
      const batchId = item.batchId;
      const attentionItemId = item.id;
      if (!batchId || !attentionItemId) {
        continue;
      }
      const key = `${batchId}:${attentionItemId}`;
      rowsByKey.set(key, {
        report_path: report.reportPath,
        batch_id: batchId,
        generated_at: report.generatedAt,
        attention_item_id: attentionItemId,
        review_status: item.reviewStatus,
        severity: item.severity,
        kind: item.kind,
        metric: item.metric,
        score: item.score,
        delta: item.delta,
        forecast_type: item.forecastType,
        task_id: item.taskId,
        task_label: item.taskLabel,
        reason: item.reason,
        recommended_actions_json: JSON.stringify(item.recommendedActions),
        review_note: item.reviewNote,
        reviewer: item.reviewer,
        reviewed_at: item.reviewedAt,
        source_path: item.sourcePath ?? report.reportPath,
      });
    }
  }
  return [...rowsByKey.values()].sort((left, right) =>
    String(left.generated_at ?? "").localeCompare(String(right.generated_at ?? ""))
    || String(left.batch_id ?? "").localeCompare(String(right.batch_id ?? ""))
    || String(left.attention_item_id ?? "").localeCompare(String(right.attention_item_id ?? ""))
    || String(left.report_path ?? "").localeCompare(String(right.report_path ?? ""))
  );
}

function buildForecastBatchHealthMartRows(health: ForecastBatchHealthSnapshot): ForecastBatchHealthMartRow[] {
  return [{
    report_path: health.path,
    report_exists: health.exists,
    report_markdown_path: health.paths.markdown,
    batch_index_path: health.paths.batchIndex,
    batch_index_dir: health.paths.batchIndexDir,
    attention_backlog_path: health.paths.attentionBacklog,
    attention_backlog_dir: health.paths.attentionBacklogDir,
    batch_id: health.batchId,
    status: health.status,
    generated_at: health.generatedAt,
    entries: health.summary.entries,
    forecast_ops: health.summary.forecastOps,
    resolutions: health.summary.resolutions,
    performance_reports: health.summary.performanceReports,
    completed_forecasts: health.summary.completedForecasts,
    failed_forecasts: health.summary.failedForecasts,
    resolved_cases: health.summary.resolvedCases,
    failed_resolutions: health.summary.failedResolutions,
    performance_score_rows: health.summary.performanceScoreRows,
    attention_items: health.summary.attentionItems,
    open_attention_items: health.summary.openAttentionItems,
    deferred_attention_items: health.summary.deferredAttentionItems,
    reviewed_attention_items: health.summary.reviewedAttentionItems,
    unresolved_attention_items: health.summary.unresolvedAttentionItems,
    score_regression_items: health.summary.scoreRegressionItems,
    calibration_guard_regression_items: health.summary.calibrationGuardRegressionItems,
    candidate_calibration_guard_rules: health.summary.candidateCalibrationGuardRules,
    open_candidate_calibration_guard_rules: health.summary.openCandidateCalibrationGuardRules,
    deferred_candidate_calibration_guard_rules: health.summary.deferredCandidateCalibrationGuardRules,
    reviewed_candidate_calibration_guard_rules: health.summary.reviewedCandidateCalibrationGuardRules,
    unresolved_candidate_calibration_guard_rules: health.summary.unresolvedCandidateCalibrationGuardRules,
    missing_phase_count: health.missingPhases.length,
    issue_count: health.issues.length,
    missing_phases_json: JSON.stringify(health.missingPhases),
  }];
}

function buildForecastBatchHealthIssueMartRows(health: ForecastBatchHealthSnapshot): ForecastBatchHealthIssueMartRow[] {
  return health.issues.map((issue) => ({
    report_path: health.path,
    batch_id: health.batchId,
    generated_at: health.generatedAt,
    status: health.status,
    severity: issue.severity,
    kind: issue.kind,
    message: issue.message,
  }));
}

function buildForecastBatchHealthAttentionItemMartRows(health: ForecastBatchHealthSnapshot): ForecastBatchHealthAttentionItemMartRow[] {
  return health.attentionItems.map((item) => ({
    report_path: health.path,
    batch_id: health.batchId,
    generated_at: health.generatedAt,
    status: health.status,
    attention_item_id: item.id,
    review_status: item.reviewStatus,
    severity: item.severity,
    kind: item.kind,
    metric: item.metric,
    score: item.score,
    delta: item.delta,
    forecast_type: item.forecastType,
    task_id: item.taskId,
    task_label: item.taskLabel,
    reason: item.reason,
    recommended_action: item.recommendedAction,
    review_note: item.reviewNote,
    reviewer: item.reviewer,
    reviewed_at: item.reviewedAt,
    source_path: item.sourcePath,
  }));
}

function buildForecastBatchHealthAttentionKindMartRows(health: ForecastBatchHealthSnapshot): ForecastBatchHealthAttentionKindMartRow[] {
  return health.attentionByKind.map((row) => ({
    report_path: health.path,
    batch_id: health.batchId,
    generated_at: health.generatedAt,
    status: health.status,
    kind: row.kind,
    items: row.items,
    open_items: row.open,
    deferred_items: row.deferred,
    reviewed_items: row.reviewed,
    unresolved_items: (row.open ?? 0) + (row.deferred ?? 0),
    high_items: row.high,
    medium_items: row.medium,
    low_items: row.low,
  }));
}

function buildForecastBatchHealthAttentionSeverityMartRows(health: ForecastBatchHealthSnapshot): ForecastBatchHealthAttentionSeverityMartRow[] {
  return health.attentionBySeverity.map((row) => ({
    report_path: health.path,
    batch_id: health.batchId,
    generated_at: health.generatedAt,
    status: health.status,
    severity: row.severity,
    items: row.items,
    open_items: row.open,
    deferred_items: row.deferred,
    reviewed_items: row.reviewed,
    unresolved_items: (row.open ?? 0) + (row.deferred ?? 0),
  }));
}

function buildForecastBatchHealthAttentionTypeMartRows(health: ForecastBatchHealthSnapshot): ForecastBatchHealthAttentionTypeMartRow[] {
  return health.attentionByForecastType.map((row) => ({
    report_path: health.path,
    batch_id: health.batchId,
    generated_at: health.generatedAt,
    status: health.status,
    forecast_type: row.forecastType,
    items: row.items,
    open_items: row.open,
    deferred_items: row.deferred,
    reviewed_items: row.reviewed,
    unresolved_items: (row.open ?? 0) + (row.deferred ?? 0),
    high_items: row.high,
    medium_items: row.medium,
    low_items: row.low,
  }));
}

function buildForecastBatchHealthCandidateGuardMartRows(health: ForecastBatchHealthSnapshot): ForecastBatchHealthCandidateGuardMartRow[] {
  return health.candidateCalibrationGuardRules.map((rule) => ({
    report_path: health.path,
    batch_id: health.batchId,
    generated_at: health.generatedAt,
    status: health.status,
    rule_id: rule.id,
    review_status: rule.reviewStatus,
    bucket_label: rule.bucketLabel,
    direction: rule.direction,
    suggested_adjustment: rule.suggestedAdjustment,
    sample_size: rule.sampleSize,
    mean_forecast: rule.meanForecast,
    observed_rate: rule.observedRate,
    calibration_error: rule.calibrationError,
    activation_status: rule.activationStatus,
    rationale: rule.rationale,
    review_note: rule.reviewNote,
    reviewer: rule.reviewer,
    reviewed_at: rule.reviewedAt,
  }));
}

function readNumber(value: unknown, key: string) {
  const raw = readRecord(value)?.[key];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readBoolean(value: unknown, key: string) {
  const raw = readRecord(value)?.[key];
  if (typeof raw === "boolean") {
    return raw;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  return null;
}

function parseJsonRecord(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return readRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

await main();
