"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { buildRunDetail } from "@/components/run-workspace/run-detail"
import { useRuns } from "@/hooks/use-runs"
import { fetchJson } from "@/lib/api-client"
import { isRecord, parseEventData, readNumber, readString, type JsonRecord } from "@/lib/records"

export type RunStreamState = {
  connected: boolean
  status: string
  progress: { total: number; running: number; completed: number; failed: number } | null
  lastEvent: JsonRecord | null
}

export function useRunWorkspace(taskId: string) {
  const { refreshRuns, runs } = useRuns({ poll: false })
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
    const payload = await fetchJson<{ run?: JsonRecord }>(`/api/runs/${taskId}`)
    setRun(isRecord(payload.run) ? payload.run : null)
  }, [taskId])

  const loadWorkspace = useCallback(async () => {
    setError(null)
    await loadRun()
    await refreshRuns()
  }, [loadRun, refreshRuns])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        await loadWorkspace()
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
    const interval = window.setInterval(() => void load(), streamState.status === "completed" ? 15000 : 5000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [loadWorkspace, streamState.status])

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

  return {
    detail,
    error,
    loading,
    retryingRowId,
    retryTaskRow,
    runs,
    streamState,
  }
}
