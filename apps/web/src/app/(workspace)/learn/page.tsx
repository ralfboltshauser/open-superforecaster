import type { Metadata } from "next"

import { LearnExperience } from "@/components/education/learn-experience"

export const metadata: Metadata = {
  title: "Learn Superforecasting · Open Superforecaster",
  description: "An interactive field guide to questions, probabilities, base rates, updating, aggregation, scoring, and perpetual beta.",
}

export default function LearnPage() {
  return <LearnExperience />
}
