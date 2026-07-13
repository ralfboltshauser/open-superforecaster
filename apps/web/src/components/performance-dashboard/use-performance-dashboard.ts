"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { buildPerformanceSnapshot, type PerformanceSnapshot } from "@/components/performance-dashboard/model"
import { fetchJson } from "@/lib/api-client"
import type { JsonRecord } from "@/lib/records"

type PerformanceState = {
  snapshot: PerformanceSnapshot | null
  loading: boolean
  refreshing: boolean
  error: string | null
}

export function usePerformanceDashboard() {
  const [state, setState] = useState<PerformanceState>({
    snapshot: null,
    loading: true,
    refreshing: false,
    error: null,
  })
  const loadingRef = useRef(false)
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    setState((current) => ({ ...current, refreshing: !current.loading, error: null }))
    try {
      const payload = await fetchJson<JsonRecord>("/api/resolutions/performance")
      if (!mountedRef.current) return
      setState({
        snapshot: buildPerformanceSnapshot(payload),
        loading: false,
        refreshing: false,
        error: null,
      })
    } catch (error) {
      if (!mountedRef.current) return
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: readableError(error),
      }))
    } finally {
      loadingRef.current = false
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    const interval = window.setInterval(() => void refresh(), 30_000)
    return () => {
      mountedRef.current = false
      window.clearInterval(interval)
    }
  }, [refresh])

  return { ...state, refresh }
}

function readableError(error: unknown) {
  if (error instanceof Error && error.message.includes("Failed to fetch")) {
    return "The local performance service is unreachable. Check that the server is running."
  }
  return "Performance data could not be loaded. No scores have been inferred or estimated."
}
