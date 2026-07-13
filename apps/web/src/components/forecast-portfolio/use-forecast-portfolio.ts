"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { buildForecastPortfolio, isForecastRun, type ForecastPortfolioItem } from "@/components/forecast-portfolio/model"
import { fetchJson } from "@/lib/api-client"
import { isRecord, readArray, readString, type JsonRecord } from "@/lib/records"

type PortfolioState = {
  items: ForecastPortfolioItem[]
  loading: boolean
  refreshing: boolean
  error: string | null
  detailFailures: number
  lastUpdatedAt: string | null
}

const initialState: PortfolioState = {
  items: [],
  loading: true,
  refreshing: false,
  error: null,
  detailFailures: 0,
  lastUpdatedAt: null,
}

export function useForecastPortfolio() {
  const [state, setState] = useState(initialState)
  const detailsRef = useRef<Record<string, JsonRecord>>({})
  const loadingRef = useRef(false)
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    if (loadingRef.current) {
      return
    }
    loadingRef.current = true
    setState((current) => ({
      ...current,
      refreshing: !current.loading,
      error: null,
    }))

    try {
      const [runsPayload, resolutions, performance] = await Promise.all([
        fetchJson<JsonRecord>("/api/runs"),
        fetchJson<JsonRecord>("/api/resolutions"),
        fetchJson<JsonRecord>("/api/resolutions/performance"),
      ])
      const runs = readArray(runsPayload, "runs").filter(isRecord)
      const forecastRuns = runs.filter(isForecastRun)
      let detailFailures = 0

      await Promise.all(
        forecastRuns.map(async (run) => {
          const taskId = readString(run, "id")
          if (!taskId || detailsRef.current[taskId]) {
            return
          }
          try {
            const payload = await fetchJson<JsonRecord>(`/api/runs/${encodeURIComponent(taskId)}`)
            if (isRecord(payload.run)) {
              detailsRef.current[taskId] = payload.run
            } else {
              detailFailures += 1
            }
          } catch {
            detailFailures += 1
          }
        }),
      )

      if (!mountedRef.current) {
        return
      }
      setState({
        items: buildForecastPortfolio({
          runs,
          detailsByTaskId: detailsRef.current,
          resolutions,
          performance,
        }),
        loading: false,
        refreshing: false,
        error: null,
        detailFailures,
        lastUpdatedAt: new Date().toISOString(),
      })
    } catch (error) {
      if (!mountedRef.current) {
        return
      }
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
    const interval = window.setInterval(() => void refresh(), 20_000)
    return () => {
      mountedRef.current = false
      window.clearInterval(interval)
    }
  }, [refresh])

  return { ...state, refresh }
}

function readableError(error: unknown) {
  if (!(error instanceof Error)) {
    return "The forecast ledger could not be loaded."
  }
  if (error.message.includes("Failed to fetch")) {
    return "The forecast ledger is unreachable. Check that the local server is running."
  }
  return "The forecast ledger could not be loaded. Try again in a moment."
}
