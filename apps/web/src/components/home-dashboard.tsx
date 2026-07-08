"use client"

import { AppShell } from "@/components/app-shell"
import { ForecastComposer } from "@/components/forecast-composer"
import { SourceGraphBackground } from "@/components/source-graph-background"
import { Button } from "@/components/ui/button"
import { useRuns } from "@/hooks/use-runs"

export function HomeDashboard() {
  const { runs } = useRuns()

  return (
    <AppShell runs={runs}>
      <main className="relative min-h-svh overflow-hidden">
        <SourceGraphBackground runs={runs} />
        <section className="relative z-10 flex min-h-svh flex-col items-center justify-center px-5 py-16">
          <div className="w-full max-w-4xl text-center">
            <p className="fs-eyebrow text-primary/80">open superforecaster</p>
            <h1 className="mt-4 text-4xl font-normal tracking-[0.12em] text-foreground md:text-6xl">
              search the future
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              Ask a forecast. Watch researchers gather evidence, then inspect the distribution, citations, and workflow trace.
            </p>
            <ForecastComposer className="mx-auto mt-10 max-w-3xl text-left" />
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Button type="button" variant="outline" size="sm">
                What can I forecast?
              </Button>
              <Button type="button" variant="ghost" size="sm">
                Browse recent runs
              </Button>
            </div>
          </div>
          <footer className="absolute bottom-5 left-5 right-5 z-10 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span>Smithers workflows</span>
            <span>Codex research agents</span>
            <span>Forecast ledger</span>
          </footer>
        </section>
      </main>
    </AppShell>
  )
}
