"use client"

import { useCallback, useMemo, useState } from "react"

import { usePolling } from "@/hooks/use-polling"
import { fetchJson, postJson } from "@/lib/api-client"
import { isRecord, readArray, type JsonRecord } from "@/lib/records"

export type BenchmarkMode = "fixed_evidence" | "agentic_pastcasting_smoke"

type BenchmarksPayload = {
  benchmarkRuns?: JsonRecord[]
  benchmarkSuites?: JsonRecord[]
}

export function useLabDashboard() {
  const [runs, setRuns] = useState<JsonRecord[]>([])
  const [health, setHealth] = useState<JsonRecord | null>(null)
  const [diagnostics, setDiagnostics] = useState<JsonRecord | null>(null)
  const [benchmarks, setBenchmarks] = useState<{ benchmarkRuns: JsonRecord[]; benchmarkSuites: JsonRecord[] }>({
    benchmarkRuns: [],
    benchmarkSuites: [],
  })
  const [resolutions, setResolutions] = useState<JsonRecord | null>(null)
  const [performance, setPerformance] = useState<JsonRecord | null>(null)
  const [maintenance, setMaintenance] = useState<JsonRecord | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [runsPayload, healthPayload, diagnosticsPayload, benchmarkPayload, resolutionPayload, performancePayload, maintenancePayload] =
      await Promise.all([
        fetchJson<{ runs?: JsonRecord[] }>("/api/runs").catch(() => ({ runs: [] })),
        fetchJson<JsonRecord>("/api/health").catch(() => null),
        fetchJson<JsonRecord>("/api/diagnostics").catch(() => null),
        fetchJson<BenchmarksPayload>("/api/benchmarks").catch(() => ({ benchmarkRuns: [], benchmarkSuites: [] })),
        fetchJson<JsonRecord>("/api/resolutions").catch(() => null),
        fetchJson<JsonRecord>("/api/resolutions/performance").catch(() => null),
        fetchJson<JsonRecord>("/api/maintenance").catch(() => null),
      ])

    setRuns(Array.isArray(runsPayload.runs) ? runsPayload.runs : [])
    setHealth(healthPayload)
    setDiagnostics(diagnosticsPayload)
    setBenchmarks({
      benchmarkRuns: Array.isArray(benchmarkPayload.benchmarkRuns) ? benchmarkPayload.benchmarkRuns : [],
      benchmarkSuites: Array.isArray(benchmarkPayload.benchmarkSuites) ? benchmarkPayload.benchmarkSuites : [],
    })
    setResolutions(resolutionPayload)
    setPerformance(performancePayload)
    setMaintenance(maintenancePayload)
  }, [])

  usePolling(load, 8000)

  const diagnosticCounts = useMemo(() => summarizeDiagnostics(diagnostics), [diagnostics])
  const resolutionSummary = isRecord(resolutions?.summary) ? resolutions.summary : {}
  const actions = readArray(maintenance, "actions").filter((value): value is string => typeof value === "string")

  const runAction = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setBusy(key)
      try {
        await action()
        await load()
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  const launchBenchmark = useCallback(
    (evalMode: BenchmarkMode) =>
      runAction(evalMode, () =>
        postJson("/api/benchmarks", {
          evalMode,
          maxCases: 1,
          rollouts: evalMode === "fixed_evidence" ? 3 : undefined,
          experimentLabel: evalMode === "fixed_evidence" ? "ui-fixed-evidence-smoke" : "ui-live-web-smoke",
        }),
      ),
    [runAction],
  )

  const importBtf2 = useCallback(() => runAction("btf2", () => postJson("/api/benchmarks/import-btf2", { maxRows: 10 })), [runAction])

  const runMaintenance = useCallback((action: string) => runAction(action, () => postJson("/api/maintenance", { action })), [runAction])

  return {
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
  }
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
