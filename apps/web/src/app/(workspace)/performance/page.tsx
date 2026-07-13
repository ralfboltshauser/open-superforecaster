import type { Metadata } from "next"

import { PerformanceDashboard } from "@/components/performance-dashboard"

export const metadata: Metadata = {
  title: "Performance · Open Superforecaster",
  description: "Read system scores, calibration, and sample-size limits without overclaiming.",
}

export default function PerformancePage() {
  return <PerformanceDashboard />
}
