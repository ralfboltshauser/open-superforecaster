"use client"

import Link from "next/link"
import { ArrowRight, BookOpenCheck, History } from "lucide-react"

import { ForecastComposer } from "@/components/forecast-composer"
import { useEducationProgress } from "@/components/education/education-progress"
import { LogoMark } from "@/components/logo-mark"
import { SourceGraphBackground } from "@/components/source-graph-background"
import { Button } from "@/components/ui/button"
import { useRuns } from "@/hooks/use-runs"

export function HomeDashboard() {
  const { error, runs } = useRuns()
  const { hydrated, progress } = useEducationProgress()
  const onboardingLabel = !hydrated
    ? "Open the 5-minute guide"
    : progress.onboarding.completedAt
      ? "Review the forecasting guide"
      : progress.onboarding.completedStepIds.length > 0
        ? "Continue your forecasting guide"
        : progress.onboarding.skippedAt
          ? "Resume the 5-minute guide"
          : "New here? Take the 5-minute guide"

  return (
    <main className="relative min-h-svh overflow-hidden">
      <SourceGraphBackground runs={runs} />
      <section className="relative z-10 flex min-h-svh flex-col items-center justify-center px-5 py-14 sm:py-16">
        <div className="w-full max-w-5xl">
          <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
            <LogoMark className="h-28 w-72 drop-shadow-[0_0_34px_rgba(132,205,255,0.22)] sm:h-32 sm:w-80" />
            <p className="fs-eyebrow mt-7 text-primary/90">open superforecaster</p>
            <h1 className="fs-wordmark mt-3 text-[1.55rem] font-normal leading-tight tracking-[0.18em] sm:text-4xl sm:tracking-[0.28em] md:text-5xl">
              forecast. resolve. learn.
            </h1>
            <div className="fs-blueprint-line mt-5 h-px w-44" />
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              Turn a vague uncertainty into a resolvable question, compare independent estimates, and learn when the outcome arrives.
            </p>
            <Button className="mt-5 border border-primary/25 bg-primary/10 text-primary hover:bg-primary/15" variant="outline" nativeButton={false} render={<Link href="/onboarding" />}>
              <BookOpenCheck data-icon="inline-start" />
              {onboardingLabel}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>

          <ForecastComposer className="mx-auto mt-9 max-w-3xl text-left" />

          <div className="mx-auto mt-7 grid max-w-3xl gap-4 border-y border-border/70 py-5 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <MetricLabel number="01" label="Frame" />
            <div className="hidden h-10 w-px bg-border/80 sm:block" />
            <MetricLabel number="02" label="Forecast" />
            <div className="hidden h-10 w-px bg-border/80 sm:block" />
            <MetricLabel number="03" label="Learn" />
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" size="sm" className="border-primary/25 bg-background/40 uppercase tracking-[0.18em] text-primary/90" nativeButton={false} render={<Link href="/learn#questions" />}>
              What can I forecast?
            </Button>
            <Button type="button" variant="ghost" size="sm" className="uppercase tracking-[0.18em] text-muted-foreground" nativeButton={false} render={<Link href="/forecasts" />}>
              <History data-icon="inline-start" />
              Browse forecasts
            </Button>
          </div>
          {error ? (
            <p className="mx-auto mt-4 max-w-3xl rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-center text-xs text-destructive">
              Forecast history is temporarily unavailable. You can still prepare a question.
            </p>
          ) : null}
        </div>
        <footer className="absolute bottom-5 left-5 right-5 z-10 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[0.68rem] uppercase tracking-[0.26em] text-muted-foreground/80">
          <span>science.</span>
          <span>evidence.</span>
          <span>foresight.</span>
          <span className="text-primary/90">open.</span>
        </footer>
      </section>
    </main>
  )
}

function MetricLabel({ number, label }: { number: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-5 sm:flex-col sm:items-start sm:justify-start">
      <span className="text-sm tabular-nums tracking-[0.22em] text-primary">{number}</span>
      <span className="text-xs uppercase tracking-[0.32em] text-foreground/85">{label}</span>
    </div>
  )
}
