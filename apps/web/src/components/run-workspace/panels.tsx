"use client"

import Link from "next/link"
import {
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

import { parseRecord, sourceDomain } from "@/components/run-workspace/run-detail"
import type { RunStreamState } from "@/components/run-workspace/use-run-workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { formatModeLabel, questionTitle, readNumber, readString, truncate, type JsonRecord } from "@/lib/records"

export function RunStreamPanel({ streamState }: { streamState: RunStreamState }) {
  const progress = streamState.progress
  const percent = progress && progress.total > 0 ? Math.round(((progress.completed + progress.failed) / progress.total) * 100) : 0
  const streamLabel =
    percent >= 100 ? "Run events complete" : streamState.connected ? "Receiving run events" : "Waiting for run events"
  return (
    <Card size="sm" className="min-w-72 bg-card/60">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{streamLabel}</span>
          <span>{percent}%</span>
        </div>
        <Progress value={percent} />
        {streamState.lastEvent ? (
          <p className="truncate text-xs text-muted-foreground">
            {traceLabel(streamState.lastEvent)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function LoadingRunState() {
  return (
    <section className="mt-6 grid gap-4 xl:grid-cols-[minmax(360px,0.52fr)_minmax(0,0.48fr)]">
      <Card className="fs-panel">
        <CardHeader>
          <CardTitle className="text-base">Briefing researchers</CardTitle>
          <CardDescription>Loading run detail, trace events, and source bank.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-md border bg-muted/25 px-3 py-2 text-sm text-forecast">
            <Loader2 className="animate-spin" data-icon="inline-start" />
            asking researchers
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="grid grid-cols-8 gap-2">
            {Array.from({ length: 16 }, (_, index) => (
              <span className="flex size-8 items-center justify-center rounded-full border border-muted text-muted-foreground" key={index}>
                <Bot />
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
        <CardContent className="flex flex-col gap-5">
          <Skeleton className="h-10 w-48 bg-success/15" />
          <div className="grid grid-cols-5 gap-3">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton className="h-14 bg-muted/35" key={index} />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

export function ResearchNarrativePanel({
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
  const latestTime = latest ? readString(latest, "createdAt") ?? readString(latest, "timestamp") ?? "latest" : "pending"
  return (
    <Card className="fs-panel">
      <CardHeader>
        <CardTitle className="text-base">Research transcript</CardTitle>
        <CardDescription>Question intake, evidence search, and synthesis status.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm leading-7 text-muted-foreground">
        <div className="rounded-lg border bg-background/45 p-4 text-foreground">{questionTitle(task)}</div>
        <div className="flex items-center gap-3 rounded-md border bg-muted/25 px-3 py-2">
          <span className="text-xs text-muted-foreground">{latestTime}</span>
          <span className="font-medium uppercase tracking-[0.16em] text-forecast">briefing researchers</span>
          <span className="ml-auto flex items-center gap-1 text-xs text-success">
            <CircleDot />
            {streamState.connected ? "live" : "idle"}
          </span>
        </div>
        <p>The workflow classifies the request, fans out research, extracts citations, and writes a forecast aggregate once evidence is ready.</p>
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
            Latest event: {traceLabel(latest)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ForecastResultPanel({ output, task, expanded = false }: { output: JsonRecord | null; task: JsonRecord; expanded?: boolean }) {
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
  const p25 = readString(output, "p25") ?? readString(dateDistribution, "p25") ?? p10
  const p75 = readString(output, "p75") ?? readString(dateDistribution, "p75") ?? readString(output, "upperBound")
  const p90 = readString(output, "p90") ?? readString(dateDistribution, "p90") ?? readString(output, "upperBound")
  const displayedP75 = p75 ?? p90

  return (
    <Card className="fs-artifact">
      <CardHeader>
        <CardTitle className="text-lg leading-tight text-forecast md:text-xl">{questionTitle(task)}</CardTitle>
        <CardDescription className="text-primary">
          {target} {median ? <span className="font-medium text-success">{median}</span> : null}
        </CardDescription>
        <CardAction>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 />
            researchers 1-3
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {output ? (
          <>
            <div>
              <p className="text-sm text-primary">{target}</p>
              <p className="mt-2 text-3xl font-medium text-success md:text-5xl">
                {median ?? (typeof probability === "number" ? `${Math.round(probability * 100)}%` : "Forecast ready")}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="mx-auto h-0.5 w-2/3 bg-border" />
              <div className="grid gap-3 md:grid-cols-5">
                <ForecastQuantile label="10% by" value={p10 ?? "not set"} />
                <ForecastQuantile label="25% by" value={p25 ?? "not set"} />
                <ForecastQuantile label="median" value={median ?? "not set"} active />
                <ForecastQuantile label="75% by" value={displayedP75 ?? "not set"} />
                <ForecastQuantile label="90% by" value={p90 ?? "not set"} />
              </div>
            </div>
            <div className="flex flex-col gap-3 text-sm leading-7 text-muted-foreground">
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
    <div className={cn("rounded-md px-3 py-2", active ? "bg-success/15 text-success" : "bg-muted/35")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}

export function ResearchTeamPanel({
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
          <Bot className="text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-8 gap-2">
          {Array.from({ length: Math.max(8, Math.min(24, attempts.length || 12)) }, (_, index) => (
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-full border",
                index < attempts.length ? "border-primary text-primary" : "border-muted text-muted-foreground",
              )}
              key={index}
            >
              <Bot />
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {shown.map((event, index) => (
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-xs" key={String(event.id ?? index)}>
              <span className="truncate">{traceLabel(event)}</span>
              <span className="shrink-0 text-muted-foreground">{readString(event, "agentLabel") ?? readString(event, "phase") ?? "workflow"}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function SourceMap({ sources }: { sources: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Source map</CardTitle>
        <CardDescription>{sources.length} persisted citations</CardDescription>
        <CardAction>
          <Network className="text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {sources.slice(0, 10).map((source, index) => (
            <div className="rounded-md border bg-muted/25 p-3" key={String(source.id ?? index)}>
              <FileText className="mb-2 text-muted-foreground" />
              <p className="truncate text-sm">{sourceDomain(source)}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function EvidenceStrip({ sources }: { sources: JsonRecord[] }) {
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

export function ForecastLedger({ attempts, aggregates, scores }: { attempts: JsonRecord[]; aggregates: JsonRecord[]; scores: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Forecast ledger</CardTitle>
        <CardDescription>{attempts.length} attempts · {aggregates.length} aggregates · {scores.length} scores</CardDescription>
        <CardAction>
          <BarChart3 className="text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <StatTile label="Attempts" value={attempts.length} />
        <StatTile label="Aggregates" value={aggregates.length} />
        <StatTile label="Scores" value={scores.length} />
      </CardContent>
    </Card>
  )
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-medium">{value}</p>
    </div>
  )
}

export function SourceList({ sources }: { sources: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Citations and source bank</CardTitle>
        <CardDescription>{sources.length} sources</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[62vh]">
          <div className="flex flex-col gap-3 pr-4">
            {sources.map((source, index) => (
              <div className="rounded-lg border bg-card p-4" key={String(source.id ?? index)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{readString(source, "title") ?? sourceDomain(source)}</p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{readString(source, "url") ?? readString(source, "sourceUrl") ?? "no url"}</p>
                  </div>
                  <LinkIcon className="shrink-0 text-muted-foreground" />
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

export function MetricGrid({ task, artifacts, sources, taskId }: { task: JsonRecord; artifacts: JsonRecord[]; sources: JsonRecord[]; taskId: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <StatTile label="Mode" value={formatModeLabel(task.operationSubmode ?? task.operationMode)} />
      <StatTile label="Artifacts" value={artifacts.length} />
      <StatTile label="Sources" value={sources.length} />
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

export function TaskRows({ rows, retryingRowId, onRetry }: { rows: JsonRecord[]; retryingRowId: string | null; onRetry: (rowId: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rows</CardTitle>
        <CardDescription>{rows.length} workflow rows</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.map((row) => {
          const rowId = String(row.id ?? "")
          return (
            <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm" key={rowId}>
              <span className="truncate">{readString(row, "label") ?? rowId}</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{String(row.status ?? "unknown")}</Badge>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => onRetry(rowId)} disabled={!rowId || retryingRowId === rowId} aria-label="Retry row">
                  {retryingRowId === rowId ? <Loader2 className="animate-spin" data-icon /> : <RotateCcw data-icon />}
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

export function TraceEvents({ events }: { events: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trace</CardTitle>
        <CardDescription>{events.length} recent persisted events</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {events.slice(0, 40).map((event, index) => (
          <div className="grid gap-2 rounded-md border p-3 text-xs md:grid-cols-[1fr_1fr_auto]" key={String(event.id ?? index)}>
            <span className="truncate">{String(event.eventType ?? "event")}</span>
            <span className="truncate text-muted-foreground">{String(event.phase ?? "workflow")}</span>
            <CheckCircle2 className="text-primary" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function traceLabel(event: JsonRecord) {
  return `${String(event.eventType ?? "trace")} · ${String(event.phase ?? "workflow")}`
}
