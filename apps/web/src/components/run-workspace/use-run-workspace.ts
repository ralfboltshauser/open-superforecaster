"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { buildRunDetail } from "@/components/run-workspace/run-detail"
import { parseLiveRunSnapshot, type LiveRunSnapshot } from "@/components/run-workspace/live-activity"
import { useRuns } from "@/hooks/use-runs"
import { fetchJson } from "@/lib/api-client"
import { isRecord, parseEventData, readNumber, readString, type JsonRecord } from "@/lib/records"

export type RunStreamState = {
  connected: boolean
  status: string
  progress: { total: number; running: number; completed: number; failed: number } | null
  lastEvent: JsonRecord | null
  activity: LiveRunSnapshot | null
  activityError: string | null
}

export function useRunWorkspace(taskId: string) {
  const { refreshRuns, runs } = useRuns({ poll: false })
  const [run, setRun] = useState<JsonRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryingRowId, setRetryingRowId] = useState<string | null>(null)
  const traceRefreshTimer = useRef<number | null>(null)
  const [streamState, setStreamState] = useState<RunStreamState>({
    connected: false,
    status: "connecting",
    progress: null,
    lastEvent: null,
    activity: null,
    activityError: null,
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
    return () => {
      cancelled = true
    }
  }, [loadWorkspace])

  useEffect(() => {
    if (streamState.connected || ["completed", "failed", "cancelled", "revoked", "partial_failure"].includes(streamState.status)) {
      return
    }
    const interval = window.setInterval(() => void loadWorkspace().catch(() => undefined), 15_000)
    return () => window.clearInterval(interval)
  }, [loadWorkspace, streamState.connected, streamState.status])

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
    })
    events.addEventListener("trace", (event) => {
      const traceEvent = parseEventData(event)
      setStreamState((current) => ({
        ...current,
        connected: true,
        lastEvent: traceEvent,
      }))
      if (traceRefreshTimer.current !== null) window.clearTimeout(traceRefreshTimer.current)
      traceRefreshTimer.current = window.setTimeout(() => {
        traceRefreshTimer.current = null
        void loadRun().catch(() => undefined)
      }, 100)
    })
    events.addEventListener("activity", (event) => {
      const activity = parseLiveRunSnapshot(parseEventData(event))
      if (!activity) return
      setStreamState((current) => ({
        ...current,
        connected: true,
        activity,
        activityError: null,
      }))
    })
    events.addEventListener("activity_error", (event) => {
      const payload = parseEventData(event)
      setStreamState((current) => ({
        ...current,
        activityError: readString(payload, "message") ?? "Live execution activity is temporarily unavailable.",
      }))
    })
    events.addEventListener("done", (event) => {
      const done = parseEventData(event)
      setStreamState((current) => ({
        ...current,
        connected: false,
        status: readString(done, "status") ?? current.status,
      }))
      if (traceRefreshTimer.current !== null) {
        window.clearTimeout(traceRefreshTimer.current)
        traceRefreshTimer.current = null
      }
      void loadWorkspace().catch(() => undefined)
      events.close()
    })
    events.onerror = () => {
      setStreamState((current) => ({ ...current, connected: false }))
    }
    return () => {
      events.close()
      if (traceRefreshTimer.current !== null) {
        window.clearTimeout(traceRefreshTimer.current)
        traceRefreshTimer.current = null
      }
    }
  }, [taskId, loadRun, loadWorkspace])

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
