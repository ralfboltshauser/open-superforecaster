"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleDot,
  FileJson,
  FileText,
  LinkIcon,
  Loader2,
  Network,
  RotateCcw,
} from "lucide-react"

import { AppShell } from "@/components/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  formatModeLabel,
  isRecord,
  parseEventData,
  questionTitle,
  readArray,
  readNumber,
  readString,
  statusTone,
  truncate,
  type JsonRecord,
} from "@/lib/records"

type RunStreamState = {
  connected: boolean
  status: string
  progress: { total: number; running: number; completed: number; failed: number } | null
  lastEvent: JsonRecord | null
}

export function RunWorkspace({ taskId }: { taskId: string }) {
  const [runs, setRuns] = useState<JsonRecord[]>([])
  const [run, setRun] = useState<JsonRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryingRowId, setRetryingRowId] = useState<string | null>(null)
  const [streamState, setStreamState] = useState<RunStreamState>({
    connected: false,
    status: "connecting",
    progress: null,
    lastEvent: null,
  })

  const loadRun = useCallback(async () => {
    const response = await fetch(`/api/runs/${taskId}`)
    if (!response.ok) {
      throw new Error(await response.text())
    }
    const payload = (await response.json()) as { run?: JsonRecord }
    setRun(isRecord(payload.run) ? payload.run : null)
  }, [taskId])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setError(null)
        await loadRun()
        const response = await fetch("/api/runs")
        if (response.ok) {
          const payload = (await response.json()) as { runs?: JsonRecord[] }
          if (!cancelled) {
            setRuns(Array.isArray(payload.runs) ? payload.runs : [])
          }
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }
    void load()
    const interval = window.setInterval(() => void load(), 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [taskId, loadRun])

  useEffect(() => {
    const events = new EventSource(`/api/runs/${taskId}/events`)

    events.addEventListener("open", () => {
      setStreamState((current) => ({ ...current, connected: true }))
    })
    events.addEventListener("status", (event) => {
      const task = parseEventData(event)
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
      }))
      void loadRun().catch(() => undefined)
    })
    events.addEventListener("trace", (event) => {
      const traceEvent = parseEventData(event)
      setStreamState((current) => ({
        ...current,
        connected: true,
        lastEvent: traceEvent,
      }))
      void loadRun().catch(() => undefined)
    })
    events.addEventListener("done", (event) => {
      const done = parseEventData(event)
      setStreamState((current) => ({
        ...current,
        connected: false,
        status: readString(done, "status") ?? current.status,
      }))
      void loadRun().catch(() => undefined)
      events.close()
    })
    events.onerror = () => {
      setStreamState((current) => ({ ...current, connected: false }))
    }
    return () => events.close()
  }, [taskId, loadRun])

  const detail = useMemo(() => buildRunDetail(run), [run])

  async function retryTaskRow(rowId: string) {
    setRetryingRowId(rowId)
    try {
      const response = await fetch(`/api/runs/${taskId}/rows/${rowId}/retry`, { method: "POST" })
      if (!response.ok) {
        throw new Error(await response.text())
      }
      await loadRun()
    } finally {
      setRetryingRowId(null)
    }
  }

  return (
    <AppShell runs={runs}>
      <main className="min-h-svh px-4 py-4 md:px-8">
        <header className="flex flex-col gap-5 border-b border-border/70 pb-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-4xl">
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
              <ArrowLeft data-icon="inline-start" />
              New forecast
            </Button>
            <p className="fs-eyebrow mt-5 text-primary/80">Forecast workspace</p>
            <h1 className="mt-3 max-w-5xl text-xl font-medium leading-tight text-foreground md:text-3xl">{detail.title}</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {detail.task ? `${formatModeLabel(detail.task.operationSubmode ?? detail.task.operationMode)} · ${String(detail.task.status ?? "unknown")}` : "Loading run"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className={streamState.connected ? "border-primary text-primary" : ""}>
              {streamState.connected ? "Live" : "Idle"}
            </Badge>
            <Badge variant="secondary" className={statusTone(detail.task?.status)}>
              {String(detail.task?.status ?? streamState.status)}
            </Badge>
          </div>
        </header>

        {error ? (
          <Card className="mt-6 border-destructive/40">
            <CardContent className="text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : null}

        {loading && !detail.task ? (
          <section className="mt-6 grid gap-4 xl:grid-cols-[minmax(360px,0.52fr)_minmax(0,0.48fr)]">
            <Card className="fs-panel">
              <CardHeader>
                <CardTitle className="text-base">Briefing researchers</CardTitle>
                <CardDescription>Loading run detail, trace events, and source bank.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3 rounded-md border bg-muted/25 px-3 py-2 text-sm text-forecast">
                  <Loader2 className="size-4 animate-spin" />
                  asking researchers
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-5/6 rounded bg-muted" />
                  <div className="h-3 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-4/5 rounded bg-muted" />
                </div>
                <div className="grid grid-cols-8 gap-2">
                  {Array.from({ length: 16 }, (_, index) => (
                    <span className="flex size-8 items-center justify-center rounded-full border border-muted text-muted-foreground" key={index}>
                      <Bot className="size-4" />
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="fs-artifact">
              <CardHeader>
                <CardTitle className="text-xl text-forecast">Forecast artifact pending</CardTitle>
                <CardDescription>The final distribution will appear here.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="h-10 w-48 rounded bg-success/15" />
                <div className="grid grid-cols-5 gap-3">
                  {Array.from({ length: 5 }, (_, index) => (
                    <div className="h-14 rounded-md bg-muted/35" key={index} />
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="h-3 rounded bg-muted" />
                  <div className="h-3 w-11/12 rounded bg-muted" />
                  <div className="h-3 w-4/5 rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          </section>
        ) : null}

        {detail.task ? (
          <Tabs defaultValue="overview" className="mt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <TabsList>
                <TabsTrigger value="overview">overview</TabsTrigger>
                <TabsTrigger value="results">results</TabsTrigger>
                <TabsTrigger value="researchers">researchers</TabsTrigger>
                <TabsTrigger value="sources">sources</TabsTrigger>
                <TabsTrigger value="debug">debug</TabsTrigger>
              </TabsList>
              <RunStreamPanel streamState={streamState} />
            </div>

            <TabsContent value="overview" className="mt-6">
              <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.52fr)_minmax(0,0.48fr)]">
                <div className="grid gap-6">
                  <ResearchNarrativePanel task={detail.task} sources={detail.sources} streamState={streamState} traceEvents={detail.traceEvents} />
                  <ResearchTeamPanel attempts={detail.attempts} traceEvents={detail.traceEvents} streamState={streamState} />
                  <SourceMap sources={detail.sources} />
                </div>
                <ForecastResultPanel output={detail.forecastOutput} task={detail.task} />
              </div>
            </TabsContent>

            <TabsContent value="results" className="mt-6">
              <div className="grid gap-6">
                <ForecastResultPanel output={detail.forecastOutput} task={detail.task} expanded />
                <EvidenceStrip sources={detail.sources} />
              </div>
            </TabsContent>

            <TabsContent value="researchers" className="mt-6">
              <div className="grid gap-6">
                <ResearchTeamPanel attempts={detail.attempts} traceEvents={detail.traceEvents} streamState={streamState} expanded />
                <ForecastLedger attempts={detail.attempts} aggregates={detail.aggregates} scores={detail.scores} />
              </div>
            </TabsContent>

            <TabsContent value="sources" className="mt-6">
              <SourceList sources={detail.sources} />
            </TabsContent>

            <TabsContent value="debug" className="mt-6">
              <div className="grid gap-6">
                <MetricGrid task={detail.task} artifacts={detail.artifacts} sources={detail.sources} taskId={taskId} />
                <TaskRows rows={detail.taskRows} retryingRowId={retryingRowId} onRetry={(rowId) => void retryTaskRow(rowId)} />
                <TraceEvents events={detail.traceEvents} />
              </div>
            </TabsContent>
          </Tabs>
        ) : null}
      </main>
    </AppShell>
  )
}

function buildRunDetail(run: JsonRecord | null) {
  const task = isRecord(run?.task) ? run.task : null
  const taskRows = readArray(run, "taskRows").filter(isRecord)
  const artifacts = readArray(run, "artifacts").filter(isRecord)
  const sources = readArray(run, "sources").filter(isRecord)
  const attempts = readArray(run, "forecastAttempts").filter(isRecord)
  const aggregates = readArray(run, "forecastAggregates").filter(isRecord)
  const scores = readArray(run, "forecastScores").filter(isRecord)
  const traceEvents = readArray(run, "traceEvents").filter(isRecord)
  const forecastOutput = firstAggregateOutput(aggregates) ?? firstArtifactOutput(artifacts)
  return {
    task,
    taskRows,
    artifacts,
    sources,
    attempts,
    aggregates,
    scores,
    traceEvents,
    forecastOutput,
    title: task ? questionTitle(task) : "Loading run",
  }
}

function RunStreamPanel({ streamState }: { streamState: RunStreamState }) {
  const progress = streamState.progress
  const percent = progress && progress.total > 0 ? Math.round(((progress.completed + progress.failed) / progress.total) * 100) : 0
  const streamLabel =
    percent >= 100 ? "Run events complete" : streamState.connected ? "Receiving run events" : "Waiting for run events"
  return (
    <Card size="sm" className="min-w-72 bg-card/60">
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{streamLabel}</span>
          <span>{percent}%</span>
        </div>
        <Progress value={percent} />
        {streamState.lastEvent ? (
          <p className="truncate text-xs text-muted-foreground">
            {String(streamState.lastEvent.eventType ?? "trace")} · {String(streamState.lastEvent.phase ?? "workflow")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ResearchNarrativePanel({
  task,
  sources,
  streamState,
  traceEvents,
}: {
  task: JsonRecord
  sources: JsonRecord[]
  streamState: RunStreamState
  traceEvents: JsonRecord[]
}) {
  const latest = streamState.lastEvent ?? traceEvents[0] ?? null
  return (
    <Card className="fs-panel">
      <CardHeader>
        <CardTitle className="text-base">Research transcript</CardTitle>
        <CardDescription>Question intake, evidence search, and synthesis status.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-7 text-muted-foreground">
        <div className="rounded-lg border bg-background/45 p-4 text-foreground">
          {questionTitle(task)}
        </div>
        <div className="flex items-center gap-3 rounded-md border bg-muted/25 px-3 py-2">
          <span className="text-xs text-muted-foreground">04:22 PM</span>
          <span className="font-medium uppercase tracking-[0.16em] text-forecast">briefing researchers</span>
          <span className="ml-auto flex items-center gap-1 text-xs text-success">
            <CircleDot className="size-3" />
            {streamState.connected ? "live" : "idle"}
          </span>
        </div>
        <p>
          The workflow classifies the request, fans out research, extracts citations, and writes a forecast aggregate once evidence is ready.
        </p>
        <div className="flex flex-wrap gap-2">
          {sources.slice(0, 5).map((source, index) => (
            <span className="fs-citation" key={String(source.id ?? index)}>
              {sourceDomain(source)}
            </span>
          ))}
          {sources.length === 0 ? <span className="fs-citation">sources pending</span> : null}
        </div>
        {latest ? (
          <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
            Latest event: {String(latest.eventType ?? "trace")} · {String(latest.phase ?? "workflow")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ForecastResultPanel({ output, task, expanded = false }: { output: JsonRecord | null; task: JsonRecord; expanded?: boolean }) {
  const dateDistribution = parseRecord(readString(output, "date_distribution") ?? output?.dateDistribution)
  const target = readString(output, "targetVariable") ?? readString(output, "metricName") ?? "forecast"
  const median =
    readString(output, "median") ??
    readString(output, "parity_date") ??
    readString(output, "target_date") ??
    readString(dateDistribution, "p50") ??
    readString(output, "answer")
  const probability = readNumber(output, "probability")
  const rationale = readString(output, "rationale") ?? readString(output, "summary") ?? readString(output, "answer")
  const p10 = readString(output, "p10") ?? readString(dateDistribution, "p10") ?? readString(output, "lowerBound")
  const p25 = readString(output, "p25") ?? readString(dateDistribution, "p25")
  const p75 = readString(output, "p75") ?? readString(dateDistribution, "p75")
  const p90 = readString(output, "p90") ?? readString(dateDistribution, "p90") ?? readString(output, "upperBound")

  return (
    <Card className="fs-artifact">
      <CardHeader>
        <CardTitle className="text-lg leading-tight text-forecast md:text-xl">{questionTitle(task)}</CardTitle>
        <CardDescription className="text-primary">
          {target} {median ? <span className="font-medium text-success">{median}</span> : null}
        </CardDescription>
        <CardAction>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" />
            researchers 1-3
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-6">
        {output ? (
          <>
            <div>
              <p className="text-sm text-primary">{target}</p>
              <p className="mt-2 text-3xl font-medium text-success md:text-5xl">
                {median ?? (typeof probability === "number" ? `${Math.round(probability * 100)}%` : "Forecast ready")}
              </p>
            </div>
            <div className="space-y-3">
              <div className="mx-auto h-0.5 w-2/3 bg-border" />
              <div className="grid gap-3 md:grid-cols-5">
              <ForecastQuantile label="10% by" value={p10 ?? "not set"} />
              <ForecastQuantile label="25% by" value={p25 ?? "not set"} />
              <ForecastQuantile label="median" value={median ?? "not set"} active />
              <ForecastQuantile label="75% by" value={p75 ?? "not set"} />
              <ForecastQuantile label="90% by" value={p90 ?? "not set"} />
              </div>
            </div>
            <div className="space-y-3 text-sm leading-7 text-muted-foreground">
              <p>
                <span className="font-medium text-primary">rationale: </span>
                {expanded ? rationale : truncate(rationale ?? "The workflow is still writing the final rationale.", 720)}
              </p>
            </div>
          </>
        ) : (
          <div className="flex min-h-52 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            Forecast output will appear here once the workflow writes an aggregate.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ForecastQuantile({ label, value, active = false }: { label: string; value: string; active?: boolean }) {
  return (
    <div className={active ? "rounded-md bg-success/15 px-3 py-2 text-success" : "rounded-md bg-muted/35 px-3 py-2"}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}

function ResearchTeamPanel({
  attempts,
  traceEvents,
  streamState,
  expanded = false,
}: {
  attempts: JsonRecord[]
  traceEvents: JsonRecord[]
  streamState: RunStreamState
  expanded?: boolean
}) {
  const shown = expanded ? traceEvents.slice(0, 20) : traceEvents.slice(0, 5)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Research team</CardTitle>
        <CardDescription>
          {attempts.length} attempts · {traceEvents.length} trace events · {streamState.connected ? "on task" : "idle"}
        </CardDescription>
        <CardAction>
          <Bot className="size-5 text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-8 gap-2">
          {Array.from({ length: Math.max(8, Math.min(24, attempts.length || 12)) }, (_, index) => (
            <span
              className={`flex size-8 items-center justify-center rounded-full border ${
                index < attempts.length ? "border-primary text-primary" : "border-muted text-muted-foreground"
              }`}
              key={index}
            >
              <Bot className="size-4" />
            </span>
          ))}
        </div>
        <div className="space-y-2">
          {shown.map((event, index) => (
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-xs" key={String(event.id ?? index)}>
              <span className="truncate">{String(event.eventType ?? "trace")}</span>
              <span className="shrink-0 text-muted-foreground">{String(event.phase ?? "workflow")}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function SourceMap({ sources }: { sources: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Source map</CardTitle>
        <CardDescription>{sources.length} persisted citations</CardDescription>
        <CardAction>
          <Network className="size-5 text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {sources.slice(0, 10).map((source, index) => (
            <div className="rounded-md border bg-muted/25 p-3" key={String(source.id ?? index)}>
              <FileText className="mb-2 size-4 text-muted-foreground" />
              <p className="truncate text-sm">{sourceDomain(source)}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function EvidenceStrip({ sources }: { sources: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence</CardTitle>
        <CardDescription>Sources cited by the workflow</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {sources.slice(0, 24).map((source, index) => (
          <Badge variant="outline" key={String(source.id ?? index)}>
            {sourceDomain(source)}
          </Badge>
        ))}
      </CardContent>
    </Card>
  )
}

function ForecastLedger({ attempts, aggregates, scores }: { attempts: JsonRecord[]; aggregates: JsonRecord[]; scores: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Forecast ledger</CardTitle>
        <CardDescription>{attempts.length} attempts · {aggregates.length} aggregates · {scores.length} scores</CardDescription>
        <CardAction>
          <BarChart3 className="size-5 text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <LedgerCount label="Attempts" value={attempts.length} />
        <LedgerCount label="Aggregates" value={aggregates.length} />
        <LedgerCount label="Scores" value={scores.length} />
      </CardContent>
    </Card>
  )
}

function LedgerCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/40 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-medium">{value}</p>
    </div>
  )
}

function SourceList({ sources }: { sources: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Citations and source bank</CardTitle>
        <CardDescription>{sources.length} sources</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[62vh]">
          <div className="space-y-3 pr-4">
            {sources.map((source, index) => (
              <div className="rounded-lg border bg-card p-4" key={String(source.id ?? index)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{readString(source, "title") ?? sourceDomain(source)}</p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{readString(source, "url") ?? readString(source, "sourceUrl") ?? "no url"}</p>
                  </div>
                  <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
                </div>
                {readString(source, "snippet") ? <p className="mt-3 text-sm text-muted-foreground">{readString(source, "snippet")}</p> : null}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function MetricGrid({ task, artifacts, sources, taskId }: { task: JsonRecord; artifacts: JsonRecord[]; sources: JsonRecord[]; taskId: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <LedgerCount label="Mode" value={String(task.operationSubmode ?? task.operationMode).length} />
      <LedgerCount label="Artifacts" value={artifacts.length} />
      <LedgerCount label="Sources" value={sources.length} />
      <Card size="sm">
        <CardContent>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/api/runs/${taskId}/trace-bundle`} />}>
            <FileJson data-icon="inline-start" />
            Trace bundle
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function TaskRows({ rows, retryingRowId, onRetry }: { rows: JsonRecord[]; retryingRowId: string | null; onRetry: (rowId: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rows</CardTitle>
        <CardDescription>{rows.length} workflow rows</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((row) => {
          const rowId = String(row.id ?? "")
          return (
            <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm" key={rowId}>
              <span className="truncate">{readString(row, "label") ?? rowId}</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{String(row.status ?? "unknown")}</Badge>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => onRetry(rowId)} disabled={!rowId || retryingRowId === rowId} aria-label="Retry row">
                  {retryingRowId === rowId ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function TraceEvents({ events }: { events: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trace</CardTitle>
        <CardDescription>{events.length} recent persisted events</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.slice(0, 40).map((event, index) => (
          <div className="grid gap-2 rounded-md border p-3 text-xs md:grid-cols-[1fr_1fr_auto]" key={String(event.id ?? index)}>
            <span className="truncate">{String(event.eventType ?? "event")}</span>
            <span className="truncate text-muted-foreground">{String(event.phase ?? "workflow")}</span>
            <CheckCircle2 className="size-4 text-primary" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function firstAggregateOutput(aggregates: JsonRecord[]) {
  for (const aggregate of aggregates) {
    const output = aggregate.rawAggregate ?? aggregate.outputJson ?? aggregate.output
    if (isRecord(output)) {
      return output
    }
  }
  return null
}

function parseRecord(value: unknown) {
  if (isRecord(value)) {
    return value
  }
  if (typeof value !== "string") {
    return null
  }
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function firstArtifactOutput(artifacts: JsonRecord[]) {
  for (const artifact of artifacts) {
    const content = artifact.contentJson ?? artifact.outputJson ?? artifact.content
    if (isRecord(content)) {
      return content
    }
  }
  return null
}

function sourceDomain(source: JsonRecord) {
  const url = readString(source, "url") ?? readString(source, "sourceUrl") ?? readString(source, "domain") ?? "source"
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return truncate(url, 28)
  }
}
