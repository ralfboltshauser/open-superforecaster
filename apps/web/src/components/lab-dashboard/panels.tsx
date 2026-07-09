"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { Activity, BarChart3, Database, FlaskConical, Play, Server, ShieldCheck, TrendingUp, Wrench } from "lucide-react"

import type { BenchmarkMode } from "@/components/lab-dashboard/use-lab-dashboard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { formatModeLabel, isRecord, readArray, runTitle, statusTone, type JsonRecord } from "@/lib/records"

type DiagnosticCounts = {
  rows: Array<{ name: string; ok: boolean }>
  total: number
  ok: number
}

export function LabMetricGrid({
  benchmarkCount,
  diagnosticCounts,
  healthStatus,
  pendingForecastCount,
}: {
  benchmarkCount: number
  diagnosticCounts: DiagnosticCounts
  healthStatus: unknown
  pendingForecastCount: unknown
}) {
  return (
    <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={Server} label="System" value={String(healthStatus ?? "unknown")} />
      <MetricCard icon={Activity} label="Diagnostics" value={`${diagnosticCounts.ok}/${diagnosticCounts.total} ok`} />
      <MetricCard icon={BarChart3} label="Benchmarks" value={String(benchmarkCount)} />
      <MetricCard icon={ShieldCheck} label="Pending resolutions" value={String(pendingForecastCount ?? 0)} />
    </section>
  )
}

export function WorkflowLauncher({
  busy,
  importBtf2,
  launchBenchmark,
}: {
  busy: string | null
  importBtf2: () => Promise<void>
  launchBenchmark: (mode: BenchmarkMode) => Promise<void>
}) {
  return (
    <Card id="workflows">
      <CardHeader>
        <CardTitle>Workflow launcher</CardTitle>
        <CardDescription>Start smoke checks without leaving the dashboard.</CardDescription>
        <CardAction>
          <FlaskConical className="text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <Button type="button" variant="outline" onClick={() => void launchBenchmark("fixed_evidence")} disabled={busy !== null}>
          <Play data-icon="inline-start" />
          Fixed evidence
        </Button>
        <Button type="button" variant="outline" onClick={() => void launchBenchmark("agentic_pastcasting_smoke")} disabled={busy !== null}>
          <Play data-icon="inline-start" />
          Live web smoke
        </Button>
        <Button type="button" variant="secondary" onClick={() => void importBtf2()} disabled={busy !== null}>
          <Database data-icon="inline-start" />
          Import BTF-2
        </Button>
      </CardContent>
    </Card>
  )
}

export function RecentRunsCard({ runs }: { runs: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent runs</CardTitle>
        <CardDescription>{runs.length} runs in the local ledger</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {runs.slice(0, 8).map((run) => (
          <Link
            className="grid gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50 md:grid-cols-[1fr_auto]"
            href={`/runs/${String(run.id ?? "")}`}
            key={String(run.id ?? runTitle(run))}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{runTitle(run)}</span>
              <span className="block truncate text-xs text-muted-foreground">{formatModeLabel(run.operationSubmode ?? run.operationMode)}</span>
            </span>
            <Badge variant="secondary" className={statusTone(run.status)}>
              {String(run.status ?? "queued")}
            </Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

export function DiagnosticsCard({ diagnosticCounts }: { diagnosticCounts: DiagnosticCounts }) {
  return (
    <Card id="diagnostics">
      <CardHeader>
        <CardTitle>Diagnostics</CardTitle>
        <CardDescription>Backend dependencies and local workflow prerequisites.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress value={diagnosticCounts.total ? Math.round((diagnosticCounts.ok / diagnosticCounts.total) * 100) : 0} />
        <div className="flex flex-col gap-2">
          {diagnosticCounts.rows.slice(0, 8).map((row) => (
            <div className="flex items-center justify-between gap-3 text-sm" key={row.name}>
              <span className="truncate">{row.name}</span>
              <Badge variant={row.ok ? "outline" : "destructive"}>{row.ok ? "ok" : "check"}</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function BenchmarksCard({ benchmarks }: { benchmarks: { benchmarkRuns: JsonRecord[]; benchmarkSuites: JsonRecord[] } }) {
  return (
    <Card id="benchmarks">
      <CardHeader>
        <CardTitle>Benchmarks</CardTitle>
        <CardDescription>{benchmarks.benchmarkSuites.length} suites · {benchmarks.benchmarkRuns.length} runs</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {benchmarks.benchmarkRuns.slice(0, 6).map((run) => (
          <div className="rounded-md border p-3 text-sm" key={String(run.id ?? run.label)}>
            <p className="truncate font-medium">{String(run.experimentLabel ?? run.evalMode ?? "benchmark")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{String(run.status ?? "unknown")}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function PerformanceCard({ performance }: { performance: JsonRecord | null }) {
  const summary = isRecord(performance?.summary) ? performance.summary : {}
  const groups = isRecord(performance?.groups) ? performance.groups : {}
  const byForecastType = readArray(groups, "byForecastType").filter(isRecord)
  const bestForecasts = readArray(performance, "bestResolvedForecasts").filter(isRecord)
  const worstForecasts = readArray(performance, "worstResolvedForecasts").filter(isRecord)
  const scoreTrends = readArray(performance, "scoreTrends").filter(isRecord)
  const needsAttention = readArray(performance, "needsAttention").filter(isRecord)
  const calibrationBuckets = readArray(performance, "calibrationBuckets").filter(isRecord)
  const calibrationSummary = isRecord(performance?.calibrationSummary) ? performance.calibrationSummary : null
  return (
    <Card id="performance">
      <CardHeader>
        <CardTitle>Forecast performance</CardTitle>
        <CardDescription>
          {String(summary.resolvedTasks ?? 0)} resolved tasks · {String(summary.productScoreRows ?? 0)} score rows
        </CardDescription>
        <CardAction>
          <TrendingUp className="text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {byForecastType.length ? (
          byForecastType.slice(0, 6).map((group) => (
            <div className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[1fr_auto]" key={String(group.key ?? group.label)}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{String(group.label ?? group.key ?? "forecast type")}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {String(group.resolvedTasks ?? 0)} tasks · {String(group.scoreRows ?? 0)} rows
                </span>
              </span>
              <Badge variant="secondary">
                {String(group.primaryMetric ?? "metric")} {formatMetric(group.primaryMean)}
              </Badge>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No resolved score rows yet.</p>
        )}
        {bestForecasts.length || worstForecasts.length ? (
          <div className="grid gap-3 border-t pt-3 md:grid-cols-2">
            <PerformanceCaseList title="Best" cases={bestForecasts} />
            <PerformanceCaseList title="Worst" cases={worstForecasts} />
          </div>
        ) : null}
        {scoreTrends.length ? <PerformanceTrendList trends={scoreTrends} /> : null}
        {calibrationBuckets.length ? <PerformanceCalibrationList buckets={calibrationBuckets} summary={calibrationSummary} /> : null}
        {needsAttention.length ? <PerformanceAttentionList items={needsAttention} /> : null}
      </CardContent>
    </Card>
  )
}

export function MaintenanceCard({
  actions,
  busy,
  runMaintenance,
}: {
  actions: string[]
  busy: string | null
  runMaintenance: (action: string) => Promise<void>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Maintenance</CardTitle>
        <CardDescription>Run local cleanup and repair jobs.</CardDescription>
        <CardAction>
          <Wrench className="text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {actions.slice(0, 6).map((action) => (
          <Button className="w-full justify-start" disabled={busy !== null} key={action} onClick={() => void runMaintenance(action)} type="button" variant="outline">
            <Wrench data-icon="inline-start" />
            {action}
          </Button>
        ))}
        <Separator />
        <p className="text-xs text-muted-foreground">Jobs are written to the local maintenance ledger.</p>
      </CardContent>
    </Card>
  )
}

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-medium">{value}</p>
        </div>
        <Icon className="text-primary" />
      </CardContent>
    </Card>
  )
}

function formatMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : ""
}

function PerformanceCaseList({ title, cases }: { title: string; cases: JsonRecord[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">{title}</p>
      <div className="flex flex-col gap-2">
        {cases.slice(0, 3).map((item) => (
          <Link className="rounded-md border px-3 py-2 text-sm hover:bg-muted/50" href={`/runs/${String(item.taskId ?? "")}`} key={String(item.taskId ?? item.taskLabel)}>
            <span className="block truncate font-medium">{String(item.taskLabel ?? item.taskId ?? "forecast")}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {String(item.primaryMetric ?? "score")} {formatMetric(item.primaryScore)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function PerformanceTrendList({ trends }: { trends: JsonRecord[] }) {
  const visibleTrends = trends
    .filter((trend) => trend.direction !== "insufficient_data")
    .slice(0, 4)
  if (visibleTrends.length === 0) {
    return null
  }
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Trends</p>
      <div className="grid gap-2 md:grid-cols-2">
        {visibleTrends.map((trend) => (
          <div className="rounded-md border px-3 py-2 text-sm" key={String(trend.key ?? `${trend.label}-${trend.metric}`)}>
            <span className="block truncate font-medium">{String(trend.label ?? "window")} · {String(trend.metric ?? "metric")}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {String(trend.direction ?? "trend")} · delta {formatMetric(trend.delta)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformanceCalibrationList({ buckets, summary }: { buckets: JsonRecord[]; summary: JsonRecord | null }) {
  const populatedBuckets = buckets.filter((bucket) => typeof bucket.count === "number" && bucket.count > 0)
  if (populatedBuckets.length === 0) {
    return null
  }
  return (
    <div className="border-t pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">Calibration</p>
        <Badge variant="secondary">
          ECE {formatMetric(summary?.expectedCalibrationError)}
        </Badge>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {populatedBuckets.slice(0, 6).map((bucket) => (
          <div className="rounded-md border px-3 py-2 text-sm" key={String(bucket.label ?? bucket.minProbability)}>
            <span className="block truncate font-medium">{String(bucket.label ?? "bucket")}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {String(bucket.count ?? 0)} cases · forecast {formatMetric(bucket.meanForecast)} · observed {formatMetric(bucket.observedRate)}
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              error {formatMetric(bucket.calibrationError)} · Brier {formatMetric(bucket.meanBrier)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformanceAttentionList({ items }: { items: JsonRecord[] }) {
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Needs attention</p>
      <div className="flex flex-col gap-2">
        {items.slice(0, 4).map((item) => {
          const taskId = typeof item.taskId === "string" ? item.taskId : null
          const recommendedActions = readArray(item, "recommendedActions").filter((value): value is string => typeof value === "string")
          const content = (
            <>
              <span className="block truncate font-medium">{String(item.taskLabel ?? item.kind ?? "attention item")}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {String(item.severity ?? "medium")} · {String(item.metric ?? "metric")} {formatMetric(item.score)}
              </span>
              {recommendedActions[0] ? (
                <span className="mt-1 block truncate text-xs text-muted-foreground">{recommendedActions[0]}</span>
              ) : null}
            </>
          )
          return taskId ? (
            <Link className="rounded-md border px-3 py-2 text-sm hover:bg-muted/50" href={`/runs/${taskId}`} key={String(item.id ?? taskId)}>
              {content}
            </Link>
          ) : (
            <div className="rounded-md border px-3 py-2 text-sm" key={String(item.id ?? item.reason)}>
              {content}
            </div>
          )
        })}
      </div>
    </div>
  )
}
