type CheckStatus = "pass" | "skip" | "fail";

export {};

type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
};
type CheckOutcome = Omit<CheckResult, "name">;

type JsonRecord = Record<string, unknown>;
type ClassificationCase = {
  prompt: string;
  expectedMode: string;
  expectedWorkflow: string;
  expectedRequiresTable: boolean;
  expectedForecastType?: string;
};

const args = new Set(Bun.argv.slice(2));
const baseUrl = readArgValue("--base-url") ?? process.env.OPEN_SUPERFORECASTER_BASE_URL ?? "http://localhost:3000";
const requireData = args.has("--require-data");
const writeChecks = args.has("--write-checks");
const results: CheckResult[] = [];

await runSmokeChecks();

async function runSmokeChecks() {
  let runsPayload: JsonRecord | null = null;
  let benchmarksPayload: JsonRecord | null = null;

  await check("health endpoint", async () => {
    const health = await getJson("/api/health");
    if (health.service !== "open-superforecaster") {
      throw new Error("unexpected service label");
    }
    if (health.ok !== true) {
      throw new Error("health snapshot is not ok");
    }
    return "configuration and local directories are healthy";
  });

  await check("diagnostics read model", async () => {
    const diagnostics = await getJson("/api/diagnostics");
    const settings = readRecord(diagnostics, "settings");
    const objectStorage = readRecord(diagnostics, "objectStorage");
    const evalDatasets = readRecord(diagnostics, "evalDatasets");
    const commands = readArray(diagnostics, "commands");
    if (!settings || !readString(settings, "codexModel") || !readString(settings, "smithersStateDir")) {
      throw new Error("diagnostics settings are incomplete");
    }
    for (const bucketKey of ["artifacts", "evals", "exports"]) {
      const bucket = readRecord(objectStorage, bucketKey);
      if (bucket?.ok !== true || !readString(bucket, "bucket")) {
        throw new Error(`diagnostics bucket check failed for ${bucketKey}: ${JSON.stringify(bucket)}`);
      }
    }
    if (typeof evalDatasets?.suiteCount !== "number" || typeof evalDatasets.caseCount !== "number") {
      throw new Error("diagnostics eval dataset summary is incomplete");
    }
    if (!commands.some((command) => isRecord(command) && readString(command, "command") === "bun run export-local")) {
      throw new Error("diagnostics command list is missing export-local");
    }
    return `${evalDatasets.suiteCount} suite(s), ${evalDatasets.caseCount} case(s), ${commands.length} command(s)`;
  });

  await check("maintenance action API", async () => {
    const maintenance = await getJson("/api/maintenance");
    const actions = readArray(maintenance, "actions").filter(isRecord);
    const objectStorageAction = actions.find((action) => readString(action, "action") === "object_storage_smoke");
    if (!objectStorageAction) {
      throw new Error("object_storage_smoke action is missing");
    }
    const response = await postJson("/api/maintenance", { action: "object_storage_smoke" });
    if (response.ok !== true) {
      throw new Error("maintenance action did not return ok=true");
    }
    const job = readRecord(response, "job");
    if (job?.status !== "completed" || readString(job, "jobType") !== "object_storage_smoke") {
      throw new Error(`unexpected maintenance job: ${JSON.stringify(job)}`);
    }
    return `executed ${readString(job, "command") ?? "object storage smoke"} as job ${readString(job, "id") ?? "unknown"}`;
  });

  await check("classifier preview endpoint", async () => {
    const response = await postJson("/api/classify", {
      mode: "auto",
      prompt: "Will Apple release a foldable iPhone before January 1, 2027?",
    });
    if (response.ok !== true) {
      throw new Error("classifier preview did not return ok=true");
    }
    const classification = readRecord(response, "classification");
    if (!classification) {
      throw new Error("classification object is missing");
    }
    const mode = readString(classification, "mode");
    const forecastType = readString(classification, "forecastType");
    const workflow = readString(classification, "workflow");
    if (mode !== "forecast" || forecastType !== "binary" || workflow !== "binary-forecast") {
      throw new Error(`unexpected classification: ${JSON.stringify(classification)}`);
    }
    return `${mode}/${forecastType} routed to ${workflow}`;
  });

  await check("classifier routing matrix", async () => {
    const cases: ClassificationCase[] = [
      {
        prompt: "Will Apple release a foldable iPhone before January 1, 2027?",
        expectedMode: "forecast",
        expectedForecastType: "binary",
        expectedWorkflow: "binary-forecast",
        expectedRequiresTable: false,
      },
      {
        prompt: "When will SpaceX first complete an orbital propellant transfer?",
        expectedMode: "forecast",
        expectedForecastType: "date",
        expectedWorkflow: "date-forecast",
        expectedRequiresTable: false,
      },
      {
        prompt: "How many orbital launches will SpaceX complete in 2027?",
        expectedMode: "forecast",
        expectedForecastType: "numeric",
        expectedWorkflow: "numeric-forecast",
        expectedRequiresTable: false,
      },
      {
        prompt: "Which company will have the highest market cap on January 1, 2027: Apple, Microsoft, Nvidia, or Alphabet?",
        expectedMode: "forecast",
        expectedForecastType: "categorical",
        expectedWorkflow: "categorical-forecast",
        expectedRequiresTable: false,
      },
      {
        prompt: "What are the probabilities that SpaceX completes at least 120, 140, or 160 orbital launches in 2027?",
        expectedMode: "forecast",
        expectedForecastType: "thresholded",
        expectedWorkflow: "thresholded-forecast",
        expectedRequiresTable: false,
      },
      {
        prompt: "If Starship reaches operational weekly launch cadence by December 31, 2026, will SpaceX complete at least 160 orbital launches in 2027?",
        expectedMode: "forecast",
        expectedForecastType: "conditional",
        expectedWorkflow: "conditional-forecast",
        expectedRequiresTable: false,
      },
      {
        prompt: "Research the competitive landscape for open-source forecasting agents.",
        expectedMode: "multi_agent",
        expectedWorkflow: "deep-research",
        expectedRequiresTable: false,
      },
      {
        prompt: "For each row in this table, research whether the company sells to AI labs.",
        expectedMode: "agent_map",
        expectedWorkflow: "agent-map",
        expectedRequiresTable: true,
      },
      {
        prompt: "Rank the rows in this table by fit for enterprise AI security buyers.",
        expectedMode: "rank",
        expectedWorkflow: "rank",
        expectedRequiresTable: true,
      },
      {
        prompt: "Classify each row in this dataset as enterprise, SMB, or consumer.",
        expectedMode: "classify",
        expectedWorkflow: "agent-map",
        expectedRequiresTable: true,
      },
      {
        prompt: "Merge these two contact tables and match records across sources.",
        expectedMode: "merge",
        expectedWorkflow: "merge",
        expectedRequiresTable: true,
      },
      {
        prompt: "Deduplicate this CRM table and group near duplicates.",
        expectedMode: "dedupe",
        expectedWorkflow: "dedupe",
        expectedRequiresTable: true,
      },
    ];

    for (const testCase of cases) {
      const response = await postJson("/api/classify", {
        mode: "auto",
        prompt: testCase.prompt,
      });
      assertClassification(testCase, readRecord(response, "classification"));
    }

    return `${cases.length} prompts route to expected workflows`;
  });

  await check("runs ledger", async () => {
    runsPayload = await getJson("/api/runs");
    const runs = readArray(runsPayload, "runs");
    if (requireData && runs.length === 0) {
      throw new Error("no runs available");
    }
    return `${runs.length} recent run(s)`;
  });

  await check("run detail and artifact export", async () => {
    const runs = readArray(runsPayload, "runs").filter(isRecord);
    const run = runs.find((candidate) => typeof candidate.outputArtifactId === "string") ?? runs[0];
    if (!run) {
      return skip("no runs available");
    }
    const taskId = readString(run, "id");
    if (!taskId) {
      throw new Error("run id is missing");
    }
    const detail = await getJson(`/api/runs/${taskId}`);
    const runDetail = readRecord(detail, "run");
    const task = readRecord(runDetail, "task");
    if (task?.id !== taskId) {
      throw new Error("run detail task id mismatch");
    }
    const taskRows = readArray(runDetail, "taskRows").filter(isRecord);
    const submode = readString(task, "operationSubmode");
    const shouldHaveTaskRows = ["agent_map", "classify", "rank"].includes(submode ?? "");
    if (shouldHaveTaskRows && taskRows.length === 0) {
      throw new Error("independent table run detail is missing task row ledger entries");
    }
    const artifacts = readArray(runDetail, "artifacts").filter(isRecord);
    const artifact = artifacts.find((candidate) => readArray(candidate, "rows").length > 0);
    if (!artifact) {
      return `detail loaded for ${taskId}; no artifact rows to export`;
    }
    const artifactId = readString(artifact, "id");
    if (!artifactId) {
      throw new Error("artifact id is missing");
    }
    const response = await fetchUrl(`/api/artifacts/${artifactId}/csv`);
    if (!response.ok) {
      throw new Error(`csv export returned ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/csv")) {
      throw new Error(`unexpected csv content-type: ${contentType}`);
    }
    const csv = await response.text();
    if (!csv.startsWith("\"row_index\",\"source_row_id\",\"status\"")) {
      throw new Error("csv header is missing required metadata columns");
    }
    const parquetResponse = await fetchUrl(`/api/artifacts/${artifactId}/parquet`);
    if (!parquetResponse.ok) {
      throw new Error(`parquet export returned ${parquetResponse.status}`);
    }
    const parquetContentType = parquetResponse.headers.get("content-type") ?? "";
    if (!parquetContentType.includes("application/vnd.apache.parquet")) {
      throw new Error(`unexpected parquet content-type: ${parquetContentType}`);
    }
    const parquetBytes = new Uint8Array(await parquetResponse.arrayBuffer());
    if (!hasParquetMagic(parquetBytes)) {
      throw new Error("parquet export is missing PAR1 magic bytes");
    }
    return `detail loaded for ${taskId}; ${taskRows.length} task row(s); exported artifact ${artifactId} as csv/parquet`;
  });

  await check("run event stream", async () => {
    const runs = readArray(runsPayload, "runs").filter(isRecord);
    const run = runs.find((candidate) => candidate.status === "completed");
    if (!run) {
      return skip("no completed run available for deterministic SSE stream check");
    }
    const taskId = readString(run, "id");
    if (!taskId) {
      throw new Error("completed run id is missing");
    }
    const response = await fetchUrl(`/api/runs/${taskId}/events`);
    if (!response.ok) {
      throw new Error(`event stream returned ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      throw new Error(`unexpected stream content-type: ${contentType}`);
    }
    const text = await response.text();
    if (!text.includes("event: status") || !text.includes("event: done")) {
      throw new Error("stream did not emit status and done events");
    }
    return `stream emitted status/done for ${taskId}`;
  });

  await check("benchmark lab read model", async () => {
    benchmarksPayload = await getJson("/api/benchmarks");
    const benchmarkRuns = readArray(benchmarksPayload, "benchmarkRuns");
    const benchmarkSuites = readArray(benchmarksPayload, "benchmarkSuites");
    if (requireData && benchmarkRuns.length === 0) {
      throw new Error("no benchmark runs available");
    }
    const benchmarkRunRecords = benchmarkRuns.filter(isRecord);
    const runMissingPromotionGate = benchmarkRunRecords.find((run) => !readRecord(run, "promotionGate"));
    if (runMissingPromotionGate) {
      throw new Error("benchmark list run is missing promotion gate");
    }
    return `${benchmarkRuns.length} run(s), ${benchmarkSuites.length} suite(s)`;
  });

  await check("benchmark run detail surface", async () => {
    const benchmarkRuns = readArray(benchmarksPayload, "benchmarkRuns").filter(isRecord);
    const benchmarkRun = benchmarkRuns.find((run) => !["running", "queued"].includes(String(run.status ?? ""))) ?? benchmarkRuns[0];
    if (!benchmarkRun) {
      return skip("no benchmark run available for detail check");
    }
    const benchmarkRunId = readString(benchmarkRun, "id");
    if (!benchmarkRunId) {
      throw new Error("benchmark run id is missing");
    }
    const response = await getJson(`/api/benchmarks/${benchmarkRunId}`);
    const detail = readRecord(response, "benchmarkRun");
    const scorecard = readRecord(detail, "scorecard");
    const cases = readArray(detail, "cases").filter(isRecord);
    const reports = readRecord(detail, "reports");
    const promotionGate = readRecord(scorecard, "promotionGate");
    if (!scorecard || !promotionGate || cases.length === 0) {
      throw new Error("benchmark detail is missing scorecard, promotion gate, or cases");
    }
    const firstCase = cases[0];
    const links = readRecord(firstCase, "links");
    if (!readString(firstCase, "externalId") || !readString(links, "runDetail")) {
      throw new Error("benchmark case detail is missing replay links");
    }
    if (!reports || !("score" in reports) || !("analysis" in reports) || !("comparison" in reports)) {
      throw new Error("benchmark detail reports block is incomplete");
    }
    return `${cases.length} case(s), gate ${readString(promotionGate, "status") ?? "unknown"}`;
  });

  await check("benchmark comparison surface", async () => {
    const benchmarkRuns = readArray(benchmarksPayload, "benchmarkRuns").filter(isRecord);
    const comparedRun = benchmarkRuns.find((run) => readRecord(run, "comparison"));
    if (comparedRun) {
      const comparison = readRecord(comparedRun, "comparison");
      const recommendation = readRecord(comparison, "recommendation");
      return `existing comparison on ${readString(comparedRun, "id") ?? "unknown run"}: ${readString(recommendation, "status") ?? "unknown"}`;
    }
    if (!writeChecks) {
      return skip("no existing comparison report; rerun with --write-checks to generate one");
    }
    const candidate = benchmarkRuns.find((run) => !["running", "queued"].includes(String(run.status ?? "")));
    if (!candidate) {
      return skip("no completed benchmark run available for comparison generation");
    }
    const benchmarkRunId = readString(candidate, "id");
    if (!benchmarkRunId) {
      throw new Error("candidate benchmark run id is missing");
    }
    const response = await postJson(`/api/benchmarks/${benchmarkRunId}/comparison`, {});
    if (response.ok !== true) {
      throw new Error("comparison generation did not return ok=true");
    }
    const comparison = readRecord(response, "comparison");
    if (!comparison?.comparisonReportArtifactId) {
      throw new Error("comparison report artifact id missing");
    }
    return `generated comparison ${String(comparison.comparisonReportArtifactId)}`;
  });

  await check("metrics endpoint", async () => {
    const response = await fetchUrl("/metrics");
    if (!response.ok) {
      throw new Error(`metrics returned ${response.status}`);
    }
    const metrics = await response.text();
    const required = [
      "open_superforecaster_up",
      "open_superforecaster_tasks_total",
      "open_superforecaster_benchmark_run_info",
      "open_superforecaster_benchmark_promotion_gate_status",
      "open_superforecaster_workflow_change_proposals_total",
      "open_superforecaster_workflow_variant_info",
      "open_superforecaster_binary_calibration_status",
      "open_superforecaster_binary_calibration_candidate_guard_rules_total",
      "open_superforecaster_baseline_sanity_scores_total",
      "open_superforecaster_market_anchor_scores_total",
      "open_superforecaster_resolution_boundary_scores_total",
      "open_superforecaster_uncertainty_range_scores_total",
      "open_superforecaster_component_weighting_scores_total",
      "open_superforecaster_aggregate_quality_scores_total",
      "open_superforecaster_aggregate_stats_scores_total",
      "open_superforecaster_aggregate_plan_scores_total",
      "open_superforecaster_conditional_scores_total",
      "open_superforecaster_thresholded_scores_total",
      "open_superforecaster_numeric_distribution_scores_total",
      "open_superforecaster_date_distribution_scores_total",
      "open_superforecaster_categorical_distribution_scores_total",
      "open_superforecaster_evidence_coverage_scores_total",
      "open_superforecaster_input_context_scores_total",
      "open_superforecaster_run_metadata_scores_total",
      "open_superforecaster_calibration_guard_impact_status",
      "open_superforecaster_calibration_guard_validation_reports_total",
    ];
    const missing = required.filter((metric) => !metrics.includes(metric));
    if (missing.length) {
      throw new Error(`missing metrics: ${missing.join(", ")}`);
    }
    return "required Prometheus series are present";
  });

  printSummary();
}

async function check(name: string, fn: () => Promise<string | CheckOutcome>) {
  try {
    const outcome = await fn();
    if (typeof outcome === "string") {
      results.push({ name, status: "pass", detail: outcome });
    } else {
      results.push({ ...outcome, name });
    }
  } catch (error) {
    results.push({
      name,
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function skip(detail: string): CheckOutcome {
  return {
    status: "skip",
    detail,
  };
}

async function getJson(path: string) {
  const response = await fetchUrl(path);
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return (await response.json()) as JsonRecord;
}

async function postJson(path: string, body: JsonRecord) {
  const response = await fetchUrl(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as JsonRecord;
}

function fetchUrl(path: string, init?: RequestInit) {
  return fetch(new URL(path, baseUrl), init);
}

function readArgValue(name: string) {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : null;
}

function assertClassification(testCase: ClassificationCase, classification: JsonRecord | null) {
  if (!classification) {
    throw new Error(`classification object is missing for prompt: ${testCase.prompt}`);
  }
  const mode = readString(classification, "mode");
  const forecastType = readString(classification, "forecastType");
  const workflow = readString(classification, "workflow");
  const requiresTable = classification.requiresTable;
  const rationale = readString(classification, "rationale") ?? "";

  if (mode !== testCase.expectedMode) {
    throw new Error(`expected mode ${testCase.expectedMode}, got ${mode} for prompt: ${testCase.prompt}`);
  }
  if (workflow !== testCase.expectedWorkflow) {
    throw new Error(`expected workflow ${testCase.expectedWorkflow}, got ${workflow} for prompt: ${testCase.prompt}`);
  }
  if (testCase.expectedForecastType && forecastType !== testCase.expectedForecastType) {
    throw new Error(`expected forecast type ${testCase.expectedForecastType}, got ${forecastType} for prompt: ${testCase.prompt}`);
  }
  if (requiresTable !== testCase.expectedRequiresTable) {
    throw new Error(`expected requiresTable=${testCase.expectedRequiresTable}, got ${String(requiresTable)} for prompt: ${testCase.prompt}`);
  }
  if (workflow !== "codex-smoke" && /\bplaceholder\b/i.test(rationale)) {
    throw new Error(`unexpected placeholder rationale for ${workflow}: ${rationale}`);
  }
}

function readArray(value: JsonRecord | null, key: string) {
  const raw = value?.[key];
  return Array.isArray(raw) ? raw : [];
}

function readRecord(value: JsonRecord | null, key: string) {
  const raw = value?.[key];
  return isRecord(raw) ? raw : null;
}

function readString(value: JsonRecord | null, key: string) {
  const raw = value?.[key];
  return typeof raw === "string" ? raw : null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasParquetMagic(bytes: Uint8Array) {
  if (bytes.length < 8) {
    return false;
  }
  const header = String.fromCharCode(...bytes.slice(0, 4));
  const footer = String.fromCharCode(...bytes.slice(bytes.length - 4));
  return header === "PAR1" && footer === "PAR1";
}

function printSummary() {
  for (const result of results) {
    const prefix = result.status === "pass" ? "PASS" : result.status === "skip" ? "SKIP" : "FAIL";
    console.log(`${prefix} ${result.name}: ${result.detail}`);
  }
  const failed = results.filter((result) => result.status === "fail");
  const skipped = results.filter((result) => result.status === "skip");
  console.log(`\nSmoke checks: ${results.length - failed.length - skipped.length} passed, ${skipped.length} skipped, ${failed.length} failed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}
