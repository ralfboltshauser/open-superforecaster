import type { Metadata } from "next"

import { OnboardingExperience } from "@/components/education/onboarding-experience"

export const metadata: Metadata = {
  title: "Forecasting Onboarding · Open Superforecaster",
  description: "Learn the foundations of calibrated, resolvable forecasting before making your first prediction.",
}

export default function OnboardingPage() {
  return <OnboardingExperience />
}
