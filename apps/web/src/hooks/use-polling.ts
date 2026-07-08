"use client"

import { useEffect } from "react"

export function usePolling(callback: () => void | Promise<void>, intervalMs: number, enabled = true) {
  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false

    async function tick() {
      if (cancelled) {
        return
      }
      await callback()
    }

    void tick()
    const interval = window.setInterval(() => void tick(), intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [callback, enabled, intervalMs])
}
