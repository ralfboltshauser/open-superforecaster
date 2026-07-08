import postgres from "postgres";
import { resolve } from "node:path";
import { loadAppConfig } from "../packages/config/src/index";

const CONFIRMATION = "open-superforecaster-cleanup-local";
const UUID_ARRAY = 2950;
const TEXT_ARRAY = 25;

type CleanupTarget =
  | { kind: "task"; id: string }
  | { kind: "artifact"; id: string }
  | { kind: "benchmark-run"; id: string };

type CleanupPlan = {
  target: CleanupTarget;
  counts: Record<string, number>;
  warnings: string[];
  options: Record<string, unknown>;
};

const root = resolve(import.meta.dir, "..");
const config = loadAppConfig({ ...process.env, OPEN_SUPERFORECASTER_ROOT: root });
const args = new Set(process.argv.slice(2));
const target = parseTarget();
const confirmed = process.argv.includes("--confirm") && process.argv[process.argv.indexOf("--confirm") + 1] === CONFIRMATION;
const dryRun = args.has("--dry-run") || !confirmed;
const includeBenchmarkTasks = args.has("--include-benchmark-tasks");

const sql = postgres(config.DATABASE_URL);

try {
  const plan = await buildCleanupPlan(sql, target, { includeBenchmarkTasks });
  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      project: "open-superforecaster",
      root,
      dryRun: true,
      confirmationRequired: `--confirm ${CONFIRMATION}`,
      ...plan,
    }, null, 2));
    process.exit(0);
  }

  const deleted = await sql.begin(async (tx) => {
    if (target.kind === "task") {
      return deleteTask(tx, target.id);
    }
    if (target.kind === "artifact") {
      return deleteArtifact(tx, target.id);
    }
    return deleteBenchmarkRun(tx, target.id, { includeBenchmarkTasks });
  });

  console.log(JSON.stringify({
    ok: true,
    project: "open-superforecaster",
    root,
    dryRun: false,
    target,
    planned: plan.counts,
    deleted,
    warnings: plan.warnings,
  }, null, 2));
} finally {
  await sql.end();
}

function parseTarget(): CleanupTarget {
  const candidates = [
    ["task", readFlagValue("--task")],
    ["artifact", readFlagValue("--artifact")],
    ["benchmark-run", readFlagValue("--benchmark-run")],
  ].filter((entry): entry is [CleanupTarget["kind"], string] => typeof entry[1] === "string" && entry[1].length > 0);

  if (candidates.length !== 1) {
    printUsage();
    process.exit(1);
  }

  const [kind, id] = candidates[0]!;
  return { kind, id } as CleanupTarget;
}

function readFlagValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function printUsage() {
  console.error(`Usage:
  bun run cleanup-local -- --task <task-id> [--dry-run]
  bun run cleanup-local -- --artifact <artifact-id> [--dry-run]
  bun run cleanup-local -- --benchmark-run <benchmark-run-id> [--include-benchmark-tasks] [--dry-run]

Confirmed deletion requires:
  --confirm ${CONFIRMATION}

Smithers SQLite state is never deleted by this command.`);
}

async function buildCleanupPlan(sql: any, target: CleanupTarget, options: { includeBenchmarkTasks: boolean }): Promise<CleanupPlan> {
  if (target.kind === "task") {
    const refs = await collectTaskRefs(sql, target.id);
    assertFound(refs.taskFound, `Task not found: ${target.id}`);
    const counts = refs.counts as Record<string, number>;
    return {
      target,
      counts,
      warnings: [
        "Deletes projected app rows for this task only; Smithers SQLite state is not touched.",
        ...((counts.benchmarkCaseResultsDetached ?? 0) > 0 ? ["Benchmark case results linked to this task are detached, not deleted."] : []),
      ],
      options,
    };
  }

  if (target.kind === "artifact") {
    const refs = await collectArtifactRefs(sql, target.id);
    assertFound(refs.artifactFound, `Artifact not found: ${target.id}`);
    return {
      target,
      counts: refs.counts,
      warnings: ["Deletes artifact rows and citations, and clears output/report pointers that referenced the artifact."],
      options,
    };
  }

  const refs = await collectBenchmarkRunRefs(sql, target.id);
  assertFound(refs.benchmarkRunFound, `Benchmark run not found: ${target.id}`);
  return {
    target,
    counts: refs.counts,
    warnings: [
      options.includeBenchmarkTasks
        ? "Deletes linked benchmark task projections too; Smithers SQLite state is still not touched."
        : "Linked benchmark task projections are preserved and detached from the benchmark run.",
    ],
    options,
  };
}

async function collectTaskRefs(sql: any, taskId: string) {
  const [task] = await sql`
    select id, smithers_run_id, output_artifact_id
    from tasks
    where id = ${taskId}
    limit 1
  `;
  if (!task) {
    return emptyTaskRefs(false);
  }

  const artifactIds = unique([
    ...ids(await sql`select id from artifacts where task_id = ${taskId}`),
    ...(typeof task.output_artifact_id === "string" ? [task.output_artifact_id] : []),
  ]);
  const artifactRowIds = artifactIds.length
    ? ids(await sql`select id from artifact_rows where artifact_id = any(${sql.array(artifactIds, UUID_ARRAY)})`)
    : [];
  const taskRowIds = ids(await sql`select id from task_rows where task_id = ${taskId}`);
  const sourceIds = ids(await sql`select id from source_bank_entries where task_id = ${taskId}`);
  const traceGroupIds = ids(await sql`select id from trace_groups where task_id = ${taskId}`);
  const attemptIds = unique([
    ...(typeof task.smithers_run_id === "string"
      ? ids(await sql`select id from forecast_attempts where research_pass_id = ${task.smithers_run_id}`)
      : []),
    ...(taskRowIds.length
      ? ids(await sql`select id from forecast_attempts where task_row_id = any(${sql.array(taskRowIds, UUID_ARRAY)})`)
      : []),
  ]);
  const aggregateIds = unique([
    ...(taskRowIds.length
      ? ids(await sql`select id from forecast_aggregates where task_row_id = any(${sql.array(taskRowIds, UUID_ARRAY)})`)
      : []),
    ...(attemptIds.length
      ? ids(await sql`
          select id
          from forecast_aggregates
          where exists (
            select 1
            from jsonb_array_elements_text(component_attempt_ids) component_attempt_id
            where component_attempt_id = any(${sql.array(attemptIds, TEXT_ARRAY)})
          )
        `)
      : []),
  ]);
  const resolutionIds = taskRowIds.length
    ? ids(await sql`select id from forecast_resolutions where task_row_id = any(${sql.array(taskRowIds, UUID_ARRAY)})`)
    : [];
  const benchmarkCaseResultIds = ids(await sql`select id from benchmark_case_results where task_id = ${taskId}`);

  const counts = {
    tasks: 1,
    artifacts: artifactIds.length,
    artifactRows: artifactRowIds.length,
    taskRows: taskRowIds.length,
    traceEvents: await countRows(sql`select count(*) from trace_events where task_id = ${taskId}`),
    traceGroups: traceGroupIds.length,
    sourceBankEntries: sourceIds.length,
    citations: await countCitations(sql, { sourceIds, artifactIds, artifactRowIds }),
    forecastAttempts: attemptIds.length,
    forecastAggregates: aggregateIds.length,
    forecastResolutions: resolutionIds.length,
    forecastScores: await countForecastScores(sql, { attemptIds, aggregateIds, resolutionIds }),
    benchmarkCaseResultsDetached: benchmarkCaseResultIds.length,
  };

  return {
    taskFound: true,
    artifactIds,
    artifactRowIds,
    taskRowIds,
    sourceIds,
    traceGroupIds,
    attemptIds,
    aggregateIds,
    resolutionIds,
    counts,
  };
}

function emptyTaskRefs(taskFound: boolean) {
  return {
    taskFound,
    artifactIds: [],
    artifactRowIds: [],
    taskRowIds: [],
    sourceIds: [],
    traceGroupIds: [],
    attemptIds: [],
    aggregateIds: [],
    resolutionIds: [],
    counts: {},
  };
}

async function collectArtifactRefs(sql: any, artifactId: string) {
  const [artifact] = await sql`select id from artifacts where id = ${artifactId} limit 1`;
  if (!artifact) {
    return {
      artifactFound: false,
      artifactRowIds: [],
      counts: {},
    };
  }

  const artifactRowIds = ids(await sql`select id from artifact_rows where artifact_id = ${artifactId}`);
  const counts = {
    artifacts: 1,
    artifactRows: artifactRowIds.length,
    citations: await countCitations(sql, { sourceIds: [], artifactIds: [artifactId], artifactRowIds }),
    tasksCleared: await countRows(sql`select count(*) from tasks where output_artifact_id = ${artifactId}`),
    benchmarkRunPointersCleared: await countRows(sql`
      select count(*)
      from benchmark_runs
      where score_report_artifact_id = ${artifactId}
         or analysis_report_artifact_id = ${artifactId}
         or comparison_report_artifact_id = ${artifactId}
    `),
    benchmarkCaseResultPointersCleared: await countRows(sql`
      select count(*)
      from benchmark_case_results
      where forecast_output_artifact_id = ${artifactId}
         or analyst_notes_artifact_id = ${artifactId}
    `),
    forecastAttemptEvidencePointersCleared: await countRows(sql`
      select count(*) from forecast_attempts where evidence_digest_artifact_id = ${artifactId}
    `),
  };

  return {
    artifactFound: true,
    artifactRowIds,
    counts,
  };
}

async function collectBenchmarkRunRefs(sql: any, benchmarkRunId: string) {
  const [benchmarkRun] = await sql`
    select id, score_report_artifact_id, analysis_report_artifact_id, comparison_report_artifact_id
    from benchmark_runs
    where id = ${benchmarkRunId}
    limit 1
  `;
  if (!benchmarkRun) {
    return {
      benchmarkRunFound: false,
      reportArtifactIds: [],
      taskIds: [],
      counts: {},
    };
  }

  const caseResults = await sql`
    select id, task_id, analyst_notes_artifact_id
    from benchmark_case_results
    where benchmark_run_id = ${benchmarkRunId}
  `;
  const taskIds = unique(caseResults.map((row: Record<string, unknown>) => row.task_id).filter(isString));
  const reportArtifactIds = unique([
    benchmarkRun.score_report_artifact_id,
    benchmarkRun.analysis_report_artifact_id,
    benchmarkRun.comparison_report_artifact_id,
    ...caseResults.map((row: Record<string, unknown>) => row.analyst_notes_artifact_id),
  ].filter(isString));

  const taskCounts = await taskIds.reduce(async (previous, taskId) => {
    const counts = await previous;
    const refs = await collectTaskRefs(sql, taskId);
    return addCounts(counts, prefixCounts(refs.counts, "linkedTask"));
  }, Promise.resolve({} as Record<string, number>));

  const counts = {
    benchmarkRuns: 1,
    benchmarkCaseResults: caseResults.length,
    benchmarkAnalyses: await countRows(sql`select count(*) from benchmark_analyses where benchmark_run_id = ${benchmarkRunId}`),
    workflowChangeProposals: await countRows(sql`select count(*) from workflow_change_proposals where source_benchmark_run_id = ${benchmarkRunId}`),
    workflowPromotionDecisions: await countRows(sql`select count(*) from workflow_promotion_decisions where benchmark_run_id = ${benchmarkRunId}`),
    reportArtifacts: reportArtifactIds.length,
    linkedTasks: taskIds.length,
    ...taskCounts,
  };

  return {
    benchmarkRunFound: true,
    reportArtifactIds,
    taskIds,
    counts,
  };
}

async function deleteTask(sql: any, taskId: string) {
  const refs = await collectTaskRefs(sql, taskId);
  assertFound(refs.taskFound, `Task not found: ${taskId}`);
  const deleted: Record<string, number> = {};

  deleted.forecastScores = await deleteForecastScores(sql, refs);
  deleted.forecastAggregates = await deleteByIds(sql, "forecast_aggregates", refs.aggregateIds);
  deleted.forecastAttempts = await deleteByIds(sql, "forecast_attempts", refs.attemptIds);
  deleted.forecastResolutions = await deleteByIds(sql, "forecast_resolutions", refs.resolutionIds);
  deleted.citations = await deleteCitations(sql, refs);
  deleted.sourceBankEntries = await deleteByIds(sql, "source_bank_entries", refs.sourceIds);
  deleted.traceEvents = await deleteWhereTask(sql, "trace_events", taskId);
  deleted.traceGroups = await deleteByIds(sql, "trace_groups", refs.traceGroupIds);
  deleted.artifactRows = await deleteByIds(sql, "artifact_rows", refs.artifactRowIds);
  deleted.artifacts = await deleteByIds(sql, "artifacts", refs.artifactIds);
  deleted.taskRows = await deleteByIds(sql, "task_rows", refs.taskRowIds);
  deleted.benchmarkCaseResultsDetached = (await sql`
    update benchmark_case_results
    set task_id = null,
        smithers_run_id = null,
        forecast_output_artifact_id = null,
        updated_at = now()
    where task_id = ${taskId}
    returning id
  `).length;
  deleted.tasks = (await sql`delete from tasks where id = ${taskId} returning id`).length;

  return deleted;
}

async function deleteArtifact(sql: any, artifactId: string) {
  const refs = await collectArtifactRefs(sql, artifactId);
  assertFound(refs.artifactFound, `Artifact not found: ${artifactId}`);
  const deleted: Record<string, number> = {};

  deleted.citations = await deleteCitations(sql, { sourceIds: [], artifactIds: [artifactId], artifactRowIds: refs.artifactRowIds });
  deleted.artifactRows = await deleteByIds(sql, "artifact_rows", refs.artifactRowIds);
  deleted.tasksCleared = (await sql`
    update tasks
    set output_artifact_id = null,
        updated_at = now()
    where output_artifact_id = ${artifactId}
    returning id
  `).length;
  deleted.benchmarkRunsCleared = (await sql`
    update benchmark_runs
    set score_report_artifact_id = case when score_report_artifact_id = ${artifactId} then null else score_report_artifact_id end,
        analysis_report_artifact_id = case when analysis_report_artifact_id = ${artifactId} then null else analysis_report_artifact_id end,
        comparison_report_artifact_id = case when comparison_report_artifact_id = ${artifactId} then null else comparison_report_artifact_id end,
        updated_at = now()
    where score_report_artifact_id = ${artifactId}
       or analysis_report_artifact_id = ${artifactId}
       or comparison_report_artifact_id = ${artifactId}
    returning id
  `).length;
  deleted.benchmarkCaseResultsCleared = (await sql`
    update benchmark_case_results
    set forecast_output_artifact_id = case when forecast_output_artifact_id = ${artifactId} then null else forecast_output_artifact_id end,
        analyst_notes_artifact_id = case when analyst_notes_artifact_id = ${artifactId} then null else analyst_notes_artifact_id end,
        updated_at = now()
    where forecast_output_artifact_id = ${artifactId}
       or analyst_notes_artifact_id = ${artifactId}
    returning id
  `).length;
  deleted.forecastAttemptEvidenceCleared = (await sql`
    update forecast_attempts
    set evidence_digest_artifact_id = null,
        updated_at = now()
    where evidence_digest_artifact_id = ${artifactId}
    returning id
  `).length;
  deleted.artifacts = (await sql`delete from artifacts where id = ${artifactId} returning id`).length;

  return deleted;
}

async function deleteBenchmarkRun(sql: any, benchmarkRunId: string, options: { includeBenchmarkTasks: boolean }) {
  const refs = await collectBenchmarkRunRefs(sql, benchmarkRunId);
  assertFound(refs.benchmarkRunFound, `Benchmark run not found: ${benchmarkRunId}`);
  const deleted: Record<string, number> = {};

  if (options.includeBenchmarkTasks) {
    for (const taskId of refs.taskIds) {
      const taskDeleted = await deleteTask(sql, taskId);
      Object.assign(deleted, addCounts(deleted, prefixCounts(taskDeleted, "linkedTaskDeleted")));
    }
  } else if (refs.taskIds.length) {
    deleted.linkedTasksDetached = (await sql`
      update tasks
      set benchmark_run_id = null,
          updated_at = now()
      where benchmark_run_id = ${benchmarkRunId}
      returning id
    `).length;
  }

  for (const artifactId of refs.reportArtifactIds) {
    const artifactDeleted = await deleteArtifact(sql, artifactId);
    Object.assign(deleted, addCounts(deleted, prefixCounts(artifactDeleted, "reportArtifactDeleted")));
  }

  deleted.workflowPromotionDecisions = (await sql`
    delete from workflow_promotion_decisions where benchmark_run_id = ${benchmarkRunId} returning id
  `).length;
  deleted.workflowChangeProposals = (await sql`
    delete from workflow_change_proposals where source_benchmark_run_id = ${benchmarkRunId} returning id
  `).length;
  deleted.benchmarkAnalyses = (await sql`
    delete from benchmark_analyses where benchmark_run_id = ${benchmarkRunId} returning id
  `).length;
  deleted.benchmarkCaseResults = (await sql`
    delete from benchmark_case_results where benchmark_run_id = ${benchmarkRunId} returning id
  `).length;
  deleted.benchmarkRuns = (await sql`delete from benchmark_runs where id = ${benchmarkRunId} returning id`).length;

  return deleted;
}

async function countRows(query: Promise<Array<Record<string, unknown>>>) {
  const [row] = await query;
  return Number(row?.count ?? 0);
}

async function countCitations(sql: any, refs: { sourceIds: string[]; artifactIds: string[]; artifactRowIds: string[] }) {
  if (!refs.sourceIds.length && !refs.artifactIds.length && !refs.artifactRowIds.length) {
    return 0;
  }
  return countRows(sql`
    select count(distinct id)
    from citations
    where source_id = any(${sql.array(refs.sourceIds, UUID_ARRAY)})
       or artifact_id = any(${sql.array(refs.artifactIds, UUID_ARRAY)})
       or row_id = any(${sql.array(refs.artifactRowIds, UUID_ARRAY)})
  `);
}

async function countForecastScores(sql: any, refs: { attemptIds: string[]; aggregateIds: string[]; resolutionIds: string[] }) {
  if (!refs.attemptIds.length && !refs.aggregateIds.length && !refs.resolutionIds.length) {
    return 0;
  }
  return countRows(sql`
    select count(distinct id)
    from forecast_scores
    where forecast_attempt_id = any(${sql.array(refs.attemptIds, UUID_ARRAY)})
       or forecast_aggregate_id = any(${sql.array(refs.aggregateIds, UUID_ARRAY)})
       or resolution_id = any(${sql.array(refs.resolutionIds, UUID_ARRAY)})
  `);
}

async function deleteForecastScores(sql: any, refs: { attemptIds: string[]; aggregateIds: string[]; resolutionIds: string[] }) {
  if (!refs.attemptIds.length && !refs.aggregateIds.length && !refs.resolutionIds.length) {
    return 0;
  }
  return (await sql`
    delete from forecast_scores
    where forecast_attempt_id = any(${sql.array(refs.attemptIds, UUID_ARRAY)})
       or forecast_aggregate_id = any(${sql.array(refs.aggregateIds, UUID_ARRAY)})
       or resolution_id = any(${sql.array(refs.resolutionIds, UUID_ARRAY)})
    returning id
  `).length;
}

async function deleteCitations(sql: any, refs: { sourceIds: string[]; artifactIds: string[]; artifactRowIds: string[] }) {
  if (!refs.sourceIds.length && !refs.artifactIds.length && !refs.artifactRowIds.length) {
    return 0;
  }
  return (await sql`
    delete from citations
    where source_id = any(${sql.array(refs.sourceIds, UUID_ARRAY)})
       or artifact_id = any(${sql.array(refs.artifactIds, UUID_ARRAY)})
       or row_id = any(${sql.array(refs.artifactRowIds, UUID_ARRAY)})
    returning id
  `).length;
}

async function deleteByIds(sql: any, table: string, values: string[]) {
  if (!values.length) {
    return 0;
  }
  return (await sql`delete from ${sql(table)} where id = any(${sql.array(values, UUID_ARRAY)}) returning id`).length;
}

async function deleteWhereTask(sql: any, table: string, taskId: string) {
  return (await sql`delete from ${sql(table)} where task_id = ${taskId} returning id`).length;
}

function ids(rows: Array<Record<string, unknown>>) {
  return rows.map((row) => row.id).filter(isString);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function addCounts(left: Record<string, number>, right: Record<string, number>) {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    merged[key] = (merged[key] ?? 0) + value;
  }
  return merged;
}

function prefixCounts(counts: Record<string, number>, prefix: string) {
  return Object.fromEntries(Object.entries(counts).map(([key, value]) => [`${prefix}.${key}`, value]));
}

function assertFound(found: boolean, message: string): asserts found {
  if (!found) {
    throw new Error(message);
  }
}
