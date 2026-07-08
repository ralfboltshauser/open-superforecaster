"use client"

import Link from "next/link"
import {
  BarChart3,
  Bot,
  CheckCircle2,
  CircleDot,
  FileJson,
  FileText,
  LinkIcon,
  Loader2,
  Network,
  RotateCcw,
} from "lucide-react"

import { parseRecord, sourceDomain } from "@/components/run-workspace/run-detail"
import type { RunStreamState } from "@/components/run-workspace/use-run-workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { formatModeLabel, questionTitle, readArray, readNumber, readString, truncate, type JsonRecord } from "@/lib/records"

export function RunStreamPanel({ streamState }: { streamState: RunStreamState }) {
  const progress = streamState.progress
  const percent = progress && progress.total > 0 ? Math.round(((progress.completed + progress.failed) / progress.total) * 100) : 0
  const streamLabel =
    percent >= 100 ? "Run events complete" : streamState.connected ? "Receiving run events" : "Waiting for run events"
  return (
    <Card size="sm" className="min-w-72 bg-card/60">
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{streamLabel}</span>
          <span>{percent}%</span>
        </div>
        <Progress value={percent} />
        {streamState.lastEvent ? (
          <p className="truncate text-xs text-muted-foreground">
            {traceLabel(streamState.lastEvent)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function LoadingRunState() {
  return (
    <section className="mt-6 grid gap-4 xl:grid-cols-[minmax(360px,0.52fr)_minmax(0,0.48fr)]">
      <Card className="fs-panel">
        <CardHeader>
          <CardTitle className="text-base">Briefing researchers</CardTitle>
          <CardDescription>Loading run detail, trace events, and source bank.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-md border bg-muted/25 px-3 py-2 text-sm text-forecast">
            <Loader2 className="animate-spin" data-icon="inline-start" />
            asking researchers
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-4/5" />
          </div>
          <div className="grid grid-cols-8 gap-2">
            {Array.from({ length: 16 }, (_, index) => (
              <span className="flex size-8 items-center justify-center rounded-full border border-muted text-muted-foreground" key={index}>
                <Bot />
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card className="fs-artifact">
        <CardHeader>
          <CardTitle className="text-xl text-forecast">Forecast artifact pending</CardTitle>
          <CardDescription>The final distribution will appear here.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Skeleton className="h-10 w-48 bg-success/15" />
          <div className="grid grid-cols-5 gap-3">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton className="h-14 bg-muted/35" key={index} />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

export function ResearchNarrativePanel({
  task,
  sources,
  streamState,
  traceEvents,
}: {
  task: JsonRecord
  sources: JsonRecord[]
  streamState: RunStreamState
  traceEvents: JsonRecord[]
}) {
  const latest = streamState.lastEvent ?? traceEvents[0] ?? null
  const latestTime = latest ? readString(latest, "createdAt") ?? readString(latest, "timestamp") ?? "latest" : "pending"
  return (
    <Card className="fs-panel">
      <CardHeader>
        <CardTitle className="text-base">Research transcript</CardTitle>
        <CardDescription>Question intake, evidence search, and synthesis status.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm leading-7 text-muted-foreground">
        <div className="rounded-lg border bg-background/45 p-4 text-foreground">{questionTitle(task)}</div>
        <div className="flex items-center gap-3 rounded-md border bg-muted/25 px-3 py-2">
          <span className="text-xs text-muted-foreground">{latestTime}</span>
          <span className="font-medium uppercase tracking-[0.16em] text-forecast">briefing researchers</span>
          <span className="ml-auto flex items-center gap-1 text-xs text-success">
            <CircleDot />
            {streamState.connected ? "live" : "idle"}
          </span>
        </div>
        <p>The workflow classifies the request, fans out research, extracts citations, and writes a forecast aggregate once evidence is ready.</p>
        <div className="flex flex-wrap gap-2">
          {sources.slice(0, 5).map((source, index) => (
            <span className="fs-citation" key={String(source.id ?? index)}>
              {sourceDomain(source)}
            </span>
          ))}
          {sources.length === 0 ? <span className="fs-citation">sources pending</span> : null}
        </div>
        {latest ? (
          <p className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
            Latest event: {traceLabel(latest)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ForecastResultPanel({ output, task, expanded = false }: { output: JsonRecord | null; task: JsonRecord; expanded?: boolean }) {
  const forecastType = inferForecastType(output)
  const target = forecastType ? forecastType.replace(/_/g, " ") : readString(output, "targetVariable") ?? readString(output, "metricName") ?? "forecast"

  return (
    <Card className="fs-artifact">
      <CardHeader>
        <CardTitle className="text-lg leading-tight text-forecast md:text-xl">{questionTitle(task)}</CardTitle>
        <CardDescription className="text-primary">{target}</CardDescription>
        <CardAction>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 />
            researchers 1-3
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {output ? (
          <>
            <ForecastReportBody output={output} forecastType={forecastType} expanded={expanded} />
          </>
        ) : (
          <div className="flex min-h-52 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            Forecast output will appear here once the workflow writes an aggregate.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ForecastReportBody({
  output,
  forecastType,
  expanded,
}: {
  output: JsonRecord
  forecastType: ForecastReportType | null
  expanded: boolean
}) {
  if (forecastType === "binary") {
    return <BinaryForecastReport output={output} expanded={expanded} />
  }
  if (forecastType === "date") {
    return <DateForecastReport output={output} expanded={expanded} />
  }
  if (forecastType === "numeric") {
    return <NumericForecastReport output={output} expanded={expanded} />
  }
  if (forecastType === "categorical") {
    return <CategoricalForecastReport output={output} expanded={expanded} />
  }
  if (forecastType === "thresholded") {
    return <ThresholdedForecastReport output={output} expanded={expanded} />
  }
  if (forecastType === "conditional") {
    return <ConditionalForecastReport output={output} expanded={expanded} />
  }
  return <FallbackForecastReport output={output} expanded={expanded} />
}

function BinaryForecastReport({ output, expanded }: { output: JsonRecord; expanded: boolean }) {
  const probability = readNumber(output, "probability")
  const meanProbability = readNumberAny(output, "meanProbability", "mean_probability")
  const medianProbability = readNumberAny(output, "medianProbability", "median_probability")
  const disagreement = readNumber(output, "disagreement")
  const calibrationNotes = readStringAny(output, "calibrationNotes", "calibration_notes")
  const calibrationWarnings = readStringArray(output, "calibrationWarnings", "calibration_warnings")
  const rationale = readRationale(output)
  const components = recordArray(output, "componentProbabilities", "component_probabilities").flatMap((component, index) => {
    const componentProbability = readNumber(component, "probability")
    if (componentProbability === null) {
      return []
    }
    return [{
      label: readString(component, "forecasterLabel") ?? readString(component, "forecaster_label") ?? `forecaster ${index + 1}`,
      probability: componentProbability,
      baseRateProbability: readNumberAny(component, "baseRateProbability", "base_rate_probability"),
      insideViewProbability: readNumberAny(component, "insideViewProbability", "inside_view_probability"),
    }]
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(220px,0.55fr)]">
        <HeroMetric label="aggregate probability" value={probability === null ? "not set" : formatProbabilityPercent(probability)} />
        <div className="grid grid-cols-3 gap-2">
          <MiniMetric label="mean" value={meanProbability === null ? "n/a" : formatProbabilityPercent(meanProbability)} />
          <MiniMetric label="median" value={medianProbability === null ? "n/a" : formatProbabilityPercent(medianProbability)} />
          <MiniMetric label="spread" value={disagreement === null ? "n/a" : `${formatNumber(disagreement)} pts`} />
        </div>
      </div>
      <div className="grid gap-3">
        {components.map((component) => (
          <ProbabilityRow
            key={component.label}
            label={component.label}
            probability={component.probability}
            markers={[
              { label: "base", value: component.baseRateProbability },
              { label: "inside", value: component.insideViewProbability },
            ]}
          />
        ))}
      </div>
      {calibrationWarnings.length ? (
        <ReportSection label="calibration warnings">
          <div className="flex flex-wrap gap-2">
            {calibrationWarnings.map((warning) => (
              <span className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-muted-foreground" key={warning}>
                {warning}
              </span>
            ))}
          </div>
        </ReportSection>
      ) : null}
      <ReportText label="calibration" value={calibrationNotes} expanded={expanded} />
      <ReportText label="rationale" value={rationale} expanded={expanded} />
    </div>
  )
}

function DateForecastReport({ output, expanded }: { output: JsonRecord; expanded: boolean }) {
  const distribution = parseRecord(output.dateDistribution ?? readString(output, "date_distribution"))
  const targetDate = readStringAny(output, "targetDate", "target_date") ?? readString(distribution, "p50")
  const neverProbability = readNumberAny(output, "neverProbability", "never_probability")
  const componentDates = recordArray(output, "componentDates", "component_dates")
  const quantiles = [
    { label: "p10", value: readString(distribution, "p10") },
    { label: "p25", value: readString(distribution, "p25") },
    { label: "p50", value: readString(distribution, "p50") ?? targetDate },
    { label: "p75", value: readString(distribution, "p75") },
    { label: "p90", value: readString(distribution, "p90") },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(180px,0.45fr)]">
        <HeroMetric label="target date" value={targetDate ?? "not set"} />
        <MiniMetric label="never" value={neverProbability === null ? "n/a" : formatProbabilityPercent(neverProbability)} />
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        {quantiles.map((quantile) => (
          <ForecastQuantile active={quantile.label === "p50"} key={quantile.label} label={quantile.label} value={quantile.value ?? "not set"} />
        ))}
      </div>
      <ReportSection label="component dates">
        <div className="grid gap-2 md:grid-cols-3">
          {componentDates.map((component, index) => (
            <CompactValue
              key={`${readString(component, "forecasterLabel") ?? "date"}-${index}`}
              label={readString(component, "forecasterLabel") ?? readString(component, "forecaster_label") ?? `forecaster ${index + 1}`}
              value={readStringAny(component, "targetDate", "target_date") ?? "not set"}
              meta={formatNullablePercent(readNumberAny(component, "neverProbability", "never_probability"), "never")}
            />
          ))}
        </div>
      </ReportSection>
      <ReportText label="rationale" value={readRationale(output)} expanded={expanded} />
    </div>
  )
}

function NumericForecastReport({ output, expanded }: { output: JsonRecord; expanded: boolean }) {
  const distribution = parseRecord(output.distribution)
  const value = readNumber(output, "value")
  const unit = readString(output, "unit") ?? "units"
  const low = readNumber(distribution, "low")
  const median = readNumber(distribution, "median")
  const high = readNumber(distribution, "high")
  const componentValues = recordArray(output, "componentValues", "component_values")

  return (
    <div className="flex flex-col gap-6">
      <HeroMetric label="aggregate value" value={value === null ? "not set" : `${formatNumber(value)} ${unit}`} />
      <div className="grid gap-3 md:grid-cols-3">
        <ForecastQuantile label="low" value={low === null ? "not set" : `${formatNumber(low)} ${unit}`} />
        <ForecastQuantile active label="median" value={median === null ? "not set" : `${formatNumber(median)} ${unit}`} />
        <ForecastQuantile label="high" value={high === null ? "not set" : `${formatNumber(high)} ${unit}`} />
      </div>
      <ReportSection label="component values">
        <div className="grid gap-2 md:grid-cols-3">
          {componentValues.map((component, index) => {
            const componentValue = readNumber(component, "value")
            const componentUnit = readString(component, "unit") ?? unit
            return (
              <CompactValue
                key={`${readString(component, "forecasterLabel") ?? "numeric"}-${index}`}
                label={readString(component, "forecasterLabel") ?? readString(component, "forecaster_label") ?? `forecaster ${index + 1}`}
                value={componentValue === null ? "not set" : `${formatNumber(componentValue)} ${componentUnit}`}
              />
            )
          })}
        </div>
      </ReportSection>
      <ReportText label="rationale" value={readRationale(output)} expanded={expanded} />
    </div>
  )
}

function CategoricalForecastReport({ output, expanded }: { output: JsonRecord; expanded: boolean }) {
  const topCategory = readStringAny(output, "topCategory", "top_category") ?? "not set"
  const probabilities = recordArray(output, "probabilities")
    .flatMap((item) => {
      const probability = readNumber(item, "probability")
      const category = readString(item, "category")
      return probability === null || !category ? [] : [{ category, probability }]
    })
    .sort((left, right) => right.probability - left.probability)
  const componentCategories = recordArray(output, "componentCategories", "component_categories")

  return (
    <div className="flex flex-col gap-6">
      <HeroMetric label="top category" value={topCategory} />
      <div className="grid gap-3">
        {probabilities.map((item) => (
          <ProbabilityRow key={item.category} label={item.category} probability={item.probability} />
        ))}
      </div>
      <ReportSection label="component picks">
        <div className="grid gap-2 md:grid-cols-3">
          {componentCategories.map((component, index) => (
            <CompactValue
              key={`${readString(component, "forecasterLabel") ?? "category"}-${index}`}
              label={readString(component, "forecasterLabel") ?? readString(component, "forecaster_label") ?? `forecaster ${index + 1}`}
              value={readStringAny(component, "topCategory", "top_category") ?? "not set"}
            />
          ))}
        </div>
      </ReportSection>
      <ReportText label="rationale" value={readRationale(output)} expanded={expanded} />
    </div>
  )
}

function ThresholdedForecastReport({ output, expanded }: { output: JsonRecord; expanded: boolean }) {
  const direction = readStringAny(output, "thresholdDirection", "threshold_direction") ?? "threshold"
  const units = readString(output, "units")
  const probabilities = recordArray(output, "probabilities").flatMap((item) => {
    const probability = readNumber(item, "probability")
    const threshold = readString(item, "threshold")
    return probability === null || !threshold
      ? []
      : [{ threshold, probability, rationale: readString(item, "rationale") }]
  })
  const monotonicityRepaired = output.monotonicityRepaired === true
  const monotonicityNotes = readStringAny(output, "monotonicityNotes", "monotonicity_notes")
  const componentCurves = recordArray(output, "componentCurves", "component_curves")

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(180px,0.45fr)]">
        <HeroMetric label={direction.replace(/_/g, " ")} value={units ? `threshold curve · ${units}` : "threshold curve"} />
        <MiniMetric label="monotonicity" value={monotonicityRepaired ? "repaired" : "clean"} />
      </div>
      <div className="grid gap-3">
        {probabilities.map((item) => (
          <ProbabilityRow
            key={item.threshold}
            label={item.threshold}
            probability={item.probability}
            meta={expanded ? item.rationale ?? undefined : undefined}
          />
        ))}
      </div>
      <ReportSection label="component curves">
        <div className="grid gap-2 md:grid-cols-3">
          {componentCurves.map((curve, index) => (
            <CompactValue
              key={`${readString(curve, "forecasterLabel") ?? "curve"}-${index}`}
              label={readString(curve, "forecasterLabel") ?? readString(curve, "forecaster_label") ?? `forecaster ${index + 1}`}
              value={summarizeCurve(recordArray(curve, "probabilities"))}
            />
          ))}
        </div>
      </ReportSection>
      <ReportText label="monotonicity" value={monotonicityNotes} expanded={expanded} />
      <ReportText label="rationale" value={readRationale(output)} expanded={expanded} />
    </div>
  )
}

function ConditionalForecastReport({ output, expanded }: { output: JsonRecord; expanded: boolean }) {
  const condition = readString(output, "condition") ?? "stated condition"
  const conditionProbability = readNumberAny(output, "conditionProbability", "condition_probability")
  const givenCondition = readNumberAny(output, "probabilityGivenCondition", "probability_given_condition")
  const givenNotCondition = readNumberAny(output, "probabilityGivenNotCondition", "probability_given_not_condition")
  const delta = readNumberAny(output, "probabilityDelta", "probability_delta")
  const componentBranches = recordArray(output, "componentBranches", "component_branches")

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(180px,0.45fr)]">
        <HeroMetric label="condition" value={condition} />
        <MiniMetric label="p(condition)" value={conditionProbability === null ? "n/a" : formatProbabilityPercent(conditionProbability)} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <BranchProbability label="outcome | condition" probability={givenCondition} />
        <BranchProbability label="outcome | not condition" probability={givenNotCondition} />
      </div>
      <MiniMetric label="branch delta" value={delta === null ? "n/a" : `${delta > 0 ? "+" : ""}${formatNumber(delta)} pts`} />
      <ReportSection label="component branches">
        <div className="grid gap-2 md:grid-cols-3">
          {componentBranches.map((branch, index) => (
            <CompactValue
              key={`${readString(branch, "forecasterLabel") ?? "branch"}-${index}`}
              label={readString(branch, "forecasterLabel") ?? readString(branch, "forecaster_label") ?? `forecaster ${index + 1}`}
              value={`${formatNullableProbability(readNumberAny(branch, "probabilityGivenCondition", "probability_given_condition"))} / ${formatNullableProbability(readNumberAny(branch, "probabilityGivenNotCondition", "probability_given_not_condition"))}`}
              meta={formatNullablePercent(readNumberAny(branch, "conditionProbability", "condition_probability"), "condition")}
            />
          ))}
        </div>
      </ReportSection>
      <ReportText label="condition effect" value={readStringAny(output, "dependenceNotes", "dependence_notes") ?? readStringAny(output, "branchRationale", "branch_rationale")} expanded={expanded} />
      <ReportText label="given condition" value={readStringAny(output, "rationaleGivenCondition", "rationale_given_condition")} expanded={expanded} />
      <ReportText label="given not condition" value={readStringAny(output, "rationaleGivenNotCondition", "rationale_given_not_condition")} expanded={expanded} />
    </div>
  )
}

function FallbackForecastReport({ output, expanded }: { output: JsonRecord; expanded: boolean }) {
  const probability = readNumber(output, "probability")
  const answer = readString(output, "answer") ?? readStringAny(output, "targetDate", "target_date") ?? readStringAny(output, "topCategory", "top_category")
  return (
    <div className="flex flex-col gap-6">
      <HeroMetric label="forecast" value={answer ?? (probability === null ? "ready" : formatProbabilityPercent(probability))} />
      <ReportText label="rationale" value={readRationale(output)} expanded={expanded} />
    </div>
  )
}

type ForecastReportType = "binary" | "date" | "numeric" | "categorical" | "thresholded" | "conditional"

function inferForecastType(output: JsonRecord | null): ForecastReportType | null {
  const explicit = readString(output, "forecastType") ?? readString(output, "forecast_type")
  if (isForecastReportType(explicit)) {
    return explicit
  }
  if (readNumber(output, "probability") !== null) {
    return "binary"
  }
  if (output?.dateDistribution || output?.date_distribution || readStringAny(output, "targetDate", "target_date")) {
    return "date"
  }
  if (output?.distribution || readNumber(output, "value") !== null) {
    return "numeric"
  }
  if (readArray(output, "probabilities").length && readString(output, "topCategory")) {
    return "categorical"
  }
  return null
}

function isForecastReportType(value: string | null): value is ForecastReportType {
  return value === "binary" || value === "date" || value === "numeric" || value === "categorical" || value === "thresholded" || value === "conditional"
}

function formatProbabilityPercent(probability: number) {
  const percent = probability >= 0 && probability <= 1 ? probability * 100 : probability
  const rounded = Math.round(percent * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

function formatNullableProbability(probability: number | null) {
  return probability === null ? "n/a" : formatProbabilityPercent(probability)
}

function formatNullablePercent(probability: number | null, label: string) {
  return probability === null ? undefined : `${label} ${formatProbabilityPercent(probability)}`
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function recordArray(record: unknown, ...keys: string[]) {
  if (!isJsonRecord(record)) {
    return []
  }
  for (const key of keys) {
    const raw = record[key]
    const parsed = typeof raw === "string" ? parseJsonValue(raw) : raw
    if (Array.isArray(parsed)) {
      return parsed.filter(isJsonRecord)
    }
  }
  return []
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readStringArray(record: unknown, ...keys: string[]) {
  if (!isJsonRecord(record)) {
    return []
  }
  for (const key of keys) {
    const raw = record[key]
    const parsed = typeof raw === "string" ? parseJsonValue(raw) : raw
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    }
  }
  return []
}

function readRationale(output: JsonRecord) {
  return readString(output, "rationale") ?? readString(output, "summary") ?? readString(output, "answer")
}

function readNumberAny(record: unknown, ...keys: string[]) {
  for (const key of keys) {
    const value = readNumber(record, key)
    if (value !== null) {
      return value
    }
  }
  return null
}

function readStringAny(record: unknown, ...keys: string[]) {
  for (const key of keys) {
    const value = readString(record, key)
    if (value !== null) {
      return value
    }
  }
  return null
}

function parseJsonValue(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function summarizeCurve(points: JsonRecord[]) {
  const labels = points.slice(0, 3).flatMap((point) => {
    const threshold = readString(point, "threshold")
    const probability = readNumber(point, "probability")
    return threshold && probability !== null ? [`${threshold}: ${formatProbabilityPercent(probability)}`] : []
  })
  return labels.length ? labels.join(" · ") : "not set"
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  const valueSize = value.length > 60 ? "text-xl md:text-2xl" : value.length > 28 ? "text-2xl md:text-3xl" : "text-3xl md:text-5xl"
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className={cn("mt-2 break-words font-medium leading-tight text-success", valueSize)}>{value}</p>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/70 bg-muted/25 px-3 py-2">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-medium text-foreground">{value}</p>
    </div>
  )
}

function ReportSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

function ReportText({ label, value, expanded }: { label: string; value: string | null; expanded: boolean }) {
  if (!value) {
    return null
  }
  return (
    <ReportSection label={label}>
      <p className="text-sm leading-7 text-muted-foreground">{expanded ? value : truncate(value, 720)}</p>
    </ReportSection>
  )
}

function ProbabilityRow({
  label,
  probability,
  markers = [],
  meta,
}: {
  label: string
  probability: number
  markers?: Array<{ label: string; value: number | null }>
  meta?: string
}) {
  const percent = normalizePercent(probability)
  return (
    <div className="grid gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-foreground">{label}</span>
        <span className="shrink-0 font-medium text-success">{formatProbabilityPercent(probability)}</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
        {markers.map((marker) => marker.value === null ? null : (
          <span
            aria-label={marker.label}
            className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-forecast"
            key={marker.label}
            style={{ left: `${normalizePercent(marker.value)}%` }}
          />
        ))}
      </div>
      {markers.some((marker) => marker.value !== null) ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.68rem] text-muted-foreground">
          {markers.map((marker) => marker.value === null ? null : (
            <span key={marker.label}>{marker.label} {formatProbabilityPercent(marker.value)}</span>
          ))}
        </div>
      ) : null}
      {meta ? <p className="text-xs leading-5 text-muted-foreground">{meta}</p> : null}
    </div>
  )
}

function BranchProbability({ label, probability }: { label: string; probability: number | null }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-3">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-medium text-success">{probability === null ? "n/a" : formatProbabilityPercent(probability)}</p>
      {probability !== null ? (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-success" style={{ width: `${normalizePercent(probability)}%` }} />
        </div>
      ) : null}
    </div>
  )
}

function CompactValue({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-foreground">{value}</p>
      {meta ? <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p> : null}
    </div>
  )
}

function normalizePercent(probability: number) {
  const percent = probability >= 0 && probability <= 1 ? probability * 100 : probability
  return Math.max(0, Math.min(100, percent))
}

function ForecastQuantile({ label, value, active = false }: { label: string; value: string; active?: boolean }) {
  return (
    <div className={cn("rounded-md px-3 py-2", active ? "bg-success/15 text-success" : "bg-muted/35")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}

export function ResearchTeamPanel({
  attempts,
  traceEvents,
  streamState,
  expanded = false,
}: {
  attempts: JsonRecord[]
  traceEvents: JsonRecord[]
  streamState: RunStreamState
  expanded?: boolean
}) {
  const shown = expanded ? traceEvents.slice(0, 20) : traceEvents.slice(0, 5)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Research team</CardTitle>
        <CardDescription>
          {attempts.length} attempts · {traceEvents.length} trace events · {streamState.connected ? "on task" : "idle"}
        </CardDescription>
        <CardAction>
          <Bot className="text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-8 gap-2">
          {Array.from({ length: Math.max(8, Math.min(24, attempts.length || 12)) }, (_, index) => (
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-full border",
                index < attempts.length ? "border-primary text-primary" : "border-muted text-muted-foreground",
              )}
              key={index}
            >
              <Bot />
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {shown.map((event, index) => (
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-xs" key={String(event.id ?? index)}>
              <span className="truncate">{traceLabel(event)}</span>
              <span className="shrink-0 text-muted-foreground">{readString(event, "agentLabel") ?? readString(event, "phase") ?? "workflow"}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function SourceMap({ sources }: { sources: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Source map</CardTitle>
        <CardDescription>{sources.length} persisted citations</CardDescription>
        <CardAction>
          <Network className="text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {sources.slice(0, 10).map((source, index) => (
            <div className="rounded-md border bg-muted/25 p-3" key={String(source.id ?? index)}>
              <FileText className="mb-2 text-muted-foreground" />
              <p className="truncate text-sm">{sourceDomain(source)}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function EvidenceStrip({ sources }: { sources: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence</CardTitle>
        <CardDescription>Sources cited by the workflow</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {sources.slice(0, 24).map((source, index) => (
          <Badge variant="outline" key={String(source.id ?? index)}>
            {sourceDomain(source)}
          </Badge>
        ))}
      </CardContent>
    </Card>
  )
}

export function ForecastLedger({ attempts, aggregates, scores }: { attempts: JsonRecord[]; aggregates: JsonRecord[]; scores: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Forecast ledger</CardTitle>
        <CardDescription>{attempts.length} attempts · {aggregates.length} aggregates · {scores.length} scores</CardDescription>
        <CardAction>
          <BarChart3 className="text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <StatTile label="Attempts" value={attempts.length} />
        <StatTile label="Aggregates" value={aggregates.length} />
        <StatTile label="Scores" value={scores.length} />
      </CardContent>
    </Card>
  )
}

function StatTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-medium">{value}</p>
    </div>
  )
}

export function SourceList({ sources }: { sources: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Citations and source bank</CardTitle>
        <CardDescription>{sources.length} sources</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[62vh]">
          <div className="flex flex-col gap-3 pr-4">
            {sources.map((source, index) => (
              <div className="rounded-lg border bg-card p-4" key={String(source.id ?? index)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{readString(source, "title") ?? sourceDomain(source)}</p>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{readString(source, "url") ?? readString(source, "sourceUrl") ?? "no url"}</p>
                  </div>
                  <LinkIcon className="shrink-0 text-muted-foreground" />
                </div>
                {readString(source, "snippet") ? <p className="mt-3 text-sm text-muted-foreground">{readString(source, "snippet")}</p> : null}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

export function MetricGrid({ task, artifacts, sources, taskId }: { task: JsonRecord; artifacts: JsonRecord[]; sources: JsonRecord[]; taskId: string }) {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <StatTile label="Mode" value={formatModeLabel(task.operationSubmode ?? task.operationMode)} />
      <StatTile label="Artifacts" value={artifacts.length} />
      <StatTile label="Sources" value={sources.length} />
      <Card size="sm">
        <CardContent>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/api/runs/${taskId}/trace-bundle`} />}>
            <FileJson data-icon="inline-start" />
            Trace bundle
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export function TaskRows({ rows, retryingRowId, onRetry }: { rows: JsonRecord[]; retryingRowId: string | null; onRetry: (rowId: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rows</CardTitle>
        <CardDescription>{rows.length} workflow rows</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {rows.map((row) => {
          const rowId = String(row.id ?? "")
          return (
            <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm" key={rowId}>
              <span className="truncate">{readString(row, "label") ?? rowId}</span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{String(row.status ?? "unknown")}</Badge>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => onRetry(rowId)} disabled={!rowId || retryingRowId === rowId} aria-label="Retry row">
                  {retryingRowId === rowId ? <Loader2 className="animate-spin" data-icon /> : <RotateCcw data-icon />}
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

export function TraceEvents({ events }: { events: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Trace</CardTitle>
        <CardDescription>{events.length} recent persisted events</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {events.slice(0, 40).map((event, index) => (
          <div className="grid gap-2 rounded-md border p-3 text-xs md:grid-cols-[1fr_1fr_auto]" key={String(event.id ?? index)}>
            <span className="truncate">{String(event.eventType ?? "event")}</span>
            <span className="truncate text-muted-foreground">{String(event.phase ?? "workflow")}</span>
            <CheckCircle2 className="text-primary" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function traceLabel(event: JsonRecord) {
  return `${String(event.eventType ?? "trace")} · ${String(event.phase ?? "workflow")}`
}
