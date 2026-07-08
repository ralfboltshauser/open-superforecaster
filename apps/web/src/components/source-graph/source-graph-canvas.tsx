"use client"

import { useEffect, useMemo, useRef } from "react"

import { SourceGraphEngine } from "@/components/source-graph/source-graph-engine"
import type { SourceGraphVariant } from "@/components/source-graph/types"

type SourceGraphCanvasProps = {
  domains: string[]
  variant: SourceGraphVariant
}

export function SourceGraphCanvas({ domains, variant }: SourceGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const domainKey = useMemo(() => domains.join("|"), [domains])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const engine = new SourceGraphEngine(canvas, { domains: domainKey.split("|").filter(Boolean), variant })
    engine.start()
    return () => engine.destroy()
  }, [domainKey, variant])

  return <canvas ref={canvasRef} className="pointer-events-auto absolute inset-0 size-full" />
}
