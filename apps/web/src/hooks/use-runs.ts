"use client"

import { useCallback, useState } from "react"

import { usePolling } from "@/hooks/use-polling"
import { fetchJson } from "@/lib/api-client"
import type { JsonRecord } from "@/lib/records"

type RunsPayload = {
  runs?: JsonRecord[]
}

export function useRuns({ intervalMs = 5000, poll = true }: { intervalMs?: number; poll?: boolean } = {}) {
  const [runs, setRuns] = useState<JsonRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshRuns = useCallback(async () => {
    try {
      const payload = await fetchJson<RunsPayload>("/api/runs")
      setRuns(Array.isArray(payload.runs) ? payload.runs : [])
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  usePolling(refreshRuns, intervalMs, poll)

  return { error, loading, refreshRuns, runs }
}
