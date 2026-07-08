"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { Activity, BarChart3, Database, FlaskConical, Play, Server, ShieldCheck, Wrench } from "lucide-react"

import { AppShell } from "@/components/app-shell"
import { ForecastComposer } from "@/components/forecast-composer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { formatModeLabel, isRecord, readArray, runTitle, statusTone, type JsonRecord } from "@/lib/records"

export function LabDashboard() {
  const [runs, setRuns] = useState<JsonRecord[]>([])
  const [health, setHealth] = useState<JsonRecord | null>(null)
  const [diagnostics, setDiagnostics] = useState<JsonRecord | null>(null)
  const [benchmarks, setBenchmarks] = useState<{ benchmarkRuns: JsonRecord[]; benchmarkSuites: JsonRecord[] }>({
    benchmarkRuns: [],
    benchmarkSuites: [],
  })
  const [resolutions, setResolutions] = useState<JsonRecord | null>(null)
  const [maintenance, setMaintenance] = useState<JsonRecord | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    const [runsResponse, healthResponse, diagnosticsResponse, benchmarkResponse, resolutionResponse, maintenanceResponse] =
      await Promise.all([
        fetch("/api/runs"),
        fetch("/api/health"),
        fetch("/api/diagnostics"),
        fetch("/api/benchmarks"),
        fetch("/api/resolutions"),
        fetch("/api/maintenance"),
      ])

    if (runsResponse.ok) {
      const payload = (await runsResponse.json()) as { runs?: JsonRecord[] }
      setRuns(Array.isArray(payload.runs) ? payload.runs : [])
    }
    if (healthResponse.ok) {
      setHealth((await healthResponse.json()) as JsonRecord)
    }
    if (diagnosticsResponse.ok) {
      setDiagnostics((await diagnosticsResponse.json()) as JsonRecord)
    }
    if (benchmarkResponse.ok) {
      const payload = (await benchmarkResponse.json()) as { benchmarkRuns?: JsonRecord[]; benchmarkSuites?: JsonRecord[] }
      setBenchmarks({
        benchmarkRuns: Array.isArray(payload.benchmarkRuns) ? payload.benchmarkRuns : [],
        benchmarkSuites: Array.isArray(payload.benchmarkSuites) ? payload.benchmarkSuites : [],
      })
    }
    if (resolutionResponse.ok) {
      setResolutions((await resolutionResponse.json()) as JsonRecord)
    }
    if (maintenanceResponse.ok) {
      setMaintenance((await maintenanceResponse.json()) as JsonRecord)
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    const interval = window.setInterval(() => void load(), 8000)
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
    }
  }, [])

  const diagnosticCounts = useMemo(() => summarizeDiagnostics(diagnostics), [diagnostics])
  const resolutionSummary = isRecord(resolutions?.summary) ? resolutions.summary : {}
  const actions = readArray(maintenance, "actions").filter((value): value is string => typeof value === "string")

  async function launchBenchmark(evalMode: "fixed_evidence" | "agentic_pastcasting_smoke") {
    setBusy(evalMode)
    try {
      await fetch("/api/benchmarks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          evalMode,
          maxCases: 1,
          rollouts: evalMode === "fixed_evidence" ? 3 : undefined,
          experimentLabel: evalMode === "fixed_evidence" ? "ui-fixed-evidence-smoke" : "ui-live-web-smoke",
        }),
      })
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function importBtf2() {
    setBusy("btf2")
    try {
      await fetch("/api/benchmarks/import-btf2", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maxRows: 10 }),
      })
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function runMaintenance(action: string) {
    setBusy(action)
    try {
      await fetch("/api/maintenance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      })
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <AppShell runs={runs}>
      <main className="min-h-svh px-4 py-4 md:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-primary/80">Open Superforecaster</p>
            <h1 className="mt-3 text-3xl font-medium md:text-5xl">Local durable forecasting workspace</h1>
            <p className="mt-3 max-w-3xl text-muted-foreground">
              Run forecasts, inspect workflow health, benchmark variants, and resolve forecasts from one operational surface.
            </p>
          </div>
          <ForecastComposer compact className="max-w-xl" />
        </header>

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Server} label="System" value={String(health?.status ?? "unknown")} />
          <MetricCard icon={Activity} label="Diagnostics" value={`${diagnosticCounts.ok}/${diagnosticCounts.total} ok`} />
          <MetricCard icon={BarChart3} label="Benchmarks" value={String(benchmarks.benchmarkRuns.length)} />
          <MetricCard icon={ShieldCheck} label="Pending resolutions" value={String(resolutionSummary.pendingForecastCount ?? 0)} />
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="grid gap-6">
            <Card id="workflows">
              <CardHeader>
                <CardTitle>Workflow launcher</CardTitle>
                <CardDescription>Start smoke checks without leaving the dashboard.</CardDescription>
                <CardAction>
                  <FlaskConical className="size-5 text-primary" />
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

            <Card>
              <CardHeader>
                <CardTitle>Recent runs</CardTitle>
                <CardDescription>{runs.length} runs in the local ledger</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {runs.slice(0, 8).map((run) => (
                  <Link
                    className="grid gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50 md:grid-cols-[1fr_auto]"
                    href={`/runs/${String(run.id ?? "")}`}
                    key={String(run.id ?? runTitle(run))}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{runTitle(run)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatModeLabel(run.operationSubmode ?? run.operationMode)}
                      </span>
                    </span>
                    <Badge variant="secondary" className={statusTone(run.status)}>
                      {String(run.status ?? "queued")}
                    </Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6">
            <Card id="diagnostics">
              <CardHeader>
                <CardTitle>Diagnostics</CardTitle>
                <CardDescription>Backend dependencies and local workflow prerequisites.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={diagnosticCounts.total ? Math.round((diagnosticCounts.ok / diagnosticCounts.total) * 100) : 0} />
                <div className="space-y-2">
                  {diagnosticCounts.rows.slice(0, 8).map((row) => (
                    <div className="flex items-center justify-between gap-3 text-sm" key={row.name}>
                      <span className="truncate">{row.name}</span>
                      <Badge variant={row.ok ? "outline" : "destructive"}>{row.ok ? "ok" : "check"}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card id="benchmarks">
              <CardHeader>
                <CardTitle>Benchmarks</CardTitle>
                <CardDescription>{benchmarks.benchmarkSuites.length} suites · {benchmarks.benchmarkRuns.length} runs</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {benchmarks.benchmarkRuns.slice(0, 6).map((run) => (
                  <div className="rounded-md border p-3 text-sm" key={String(run.id ?? run.label)}>
                    <p className="truncate font-medium">{String(run.experimentLabel ?? run.evalMode ?? "benchmark")}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{String(run.status ?? "unknown")}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Maintenance</CardTitle>
                <CardDescription>Run local cleanup and repair jobs.</CardDescription>
                <CardAction>
                  <Wrench className="size-5 text-primary" />
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-2">
                {actions.slice(0, 6).map((action) => (
                  <Button
                    className="w-full justify-start"
                    disabled={busy !== null}
                    key={action}
                    onClick={() => void runMaintenance(action)}
                    type="button"
                    variant="outline"
                  >
                    <Wrench data-icon="inline-start" />
                    {action}
                  </Button>
                ))}
                <Separator />
                <p className="text-xs text-muted-foreground">Jobs are written to the local maintenance ledger.</p>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </AppShell>
  )
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-medium">{value}</p>
        </div>
        <Icon className="size-5 text-primary" />
      </CardContent>
    </Card>
  )
}

function summarizeDiagnostics(diagnostics: JsonRecord | null) {
  const candidates = [
    ...readArray(diagnostics, "checks"),
    ...readArray(diagnostics, "dependencies"),
    ...readArray(diagnostics, "items"),
  ].filter(isRecord)
  const rows = candidates.length
    ? candidates.map((item) => ({
        name: String(item.name ?? item.label ?? item.key ?? "check"),
        ok: item.ok === true || item.status === "ok" || item.status === "healthy",
      }))
    : Object.entries(diagnostics ?? {}).map(([key, value]) => ({
        name: key,
        ok: value === true || value === "ok" || value === "healthy",
      }))
  return {
    rows,
    total: rows.length,
    ok: rows.filter((row) => row.ok).length,
  }
}
