import type { Metadata } from "next"

import { ForecastPortfolio } from "@/components/forecast-portfolio"

export const metadata: Metadata = {
  title: "Forecasts · Open Superforecaster",
  description: "Track active forecasts through resolution and scoring.",
}

export default function ForecastsPage() {
  return <ForecastPortfolio />
}
