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

  const refreshRuns = useCallback(async () => {
    const payload = await fetchJson<RunsPayload>("/api/runs").catch(() => ({ runs: [] }))
    setRuns(Array.isArray(payload.runs) ? payload.runs : [])
  }, [])

  usePolling(refreshRuns, intervalMs, poll)

  return { refreshRuns, runs }
}
