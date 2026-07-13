"use client"

import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Gauge,
  Info,
  RefreshCw,
  Scale,
  Sigma,
} from "lucide-react"

import { type PerformanceBucket, type PerformanceSnapshot } from "@/components/performance-dashboard/model"
import { usePerformanceDashboard } from "@/components/performance-dashboard/use-performance-dashboard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function PerformanceDashboard() {
  const { error, loading, refresh, refreshing, snapshot } = usePerformanceDashboard()

  return (
    <main className="min-h-svh px-4 py-5 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-6 border-b pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="fs-eyebrow text-primary/80">Performance & calibration</p>
            <h1 className="mt-3 text-3xl font-medium tracking-tight md:text-5xl">Keep score without fooling yourself.</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              These are descriptive results from resolved product forecasts. They are a learning signal—not proof that the system will outperform a baseline on new questions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button aria-label="Refresh performance data" disabled={refreshing} onClick={() => void refresh()} variant="outline">
              <RefreshCw className={cn(refreshing && "animate-spin")} /> Refresh
            </Button>
            <Button nativeButton={false} render={<Link href="/forecasts" />}>
              View forecasts <ArrowRight />
            </Button>
          </div>
        </header>

        {loading ? <PerformanceSkeleton /> : null}
        {!loading && error ? <PerformanceError error={error} onRetry={() => void refresh()} /> : null}
        {!loading && !error && snapshot ? <PerformanceContent snapshot={snapshot} /> : null}
      </div>
    </main>
  )
}

function PerformanceContent({ snapshot }: { snapshot: PerformanceSnapshot }) {
  const hasScores = snapshot.productScoreRows > 0
  return (
    <>
      <section aria-label="Current forecasting evidence" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          detail="Questions with recorded outcomes"
          icon={CheckCircle2}
          label="Resolved forecasts"
          value={String(snapshot.resolvedTasks)}
        />
        <MetricCard
          detail="System aggregate evaluations"
          icon={BarChart3}
          label="Aggregate score rows"
          value={String(snapshot.aggregateScoreRows)}
        />
        <MetricCard
          detail={snapshot.meanBrier === null ? "No binary aggregate score yet" : "Lower is better; 0 is perfect"}
          icon={Scale}
          label="Mean Brier score"
          value={snapshot.meanBrier === null ? "—" : formatMetric(snapshot.meanBrier)}
        />
        <MetricCard
          detail="Binary forecasts in calibration buckets"
          icon={Gauge}
          label="Calibration sample"
          value={String(snapshot.calibrationSampleSize)}
        />
      </section>

      {!hasScores ? <NoPerformanceData /> : null}

      <section className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="grid gap-6">
          <CalibrationCard snapshot={snapshot} />
          <ForecastTypeCard snapshot={snapshot} />
        </div>
        <div className="grid gap-6">
          <EvidenceLimitCard snapshot={snapshot} />
          <ScoringPrimer />
        </div>
      </section>
    </>
  )
}

function CalibrationCard({ snapshot }: { snapshot: PerformanceSnapshot }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Calibration by probability range</CardTitle>
        <CardDescription>
          If the system is calibrated, events forecast near 70% should happen about 70% of the time across a sufficiently large set.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {snapshot.calibrationBuckets.length === 0 ? (
          <div className="rounded-lg border border-dashed px-5 py-10 text-center">
            <Gauge className="mx-auto size-7 text-muted-foreground" />
            <p className="mt-3 font-medium">No populated calibration ranges yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
              Binary aggregate forecasts appear here only after their outcomes are recorded and scored.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="hidden grid-cols-[96px_1fr_72px] gap-4 px-3 text-xs uppercase tracking-[0.14em] text-muted-foreground md:grid">
              <span>Forecast range</span><span>Mean forecast vs observed rate</span><span className="text-right">Cases</span>
            </div>
            {snapshot.calibrationBuckets.map((bucket) => <CalibrationRow bucket={bucket} key={bucket.label} />)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CalibrationRow({ bucket }: { bucket: PerformanceBucket }) {
  const forecast = asPercentage(bucket.meanForecast)
  const observed = asPercentage(bucket.observedRate)
  return (
    <div className="grid gap-3 rounded-lg border bg-background/35 p-3 md:grid-cols-[96px_1fr_72px] md:items-center md:gap-4">
      <div>
        <p className="font-medium tabular-nums">{bucket.label}</p>
        {bucket.count < 10 ? <Badge className="mt-1" variant="outline">Small sample</Badge> : null}
      </div>
      <div className="grid gap-2">
        <CalibrationBar colorClass="bg-primary" label="Mean forecast" value={forecast} />
        <CalibrationBar colorClass="bg-success" label="Observed" value={observed} />
        <p className="text-xs text-muted-foreground">
          {bucket.calibrationError === null ? "Calibration gap unavailable" : `${formatPercentagePoints(bucket.calibrationError)} percentage-point gap`}
          {bucket.meanBrier === null ? "" : ` · Brier ${formatMetric(bucket.meanBrier)}`}
        </p>
      </div>
      <p className="text-sm tabular-nums text-muted-foreground md:text-right">n = {bucket.count}</p>
    </div>
  )
}

function CalibrationBar({ colorClass, label, value }: { colorClass: string; label: string; value: number | null }) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div className="grid grid-cols-[88px_1fr_48px] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", colorClass)} style={{ width: `${width}%` }} />
      </div>
      <span className="text-right tabular-nums">{value === null ? "—" : `${formatMetric(value)}%`}</span>
    </div>
  )
}

function EvidenceLimitCard({ snapshot }: { snapshot: PerformanceSnapshot }) {
  const minimum = snapshot.calibrationMinimum
  const progress = minimum && minimum > 0 ? Math.min(100, (snapshot.calibrationSampleSize / minimum) * 100) : null
  const ready = snapshot.calibrationStatus === "ready_for_candidate_fitting"
  return (
    <Card className={ready ? "ring-success/25" : "ring-forecast/25"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {ready ? <CheckCircle2 className="size-4 text-success" /> : <Info className="size-4 text-forecast" />}
          Strength of evidence
        </CardTitle>
        <CardDescription>
          {ready
            ? "The configured minimum for candidate fitting has been reached. This still does not validate a calibration model."
            : "The ledger is still collecting resolved binary forecasts. Treat bucket differences as descriptive, not stable."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {progress !== null ? (
          <>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>Candidate-fitting data floor</span>
              <span className="tabular-nums text-muted-foreground">{snapshot.calibrationSampleSize} / {minimum}</span>
            </div>
            <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full", ready ? "bg-success" : "bg-forecast")} style={{ width: `${progress}%` }} />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">The performance payload did not report a fitting threshold.</p>
        )}
        <dl className="mt-5 grid gap-3 border-t pt-4 text-sm">
          <MetricDefinition label="Expected calibration error" value={formatOptionalPercentagePoints(snapshot.expectedCalibrationError)} />
          <MetricDefinition label="Largest populated-bucket gap" value={formatOptionalPercentagePoints(snapshot.maxBucketCalibrationError)} />
          <MetricDefinition label="Generated" value={formatDateTime(snapshot.generatedAt)} />
        </dl>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Reaching a sample threshold only permits candidate fitting. Trust still requires chronological holdout evaluation, independent event families, baseline comparison, and prospective confirmation.
        </p>
      </CardContent>
    </Card>
  )
}

function ForecastTypeCard({ snapshot }: { snapshot: PerformanceSnapshot }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Results by forecast type</CardTitle>
        <CardDescription>Different forecast types use different proper scores. Compare scores only within the same metric and evaluation setup.</CardDescription>
      </CardHeader>
      <CardContent>
        {snapshot.forecastTypes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No scored forecast-type groups yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <caption className="sr-only">Performance grouped by forecast type</caption>
              <thead>
                <tr className="border-b text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-2 py-3 font-medium" scope="col">Forecast type</th>
                  <th className="px-2 py-3 text-right font-medium" scope="col">Resolved</th>
                  <th className="px-2 py-3 text-right font-medium" scope="col">Score rows</th>
                  <th className="px-2 py-3 text-right font-medium" scope="col">Primary mean</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.forecastTypes.map((group) => (
                  <tr className="border-b last:border-0" key={group.key}>
                    <th className="px-2 py-3 font-medium" scope="row">{formatLabel(group.label)}</th>
                    <td className="px-2 py-3 text-right tabular-nums text-muted-foreground">{group.resolvedTasks}</td>
                    <td className="px-2 py-3 text-right tabular-nums text-muted-foreground">{group.scoreRows}</td>
                    <td className="px-2 py-3 text-right tabular-nums">
                      {group.primaryMetric && group.primaryMean !== null ? `${formatLabel(group.primaryMetric)} ${formatMetric(group.primaryMean)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ScoringPrimer() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BookOpen className="size-4 text-primary" /> Read the score correctly</CardTitle>
        <CardDescription>Three ideas prevent most performance-chart mistakes.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <PrimerItem
          icon={Sigma}
          title="Brier score rewards honest precision"
          body="For a binary forecast it is (probability − outcome)². A 70% forecast scores 0.09 if the event happens and 0.49 if it does not. Lower is better; average across many forecasts."
        />
        <PrimerItem
          icon={Gauge}
          title="Calibration is a track record"
          body="One 70% event failing is not miscalibration. Calibration asks whether roughly 70% of a large set of comparable 70% forecasts happen."
        />
        <PrimerItem
          icon={BarChart3}
          title="A baseline is mandatory"
          body="A raw score has no claim of skill by itself. Compare the same questions against simple base rates, mean and median aggregates, markets when allowed, and prior production versions."
        />
        <Button className="justify-start px-0" nativeButton={false} render={<Link href="/learn#scoring" />} variant="link">
          Study scoring and calibration <ArrowRight />
        </Button>
      </CardContent>
    </Card>
  )
}

function PrimerItem({ icon: Icon, title, body }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  body: string
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-3 border-b pb-4 last:border-0 last:pb-0">
      <div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></div>
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p>
      </div>
    </div>
  )
}

function NoPerformanceData() {
  return (
    <div className="mt-6 flex items-start gap-3 rounded-xl border border-forecast/30 bg-forecast/5 p-4" role="status">
      <Info className="mt-0.5 size-5 shrink-0 text-forecast" />
      <div>
        <h2 className="font-medium">No scored product forecasts yet</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          This is a valid empty state, not zero performance. Resolve completed forecasts before interpreting calibration or score averages.
        </p>
      </div>
    </div>
  )
}

function MetricCard({ detail, icon: Icon, label, value }: {
  detail: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-medium tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <Icon className="size-5 text-primary" />
      </CardContent>
    </Card>
  )
}

function MetricDefinition({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="text-right tabular-nums">{value}</dd></div>
}

function PerformanceError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="mt-8 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center" role="alert">
      <AlertTriangle className="mx-auto size-8 text-destructive" />
      <h2 className="mt-4 text-lg font-medium">Performance data is unavailable</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{error}</p>
      <Button className="mt-5" onClick={onRetry} variant="outline"><RefreshCw /> Try again</Button>
    </div>
  )
}

function PerformanceSkeleton() {
  return (
    <div aria-label="Loading performance data" aria-live="polite" className="mt-6" role="status">
      <span className="sr-only">Loading performance data</span>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <Skeleton className="h-32 rounded-xl" key={item} />)}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Skeleton className="h-[520px] rounded-xl" />
        <Skeleton className="h-[420px] rounded-xl" />
      </div>
    </div>
  )
}

function asPercentage(value: number | null) {
  return value
}

function formatMetric(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(value)
}

function formatPercentagePoints(value: number) {
  return formatMetric(value)
}

function formatOptionalPercentagePoints(value: number | null) {
  return value === null ? "Not enough data" : `${formatPercentagePoints(value)} pp`
}

function formatDateTime(value: string | null) {
  if (!value) return "Unknown"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Unknown"
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date)
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}
