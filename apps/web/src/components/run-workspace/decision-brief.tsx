"use client"

import { Activity, CircleAlert, FileText, Gauge, ListChecks, SearchCheck } from "lucide-react"

import { parseRecord } from "@/components/run-workspace/run-detail"
import type { RunStreamState } from "@/components/run-workspace/use-run-workspace"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { readNumber, readString, truncate, type JsonRecord } from "@/lib/records"
import { cn } from "@/lib/utils"

type DecisionBrief = {
  question: { label: string; value: string }
  answer: { label: string; value: string; detail: string }
  evidence: { label: string; detail: string; sources: Array<{ domain: string; summary: string }> }
  checks: Array<{ label: string; value: string; tone: "ready" | "pending" | "warn" }>
  components: { label: string; value: string; detail: string; tone: "ready" | "pending" | "warn" }
  work: { label: string; value: string; detail: string; events: string[] }
}

export function DecisionBriefPanel({
  task,
  output,
  sources,
  attempts,
  aggregates,
  scores,
  taskRows,
  traceEvents,
  streamState,
}: {
  task: JsonRecord
  output: JsonRecord | null
  sources: JsonRecord[]
  attempts: JsonRecord[]
  aggregates: JsonRecord[]
  scores: JsonRecord[]
  taskRows: JsonRecord[]
  traceEvents: JsonRecord[]
  streamState: RunStreamState
}) {
  const brief = buildDecisionBrief({
    task,
    output,
    sources,
    attempts,
    aggregates,
    scores,
    taskRows,
    traceEvents,
    streamState,
  })

  return (
    <Card className="border-primary/20 bg-card/80 shadow-[0_0_0_1px_hsl(var(--primary)/0.04)] backdrop-blur">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-lg md:text-xl">Decision brief</CardTitle>
            <CardDescription>What is known from this run, what produced it, and what remains uncertain.</CardDescription>
          </div>
          <Badge variant="outline" className="border-primary/40 text-primary">
            {brief.work.value}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-lg border border-border/70 bg-background/45 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{brief.question.label}</p>
          <p className="mt-2 break-words text-base leading-7 text-foreground">{brief.question.value}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <DecisionTile icon={Gauge} label={brief.answer.label} value={brief.answer.value} detail={brief.answer.detail} emphasis={Boolean(output)} />
          <DecisionTile icon={SearchCheck} label={brief.evidence.label} value={`${sources.length}`} detail={brief.evidence.detail} tone={sources.length ? "ready" : "pending"} />
          <DecisionTile icon={ListChecks} label="Process checks" value={checkSummary(brief.checks)} detail={brief.checks.map((check) => `${check.label}: ${check.value}`).join(" · ")} tone="pending" />
          <DecisionTile icon={Activity} label={brief.components.label} value={brief.components.value} detail={brief.components.detail} tone={brief.components.tone} />
          <DecisionTile icon={Activity} label={brief.work.label} value={brief.work.value} detail={brief.work.detail} />
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
          <div className="rounded-lg border border-border/70 bg-muted/15 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <FileText data-icon="inline-start" />
              Evidence surfaced
            </div>
            <div className="mt-3 grid gap-2">
              {brief.evidence.sources.length ? brief.evidence.sources.map((source) => (
                <div className="min-w-0 rounded-md bg-background/50 px-3 py-2" key={`${source.domain}-${source.summary}`}>
                  <p className="truncate text-sm font-medium text-foreground">{source.domain}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{source.summary}</p>
                </div>
              )) : (
                <p className="text-sm text-muted-foreground">No cited sources were persisted yet.</p>
              )}
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/15 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <CircleAlert data-icon="inline-start" />
              What to inspect before relying on it
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {brief.checks.map((check) => (
                <div className="flex items-start justify-between gap-3 rounded-md bg-background/50 px-3 py-2 text-sm" key={check.label}>
                  <span className="text-muted-foreground">{check.label}</span>
                  <span className={cn("text-right font-medium", toneClass(check.tone))}>{check.value}</span>
                </div>
              ))}
            </div>
            {brief.work.events.length ? (
              <div className="mt-4 border-t border-border/70 pt-3">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Recent work</p>
                <div className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
                  {brief.work.events.map((event, index) => <span className="truncate" key={`${index}:${event}`}>{event}</span>)}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function buildDecisionBrief({
  task,
  output,
  sources,
  attempts,
  aggregates,
  scores,
  taskRows,
  traceEvents,
  streamState,
}: {
  task: JsonRecord
  output: JsonRecord | null
  sources: JsonRecord[]
  attempts: JsonRecord[]
  aggregates: JsonRecord[]
  scores: JsonRecord[]
  taskRows: JsonRecord[]
  traceEvents: JsonRecord[]
  streamState: RunStreamState
}): DecisionBrief {
  const warnings = output ? warningCount(output) : 0
  const rationale = output ? normalizeRationale(readStringAny(output, "rationale", "summary", "answer")) : null
  const attemptCount = attempts.length || (output ? readNumberAny(output, "attempt_count", "attemptCount") ?? 0 : 0)
  const progress = progressPercent(task, streamState)
  const status = String(task.status ?? streamState.status ?? "unknown")
  const answer = summarizeAnswer(output, status)
  const recordedSources = summarizeSources(sources)

  return {
    question: readExactQuestion(task),
    answer,
    evidence: {
      label: "Evidence recorded",
      detail: sources.length ? `${sources.length} persisted source${sources.length === 1 ? "" : "s"}; inspect citations before relying on the result.` : emptyEvidenceCopy(status),
      sources: recordedSources,
    },
    checks: [
      { label: "Output", value: output ? "present" : "pending", tone: output ? "ready" : "pending" },
      { label: "Rationale", value: rationale ? "present" : "missing", tone: rationale ? "ready" : "warn" },
      { label: "Warnings", value: warnings ? `${warnings} flagged` : "none surfaced", tone: warnings ? "warn" : "pending" },
      { label: "Attempts", value: attemptCount ? `${attemptCount}` : "unavailable", tone: attemptCount ? "ready" : "pending" },
      { label: "Aggregates", value: aggregates.length ? `${aggregates.length}` : "unavailable", tone: aggregates.length ? "ready" : "pending" },
      { label: "Scores", value: scores.length ? `${scores.length}` : "not scored", tone: scores.length ? "ready" : "pending" },
    ],
    components: summarizeComponents(output),
    work: {
      label: "Work completed",
      value: `${progress}%`,
      detail: `${status}; ${rowStatusSummary(taskRows)}`,
      events: latestEvents(streamState, traceEvents),
    },
  }
}

function DecisionTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = "ready",
  emphasis = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  detail: string
  tone?: "ready" | "pending" | "warn"
  emphasis?: boolean
}) {
  return (
    <div className={cn("min-w-0 rounded-lg border border-border/70 bg-muted/20 p-4", emphasis && "border-primary/30 bg-primary/10")}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <p className={cn("mt-3 break-words text-2xl font-medium leading-tight", emphasis ? "text-foreground" : toneClass(tone))}>{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  )
}

function readExactQuestion(task: JsonRecord): DecisionBrief["question"] {
  const input = isJsonRecord(task.input) ? task.input : {}
  const config = isJsonRecord(task.configJson) ? task.configJson : {}
  const question =
    readString(input, "question") ??
    readString(input, "prompt") ??
    readString(config, "prompt")
  if (question) {
    return { label: "Question", value: question }
  }
  return { label: "Run label", value: String(task.label ?? "Forecast run") }
}

function summarizeAnswer(output: JsonRecord | null, status: string) {
  if (!output) {
    const pending = status === "running" || status === "queued" || status === "connecting"
    return {
      label: "Forecast answer",
      value: pending ? "No aggregate yet" : "No aggregate recorded",
      detail: pending ? "Forecast output will appear once an aggregate is written." : "This run has no persisted aggregate to summarize.",
    }
  }
  const forecastType = readStringAny(output, "forecastType", "forecast_type")
  const probability = readNumber(output, "probability")
  const normalizedProbability = normalizeProbability(probability)
  if (normalizedProbability !== null) {
    return { label: "Forecast answer", value: formatPercent(normalizedProbability), detail: readStringAny(output, "method", "rationale") ?? `${forecastType ?? "Binary"} probability forecast.` }
  }
  const targetDate = readStringAny(output, "targetDate", "target_date") ?? readString(parseRecord(output.dateDistribution ?? output.date_distribution), "p50")
  if (targetDate) {
    const neverProbability = readNumberAny(output, "neverProbability", "never_probability")
    return {
      label: "Forecast answer",
      value: targetDate,
      detail: normalizeProbability(neverProbability) === null ? "Median or target date from the forecast aggregate." : `Never probability ${formatPercent(normalizeProbability(neverProbability) ?? 0)}.`,
    }
  }
  const value = readNumber(output, "value")
  if (value !== null) {
    return { label: "Forecast answer", value: `${formatNumber(value)} ${readString(output, "unit") ?? ""}`.trim(), detail: "Numeric aggregate value." }
  }
  const topCategory = readStringAny(output, "topCategory", "top_category")
  if (topCategory) {
    return { label: "Forecast answer", value: topCategory, detail: "Top category from the aggregate distribution." }
  }
  const answer = readStringAny(output, "answer", "summary")
  return { label: "Forecast answer", value: answer ? truncate(answer, 80) : "Aggregate recorded", detail: readString(output, "method") ?? "Forecast output exists; inspect the detailed artifact below." }
}

function summarizeComponents(output: JsonRecord | null): DecisionBrief["components"] {
  if (!output) {
    return { label: "Components recorded", value: "pending", detail: "No structured forecast output yet.", tone: "pending" }
  }
  const forecastType = inferForecastType(output)
  const agreement = componentAgreement(output, forecastType)
  if (agreement) {
    return agreement
  }
  const components = firstNonEmptyArray(output, "componentProbabilities", "component_probabilities", "componentDates", "component_dates", "componentValues", "component_values", "componentCategories", "component_categories", "componentBranches", "component_branches", "componentCurves", "component_curves")
  if (components.length) {
    return {
      label: "Components recorded",
      value: `${components.length} components`,
      detail: "Structured components exist, but they are not comparable enough to summarize agreement here.",
      tone: "pending",
    }
  }
  return {
    label: "Components recorded",
    value: "unknown",
    detail: "No structured component signal is available from this run data.",
    tone: "pending",
  }
}

function componentAgreement(output: JsonRecord, forecastType: string | null): DecisionBrief["components"] | null {
  if (forecastType === "binary") {
    const values = firstNonEmptyArray(output, "componentProbabilities", "component_probabilities")
      .map((component) => normalizeProbability(readNumber(component, "probability")))
      .filter((value): value is number => value !== null)
    if (values.length < 2) {
      return null
    }
    const spread = Math.max(...values) - Math.min(...values)
    return {
      label: "Component spread",
      value: `${formatNumber(spread)} pts`,
      detail: `${values.length} binary component probabilities; this is not cross-run reproducibility.`,
      tone: spread > 20 ? "warn" : "ready",
    }
  }
  if (forecastType === "date") {
    const values = firstNonEmptyArray(output, "componentDates", "component_dates")
      .map((component) => readStringAny(component, "targetDate", "target_date"))
      .map((value) => value ? Date.parse(value) : Number.NaN)
      .filter(Number.isFinite)
    if (values.length < 2) {
      return null
    }
    const days = Math.round((Math.max(...values) - Math.min(...values)) / 86_400_000)
    return {
      label: "Component spread",
      value: `${days} days`,
      detail: `${values.length} date components; this is intra-run spread only.`,
      tone: days > 180 ? "warn" : "ready",
    }
  }
  if (forecastType === "numeric") {
    const components = firstNonEmptyArray(output, "componentValues", "component_values")
    const values = components
      .map((component) => ({ value: readNumber(component, "value"), unit: readString(component, "unit") ?? readString(output, "unit") ?? "" }))
      .filter((component): component is { value: number; unit: string } => component.value !== null)
    const units = new Set(values.map((component) => component.unit))
    if (values.length < 2 || units.size > 1) {
      return null
    }
    const spread = Math.max(...values.map((component) => component.value)) - Math.min(...values.map((component) => component.value))
    const unit = values[0]?.unit
    return {
      label: "Component spread",
      value: `${formatNumber(spread)}${unit ? ` ${unit}` : ""}`,
      detail: `${values.length} numeric components with matching units.`,
      tone: "ready",
    }
  }
  if (forecastType === "categorical") {
    const picks = firstNonEmptyArray(output, "componentCategories", "component_categories")
      .map((component) => readStringAny(component, "topCategory", "top_category"))
      .filter((value): value is string => Boolean(value))
    if (picks.length < 2) {
      return null
    }
    const counts = new Map<string, number>()
    for (const pick of picks) {
      counts.set(pick, (counts.get(pick) ?? 0) + 1)
    }
    const [category, count] = Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0] ?? ["", 0]
    return {
      label: "Component picks",
      value: `${count}/${picks.length}`,
      detail: `${count} of ${picks.length} picked ${category}.`,
      tone: count === picks.length ? "ready" : "warn",
    }
  }
  return null
}

function latestEvents(streamState: RunStreamState, traceEvents: JsonRecord[]) {
  const liveLabels = streamState.activity?.recentActivity.map((event) => event.detail ? `${event.label} · ${event.detail}` : event.label) ?? []
  const events = [streamState.lastEvent, ...traceEvents].filter((event): event is JsonRecord => Boolean(event))
  const labels = events.map((event) => {
    const eventType = String(event.eventType ?? "trace")
    const phase = String(event.phase ?? "workflow")
    const agent = readString(event, "agentLabel")
    return truncate(agent ? `${eventType} · ${phase} · ${agent}` : `${eventType} · ${phase}`, 120)
  })
  return Array.from(new Set([...liveLabels, ...labels])).slice(0, 3)
}

function progressPercent(task: JsonRecord, streamState: RunStreamState) {
  if (streamState.activity?.progress) {
    return streamState.activity.progress.percent
  }
  const progress = streamState.progress
  if (progress && progress.total > 0) {
    return Math.round(((progress.completed + progress.failed) / progress.total) * 100)
  }
  const total = readNumber(task, "progressTotal") ?? 0
  if (total <= 0) {
    return String(task.status) === "completed" ? 100 : 0
  }
  const completed = readNumber(task, "progressCompleted") ?? 0
  const failed = readNumber(task, "progressFailed") ?? 0
  return Math.round(((completed + failed) / total) * 100)
}

function rowStatusSummary(rows: JsonRecord[]) {
  if (!rows.length) {
    return "no row ledger"
  }
  const counts = new Map<string, number>()
  for (const row of rows) {
    const status = String(row.status ?? "unknown")
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return Array.from(counts.entries()).map(([status, count]) => `${count} ${status}`).join(", ")
}

function warningCount(output: JsonRecord) {
  return firstNonEmptyArray(output, "calibrationWarnings", "calibration_warnings", "qualityIssues", "quality_issues", "leakage_flags", "leakageFlags").length
}

function summarizeSources(sources: JsonRecord[]) {
  return [...sources]
    .sort(compareSources)
    .slice(0, 2)
    .flatMap((source) => {
      const domain = persistedDomain(source)
      if (!domain) {
        return []
      }
      return [{
        domain,
        summary: truncate(readString(source, "contentSummary") ?? readString(source, "title") ?? "Persisted citation without a summary.", 150),
      }]
    })
}

function persistedDomain(source: JsonRecord) {
  const direct = readString(source, "domain")
  if (direct && direct !== "source") {
    return direct.replace(/^www\./, "")
  }
  const url = readString(source, "url") ?? readString(source, "sourceUrl")
  if (!url) {
    return null
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

function compareSources(left: JsonRecord, right: JsonRecord) {
  if (Boolean(left.usedInFinal) !== Boolean(right.usedInFinal)) {
    return left.usedInFinal ? -1 : 1
  }
  const leftRank = readNumber(left, "rank")
  const rightRank = readNumber(right, "rank")
  if (leftRank !== null || rightRank !== null) {
    return (leftRank ?? Number.POSITIVE_INFINITY) - (rightRank ?? Number.POSITIVE_INFINITY)
  }
  return sourceTime(right) - sourceTime(left)
}

function sourceTime(source: JsonRecord) {
  const value = readStringAny(source, "retrievedAt", "createdAt")
  return value ? Date.parse(value) || 0 : 0
}

function checkSummary(checks: DecisionBrief["checks"]) {
  const warn = checks.filter((check) => check.tone === "warn").length
  if (warn) {
    return `${warn} flag${warn === 1 ? "" : "s"}`
  }
  const ready = checks.filter((check) => check.tone === "ready").length
  return `${ready}/${checks.length}`
}

function emptyEvidenceCopy(status: string) {
  if (status === "completed") {
    return "No cited sources were persisted for this completed run."
  }
  if (status === "failed") {
    return "No cited sources were persisted for this failed run."
  }
  return "Sources pending while the run works."
}

function firstNonEmptyArray(record: unknown, ...keys: string[]) {
  for (const key of keys) {
    const values = readArrayAny(record, key)
    if (values.length) {
      return values
    }
  }
  return []
}

function readArrayAny(record: unknown, key: string) {
  if (!isJsonRecord(record)) {
    return []
  }
  const raw = record[key]
  const parsed = typeof raw === "string" ? parseJsonValue(raw) : raw
  return Array.isArray(parsed) ? parsed.filter(isJsonRecord) : []
}

function inferForecastType(output: JsonRecord) {
  const explicit = readStringAny(output, "forecastType", "forecast_type")
  if (explicit) {
    return explicit
  }
  if (normalizeProbability(readNumber(output, "probability")) !== null) {
    return "binary"
  }
  if (output.dateDistribution || output.date_distribution || readStringAny(output, "targetDate", "target_date")) {
    return "date"
  }
  if (output.distribution || readNumber(output, "value") !== null) {
    return "numeric"
  }
  if (readStringAny(output, "topCategory", "top_category")) {
    return "categorical"
  }
  if (firstNonEmptyArray(output, "componentBranches", "component_branches").length) {
    return "conditional"
  }
  if (firstNonEmptyArray(output, "componentCurves", "component_curves").length) {
    return "thresholded"
  }
  return null
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

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeProbability(probability: number | null) {
  if (probability === null || probability < 0 || probability > 100) {
    return null
  }
  return probability <= 1 ? probability * 100 : probability
}

function normalizeRationale(value: string | null) {
  if (!value) {
    return null
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === "no aggregate rationale was provided." || normalized === "no rationale was provided.") {
    return null
  }
  return value
}

function formatPercent(percent: number) {
  return `${formatNumber(percent)}%`
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function toneClass(tone: "ready" | "pending" | "warn") {
  if (tone === "ready") {
    return "text-foreground"
  }
  if (tone === "warn") {
    return "text-amber-300"
  }
  return "text-muted-foreground"
}
