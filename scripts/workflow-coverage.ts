import postgres from "postgres";
import { loadAppConfig } from "../packages/config/src/index";

type EvidenceRow = {
  task_id: string;
  operation_mode: string;
  operation_submode: string | null;
  status: string;
  output_artifact_id: string | null;
  artifact_rows: number;
  forecast_attempts: number;
  source_count: number;
  benchmark_case_results: number;
  created_at: string;
};

type WorkflowExpectation = {
  id: string;
  label: string;
  mode: string;
  submode: string;
  minArtifactRows: number;
  requireForecastAttempts?: boolean;
  requireBenchmarkCaseResult?: boolean;
};

const expectations: WorkflowExpectation[] = [
  { id: "forecast.binary", label: "Binary forecast", mode: "forecast", submode: "binary_forecast", minArtifactRows: 1, requireForecastAttempts: true },
  { id: "forecast.date", label: "Date forecast", mode: "forecast", submode: "date_forecast", minArtifactRows: 1, requireForecastAttempts: true },
  { id: "forecast.numeric", label: "Numeric forecast", mode: "forecast", submode: "numeric_forecast", minArtifactRows: 1, requireForecastAttempts: true },
  { id: "forecast.categorical", label: "Categorical forecast", mode: "forecast", submode: "categorical_forecast", minArtifactRows: 1, requireForecastAttempts: true },
  { id: "forecast.thresholded", label: "Thresholded forecast", mode: "forecast", submode: "thresholded_forecast", minArtifactRows: 1, requireForecastAttempts: true },
  { id: "forecast.conditional", label: "Conditional forecast", mode: "forecast", submode: "conditional_forecast", minArtifactRows: 1, requireForecastAttempts: true },
  { id: "research.deep", label: "Deep research", mode: "multi_agent", submode: "deep_research", minArtifactRows: 1 },
  { id: "table.agent_map", label: "Agent map", mode: "agent_map", submode: "agent_map", minArtifactRows: 2 },
  { id: "table.classify", label: "Classify", mode: "classify", submode: "classify", minArtifactRows: 2 },
  { id: "table.rank", label: "Rank", mode: "rank", submode: "rank", minArtifactRows: 2 },
  { id: "table.merge", label: "Merge", mode: "merge", submode: "merge", minArtifactRows: 2 },
  { id: "table.dedupe", label: "Dedupe", mode: "dedupe", submode: "dedupe", minArtifactRows: 2 },
  {
    id: "benchmark.fixed_evidence",
    label: "Fixed-evidence benchmark eval",
    mode: "fixed_evidence_eval",
    submode: "binary_forecast",
    minArtifactRows: 1,
    requireForecastAttempts: true,
    requireBenchmarkCaseResult: true,
  },
  {
    id: "benchmark.agentic_pastcasting",
    label: "Agentic pastcasting benchmark eval",
    mode: "agentic_pastcasting_eval",
    submode: "binary_forecast",
    minArtifactRows: 1,
    requireForecastAttempts: true,
    requireBenchmarkCaseResult: true,
  },
  { id: "runtime.codex_smoke", label: "Codex runtime smoke", mode: "fixed_evidence_eval", submode: "codex_smoke", minArtifactRows: 1 },
];

const args = new Set(Bun.argv.slice(2));
const json = args.has("--json");
const config = loadAppConfig();
const sql = postgres(config.DATABASE_URL);

try {
  const evidence = await sql<EvidenceRow[]>`
    select
      t.id::text as task_id,
      t.operation_mode::text as operation_mode,
      t.operation_submode,
      t.status::text as status,
      t.output_artifact_id::text as output_artifact_id,
      count(distinct ar.id)::int as artifact_rows,
      count(distinct fa.id)::int as forecast_attempts,
      count(distinct sbe.id)::int as source_count,
      count(distinct bcr.id)::int as benchmark_case_results,
      t.created_at::text as created_at
    from tasks t
    left join artifacts a on a.id = t.output_artifact_id
    left join artifact_rows ar on ar.artifact_id = a.id
    left join forecast_attempts fa on fa.research_pass_id = t.smithers_run_id
    left join source_bank_entries sbe on sbe.task_id = t.id
    left join benchmark_case_results bcr on bcr.task_id = t.id
    group by t.id
    order by t.created_at desc
  `;
  const checks = expectations.map((expectation) => checkExpectation(expectation, evidence));
  const failed = checks.filter((check) => check.status === "fail");

  if (json) {
    console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
  } else {
    for (const check of checks) {
      const prefix = check.status === "pass" ? "PASS" : "FAIL";
      console.log(`${prefix} ${check.id}: ${check.detail}`);
    }
    console.log(`\nWorkflow coverage: ${checks.length - failed.length} passed, ${failed.length} failed`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await sql.end();
}

function checkExpectation(expectation: WorkflowExpectation, evidence: EvidenceRow[]) {
  const candidates = evidence.filter(
    (row) =>
      row.operation_mode === expectation.mode &&
      row.operation_submode === expectation.submode &&
      row.status === "completed" &&
      Boolean(row.output_artifact_id) &&
      row.artifact_rows >= expectation.minArtifactRows &&
      (!expectation.requireForecastAttempts || row.forecast_attempts > 0) &&
      (!expectation.requireBenchmarkCaseResult || row.benchmark_case_results > 0),
  );
  const best = candidates[0];
  if (!best) {
    const latest = evidence.find((row) => row.operation_mode === expectation.mode && row.operation_submode === expectation.submode);
    return {
      id: expectation.id,
      label: expectation.label,
      status: "fail" as const,
      taskId: latest?.task_id ?? null,
      artifactId: latest?.output_artifact_id ?? null,
      detail: latest
        ? `latest task ${latest.task_id} status=${latest.status}, artifactRows=${latest.artifact_rows}, attempts=${latest.forecast_attempts}, benchmarkResults=${latest.benchmark_case_results}`
        : `no task found for ${expectation.mode}/${expectation.submode}`,
    };
  }

  return {
    id: expectation.id,
    label: expectation.label,
    status: "pass" as const,
    taskId: best.task_id,
    artifactId: best.output_artifact_id,
    detail: `task ${best.task_id}, artifact ${best.output_artifact_id}, rows=${best.artifact_rows}, attempts=${best.forecast_attempts}, sources=${best.source_count}, benchmarkResults=${best.benchmark_case_results}`,
  };
}
