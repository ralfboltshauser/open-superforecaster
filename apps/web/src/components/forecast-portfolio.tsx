"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Clock3,
  FileQuestion,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react"

import { type ForecastLifecycleState, type ForecastPortfolioItem } from "@/components/forecast-portfolio/model"
import { useForecastPortfolio } from "@/components/forecast-portfolio/use-forecast-portfolio"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type ForecastFilter = "all" | "active" | "awaiting" | "resolved" | "failed"

const filters: Array<{ key: ForecastFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "awaiting", label: "Awaiting resolution" },
  { key: "resolved", label: "Resolved" },
  { key: "failed", label: "Needs attention" },
]

export function ForecastPortfolio() {
  const { detailFailures, error, items, lastUpdatedAt, loading, refresh, refreshing } = useForecastPortfolio()
  const [filter, setFilter] = useState<ForecastFilter>("all")
  const [query, setQuery] = useState("")
  const visibleItems = useMemo(
    () => items.filter((item) => matchesFilter(item, filter) && matchesSearch(item, query)),
    [filter, items, query],
  )
  const counts = useMemo(() => ({
    active: items.filter((item) => matchesFilter(item, "active")).length,
    awaiting: items.filter((item) => matchesFilter(item, "awaiting")).length,
    resolved: items.filter((item) => matchesFilter(item, "resolved")).length,
  }), [items])

  return (
    <main className="min-h-svh px-4 py-5 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-6 border-b pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="fs-eyebrow text-primary/80">Forecast lifecycle</p>
            <h1 className="mt-3 text-3xl font-medium tracking-tight md:text-5xl">Follow every forecast to the finish.</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              A probability becomes evidence only after the question resolves. This view keeps recent forecasts, resolution work, and scored outcomes in one loop.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              aria-label="Refresh forecast ledger"
              disabled={refreshing}
              onClick={() => void refresh()}
              variant="outline"
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} />
              Refresh
            </Button>
            <Button nativeButton={false} render={<Link href="/" />}>
              <Sparkles />
              New forecast
            </Button>
          </div>
        </header>

        {loading ? <PortfolioSkeleton /> : null}

        {!loading && error ? <PortfolioError error={error} onRetry={() => void refresh()} /> : null}

        {!loading && !error ? (
          <>
            <section aria-label="Forecast lifecycle summary" className="mt-6 grid gap-3 sm:grid-cols-3">
              <SummaryMetric icon={CircleDashed} label="Active" value={counts.active} detail="Running or ready to review" />
              <SummaryMetric icon={CalendarClock} label="Awaiting resolution" value={counts.awaiting} detail="Completed binary forecasts" />
              <SummaryMetric icon={CheckCircle2} label="Resolved" value={counts.resolved} detail="Outcome recorded or annulled" />
            </section>

            <section className="mt-6" aria-labelledby="recent-forecasts-title">
              <div className="flex flex-col gap-4 rounded-xl border bg-card/45 p-4 md:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-medium" id="recent-forecasts-title">Recent forecasts</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The latest forecast runs available from the local ledger.
                      {lastUpdatedAt ? ` Updated ${formatRelativeTime(lastUpdatedAt)}.` : ""}
                    </p>
                  </div>
                  <div className="relative w-full lg:max-w-xs">
                    <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      aria-label="Search recent forecasts"
                      className="pl-8"
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search questions"
                      type="search"
                      value={query}
                    />
                  </div>
                </div>

                <div aria-label="Filter forecasts by state" className="flex flex-wrap gap-2" role="group">
                  {filters.map((item) => (
                    <Button
                      aria-pressed={filter === item.key}
                      key={item.key}
                      onClick={() => setFilter(item.key)}
                      size="sm"
                      variant={filter === item.key ? "secondary" : "ghost"}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </div>

              {detailFailures > 0 ? (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-forecast/30 bg-forecast/5 px-4 py-3 text-sm" role="status">
                  <FileQuestion className="mt-0.5 size-4 shrink-0 text-forecast" />
                  <p className="text-muted-foreground">
                    {detailFailures} question {detailFailures === 1 ? "title is" : "titles are"} temporarily unavailable. Refresh to retry the detail lookup.
                  </p>
                </div>
              ) : null}

              {items.length === 0 ? (
                <EmptyPortfolio />
              ) : visibleItems.length === 0 ? (
                <NoMatches onReset={() => { setFilter("all"); setQuery("") }} />
              ) : (
                <div className="mt-4 grid gap-3" aria-live="polite">
                  {visibleItems.map((item) => <ForecastRow item={item} key={item.id} />)}
                </div>
              )}
            </section>

            <aside className="mt-6 grid gap-3 rounded-xl border border-primary/20 bg-primary/5 p-5 md:grid-cols-[auto_1fr]" aria-label="Forecasting practice note">
              <Clock3 className="mt-0.5 size-5 text-primary" />
              <div>
                <h2 className="font-medium">Closing the loop is part of the forecast</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Record the outcome using the question&apos;s stated resolution rule. A correct outcome can come from weak reasoning, and a miss can follow a sound process. Scores become meaningful across many comparable, independently resolved questions.
                </p>
                <Button className="mt-3 px-0" nativeButton={false} render={<Link href="/performance" />} size="sm" variant="link">
                  Learn how scoring works <ArrowRight />
                </Button>
              </div>
            </aside>
          </>
        ) : null}
      </div>
    </main>
  )
}

function ForecastRow({ item }: { item: ForecastPortfolioItem }) {
  return (
    <Link
      className="group grid gap-4 rounded-xl border bg-card/60 p-4 transition-colors hover:border-primary/35 hover:bg-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:p-5"
      href={`/runs/${item.id}`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={stateBadgeClass(item.state)} variant="outline">
            <ForecastStateIcon state={item.state} />
            {item.stateLabel}
          </Badge>
          <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{formatForecastType(item.forecastType)}</span>
          {item.sourceCount > 0 ? <span className="text-xs text-muted-foreground">{item.sourceCount} source{item.sourceCount === 1 ? "" : "s"}</span> : null}
        </div>
        <h3 className={cn("mt-3 text-base font-medium leading-6 md:text-lg", !item.questionAvailable && "text-muted-foreground")}>
          {item.question}
        </h3>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Created {formatDate(item.createdAt)}</span>
          {item.resolutionDate ? <span>Resolves {formatDate(item.resolutionDate)}</span> : <span>Resolution date not recorded</span>}
          {item.score !== null ? <span>Brier {formatScore(item.score)}</span> : null}
        </div>
        {item.state === "failed" && item.error ? (
          <p className="mt-2 line-clamp-2 text-xs text-destructive">{item.error}</p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-4 border-t pt-3 md:min-w-44 md:justify-end md:border-l md:border-t-0 md:pl-5 md:pt-0">
        <div className="md:text-right">
          <p className="text-sm font-medium tabular-nums">{item.resultLabel ?? "Open forecast"}</p>
          <p className="mt-1 text-xs text-muted-foreground">View reasoning and evidence</p>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
    </Link>
  )
}

function SummaryMetric({ icon: Icon, label, value, detail }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  detail: string
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></div>
        <div>
          <p className="text-2xl font-medium tabular-nums">{value}</p>
          <p className="font-medium">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyPortfolio() {
  return (
    <div className="mt-4 rounded-xl border border-dashed px-6 py-14 text-center">
      <FileQuestion className="mx-auto size-8 text-muted-foreground" />
      <h3 className="mt-4 text-lg font-medium">No forecasts in recent history</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        Create a time-bounded, resolvable question. It will appear here while it runs and remain visible through resolution.
      </p>
      <Button className="mt-5" nativeButton={false} render={<Link href="/" />}><Sparkles /> Start a forecast</Button>
    </div>
  )
}

function NoMatches({ onReset }: { onReset: () => void }) {
  return (
    <div className="mt-4 rounded-xl border border-dashed px-6 py-10 text-center">
      <Search className="mx-auto size-7 text-muted-foreground" />
      <h3 className="mt-3 font-medium">No forecasts match this view</h3>
      <p className="mt-1 text-sm text-muted-foreground">Try another search or clear the lifecycle filter.</p>
      <Button className="mt-4" onClick={onReset} variant="outline">Clear filters</Button>
    </div>
  )
}

function PortfolioError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center" role="alert">
      <AlertTriangle className="mx-auto size-8 text-destructive" />
      <h2 className="mt-4 text-lg font-medium">Forecast history is unavailable</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{error}</p>
      <Button className="mt-5" onClick={onRetry} variant="outline"><RefreshCw /> Try again</Button>
    </div>
  )
}

function PortfolioSkeleton() {
  return (
    <div aria-label="Loading forecast history" aria-live="polite" className="mt-6" role="status">
      <span className="sr-only">Loading forecast history</span>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((item) => <Skeleton className="h-28 rounded-xl" key={item} />)}
      </div>
      <Skeleton className="mt-6 h-28 rounded-xl" />
      <div className="mt-4 grid gap-3">
        {[0, 1, 2].map((item) => <Skeleton className="h-36 rounded-xl" key={item} />)}
      </div>
    </div>
  )
}

function matchesFilter(item: ForecastPortfolioItem, filter: ForecastFilter) {
  if (filter === "all") return true
  if (filter === "active") return item.state === "in_progress" || item.state === "forecast_ready"
  if (filter === "awaiting") return item.state === "awaiting_resolution"
  if (filter === "resolved") return item.state === "resolved" || item.state === "annulled"
  return item.state === "failed"
}

function matchesSearch(item: ForecastPortfolioItem, query: string) {
  const normalized = query.trim().toLowerCase()
  return !normalized || item.question.toLowerCase().includes(normalized) || item.forecastType.toLowerCase().includes(normalized)
}

function ForecastStateIcon({ state }: { state: ForecastLifecycleState }) {
  if (state === "resolved") return <CheckCircle2 />
  if (state === "awaiting_resolution") return <CalendarClock />
  if (state === "failed") return <AlertTriangle />
  if (state === "annulled") return <FileQuestion />
  return <CircleDashed />
}

function stateBadgeClass(state: ForecastLifecycleState) {
  if (state === "resolved") return "border-success/35 bg-success/10 text-success"
  if (state === "awaiting_resolution") return "border-forecast/35 bg-forecast/10 text-forecast"
  if (state === "failed") return "border-destructive/35 bg-destructive/10 text-destructive"
  if (state === "annulled") return "border-muted-foreground/30 bg-muted text-muted-foreground"
  if (state === "in_progress") return "border-primary/35 bg-primary/10 text-primary"
  return "border-border bg-secondary text-secondary-foreground"
}

function formatForecastType(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value: string | null) {
  if (!value) return "date unknown"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "date unknown"
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date)
}

function formatRelativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "just now"
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}

function formatScore(value: number) {
  return new Intl.NumberFormat("en", { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value)
}
