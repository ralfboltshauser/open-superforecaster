import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DuckDBInstance, type DuckDBAppender, type DuckDBConnection } from "@duckdb/node-api";
import postgres from "postgres";
import { buildBinaryCalibrationReport, type BinaryCalibrationInput } from "../packages/backend/src/performance-calibration";
import { loadAppConfig } from "../packages/config/src/index";
import { listFilesNamed, readJson, readRecord, readString, type JsonRecord } from "./lib/forecast-script-utils";

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
      gate.weak_trace_completeness_cases,
      gate.missing_probability_cases,
      gate.missing_score_rows_cases,
      gate.missing_aggregate_rationale_cases,
      gate.promotion_gate_status,
      gate.promotion_gate_blockers,
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
          coalesce(nullif(ar.row_json #>> '{splitFindings,requiredHoldoutCaseResults}', '')::integer, 10) as required_holdout_case_results,
          coalesce(nullif(ar.row_json #>> '{splitFindings,unspecifiedCaseResults}', '')::integer, 0) as unspecified_case_results,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,sourceLeakageCases}', '')::integer, 0) as source_leakage_cases,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,informationAdvantageCases}', '')::integer, 0) as information_advantage_cases,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,postCutoffSourceCases}', '')::integer, 0) as post_cutoff_source_cases,
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,humanForecastSourceCases}', '')::integer, 0) as human_forecast_source_cases,
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
            case when br.status::text in ('running', 'queued') then 'benchmark_still_running' end,
            case when counts.result_count < 10 then 'too_few_cases_for_promotion' end,
            case when counts.trace_missing_count > 0 then 'missing_trace_bundles' end,
            case when counts.review_or_failed_count > 0 then 'failed_or_review_cases_present' end,
            case when cr.row_json #>> '{recommendation,status}' is null then 'missing_comparison_report' end,
            case when cr.row_json #>> '{recommendation,status}' is not null and cr.row_json #>> '{recommendation,status}' <> 'candidate_better' then 'comparison_' || (cr.row_json #>> '{recommendation,status}') end,
            case when findings.missing_baseline_sanity_cases > 0 then 'missing_baseline_sanity' end,
            case when findings.unexplained_component_disagreement_cases > 0 then 'unexplained_component_disagreement' end,
            case when findings.large_probability_miss_cases > 0 then 'large_probability_misses' end,
            case when findings.worse_than_baseline_cases > 0 then 'worse_than_baseline_cases' end,
            case when findings.holdout_case_results < findings.required_holdout_case_results then 'insufficient_holdout_evidence' end,
            case when findings.source_leakage_cases > 0 or findings.post_cutoff_source_cases > 0 then 'source_cutoff_leakage' end,
            case when findings.information_advantage_cases > 0 or findings.human_forecast_source_cases > 0 then 'human_forecast_leakage' end,
            case when findings.weak_trace_completeness_cases > 0 then 'weak_trace_completeness' end,
            case when findings.missing_probability_cases > 0 or findings.missing_score_rows_cases > 0 then 'schema_or_scoring_failures' end,
            case when findings.missing_aggregate_rationale_cases > 0 then 'missing_aggregate_rationale' end
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
        weak_trace_completeness_cases,
        missing_probability_cases,
        missing_score_rows_cases,
        missing_aggregate_rationale_cases,
        case when cardinality(blocker_values) = 0 then 'review_for_promotion' else 'needs_more_evidence' end as promotion_gate_status,
        array_to_string(blocker_values, ',') as promotion_gate_blockers
      from blockers
    ) gate on true
    order by br.created_at
  `;
  await replaceTable(duck, "osf_benchmark_runs", benchmarkRunColumns, benchmarkRuns);

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
      nullif(fs.score_config #>> '{resolved}', '')::boolean as resolved,
      nullif(fs.score_config #>> '{calibrationGuard,adjustment}', '')::double precision as calibration_guard_adjustment,
      (fs.score_config #> '{calibrationGuard,appliedRules}')::text as calibration_guard_rules_json,
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
      wcp.validation_gate_status,
      wcp.validation_gate_blockers::text as validation_gate_blockers_json,
      wcp.validation_completed_at::text as validation_completed_at,
      vbr.comparison_report_artifact_id::text as validation_comparison_report_artifact_id,
      vcr.row_json #>> '{recommendation,status}' as validation_recommendation_status,
      vcr.row_json #>> '{recommendation,summary}' as validation_recommendation_summary,
      validation_primary_baseline.row_json #>> '{baselineBenchmarkRunId}' as validation_primary_baseline_benchmark_run_id,
      nullif(validation_primary_baseline.row_json #>> '{pairedCaseCount}', '')::integer as validation_paired_case_count,
      nullif(validation_primary_baseline.row_json #>> '{pairedMeanBrierDelta}', '')::double precision as validation_paired_mean_brier_delta,
      nullif(validation_primary_baseline.row_json #>> '{pairedMeanLogDelta}', '')::double precision as validation_paired_mean_log_delta,
      nullif(validation_primary_baseline.row_json #>> '{pairedUncertainty,brierDelta,lower}', '')::double precision as validation_paired_brier_ci_lower,
      nullif(validation_primary_baseline.row_json #>> '{pairedUncertainty,brierDelta,upper}', '')::double precision as validation_paired_brier_ci_upper,
      wcp.created_at::text as created_at,
      wcp.updated_at::text as updated_at
    from workflow_change_proposals wcp
    left join benchmark_runs vbr on vbr.id = wcp.validation_benchmark_run_id
    left join artifact_rows vcr on vcr.artifact_id = vbr.comparison_report_artifact_id and vcr.row_index = 0
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

  const calibrationGuardValidations = await readCalibrationGuardValidationRows(resolve(root, "data/reports/forecast-calibration-guard-validation"));
  await replaceTable(duck, "osf_calibration_guard_validations", calibrationGuardValidationColumns, calibrationGuardValidations);
  const calibrationGuardDefaultPlanCandidates = await readCalibrationGuardDefaultPlanRows(resolve(root, "data/reports/forecast-calibration-guard-default-plan"));
  await replaceTable(duck, "osf_calibration_guard_default_plan_candidates", calibrationGuardDefaultPlanColumns, calibrationGuardDefaultPlanCandidates);

  const counts = {
    osf_tasks: tasks.length,
    osf_artifact_rows: artifactRows.length,
    osf_benchmark_runs: benchmarkRuns.length,
    osf_benchmark_case_results: benchmarkCases.length,
    osf_forecast_scores: forecastScores.length,
    osf_binary_calibration_buckets: binaryCalibrationBuckets.length,
    osf_workflow_change_proposals: workflowChangeProposals.length,
    osf_calibration_guard_validations: calibrationGuardValidations.length,
    osf_calibration_guard_default_plan_candidates: calibrationGuardDefaultPlanCandidates.length,
    osf_source_bank_entries: sources.length,
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
      "select bucket_label, sample_size, calibration_error, candidate_guard_suggested_adjustment from osf_binary_calibration_buckets;",
      "select proposal_id, recommendation, brier_delta, calibration_error_delta from osf_calibration_guard_validations order by generated_at desc limit 5;",
      "select proposal_id, bucket_label, suggested_adjustment, brier_delta, calibration_error_delta, implementation_status from osf_calibration_guard_default_plan_candidates order by generated_at desc limit 5;",
      "select source_benchmark_run_id, target_workflow_id, status, implementation_status, implementation_experiment_label, validation_benchmark_run_id, validation_result_status, validation_recommendation_status, validation_paired_mean_brier_delta, validation_gate_status from osf_workflow_change_proposals order by created_at desc limit 5;",
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
  { name: "weak_trace_completeness_cases", type: "INTEGER" },
  { name: "missing_probability_cases", type: "INTEGER" },
  { name: "missing_score_rows_cases", type: "INTEGER" },
  { name: "missing_aggregate_rationale_cases", type: "INTEGER" },
  { name: "promotion_gate_status", type: "VARCHAR" },
  { name: "promotion_gate_blockers", type: "VARCHAR" },
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
  { name: "resolved", type: "BOOLEAN" },
  { name: "calibration_guard_adjustment", type: "DOUBLE" },
  { name: "calibration_guard_rules_json", type: "VARCHAR" },
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
  { name: "validation_gate_status", type: "VARCHAR" },
  { name: "validation_gate_blockers_json", type: "VARCHAR" },
  { name: "validation_completed_at", type: "VARCHAR" },
  { name: "validation_comparison_report_artifact_id", type: "VARCHAR" },
  { name: "validation_recommendation_status", type: "VARCHAR" },
  { name: "validation_recommendation_summary", type: "VARCHAR" },
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

type TaskMartRow = RowFor<typeof taskColumns>;
type ArtifactRowMartRow = RowFor<typeof artifactRowColumns>;
type BenchmarkRunMartRow = RowFor<typeof benchmarkRunColumns>;
type BenchmarkCaseMartRow = RowFor<typeof benchmarkCaseColumns>;
type ForecastScoreMartRow = RowFor<typeof forecastScoreColumns>;
type BinaryCalibrationBucketMartRow = RowFor<typeof binaryCalibrationBucketColumns>;
type WorkflowChangeProposalMartRow = RowFor<typeof workflowChangeProposalColumns>;
type SourceMartRow = RowFor<typeof sourceColumns>;
type CalibrationGuardValidationMartRow = RowFor<typeof calibrationGuardValidationColumns>;
type CalibrationGuardDefaultPlanMartRow = RowFor<typeof calibrationGuardDefaultPlanColumns>;
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

function scoreToCalibrationInput(score: ForecastScoreMartRow): BinaryCalibrationInput {
  const config = parseJsonRecord(score.score_config_json);
  return {
    probability: readNumber(config, "probability") ?? readNumber(config, "probability_pct") ?? readNumber(config, "probabilityPct"),
    resolved: readBoolean(config, "resolved"),
    score: typeof score.score_value === "number" && Number.isFinite(score.score_value) ? score.score_value : null,
  };
}

async function readCalibrationGuardValidationRows(reportRoot: string): Promise<CalibrationGuardValidationMartRow[]> {
  const paths = await listFilesNamed(reportRoot, "calibration-guard-validation.json");
  const rows: CalibrationGuardValidationMartRow[] = [];
  for (const path of paths) {
    const payload = await readJsonRecord(path);
    if (!payload) {
      continue;
    }
    const generatedAt = readString(payload, "generatedAt");
    const pathsRecord = readRecord(payload, "paths");
    for (const validation of readRecordArray(payload, "validations")) {
      rows.push({
        report_path: path,
        generated_at: generatedAt,
        validation_mode: readString(validation, "validationMode"),
        proposal_id: readString(validation, "proposalId"),
        source_candidate_guard_id: readString(validation, "sourceCandidateGuardId"),
        bucket_label: readString(validation, "bucketLabel"),
        suggested_adjustment: readNumber(validation, "suggestedAdjustment"),
        matched_rows: readNumber(validation, "matchedRows"),
        baseline_mean_brier: readNumber(validation, "baselineMeanBrier"),
        candidate_mean_brier: readNumber(validation, "candidateMeanBrier"),
        brier_delta: readNumber(validation, "brierDelta"),
        baseline_calibration_error: readNumber(validation, "baselineCalibrationError"),
        candidate_calibration_error: readNumber(validation, "candidateCalibrationError"),
        calibration_error_delta: readNumber(validation, "calibrationErrorDelta"),
        recommendation: readString(validation, "recommendation"),
        proposals_path: readString(pathsRecord, "proposals"),
        performance_report_path: readString(pathsRecord, "performanceReport"),
      });
    }
  }
  return rows.sort((left, right) =>
    String(left.generated_at ?? "").localeCompare(String(right.generated_at ?? ""))
    || String(left.proposal_id ?? "").localeCompare(String(right.proposal_id ?? ""))
    || String(left.report_path ?? "").localeCompare(String(right.report_path ?? ""))
  );
}

async function readCalibrationGuardDefaultPlanRows(reportRoot: string): Promise<CalibrationGuardDefaultPlanMartRow[]> {
  const paths = await listFilesNamed(reportRoot, "calibration-guard-default-plan.json");
  const rows: CalibrationGuardDefaultPlanMartRow[] = [];
  for (const path of paths) {
    const payload = await readJsonRecord(path);
    if (!payload) {
      continue;
    }
    const generatedAt = readString(payload, "generatedAt");
    const pathsRecord = readRecord(payload, "paths");
    for (const candidate of readRecordArray(payload, "defaultCandidates")) {
      rows.push({
        report_path: path,
        generated_at: generatedAt,
        proposal_id: readString(candidate, "proposalId"),
        source_candidate_guard_id: readString(candidate, "sourceCandidateGuardId"),
        bucket_label: readString(candidate, "bucketLabel"),
        suggested_adjustment: readNumber(candidate, "suggestedAdjustment"),
        matched_rows: readNumber(candidate, "matchedRows"),
        brier_delta: readNumber(candidate, "brierDelta"),
        calibration_error_delta: readNumber(candidate, "calibrationErrorDelta"),
        target_workflow_id: readString(candidate, "targetWorkflowId"),
        target_file: readString(candidate, "targetFile"),
        implementation_status: readString(candidate, "implementationStatus"),
        recommended_action: readString(candidate, "recommendedAction"),
        acceptance_criteria_json: JSON.stringify(readStringArray(candidate, "acceptanceCriteria")),
        validation_report_path: readString(pathsRecord, "validationReport"),
      });
    }
  }
  return rows.sort((left, right) =>
    String(left.generated_at ?? "").localeCompare(String(right.generated_at ?? ""))
    || String(left.proposal_id ?? "").localeCompare(String(right.proposal_id ?? ""))
    || String(left.report_path ?? "").localeCompare(String(right.report_path ?? ""))
  );
}

async function readJsonRecord(path: string) {
  try {
    return readRecord(await readJson(path));
  } catch {
    return null;
  }
}

function readRecordArray(value: unknown, key: string) {
  const raw = readRecord(value)?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is JsonRecord => Boolean(readRecord(item))) : [];
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

function readStringArray(value: unknown, key: string) {
  const raw = readRecord(value)?.[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
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
