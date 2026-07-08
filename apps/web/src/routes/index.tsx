import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, ClipboardCheck, Database, FileJson, GitBranch, Play, Server, Terminal, Workflow, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AppSidebar } from "../components/app-sidebar";
import { RunComposer } from "../components/run-composer";
import { SystemHealthTable } from "../components/system-health-table";
import type { HealthSnapshot } from "@open-superforecaster/workflow-contracts";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [resolvingTaskId, setResolvingTaskId] = useState<string | null>(null);
  const [importingBtf2, setImportingBtf2] = useState(false);
  const [promotionDecisionRunId, setPromotionDecisionRunId] = useState<string | null>(null);
  const [comparisonRunId, setComparisonRunId] = useState<string | null>(null);
  const [maintenanceAction, setMaintenanceAction] = useState<string | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const response = await fetch("/api/health");
      return (await response.json()) as HealthSnapshot;
    },
  });
  const diagnosticsQuery = useQuery({
    queryKey: ["diagnostics"],
    queryFn: async () => {
      const response = await fetch("/api/diagnostics");
      return (await response.json()) as DiagnosticsSnapshot;
    },
    refetchInterval: 15_000,
  });
  const runsQuery = useQuery({
    queryKey: ["runs"],
    queryFn: async () => {
      const response = await fetch("/api/runs");
      if (!response.ok) {
        return { runs: [] as Array<Record<string, unknown>> };
      }
      return (await response.json()) as { runs: Array<Record<string, unknown>> };
    },
    refetchInterval: 5_000,
  });
  const benchmarksQuery = useQuery({
    queryKey: ["benchmarks"],
    queryFn: async () => {
      const response = await fetch("/api/benchmarks");
      if (!response.ok) {
        return { benchmarkRuns: [] as Array<Record<string, unknown>>, benchmarkSuites: [] as Array<Record<string, unknown>> };
      }
      return (await response.json()) as { benchmarkRuns: Array<Record<string, unknown>>; benchmarkSuites: Array<Record<string, unknown>> };
    },
    refetchInterval: 5_000,
  });
  const resolutionsQuery = useQuery({
    queryKey: ["resolutions"],
    queryFn: async () => {
      const response = await fetch("/api/resolutions");
      if (!response.ok) {
        return { summary: {}, calibrationBuckets: [], pendingForecasts: [], recentScores: [] } as ResolutionDashboard;
      }
      return (await response.json()) as ResolutionDashboard;
    },
    refetchInterval: 5_000,
  });

  async function importBtf2Subset() {
    setImportingBtf2(true);
    try {
      const response = await fetch("/api/benchmarks/import-btf2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maxRows: 10,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      await benchmarksQuery.refetch();
    } finally {
      setImportingBtf2(false);
    }
  }

  async function launchBenchmark(
    evalMode: "fixed_evidence" | "agentic_pastcasting_smoke",
    options: { suiteId?: string; maxCases?: number; experimentLabel?: string } = {},
  ) {
    const response = await fetch("/api/benchmarks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        evalMode,
        maxCases: options.maxCases ?? 1,
        rollouts: evalMode === "fixed_evidence" ? 3 : undefined,
        suiteId: options.suiteId,
        experimentLabel: options.experimentLabel ?? (evalMode === "fixed_evidence" ? "ui-fixed-evidence-smoke" : "ui-live-web-smoke"),
      }),
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }
    await Promise.all([benchmarksQuery.refetch(), runsQuery.refetch()]);
  }

  async function resolvePendingForecast(taskId: string, resolved: boolean) {
    setResolvingTaskId(taskId);
    try {
      const response = await fetch("/api/resolutions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId,
          resolved,
          resolutionSource: "manual:dashboard",
          resolutionExplanation: "Resolved manually from the local dashboard.",
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      await Promise.all([resolutionsQuery.refetch(), runsQuery.refetch()]);
    } finally {
      setResolvingTaskId(null);
    }
  }

  async function decidePromotion(run: Record<string, unknown>, state: PromotionState) {
    const benchmarkRunId = String(run.id ?? "");
    if (!benchmarkRunId) {
      return;
    }
    setPromotionDecisionRunId(benchmarkRunId);
    try {
      const response = await fetch(`/api/benchmarks/${benchmarkRunId}/promotion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state,
          decisionNote: promotionDecisionNote(state, run),
          decidedBy: "local-dashboard",
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      await benchmarksQuery.refetch();
    } finally {
      setPromotionDecisionRunId(null);
    }
  }

  async function compareBenchmarkRun(run: Record<string, unknown>) {
    const benchmarkRunId = String(run.id ?? "");
    if (!benchmarkRunId) {
      return;
    }
    setComparisonRunId(benchmarkRunId);
    try {
      const response = await fetch(`/api/benchmarks/${benchmarkRunId}/comparison`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      await benchmarksQuery.refetch();
    } finally {
      setComparisonRunId(null);
    }
  }

  async function runMaintenanceAction(action: string) {
    setMaintenanceAction(action);
    setMaintenanceError(null);
    try {
      const response = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      await diagnosticsQuery.refetch();
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : String(error));
    } finally {
      setMaintenanceAction(null);
    }
  }

  const resolutionSummary = isRecord(resolutionsQuery.data?.summary) ? resolutionsQuery.data.summary : {};
  const calibrationBuckets = Array.isArray(resolutionsQuery.data?.calibrationBuckets)
    ? resolutionsQuery.data.calibrationBuckets.filter(isRecord)
    : [];
  const pendingForecasts = Array.isArray(resolutionsQuery.data?.pendingForecasts) ? resolutionsQuery.data.pendingForecasts : [];
  const recentScores = Array.isArray(resolutionsQuery.data?.recentScores) ? resolutionsQuery.data.recentScores : [];
  const benchmarkSuites = Array.isArray(benchmarksQuery.data?.benchmarkSuites)
    ? benchmarksQuery.data.benchmarkSuites.filter(isRecord)
    : [];
  const btf2Suite = benchmarkSuites.find((suite) => String(suite.name ?? "").includes("BTF-2")) ?? null;
  const recentRuns = runsQuery.data?.runs ?? [];
  const artifactRuns = recentRuns.filter((run) => typeof run.outputArtifactId === "string").slice(0, 5);

  return (
    <main className="app-shell">
      <AppSidebar active="runs" />

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Open Superforecaster</p>
            <h1>Local durable forecasting workspace</h1>
          </div>
          <div className="variant-chip">
            <GitBranch size={16} />
            forecast workflows
          </div>
        </header>

        <RunComposer onLaunch={async () => {
          await runsQuery.refetch();
        }} />

        <section className="metrics-grid" aria-label="Implementation status">
          <Metric label="Runtime" value="TanStack Start + Bun" />
          <Metric label="Control plane" value="Smithers + CodexAgent" />
          <Metric label="State" value="Postgres + Smithers SQLite" />
          <Metric label="Track record" value={`${formatWhole(resolutionSummary.productResolvedForecasts)} resolved`} />
        </section>

        <section className="panel" id="workflows">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Workflows</p>
              <h2>Runnable modes</h2>
            </div>
            <div className="variant-chip">
              <Workflow size={16} />
              15 covered
            </div>
          </div>
          <WorkflowModeList />
        </section>

        <section className="panel" id="benchmark-lab">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Benchmark Lab</p>
              <h2>Workflow iteration loop</h2>
            </div>
            <div className="button-row">
              <button type="button" onClick={() => void launchBenchmark("fixed_evidence")}>
                <Play size={16} />
                Run fixed evidence
              </button>
              <button className="secondary" type="button" disabled={importingBtf2} onClick={() => void importBtf2Subset()}>
                <Database size={16} />
                Import BTF-2 subset
              </button>
              <button
                className="secondary"
                type="button"
                disabled={!btf2Suite}
                onClick={() => void launchBenchmark("fixed_evidence", {
                  suiteId: String(btf2Suite?.id ?? ""),
                  maxCases: Math.min(3, Number(btf2Suite?.caseCount ?? 1)),
                  experimentLabel: "ui-btf2-fixed-evidence",
                })}
              >
                <Play size={16} />
                Run BTF-2
              </button>
              <button type="button" onClick={() => void launchBenchmark("agentic_pastcasting_smoke")}>
                <Play size={16} />
                Run live-web smoke
              </button>
            </div>
          </div>
          <BenchmarkSuiteStrip suites={benchmarkSuites} />
          <div className="benchmark-list">
            {(benchmarksQuery.data?.benchmarkRuns ?? []).length === 0 ? (
              <p className="muted">No benchmark runs yet. Start fixed evidence for judgment-only scoring or live-web smoke for end-to-end plumbing.</p>
            ) : (
              benchmarksQuery.data?.benchmarkRuns.map((run) => (
                <div className="benchmark-row" key={String(run.id)}>
                  <div>
                    <strong>{String(run.suiteName ?? "Benchmark suite")}</strong>
                    <span>{String(run.evalMode)} / {String(run.caseCount)} case(s)</span>
                    <BenchmarkAnalysisPreview run={run} />
                    <BenchmarkComparisonPreview run={run} />
                    <BenchmarkCaseLinks run={run} />
                    <div className="benchmark-actions">
                      <a className="text-link" href={`/benchmarks/${String(run.id)}`}>
                        <BarChart3 size={14} />
                        Details
                      </a>
                      <button
                        className="compact secondary"
                        type="button"
                        disabled={comparisonRunId === String(run.id) || String(run.status ?? "") === "running" || String(run.status ?? "") === "queued"}
                        onClick={() => void compareBenchmarkRun(run)}
                      >
                        <BarChart3 size={14} />
                        Compare
                      </button>
                    </div>
                    <PromotionStatus run={run} />
                    <PromotionActions
                      run={run}
                      busy={promotionDecisionRunId === String(run.id)}
                      onDecide={(state) => void decidePromotion(run, state)}
                    />
                  </div>
                  <MetricInline icon={<BarChart3 size={16} />} label="Brier" value={formatMetric(run.meanBrier)} />
                  <MetricInline label="Delta" value={formatMetric(run.meanBrierDelta)} />
                  <MetricInline label="Cases" value={formatCaseCounts(run)} />
                  <span className="status warn">{String(run.status)}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Track Record</p>
              <h2>Resolution and scoring loop</h2>
            </div>
            <div className="variant-chip">
              <ClipboardCheck size={16} />
              product forecasts only
            </div>
          </div>
          <div className="track-grid">
            <Metric label="Resolved forecasts" value={formatWhole(resolutionSummary.productResolvedForecasts)} />
            <Metric label="Pending binary" value={formatWhole(resolutionSummary.pendingBinaryForecasts)} />
            <Metric label="Mean Brier" value={formatMetric(resolutionSummary.meanAggregateBrier)} />
            <Metric label="Mean log" value={formatMetric(resolutionSummary.meanAggregateLog)} />
            <Metric label="Calibration" value={formatCalibrationStatus(resolutionSummary)} />
          </div>
          <CalibrationReliability buckets={calibrationBuckets} summary={resolutionSummary} />
          <div className="split-list">
            <div>
              <h3>Pending resolution</h3>
              <div className="resolution-list">
                {pendingForecasts.length === 0 ? (
                  <p className="muted">No completed product binary forecasts are waiting for manual resolution.</p>
                ) : (
                  pendingForecasts.slice(0, 5).map((forecast) => {
                    const taskId = String(forecast.taskId ?? "");
                    return (
                      <div className="resolution-row" key={taskId}>
                        <div>
                          <strong>{String(forecast.label ?? "Binary forecast")}</strong>
                          <span>{formatProbability(forecast.probability)} / {taskId}</span>
                        </div>
                        <div className="button-row">
                          <button type="button" disabled={resolvingTaskId === taskId} onClick={() => void resolvePendingForecast(taskId, true)}>
                            <CheckCircle2 size={16} />
                            Yes
                          </button>
                          <button className="secondary" type="button" disabled={resolvingTaskId === taskId} onClick={() => void resolvePendingForecast(taskId, false)}>
                            <XCircle size={16} />
                            No
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <div>
              <h3>Recent aggregate scores</h3>
              <div className="resolution-list">
                {recentScores.length === 0 ? (
                  <p className="muted">No product forecast scores yet. Resolve a completed binary forecast to start the track record.</p>
                ) : (
                  recentScores.slice(0, 5).map((score) => (
                    <div className="score-row" key={String(score.id)}>
                      <div>
                        <strong>{String(score.taskLabel ?? "Binary forecast")}</strong>
                        <span>{formatProbability(score.probability)} resolved {score.resolved === true ? "yes" : "no"}</span>
                      </div>
                      <MetricInline label="Brier" value={formatMetric(score.scoreValue)} />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="panel" id="artifacts">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Artifacts</p>
              <h2>Recent outputs</h2>
            </div>
            <span className="status warn">{artifactRuns.length} linked</span>
          </div>
          <RecentArtifacts runs={artifactRuns} />
        </section>

        <section className="panel" id="diagnostics">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Diagnostics</p>
              <h2>System checks</h2>
            </div>
            <span className={healthQuery.data?.ok ? "status good" : "status warn"}>
              {healthQuery.isLoading ? "Checking" : healthQuery.data?.ok ? "Ready" : "Needs setup"}
            </span>
          </div>
          {healthQuery.data ? (
            <LocalDiagnosticsPanel
              diagnostics={diagnosticsQuery.data ?? null}
              health={healthQuery.data}
              busyAction={maintenanceAction}
              error={maintenanceError}
              onRunAction={(action) => void runMaintenanceAction(action)}
            />
          ) : (
            <p className="muted">Loading health checks...</p>
          )}
        </section>

        <section className="panel" id="runs">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Run Ledger</p>
              <h2>Recent tasks</h2>
            </div>
            <span className="status warn">Phase 2</span>
          </div>
          <div className="run-list">
            {(runsQuery.data?.runs ?? []).length === 0 ? (
              <p className="muted">No task records yet. Queue the smoke workflow after Postgres migrations are applied.</p>
            ) : (
              runsQuery.data?.runs.map((run) => (
                <div className="run-row" key={String(run.id)}>
                  <div>
                    <strong><a className="text-link inline-link" href={`/runs/${String(run.id)}`}>{String(run.label)}</a></strong>
                    <span>{String(run.operationMode)} / {String(run.operationSubmode ?? "default")}</span>
                    <OutputPreview run={run} />
                  </div>
                  <code>{String(run.smithersRunId ?? "pending")}</code>
                  <span className="status warn">{String(run.status)}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

type ResolutionDashboard = {
  summary: Record<string, unknown>;
  calibrationBuckets: Array<Record<string, unknown>>;
  pendingForecasts: Array<Record<string, unknown>>;
  recentScores: Array<Record<string, unknown>>;
};

type DiagnosticsSnapshot = Record<string, unknown> & {
  settings?: Record<string, unknown>;
  objectStorage?: Record<string, unknown>;
  evalDatasets?: Record<string, unknown>;
  localState?: Record<string, unknown>;
  commands?: Array<Record<string, unknown>>;
  recentMaintenanceJobs?: Array<Record<string, unknown>>;
  links?: Record<string, unknown>;
};

type PromotionState = "candidate" | "promoted_for_local_default" | "promoted_for_eval_only" | "rejected" | "needs_more_cases";

const workflowModes = [
  { group: "Forecast", label: "Binary, date, numeric, categorical, thresholded, conditional" },
  { group: "Research", label: "Deep research with parallel Codex synthesis" },
  { group: "Table", label: "Agent map, classify, rank" },
  { group: "Entity ops", label: "Merge, dedupe" },
  { group: "Benchmark", label: "Fixed evidence, agentic pastcasting smoke" },
  { group: "Runtime", label: "CodexAgent structured-output smoke" },
];

function WorkflowModeList() {
  return (
    <div className="workflow-mode-list">
      {workflowModes.map((mode) => (
        <div className="workflow-mode-row" key={mode.group}>
          <strong>{mode.group}</strong>
          <span>{mode.label}</span>
        </div>
      ))}
    </div>
  );
}

function LocalDiagnosticsPanel({
  diagnostics,
  health,
  busyAction,
  error,
  onRunAction,
}: {
  diagnostics: DiagnosticsSnapshot | null;
  health: HealthSnapshot;
  busyAction: string | null;
  error: string | null;
  onRunAction: (action: string) => void;
}) {
  const settings = isRecord(diagnostics?.settings) ? diagnostics.settings : {};
  const buckets = isRecord(settings.buckets) ? settings.buckets : {};
  const objectStorage = isRecord(diagnostics?.objectStorage) ? diagnostics.objectStorage : {};
  const evalDatasets = isRecord(diagnostics?.evalDatasets) ? diagnostics.evalDatasets : {};
  const localState = isRecord(diagnostics?.localState) ? diagnostics.localState : {};
  const links = isRecord(diagnostics?.links) ? diagnostics.links : {};
  const commands = readArray(diagnostics, "commands").filter(isRecord);
  const recentMaintenanceJobs = readArray(diagnostics, "recentMaintenanceJobs").filter(isRecord);

  return (
    <div className="diagnostics-stack">
      <div className="track-grid">
        <Metric label="Codex model" value={readDisplay(settings, "codexModel")} />
        <Metric label="Codex home" value={readDisplay(settings, "codexHome")} />
        <Metric label="Smithers state" value={readDisplay(settings, "smithersStateDir")} />
        <Metric label="DuckDB" value={readDisplay(settings, "duckdbPath")} />
      </div>

      <div className="detail-grid">
        <section className="subpanel">
          <div className="panel-header compact-header">
            <div>
              <p className="eyebrow">Object Storage</p>
              <h3>Bucket reachability</h3>
            </div>
            <Server size={18} />
          </div>
          <div className="diagnostic-list">
            <DiagnosticBucket label="Artifacts" bucket={readDisplay(buckets, "artifacts")} check={objectStorage.artifacts} />
            <DiagnosticBucket label="Evals" bucket={readDisplay(buckets, "evals")} check={objectStorage.evals} />
            <DiagnosticBucket label="Exports" bucket={readDisplay(buckets, "exports")} check={objectStorage.exports} />
          </div>
        </section>

        <section className="subpanel">
          <div className="panel-header compact-header">
            <div>
              <p className="eyebrow">Eval Data</p>
              <h3>Dataset registry</h3>
            </div>
            <Database size={18} />
          </div>
          <div className="track-grid compact-metrics">
            <Metric label="Suites" value={formatWhole(evalDatasets.suiteCount)} />
            <Metric label="Cases" value={formatWhole(evalDatasets.caseCount)} />
            <Metric label="BTF-2 imports" value={formatWhole(evalDatasets.btf2SuiteCount)} />
            <Metric label="Benchmarks" value={formatWhole(localState.benchmarkRunCount)} />
          </div>
          <LatestSuite suite={isRecord(evalDatasets.latestSuite) ? evalDatasets.latestSuite : null} />
        </section>
      </div>

      <div className="detail-grid">
        <section className="subpanel">
          <div className="panel-header compact-header">
            <div>
              <p className="eyebrow">Local State</p>
              <h3>Projection counts</h3>
            </div>
          </div>
          <div className="track-grid compact-metrics">
            <Metric label="Tasks" value={formatWhole(localState.taskCount)} />
            <Metric label="Artifacts" value={formatWhole(localState.artifactCount)} />
            <Metric label="Sources" value={formatWhole(localState.sourceBankEntryCount)} />
            <Metric label="Scores" value={formatWhole(localState.forecastScoreCount)} />
          </div>
        </section>

        <section className="subpanel">
          <div className="panel-header compact-header">
            <div>
              <p className="eyebrow">Local Services</p>
              <h3>Links</h3>
            </div>
          </div>
          <div className="link-grid">
            {["grafana", "prometheus", "minio", "metrics"].map((key) => (
              <a className="text-link" href={String(links[key] ?? "#")} key={key}>
                {key}
              </a>
            ))}
          </div>
        </section>
      </div>

      <section className="subpanel">
        <div className="panel-header compact-header">
          <div>
            <p className="eyebrow">Operator Commands</p>
            <h3>Local maintenance</h3>
          </div>
          <Terminal size={18} />
        </div>
        <div className="command-list">
          {commands.map((command) => {
            const action = readString(command, "action");
            const busy = Boolean(action && busyAction === action);
            return (
              <div className="command-row" key={String(command.command ?? command.label)}>
                <div>
                  <strong>{String(command.label ?? "Command")}</strong>
                  <span>{String(command.description ?? "")}</span>
                </div>
                <code>{String(command.command ?? "")}</code>
                {action ? (
                  <button className="compact secondary" type="button" disabled={Boolean(busyAction)} onClick={() => onRunAction(action)}>
                    <Play size={14} />
                    {busy ? "Running" : "Run"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        {error ? <p className="status bad maintenance-error">Maintenance action failed</p> : null}
        {recentMaintenanceJobs.length ? (
          <div className="maintenance-job-list">
            {recentMaintenanceJobs.map((job) => (
              <div className="maintenance-job-row" key={String(job.id)}>
                <div>
                  <strong>{formatMaintenanceJobType(String(job.jobType ?? "job"))}</strong>
                  <span>{String(job.command ?? "")}</span>
                </div>
                <span className={job.status === "completed" ? "status good" : job.status === "failed" ? "status bad" : "status warn"}>
                  {String(job.status ?? "queued")}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="subpanel">
        <div className="panel-header compact-header">
          <div>
            <p className="eyebrow">Health Checks</p>
            <h3>Runtime readiness</h3>
          </div>
          <span className={health.ok ? "status good" : "status warn"}>{health.ok ? "Ready" : "Attention"}</span>
        </div>
        <SystemHealthTable health={health} />
      </section>
    </div>
  );
}

function DiagnosticBucket({ label, bucket, check }: { label: string; bucket: string; check: unknown }) {
  const row = isRecord(check) ? check : {};
  const ok = row.ok === true;
  return (
    <div className="diagnostic-row">
      <div>
        <strong>{label}</strong>
        <span>{bucket}</span>
      </div>
      <span className={ok ? "status good" : "status bad"}>
        {ok ? "Reachable" : String(row.error ?? "Unavailable")}
      </span>
    </div>
  );
}

function LatestSuite({ suite }: { suite: Record<string, unknown> | null }) {
  if (!suite) {
    return <p className="muted">No benchmark suites registered yet.</p>;
  }
  return (
    <div className="latest-suite">
      <div>
        <strong>{String(suite.name ?? "Suite")}</strong>
        <span>{String(suite.revision ?? "revision")} / {formatWhole(suite.caseCount)} case(s)</span>
      </div>
      <code>{String(suite.rawSnapshotUri ?? "local registry")}</code>
    </div>
  );
}

function RecentArtifacts({ runs }: { runs: Array<Record<string, unknown>> }) {
  if (runs.length === 0) {
    return <p className="muted">No output artifacts are linked to recent runs yet.</p>;
  }

  return (
    <div className="artifact-summary-list">
      {runs.map((run) => {
        const artifactId = String(run.outputArtifactId ?? "");
        const taskId = String(run.id ?? "");
        return (
          <div className="artifact-summary-row" key={`${taskId}-${artifactId}`}>
            <div>
              <strong>
                <a className="text-link inline-link" href={`/runs/${taskId}`}>
                  {String(run.label ?? "Run artifact")}
                </a>
              </strong>
              <span>{String(run.operationMode)} / {String(run.operationSubmode ?? "default")}</span>
              <code>{artifactId}</code>
            </div>
            <div className="artifact-export-actions">
              <a className="text-link" href={`/api/artifacts/${artifactId}/csv`}>
                <FileJson size={13} />
                CSV
              </a>
              <a className="text-link" href={`/api/artifacts/${artifactId}/parquet`}>
                <FileJson size={13} />
                Parquet
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricInline({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return (
    <div className="inline-metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatMetric(value: unknown) {
  return typeof value === "number" ? value.toFixed(4) : "n/a";
}

function formatWhole(value: unknown) {
  return typeof value === "number" ? String(value) : "0";
}

function formatCaseCounts(run: Record<string, unknown>) {
  const completed = String(run.completedCases ?? 0);
  const running = String(run.runningCases ?? 0);
  const review = Number(run.reviewCases ?? 0);
  const failed = Number(run.failedCases ?? 0);
  return `${completed} done / ${running} running${review ? ` / ${review} review` : ""}${failed ? ` / ${failed} failed` : ""}`;
}

function CalibrationReliability({ buckets, summary }: { buckets: Array<Record<string, unknown>>; summary: Record<string, unknown> }) {
  const sampleSize = readNumber(summary, "calibrationSampleSize", "calibration_sample_size") ?? 0;
  const ece = readNumber(summary, "expectedCalibrationError", "expected_calibration_error");
  return (
    <div className="calibration-panel">
      <div className="calibration-header">
        <h3>Reliability</h3>
        <span>{sampleSize} aggregate score{sampleSize === 1 ? "" : "s"}{ece !== null ? ` · ECE ${ece.toFixed(1)}pp` : ""}</span>
      </div>
      <div className="calibration-buckets">
        {buckets.length === 0 || sampleSize === 0 ? (
          <p className="muted">No resolved aggregate forecasts yet.</p>
        ) : (
          buckets.map((bucket) => {
            const label = readString(bucket, "label") ?? "bucket";
            const count = readNumber(bucket, "count") ?? 0;
            const meanForecast = readNumber(bucket, "meanForecast", "mean_forecast");
            const observedRate = readNumber(bucket, "observedRate", "observed_rate");
            const calibrationError = readNumber(bucket, "calibrationError", "calibration_error");
            return (
              <div className="calibration-row" key={label}>
                <span>{label}</span>
                <div className="calibration-track">
                  <div className="calibration-forecast" style={{ width: `${clampPercent(meanForecast)}%` }} />
                  {observedRate !== null ? <i style={{ left: `${clampPercent(observedRate)}%` }} /> : null}
                </div>
                <strong>
                  {count} · F {formatPercentValue(meanForecast)} · O {formatPercentValue(observedRate)}
                  {calibrationError !== null ? ` · ${calibrationError.toFixed(1)}pp` : ""}
                </strong>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function BenchmarkSuiteStrip({ suites }: { suites: Array<Record<string, unknown>> }) {
  if (suites.length === 0) {
    return null;
  }

  return (
    <div className="suite-strip">
      {suites.slice(0, 4).map((suite) => {
        const policy = isRecord(suite.caseSelectionPolicy) ? suite.caseSelectionPolicy : {};
        const warning = readString(policy, "evalUseWarning", "warning");
        return (
          <div className="suite-pill" key={String(suite.id)}>
            <strong>{String(suite.name ?? "Benchmark suite")}</strong>
            <span>
              {String(suite.caseCount ?? 0)} cases · {String(suite.revision ?? "unknown revision")}
            </span>
            {warning ? <small>{warning}</small> : null}
          </div>
        );
      })}
    </div>
  );
}

function BenchmarkAnalysisPreview({ run }: { run: Record<string, unknown> }) {
  const analysis = isRecord(run.analysis) ? run.analysis : null;
  const clusters = readArray(analysis, "failureClusters", "failure_clusters");
  const proposals = Array.isArray(run.workflowChangeProposals)
    ? run.workflowChangeProposals.filter(isRecord)
    : [];
  const topProposal = proposals[0] ?? null;
  const summary = readString(analysis, "summary");
  const clusterSummary = clusters
    .slice(0, 2)
    .map((cluster) => {
      const label = readString(cluster, "label") ?? "cluster";
      const count = readNumber(cluster, "count");
      return `${label}${count !== null ? ` x${count}` : ""}`;
    })
    .join(", ");
  const proposedChange = readString(topProposal, "proposedChange", "proposed_change");

  if (!summary && !clusterSummary && !proposedChange) {
    return null;
  }

  return (
    <span className="benchmark-analysis">
      {clusterSummary ? `Analysis: ${clusterSummary}` : summary ? `Analysis: ${summary}` : "Analysis captured"}
      {proposedChange ? <span className="benchmark-proposal">Next: {proposedChange}</span> : null}
    </span>
  );
}

function BenchmarkComparisonPreview({ run }: { run: Record<string, unknown> }) {
  const comparison = isRecord(run.comparison) ? run.comparison : null;
  if (!comparison) {
    return null;
  }
  const baselines = readArray(comparison, "baselines").filter(isRecord);
  const recommendation = isRecord(comparison.recommendation) ? comparison.recommendation : null;
  const summary = readString(recommendation, "summary");
  const firstBaseline = baselines[0] ?? null;
  const pairedCaseCount = readNumber(firstBaseline, "pairedCaseCount", "paired_case_count");
  const pairedMeanBrierDelta = readNumber(firstBaseline, "pairedMeanBrierDelta", "paired_mean_brier_delta");
  const pairedUncertainty = isRecord(firstBaseline?.pairedUncertainty) ? firstBaseline.pairedUncertainty : null;
  const brierUncertainty = isRecord(pairedUncertainty?.brierDelta) ? pairedUncertainty.brierDelta : null;
  const brierCiLower = readNumber(brierUncertainty, "lower");
  const brierCiUpper = readNumber(brierUncertainty, "upper");
  const baselineCount = baselines.length;

  return (
    <span className="benchmark-comparison">
      Comparison: {baselineCount} baseline{baselineCount === 1 ? "" : "s"}
      {pairedCaseCount !== null ? ` / ${pairedCaseCount} paired` : ""}
      {pairedMeanBrierDelta !== null ? ` / paired Brier delta ${pairedMeanBrierDelta.toFixed(4)}` : ""}
      {brierCiLower !== null && brierCiUpper !== null ? ` / 95% CI [${brierCiLower.toFixed(4)}, ${brierCiUpper.toFixed(4)}]` : ""}
      {summary ? <span className="benchmark-proposal">Gate: {summary}</span> : null}
    </span>
  );
}

function BenchmarkCaseLinks({ run }: { run: Record<string, unknown> }) {
  const caseResults = Array.isArray(run.caseResults) ? run.caseResults.filter(isRecord) : [];
  if (caseResults.length === 0) {
    return null;
  }
  return (
    <span className="case-link-list">
      {caseResults.slice(0, 3).map((result) => {
        const taskId = readString(result, "taskId", "task_id");
        const traceBundleUri = readString(result, "traceBundleUri", "trace_bundle_uri");
        return (
          <span key={String(result.id)}>
            {taskId ? <a href={`/runs/${taskId}`}>Run detail</a> : "No task"}
            {traceBundleUri ? ` · ${traceBundleUri}` : ""}
          </span>
        );
      })}
      {caseResults.length > 3 ? <span>{caseResults.length - 3} more case(s)</span> : null}
    </span>
  );
}

function PromotionStatus({ run }: { run: Record<string, unknown> }) {
  const state = readString(run, "workflowPromotionState", "workflow_promotion_state") ?? "candidate";
  const latestDecision = isRecord(run.latestPromotionDecision) ? run.latestPromotionDecision : null;
  const note = readString(latestDecision, "decisionNote", "decision_note");
  const decidedBy = readString(latestDecision, "decidedBy", "decided_by");
  return (
    <span className="promotion-status">
      Workflow: {formatPromotionState(state)}
      {note ? <small>{note}{decidedBy ? ` (${decidedBy})` : ""}</small> : null}
    </span>
  );
}

function PromotionActions({
  run,
  busy,
  onDecide,
}: {
  run: Record<string, unknown>;
  busy: boolean;
  onDecide: (state: PromotionState) => void;
}) {
  const status = String(run.status ?? "");
  const disabled = busy || status === "running" || status === "queued";
  return (
    <div className="promotion-actions">
      <button className="compact" type="button" disabled={disabled} onClick={() => onDecide("promoted_for_eval_only")}>
        <CheckCircle2 size={14} />
        Promote eval
      </button>
      <button className="compact secondary" type="button" disabled={disabled} onClick={() => onDecide("promoted_for_local_default")}>
        <CheckCircle2 size={14} />
        Local default
      </button>
      <button className="compact secondary" type="button" disabled={disabled} onClick={() => onDecide("needs_more_cases")}>
        <Database size={14} />
        Need cases
      </button>
      <button className="compact secondary" type="button" disabled={disabled} onClick={() => onDecide("rejected")}>
        <XCircle size={14} />
        Reject
      </button>
    </div>
  );
}

function promotionDecisionNote(state: PromotionState, run: Record<string, unknown>) {
  const suiteName = String(run.suiteName ?? "benchmark suite");
  const caseCount = String(run.caseCount ?? "unknown");
  const brier = formatMetric(run.meanBrier);
  const delta = formatMetric(run.meanBrierDelta);
  if (state === "promoted_for_local_default") {
    return `Promoted as local default from ${suiteName} after ${caseCount} case(s). Mean Brier ${brier}; delta ${delta}.`;
  }
  if (state === "promoted_for_eval_only") {
    return `Promoted for eval-only comparison from ${suiteName} after ${caseCount} case(s). Mean Brier ${brier}; delta ${delta}.`;
  }
  if (state === "needs_more_cases") {
    return `Needs more benchmark cases before promotion. Current evidence: ${suiteName}, ${caseCount} case(s), mean Brier ${brier}, delta ${delta}.`;
  }
  if (state === "rejected") {
    return `Rejected after reviewing ${suiteName}. Current evidence: ${caseCount} case(s), mean Brier ${brier}, delta ${delta}.`;
  }
  return `Reset to candidate from ${suiteName}.`;
}

function formatPromotionState(state: string) {
  if (state === "promoted_for_local_default") {
    return "local default";
  }
  if (state === "promoted_for_eval_only") {
    return "eval-only";
  }
  if (state === "needs_more_cases") {
    return "needs more cases";
  }
  if (state === "rejected") {
    return "rejected";
  }
  return "candidate";
}

function formatMaintenanceJobType(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatProbability(value: unknown) {
  return typeof value === "number" ? `Forecast ${value.toFixed(1)}%` : "Forecast n/a";
}

function formatCalibrationStatus(summary: Record<string, unknown>) {
  const sampleSize = readNumber(summary, "calibrationSampleSize", "calibration_sample_size") ?? 0;
  const minimum = readNumber(summary, "calibrationMinimumForFitting", "calibration_minimum_for_fitting") ?? 25;
  const ece = readNumber(summary, "expectedCalibrationError", "expected_calibration_error");
  if (sampleSize < minimum) {
    return `${sampleSize}/${minimum} samples`;
  }
  return ece === null ? "Ready" : `${ece.toFixed(1)}pp ECE`;
}

function formatPercentValue(value: number | null) {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}

function clampPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function OutputPreview({ run }: { run: Record<string, unknown> }) {
  const output = isRecord(run.outputPreview) ? run.outputPreview : null;
  const probability = typeof output?.probability === "number" ? output.probability : null;
  const forecastType = typeof output?.forecastType === "string" ? output.forecastType : typeof output?.forecast_type === "string" ? output.forecast_type : null;
  const reportType = readString(output, "reportType", "report_type");
  const rowCount = readNumber(output, "row_count", "rowCount");
  const completedRows = readNumber(output, "completed_rows", "completedRows");
  const classCount = readNumber(output, "class_count", "classCount");
  const sourceCount = typeof run.sourceCount === "number" ? run.sourceCount : 0;

  const typedForecast = formatTypedForecast(output, forecastType);

  if (probability === null && sourceCount === 0 && rowCount === null && !typedForecast) {
    return null;
  }

  if (rowCount !== null) {
    if (reportType === "merge") {
      return (
        <span>
          Merge {completedRows ?? rowCount}/{rowCount}
          {sourceCount > 0 ? ` · ${sourceCount} sources` : ""}
        </span>
      );
    }
    if (reportType === "dedupe") {
      return (
        <span>
          Dedupe {classCount ?? "n/a"} classes / {rowCount} rows
          {sourceCount > 0 ? ` · ${sourceCount} sources` : ""}
        </span>
      );
    }
    return (
      <span>
        Rows {completedRows ?? rowCount}/{rowCount}
        {sourceCount > 0 ? ` · ${sourceCount} sources` : ""}
      </span>
    );
  }

  if (typedForecast) {
    return (
      <span>
        {typedForecast}
        {sourceCount > 0 ? ` · ${sourceCount} sources` : ""}
      </span>
    );
  }

  return (
    <span>
      {probability !== null ? `Forecast ${probability}%` : "Output captured"}
      {sourceCount > 0 ? ` · ${sourceCount} sources` : ""}
    </span>
  );
}

function formatTypedForecast(output: Record<string, unknown> | null, forecastType: string | null) {
  if (!output) {
    return null;
  }
  if (forecastType === "date") {
    const targetDate = readString(output, "targetDate", "target_date");
    return targetDate ? `Date ${targetDate}` : null;
  }
  if (forecastType === "numeric") {
    const value = readNumber(output, "value");
    const unit = readString(output, "unit");
    return value !== null ? `Value ${value}${unit ? ` ${unit}` : ""}` : null;
  }
  if (forecastType === "categorical") {
    const topCategory = readString(output, "topCategory", "top_category");
    return topCategory ? `Top ${topCategory}` : null;
  }
  if (forecastType === "thresholded") {
    const probabilities = readArray(output, "probabilities");
    const direction = readString(output, "thresholdDirection", "threshold_direction");
    return probabilities.length ? `Thresholded ${probabilities.length} cutoffs${direction ? ` / ${direction}` : ""}` : null;
  }
  if (forecastType === "conditional") {
    const yes = readNumber(output, "probabilityGivenCondition", "probability_given_condition");
    const no = readNumber(output, "probabilityGivenNotCondition", "probability_given_not_condition");
    return yes !== null && no !== null ? `Conditional ${yes}% / ${no}%` : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: Record<string, unknown> | null, ...keys: string[]) {
  if (!value) {
    return null;
  }
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "number") {
      return raw;
    }
  }
  return null;
}

function readString(value: Record<string, unknown> | null, ...keys: string[]) {
  if (!value) {
    return null;
  }
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "string") {
      return raw;
    }
  }
  return null;
}

function readDisplay(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  if (typeof raw === "number") {
    return String(raw);
  }
  return "n/a";
}

function readArray(value: Record<string, unknown> | null, ...keys: string[]) {
  if (!value) {
    return [];
  }
  for (const key of keys) {
    const raw = value[key];
    if (Array.isArray(raw)) {
      return raw;
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
  }
  return [];
}
