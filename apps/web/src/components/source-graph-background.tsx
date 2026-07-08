"use client"

import { useMemo } from "react"

import { domainLabels } from "@/components/source-graph/source-graph-data"
import { SourceGraphCanvas } from "@/components/source-graph/source-graph-canvas"
import type { SourceGraphVariant } from "@/components/source-graph/types"
import type { JsonRecord } from "@/lib/records"
import { cn } from "@/lib/utils"

type SourceGraphBackgroundProps = {
  runs?: JsonRecord[]
  className?: string
  variant?: SourceGraphVariant
}

export function SourceGraphBackground({ runs = [], className, variant = "hero" }: SourceGraphBackgroundProps) {
  const domains = useMemo(() => domainLabels(runs), [runs])

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden="true">
      <SourceGraphCanvas domains={domains} variant={variant} />
      <div className="fs-graph-sheen absolute inset-0" />
      <div className="fs-vignette absolute inset-0" />
    </div>
  )
}
