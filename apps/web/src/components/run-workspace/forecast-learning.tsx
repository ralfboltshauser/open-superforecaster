"use client"

import Link from "next/link"
import { useMemo, useSyncExternalStore } from "react"
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock3,
  FileCheck2,
  Gauge,
  GitCompareArrows,
  Lightbulb,
  Scale,
  ShieldCheck,
} from "lucide-react"

import { parseRecord } from "@/components/run-workspace/run-detail"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { isRecord, questionTitle, readArray, readNumber, readString, type JsonRecord } from "@/lib/records"
import { PRIVATE_PRIOR_STORAGE_KEY, privatePriorFromSnapshot } from "@/lib/question-studio"
import { cn } from "@/lib/utils"

export function QuestionContractPanel({ task }: { task: JsonRecord }) {
  const contract = readQuestionContract(task)
  const missing = [
    !contract.resolutionDate ? "resolution date" : null,
    !contract.resolutionCriteria ? "resolution criteria" : null,
  ].filter((value): value is string => Boolean(value))

  return (
    <Card className="border-primary/20 bg-card/80 backdrop-blur">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileCheck2 className="size-4 text-primary" />
              Question contract
            </CardTitle>
            <CardDescription>The exact claim being forecast and the rules that will eventually settle it.</CardDescription>
          </div>
          <Badge variant="outline" className={cn(missing.length ? "border-forecast/40 text-forecast" : "border-success/40 text-success")}>
            {missing.length ? `${missing.length} field${missing.length === 1 ? "" : "s"} missing` : "Contract recorded"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-lg border border-border/70 bg-background/45 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Forecast question</p>
          <p className="mt-2 text-base leading-7 text-foreground">{contract.question}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ContractField icon={Gauge} label="Forecast type" value={contract.forecastType} />
          <ContractField icon={CalendarClock} label="Resolution date" value={contract.resolutionDate ?? "Not recorded"} warning={!contract.resolutionDate} />
          <ContractField icon={Clock3} label="Forecast as of" value={formatInstant(contract.forecastAsOf) ?? "Not recorded"} warning={!contract.forecastAsOf} />
          <ContractField icon={ShieldCheck} label="Evidence cutoff" value={formatInstant(contract.evidenceAsOf ?? contract.cutoffDate) ?? "Current information"} />
        </div>
        <div className={cn("rounded-lg border p-4", missing.length ? "border-forecast/30 bg-forecast/5" : "border-border/70 bg-muted/15")}>
          <div className="flex items-start gap-3">
            {missing.length ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-forecast" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />}
            <div>
              <p className="text-sm font-medium text-foreground">Resolution criteria</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {contract.resolutionCriteria ?? "No explicit criteria were supplied. Treat the result as exploratory and agree on a resolver before using it for a scored decision."}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function ForecastReadingGuide() {
  const concepts = [
    {
      icon: Gauge,
      title: "Probability is not certainty",
      summary: "A 70% event can fail without the forecast being dishonest.",
      detail: "Judge a probability across many comparable resolved forecasts. One outcome tells you what happened, not whether the original probability was calibrated.",
    },
    {
      icon: Scale,
      title: "Mean and median are controls",
      summary: "They show what simple mechanical pooling produced.",
      detail: "The mean responds to every component estimate. The median is more resistant to an extreme forecaster. Keeping both visible makes complex aggregation easier to audit.",
    },
    {
      icon: GitCompareArrows,
      title: "Disagreement is information",
      summary: "A wide spread points to unresolved assumptions or evidence.",
      detail: "Inspect whether forecasters used different base rates, interpreted the resolution boundary differently, or relied on overlapping sources before treating disagreement as genuine independence.",
    },
    {
      icon: ShieldCheck,
      title: "Provenance changes meaning",
      summary: "Autonomous and assisted estimates answer different questions.",
      detail: "An autonomous estimate is frozen without user, crowd, or market anchors. Assisted candidates may be useful, but they must remain separate so their performance can be evaluated honestly.",
    },
  ]

  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <BookOpen className="size-4 text-primary" />
          How to read this forecast
        </CardTitle>
        <CardDescription>Four ideas that prevent the most common interpretation mistakes.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {concepts.map(({ icon: Icon, title, summary, detail }) => (
          <details className="group rounded-lg border border-border/70 bg-background/35 p-4 open:border-primary/25 open:bg-primary/5" key={title}>
            <summary className="flex cursor-pointer list-none items-start gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{title}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{summary}</span>
              </span>
              <span className="ml-auto text-lg leading-none text-muted-foreground transition-transform duration-150 group-open:rotate-45" aria-hidden="true">+</span>
            </summary>
            <p className="mt-3 border-t border-border/60 pt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
          </details>
        ))}
      </CardContent>
    </Card>
  )
}

export function UserPriorPanel({ taskId }: { taskId: string }) {
  const snapshot = useSyncExternalStore(subscribeToPrivatePriors, readPrivatePriorSnapshot, () => null)
  const prior = useMemo(() => privatePriorFromSnapshot(snapshot, taskId), [snapshot, taskId])

  return (
    <Card className="border-primary/20 bg-card/75">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Scale className="size-4 text-primary" />
              Your private prior
            </CardTitle>
            <CardDescription>Your estimate was captured before the machine answer was revealed.</CardDescription>
          </div>
          <Badge variant="outline" className="border-success/35 text-success">Withheld from autonomous agents</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {prior ? (
          <div className="grid gap-3 md:grid-cols-[minmax(180px,0.35fr)_minmax(0,1fr)]">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Pre-AI estimate</p>
              <p className="mt-2 text-2xl font-medium text-foreground">{prior.estimate || "No number supplied"}</p>
              <p className="mt-2 text-xs text-muted-foreground">Captured {formatInstant(prior.capturedAt) ?? prior.capturedAt}</p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/35 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Your reasoning before reveal</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{prior.rationale || "No rationale supplied."}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            No private prior was recorded for this forecast. On your next guided question, enter your own estimate before launch to practice independent judgment and compare without hindsight.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function subscribeToPrivatePriors(onStoreChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key === PRIVATE_PRIOR_STORAGE_KEY) onStoreChange()
  }
  window.addEventListener("storage", handleStorage)
  return () => window.removeEventListener("storage", handleStorage)
}

function readPrivatePriorSnapshot() {
  return window.localStorage.getItem(PRIVATE_PRIOR_STORAGE_KEY)
}

export function ForecastReasoningGuide() {
  const steps = [
    ["1", "Outside view", "Start with comparable cases and a measurable base rate."],
    ["2", "Inside view", "Adjust for facts that make this case meaningfully different."],
    ["3", "Consider the opposite", "Look for the strongest evidence and mechanism against the leading view."],
    ["4", "Aggregate", "Preserve independent estimates, then combine them mechanically."],
    ["5", "Name the crux", "State what new observation would move the probability most."],
  ]

  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Lightbulb className="size-4 text-primary" />
          Superforecasting reasoning loop
        </CardTitle>
        <CardDescription>Use this sequence to inspect the rationale rather than accepting a polished story.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {steps.map(([number, title, description]) => (
          <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3 rounded-lg border border-border/60 bg-background/35 p-3" key={number}>
            <span className="flex size-8 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-xs font-medium text-primary">{number}</span>
            <div>
              <p className="text-sm font-medium text-foreground">{title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
            </div>
          </div>
        ))}
        <Button variant="ghost" size="sm" className="mt-2 justify-self-start text-primary" nativeButton={false} render={<Link href="/learn#reasoning" />}>
          Learn the full method
          <ArrowRight data-icon="inline-end" />
        </Button>
      </CardContent>
    </Card>
  )
}

export function ForecastLifecyclePanel({ output, scores, task }: { output: JsonRecord | null; scores: JsonRecord[]; task: JsonRecord }) {
  const state = parseRecord(output?.forecastState ?? output?.forecast_state) ?? {}
  const update = parseRecord(state.update) ?? {}
  const nextReview = readString(update, "nextScheduledUpdate") ?? readString(update, "next_scheduled_update")
  const brier = scores.find((score) => String(score.scoreType ?? "").toLowerCase() === "brier")
  const scoreValue = brier ? readNumber(brier, "scoreValue") : null
  const complete = String(task.status ?? "") === "completed"

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.72fr)]">
      <Card className="border-primary/20 bg-card/80">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarClock className="size-4 text-primary" />
            Forecast lifecycle
          </CardTitle>
          <CardDescription>A forecast becomes useful evidence only after it is updated, resolved, and scored.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <LifecycleStep status="complete" label="Forecast" detail={complete ? "Output recorded" : "Run in progress"} />
          <LifecycleStep status={nextReview ? "current" : "pending"} label="Update" detail={nextReview ? `Next review ${formatInstant(nextReview) ?? nextReview}` : "No review recorded"} />
          <LifecycleStep status={scoreValue !== null ? "complete" : "pending"} label="Resolve & score" detail={scoreValue === null ? "Waiting for an outcome" : `Brier ${formatScore(scoreValue)}`} />
        </CardContent>
      </Card>
      <Card className={cn("border-border/70 bg-card/70", scoreValue === null && "border-forecast/25")}>
        <CardHeader>
          <CardTitle className="text-base">{scoreValue === null ? "Why there is no score yet" : "How to read the Brier score"}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            {scoreValue === null
              ? "Probabilities cannot be graded until the question resolves. The absence of a score is expected; it is not a missing forecast result."
              : "For the binary 0–1 Brier convention, lower is better: 0 is perfect and 1 is maximally wrong. Compare it with simple baselines across many forecasts, not in isolation."}
          </p>
          <Button variant="link" size="sm" className="mt-2 px-0" nativeButton={false} render={<Link href="/learn#scoring" />}>
            Learn about scoring
            <ArrowRight data-icon="inline-end" />
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export function EvidenceTrustGuide({ sources, task }: { sources: JsonRecord[]; task: JsonRecord }) {
  const completed = String(task.status ?? "") === "completed"
  return (
    <Card className={cn("border-border/70 bg-card/70", completed && sources.length === 0 && "border-destructive/40")}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {completed && sources.length === 0 ? <CircleAlert className="size-4 text-destructive" /> : <ShieldCheck className="size-4 text-primary" />}
          Evidence trust checklist
        </CardTitle>
        <CardDescription>Source presence is not the same as claim verification or independence.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TrustItem ok={sources.length > 0} label="Sources persisted" detail={sources.length ? `${sources.length} record${sources.length === 1 ? "" : "s"}` : "None recorded"} />
        <TrustItem label="Dates" detail="Check that evidence predates the cutoff" />
        <TrustItem label="Independence" detail="Several links may repeat one report" />
        <TrustItem label="Claim support" detail="A citation may not verify every sentence" />
      </CardContent>
    </Card>
  )
}

function ContractField({ icon: Icon, label, value, warning = false }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; warning?: boolean }) {
  return (
    <div className={cn("rounded-lg border border-border/70 bg-muted/15 p-3", warning && "border-forecast/25")}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className={cn("mt-2 break-words text-sm text-foreground", warning && "text-forecast")}>{value}</p>
    </div>
  )
}

function LifecycleStep({ status, label, detail }: { status: "complete" | "current" | "pending"; label: string; detail: string }) {
  return (
    <div className={cn("rounded-lg border p-4", status === "complete" && "border-success/30 bg-success/5", status === "current" && "border-primary/30 bg-primary/5", status === "pending" && "border-border/70 bg-muted/15")}>
      <div className="flex items-center gap-2">
        <span className={cn("size-2 rounded-full", status === "complete" && "bg-success", status === "current" && "bg-primary", status === "pending" && "bg-muted-foreground/40")} />
        <p className="text-sm font-medium text-foreground">{label}</p>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  )
}

function TrustItem({ label, detail, ok }: { label: string; detail: string; ok?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/35 p-3">
      <div className="flex items-center gap-2">
        {ok === true ? <CheckCircle2 className="size-3.5 text-success" /> : ok === false ? <CircleAlert className="size-3.5 text-forecast" /> : <span className="size-1.5 rounded-full bg-primary" />}
        <p className="text-sm font-medium text-foreground">{label}</p>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  )
}

function readQuestionContract(task: JsonRecord) {
  const directInput = isRecord(task.input) ? task.input : {}
  const config = isRecord(task.configJson) ? task.configJson : {}
  const forecastInput = isRecord(config.forecastInput) ? config.forecastInput : {}
  const input = { ...config, ...directInput, ...forecastInput }
  const operationSubmode = String(task.operationSubmode ?? "forecast")

  return {
    question: readString(input, "question") ?? readString(input, "prompt") ?? questionTitle(task),
    forecastType: operationSubmode.replace(/_forecast$/, "").replace(/_/g, " "),
    resolutionCriteria: readString(input, "resolutionCriteria"),
    resolutionDate: readString(input, "resolutionDate"),
    forecastAsOf: readString(input, "forecastAsOf"),
    evidenceAsOf: readString(input, "evidenceAsOf"),
    cutoffDate: readString(input, "cutoffDate"),
    categories: readArray(input, "categories"),
  }
}

function formatInstant(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: value.includes("T") ? "short" : undefined }).format(date)
}

function formatScore(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(value)
}
