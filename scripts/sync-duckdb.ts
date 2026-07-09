import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DuckDBInstance, type DuckDBAppender, type DuckDBConnection } from "@duckdb/node-api";
import postgres from "postgres";
import { loadAppConfig } from "../packages/config/src/index";

const config = loadAppConfig();

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
      gate.promotion_gate_status,
      gate.promotion_gate_blockers,
      cr.row_json #>> '{baselines,0,baselineBenchmarkRunId}' as baseline_benchmark_run_id,
      nullif(cr.row_json #>> '{baselines,0,pairedCaseCount}', '')::integer as paired_case_count,
      nullif(cr.row_json #>> '{baselines,0,pairedMeanBrierDelta}', '')::double precision as paired_mean_brier_delta,
      nullif(cr.row_json #>> '{baselines,0,pairedMeanLogDelta}', '')::double precision as paired_mean_log_delta,
      nullif(cr.row_json #>> '{baselines,0,pairedUncertainty,brierDelta,lower}', '')::double precision as paired_brier_ci_lower,
      nullif(cr.row_json #>> '{baselines,0,pairedUncertainty,brierDelta,upper}', '')::double precision as paired_brier_ci_upper,
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
          coalesce(nullif(ar.row_json #>> '{sourceQualityFindings,humanForecastSourceCases}', '')::integer, 0) as human_forecast_source_cases
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
            case when findings.information_advantage_cases > 0 or findings.human_forecast_source_cases > 0 then 'human_forecast_leakage' end
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

  const counts = {
    osf_tasks: tasks.length,
    osf_artifact_rows: artifactRows.length,
    osf_benchmark_runs: benchmarkRuns.length,
    osf_benchmark_case_results: benchmarkCases.length,
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
  { name: "promotion_gate_status", type: "VARCHAR" },
  { name: "promotion_gate_blockers", type: "VARCHAR" },
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

type TaskMartRow = RowFor<typeof taskColumns>;
type ArtifactRowMartRow = RowFor<typeof artifactRowColumns>;
type BenchmarkRunMartRow = RowFor<typeof benchmarkRunColumns>;
type BenchmarkCaseMartRow = RowFor<typeof benchmarkCaseColumns>;
type SourceMartRow = RowFor<typeof sourceColumns>;
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

await main();
