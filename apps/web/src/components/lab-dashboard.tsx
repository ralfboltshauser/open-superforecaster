"use client"

import { ForecastComposer } from "@/components/forecast-composer"
import {
  BenchmarksCard,
  DiagnosticsCard,
  LabMetricGrid,
  MaintenanceCard,
  PerformanceCard,
  RecentRunsCard,
  WorkflowLauncher,
} from "@/components/lab-dashboard/panels"
import { useLabDashboard } from "@/components/lab-dashboard/use-lab-dashboard"

export function LabDashboard() {
  const {
    actions,
    benchmarks,
    busy,
    diagnosticCounts,
    health,
    importBtf2,
    launchBenchmark,
    performance,
    resolutionSummary,
    runMaintenance,
    runs,
  } = useLabDashboard()

  return (
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

      <LabMetricGrid
        benchmarkCount={benchmarks.benchmarkRuns.length}
        diagnosticCounts={diagnosticCounts}
        healthStatus={health?.status}
        pendingForecastCount={resolutionSummary.pendingForecastCount}
      />

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid gap-6">
          <WorkflowLauncher busy={busy} importBtf2={importBtf2} launchBenchmark={launchBenchmark} />
          <PerformanceCard performance={performance} />
          <RecentRunsCard runs={runs} />
        </div>

        <div className="grid gap-6">
          <DiagnosticsCard diagnosticCounts={diagnosticCounts} />
          <BenchmarksCard benchmarks={benchmarks} />
          <MaintenanceCard actions={actions} busy={busy} runMaintenance={runMaintenance} />
        </div>
      </section>
    </main>
  )
}
