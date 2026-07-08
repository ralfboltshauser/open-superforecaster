import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type CellContext,
  type ColumnDef,
} from "@tanstack/react-table";
import { ArrowLeft, BarChart3, FileJson, GitBranch, Link as LinkIcon, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { AppSidebar } from "../components/app-sidebar";

export const Route = createFileRoute("/runs/$taskId")({
  component: RunDetail,
});

function RunDetail() {
  const { taskId } = Route.useParams();
  const [retryingRowId, setRetryingRowId] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<RunStreamState>({
    connected: false,
    status: "connecting",
    lastEvent: null,
    progress: null,
  });
  const query = useQuery({
    queryKey: ["run-detail", taskId],
    queryFn: async () => {
      const response = await fetch(`/api/runs/${taskId}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return (await response.json()) as { run: Record<string, unknown> };
    },
    refetchInterval: 5_000,
  });

  useEffect(() => {
    const events = new EventSource(`/api/runs/${taskId}/events`);
    setStreamState({
      connected: false,
      status: "connecting",
      lastEvent: null,
      progress: null,
    });

    events.addEventListener("open", () => {
      setStreamState((current) => ({ ...current, connected: true }));
    });
    events.addEventListener("status", (event) => {
      const task = parseEventData(event);
      setStreamState((current) => ({
        ...current,
        connected: true,
        status: readString(task, "status") ?? current.status,
        progress: task
          ? {
              total: readNumber(task, "progressTotal") ?? 0,
              running: readNumber(task, "progressRunning") ?? 0,
              completed: readNumber(task, "progressCompleted") ?? 0,
              failed: readNumber(task, "progressFailed") ?? 0,
            }
          : current.progress,
      }));
      void query.refetch();
    });
    events.addEventListener("trace", (event) => {
      const traceEvent = parseEventData(event);
      setStreamState((current) => ({
        ...current,
        connected: true,
        lastEvent: traceEvent
          ? {
              sequenceNumber: readNumber(traceEvent, "sequenceNumber"),
              eventType: readString(traceEvent, "eventType"),
              phase: readString(traceEvent, "phase"),
            }
          : current.lastEvent,
      }));
      void query.refetch();
    });
    events.addEventListener("done", (event) => {
      const done = parseEventData(event);
      setStreamState((current) => ({
        ...current,
        connected: false,
        status: readString(done, "status") ?? current.status,
      }));
      void query.refetch();
      events.close();
    });
    events.onerror = () => {
      setStreamState((current) => ({ ...current, connected: false }));
    };

    return () => {
      events.close();
    };
  }, [taskId]);

  const run = isRecord(query.data?.run) ? query.data.run : null;
  const task = isRecord(run?.task) ? run.task : null;
  const taskRows = readArray(run, "taskRows").filter(isRecord);
  const artifacts = readArray(run, "artifacts").filter(isRecord);
  const sources = readArray(run, "sources").filter(isRecord);
  const attempts = readArray(run, "forecastAttempts").filter(isRecord);
  const aggregates = readArray(run, "forecastAggregates").filter(isRecord);
  const scores = readArray(run, "forecastScores").filter(isRecord);
  const benchmarkResults = readArray(run, "benchmarkCaseResults").filter(isRecord);
  const traceEvents = readArray(run, "traceEvents").filter(isRecord);
  const rowRetryable = task ? ["agent_map", "classify", "rank"].includes(String(task.operationSubmode ?? "")) : false;
  const forecastOutput = task && String(task.operationSubmode ?? "").endsWith("_forecast")
    ? firstArtifactOutput(artifacts)
    : null;

  async function retryTaskRow(rowId: string) {
    setRetryingRowId(rowId);
    try {
      const response = await fetch(`/api/runs/${taskId}/rows/${rowId}/retry`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      await query.refetch();
    } finally {
      setRetryingRowId(null);
    }
  }

  return (
    <main className="app-shell">
      <AppSidebar active="runs" />

      <section className="workspace">
        <header className="topbar">
          <div>
            <a className="text-link" href="/"><ArrowLeft size={15} /> Runs</a>
            <p className="eyebrow">Run Detail</p>
            <h1>{task ? taskTitle(task) : "Loading run"}</h1>
          </div>
          <div className="variant-chip">
            <GitBranch size={16} />
            {task ? String(task.status ?? "unknown") : "loading"}
          </div>
        </header>

        {query.isError ? (
          <section className="panel">
            <p className="muted">{query.error instanceof Error ? query.error.message : "Run detail failed to load."}</p>
          </section>
        ) : null}

        {task ? (
          <>
            <section className="metrics-grid detail-metrics" aria-label="Run facts">
              <Metric label="Mode" value={`${String(task.operationMode)} / ${String(task.operationSubmode ?? "default")}`} />
              <Metric label="Smithers run" value={String(task.smithersRunId ?? "pending")} />
              <Metric label="Artifacts" value={String(artifacts.length)} />
              <Metric label="Sources" value={String(sources.length)} />
            </section>

            <RunStreamPanel streamState={streamState} />

            {forecastOutput ? (
              <ForecastOutputCard output={forecastOutput} submode={String(task.operationSubmode ?? "")} />
            ) : null}

            {taskRows.length ? (
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Rows</p>
                    <h2>Progress and retry ledger</h2>
                  </div>
                  <span className="status warn">{taskRows.length} row{taskRows.length === 1 ? "" : "s"}</span>
                </div>
                <TaskRowLedger
                  rows={taskRows}
                  retryable={rowRetryable}
                  retryingRowId={retryingRowId}
                  onRetry={(rowId) => void retryTaskRow(rowId)}
                />
              </section>
            ) : null}

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Output</p>
                  <h2>Artifacts and rows</h2>
                </div>
                <a className="button-link" href={String(run?.traceBundleApiPath ?? `/api/runs/${taskId}/trace-bundle`)}>
                  <FileJson size={16} />
                  Trace bundle
                </a>
              </div>
              {artifacts.length === 0 ? (
                <p className="muted">No artifacts have been persisted for this run.</p>
              ) : (
                <div className="detail-list">
                  {artifacts.map((artifact) => (
                    <ArtifactBlock artifact={artifact} key={String(artifact.id)} />
                  ))}
                </div>
              )}
            </section>

            <section className="detail-grid">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Sources</p>
                    <h2>Citations and source bank</h2>
                  </div>
                  <span className="status warn">{sources.length} rows</span>
                </div>
                <SourceList sources={sources} />
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Forecast Ledger</p>
                    <h2>Attempts, aggregate, scores</h2>
                  </div>
                  <BarChart3 size={18} />
                </div>
                <ForecastLedger attempts={attempts} aggregates={aggregates} scores={scores} benchmarkResults={benchmarkResults} />
              </section>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Trace</p>
                  <h2>Recent persisted events</h2>
                </div>
                <span className="status warn">{traceEvents.length} shown</span>
              </div>
              <TraceEventList events={traceEvents} />
            </section>
          </>
        ) : (
          <section className="panel">
            <p className="muted">Loading run detail...</p>
          </section>
        )}
      </section>
    </main>
  );
}

type RunStreamState = {
  connected: boolean;
  status: string;
  progress: null | {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
  lastEvent: null | {
    sequenceNumber: number | null;
    eventType: string | null;
    phase: string | null;
  };
};

type ArtifactTableRow = {
  id: string;
  index: string;
  values: Record<string, unknown>;
};

function RunStreamPanel({ streamState }: { streamState: RunStreamState }) {
  const progress = streamState.progress;
  return (
    <section className="stream-panel" aria-label="Live run stream">
      <div>
        <span className={streamState.connected ? "stream-dot live" : "stream-dot"} />
        <strong>{streamState.connected ? "Live stream connected" : "Stream idle"}</strong>
        <span>{streamState.status}</span>
      </div>
      {progress ? (
        <div className="stream-progress">
          <span>{progress.completed}/{progress.total || "?"} done</span>
          <span>{progress.running} running</span>
          <span>{progress.failed} failed</span>
        </div>
      ) : null}
      {streamState.lastEvent ? (
        <div className="stream-event">
          <code>{streamState.lastEvent.sequenceNumber ?? "-"}</code>
          <span>{streamState.lastEvent.eventType ?? "event"} · {streamState.lastEvent.phase ?? "phase"}</span>
        </div>
      ) : null}
    </section>
  );
}

function TaskRowLedger({
  rows,
  retryable,
  retryingRowId,
  onRetry,
}: {
  rows: Array<Record<string, unknown>>;
  retryable: boolean;
  retryingRowId: string | null;
  onRetry: (rowId: string) => void;
}) {
  return (
    <div className="task-row-list">
      {rows.map((row) => {
        const rowId = String(row.id ?? "");
        const status = String(row.status ?? "unknown");
        const sourceRowId = String(row.sourceRowId ?? rowId.slice(0, 8));
        const retryCount = readNumber(row, "retryCount", "retry_count") ?? 0;
        return (
          <div className="task-row" key={rowId}>
            <div>
              <strong>{sourceRowId}</strong>
              <span>{status}{retryCount ? ` · ${retryCount} retr${retryCount === 1 ? "y" : "ies"}` : ""}</span>
            </div>
            {retryable ? (
              <button
                className="compact secondary"
                type="button"
                disabled={!rowId || retryingRowId === rowId}
                onClick={() => onRetry(rowId)}
              >
                <RotateCcw size={13} />
                {retryingRowId === rowId ? "Retrying" : "Retry"}
              </button>
            ) : (
              <span className="muted">Relation-level workflow</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ForecastOutputCard({ output, submode }: { output: Record<string, unknown>; submode: string }) {
  const forecastType = readString(output, "forecastType", "forecast_type") ?? submode.replace("_forecast", "");
  const method = readString(output, "method") ?? "unknown method";
  const rationale = readString(output, "rationale") ?? readString(output, "branchRationale", "branch_rationale") ?? "";

  return (
    <section className="panel forecast-card">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Forecast Output</p>
          <h2>{formatModeLabel(forecastType)}</h2>
        </div>
        <span className="status warn">{formatModeLabel(method)}</span>
      </div>
      <ForecastBody output={output} forecastType={forecastType} />
      {rationale ? <p className="forecast-rationale">{rationale}</p> : null}
    </section>
  );
}

function ForecastBody({ output, forecastType }: { output: Record<string, unknown>; forecastType: string }) {
  if (forecastType === "date") {
    const distribution = readRecordLike(output, "dateDistribution", "date_distribution");
    const targetDate = readString(output, "targetDate", "target_date");
    const neverProbability = readNumber(output, "neverProbability", "never_probability");
    return (
      <div className="forecast-grid">
        <ForecastMetric label="Target" value={targetDate ?? "n/a"} />
        <ForecastMetric label="Never" value={formatPercent(neverProbability)} />
        <ForecastMetric label="P10" value={readString(distribution, "p10") ?? "n/a"} />
        <ForecastMetric label="P50" value={readString(distribution, "p50") ?? targetDate ?? "n/a"} />
        <ForecastMetric label="P90" value={readString(distribution, "p90") ?? "n/a"} />
      </div>
    );
  }

  if (forecastType === "numeric") {
    const distribution = readRecordLike(output, "distribution");
    const value = readNumber(output, "value");
    const unit = readString(output, "unit") ?? "";
    return (
      <div className="forecast-grid">
        <ForecastMetric label="Value" value={value === null ? "n/a" : `${formatNumber(value)} ${unit}`.trim()} />
        <ForecastMetric label="Low" value={formatMaybeNumber(readNumber(distribution, "low"))} />
        <ForecastMetric label="Median" value={formatMaybeNumber(readNumber(distribution, "median"))} />
        <ForecastMetric label="High" value={formatMaybeNumber(readNumber(distribution, "high"))} />
      </div>
    );
  }

  if (forecastType === "categorical") {
    const probabilities = readArrayLike(output, "probabilities")
      .map((item) => ({
        label: readString(item, "category") ?? "Category",
        probability: readNumber(item, "probability") ?? 0,
      }))
      .slice(0, 8);
    return <ProbabilityList items={probabilities} />;
  }

  if (forecastType === "thresholded") {
    const direction = readString(output, "thresholdDirection", "threshold_direction") ?? "threshold";
    const probabilities = readArrayLike(output, "probabilities")
      .map((item) => ({
        label: readString(item, "threshold") ?? "Threshold",
        probability: readNumber(item, "probability") ?? 0,
      }))
      .slice(0, 12);
    return (
      <div className="forecast-stack">
        <ForecastMetric label="Direction" value={formatModeLabel(direction)} />
        <ProbabilityList items={probabilities} />
      </div>
    );
  }

  if (forecastType === "conditional") {
    const condition = readString(output, "condition") ?? "Condition";
    const conditionProbability = readNumber(output, "conditionProbability", "condition_probability");
    const yes = readNumber(output, "probabilityGivenCondition", "probability_given_condition");
    const no = readNumber(output, "probabilityGivenNotCondition", "probability_given_not_condition");
    return (
      <div className="forecast-stack">
        <p className="forecast-condition">{condition}</p>
        <div className="forecast-grid">
          <ForecastMetric label="P(condition)" value={formatPercent(conditionProbability)} />
          <ForecastMetric label="P(outcome | condition)" value={formatPercent(yes)} />
          <ForecastMetric label="P(outcome | not)" value={formatPercent(no)} />
          <ForecastMetric label="Delta" value={formatPercent(readNumber(output, "probabilityDelta", "probability_delta"))} />
        </div>
      </div>
    );
  }

  const probability = readNumber(output, "probability");
  return <ProbabilityList items={[{ label: "Outcome", probability: probability ?? 0 }]} />;
}

function ForecastMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="forecast-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ProbabilityList({ items }: { items: Array<{ label: string; probability: number }> }) {
  if (items.length === 0) {
    return <p className="muted">No probability distribution persisted.</p>;
  }
  return (
    <div className="probability-list">
      {items.map((item) => (
        <div className="probability-row" key={item.label}>
          <div>
            <strong>{item.label}</strong>
            <span>{formatPercent(item.probability)}</span>
          </div>
          <div className="probability-track" aria-hidden="true">
            <span style={{ width: `${clampPercent(item.probability)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ArtifactBlock({ artifact }: { artifact: Record<string, unknown> }) {
  const rows = readArray(artifact, "rows").filter(isRecord);
  return (
    <div className="artifact-block">
      <div className="artifact-heading">
        <div>
          <strong>{String(artifact.artifactType ?? "artifact")}</strong>
          <span>{String(artifact.id)} · {String(artifact.storageUri ?? "no storage uri")}</span>
        </div>
        <div className="artifact-actions">
          <a className="text-link" href={`/api/artifacts/${String(artifact.id)}/csv`}>
            <FileJson size={13} />
            CSV
          </a>
          <a className="text-link" href={`/api/artifacts/${String(artifact.id)}/parquet`}>
            <FileJson size={13} />
            Parquet
          </a>
          <span className="status warn">{rows.length} row{rows.length === 1 ? "" : "s"}</span>
        </div>
      </div>
      {rows.length ? <ArtifactRows rows={rows} /> : <p className="muted">No artifact rows persisted.</p>}
    </div>
  );
}

function ArtifactRows({ rows }: { rows: Array<Record<string, unknown>> }) {
  const rowObjects = rows.map((row) => (isRecord(row.rowJson) ? row.rowJson : {}));
  const valueColumns = Array.from(new Set(rowObjects.flatMap((row) => Object.keys(row)))).slice(0, 6);
  const tableRows = rowObjects.slice(0, 12).map((row, index) => ({
    id: String(rows[index]?.id ?? `${index}`),
    index: String(rows[index]?.rowIndex ?? index),
    values: row,
  }));
  const tableColumns: Array<ColumnDef<ArtifactTableRow>> = [
    {
      id: "rowIndex",
      header: "#",
      cell: ({ row }) => row.original.index,
    },
    ...valueColumns.map((column): ColumnDef<ArtifactTableRow> => ({
      id: column,
      header: column,
      accessorFn: (row: ArtifactTableRow) => row.values[column],
      cell: ({ getValue }: CellContext<ArtifactTableRow, unknown>) => formatCell(getValue()),
    })),
  ];
  const table = useReactTable({
    data: tableRows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (valueColumns.length === 0) {
    return <JsonBlock value={rows[0]?.rowJson ?? rows[0]} />;
  }
  return (
    <div className="artifact-table-wrap">
      <table className="data-table compact-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.original.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rowObjects.length > 12 ? <p className="muted">Showing first 12 rows.</p> : null}
      <details>
        <summary>Raw first row</summary>
        <JsonBlock value={rowObjects[0]} />
      </details>
    </div>
  );
}

function SourceList({ sources }: { sources: Array<Record<string, unknown>> }) {
  if (sources.length === 0) {
    return <p className="muted">No source-bank rows persisted.</p>;
  }
  return (
    <div className="source-list">
      {sources.slice(0, 20).map((source) => {
        const url = readString(source, "url");
        return (
          <div className="source-row" key={String(source.id)}>
            <strong>{String(source.title ?? source.domain ?? "Source")}</strong>
            <span>{String(source.contentSummary ?? "")}</span>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer">
                <LinkIcon size={13} />
                {url}
              </a>
            ) : null}
          </div>
        );
      })}
      {sources.length > 20 ? <p className="muted">Showing first 20 sources.</p> : null}
    </div>
  );
}

function ForecastLedger({
  attempts,
  aggregates,
  scores,
  benchmarkResults,
}: {
  attempts: Array<Record<string, unknown>>;
  aggregates: Array<Record<string, unknown>>;
  scores: Array<Record<string, unknown>>;
  benchmarkResults: Array<Record<string, unknown>>;
}) {
  return (
    <div className="ledger-list">
      <LedgerMetric label="Attempts" value={String(attempts.length)} />
      <LedgerMetric label="Aggregates" value={String(aggregates.length)} />
      <LedgerMetric label="Scores" value={String(scores.length)} />
      <LedgerMetric label="Benchmark cases" value={String(benchmarkResults.length)} />
      {aggregates[0] ? (
        <details>
          <summary>Aggregate output</summary>
          <JsonBlock value={aggregates[0].rawAggregate ?? aggregates[0].raw_aggregate ?? aggregates[0]} />
        </details>
      ) : null}
      {scores.length ? (
        <div className="score-chip-list">
          {scores.slice(0, 12).map((score) => (
            <span className="score-chip" key={String(score.id)}>
              {String(score.scoreType ?? "score")}: {formatMetric(score.scoreValue)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TraceEventList({ events }: { events: Array<Record<string, unknown>> }) {
  if (events.length === 0) {
    return <p className="muted">No trace events persisted.</p>;
  }
  return (
    <div className="trace-event-list">
      {events.map((event) => (
        <div className="trace-event-row" key={String(event.id)}>
          <code>{String(event.sequenceNumber ?? "")}</code>
          <strong>{String(event.eventType ?? "event")}</strong>
          <span>{String(event.phase ?? "phase")} · {formatDate(event.createdAt)}</span>
          <JsonBlock value={event.payloadJson ?? {}} compact />
        </div>
      ))}
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

function LedgerMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="ledger-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function JsonBlock({ value, compact = false }: { value: unknown; compact?: boolean }) {
  return <pre className={compact ? "json-snippet compact-json" : "json-snippet"}>{JSON.stringify(value, null, 2)}</pre>;
}

function taskTitle(task: Record<string, unknown>) {
  const submode = String(task.operationSubmode ?? "");
  if (submode.endsWith("_forecast")) {
    return `${formatModeLabel(submode.replace("_forecast", ""))} forecast`;
  }
  return String(task.label ?? "Run");
}

function firstArtifactOutput(artifacts: Array<Record<string, unknown>>) {
  for (const artifact of artifacts) {
    const rows = readArray(artifact, "rows").filter(isRecord);
    const summaryRow = rows.find((row) => readNumber(row, "rowIndex", "row_index") === 0) ?? rows[0];
    if (isRecord(summaryRow?.rowJson)) {
      return summaryRow.rowJson;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  }
  return [];
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

function readRecordLike(value: Record<string, unknown> | null, ...keys: string[]) {
  if (!value) {
    return null;
  }
  for (const key of keys) {
    const raw = value[key];
    if (isRecord(raw)) {
      return raw;
    }
    if (typeof raw === "string") {
      const parsed = parseJsonCell(raw);
      if (isRecord(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function readArrayLike(value: Record<string, unknown> | null, ...keys: string[]) {
  if (!value) {
    return [];
  }
  for (const key of keys) {
    const raw = value[key];
    if (Array.isArray(raw)) {
      return raw.filter(isRecord);
    }
    if (typeof raw === "string") {
      const parsed = parseJsonCell(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(isRecord);
      }
    }
  }
  return [];
}

function parseEventData(event: Event) {
  if (!("data" in event) || typeof event.data !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(event.data);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "0 items";
    }
    if (value.every((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")) {
      return value.map(String).join(", ").slice(0, 160);
    }
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    return keys.length ? `{${keys.slice(0, 5).join(", ")}}` : "{}";
  }
  if (typeof value === "string") {
    const parsed = parseJsonCell(value);
    if (parsed !== null) {
      return summarizeStructuredCell(parsed);
    }
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function parseJsonCell(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function summarizeStructuredCell(value: unknown): string {
  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    return keys.length ? `{${keys.slice(0, 5).join(", ")}}` : "{}";
  }
  return String(value);
}

function formatModeLabel(value: string) {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatMaybeNumber(value: number | null) {
  return value === null ? "n/a" : formatNumber(value);
}

function formatPercent(value: number | null) {
  return value === null ? "n/a" : `${formatNumber(value)}%`;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function formatMetric(value: unknown) {
  return typeof value === "number" ? value.toFixed(4) : "n/a";
}

function formatDate(value: unknown) {
  return typeof value === "string" ? new Date(value).toLocaleString() : "unknown time";
}
