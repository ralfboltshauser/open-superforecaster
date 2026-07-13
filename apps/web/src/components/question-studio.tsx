"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Info,
  Loader2,
  LockKeyhole,
  RotateCcw,
  SendHorizonal,
  ShieldCheck,
  Sparkles,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { postJson } from "@/lib/api-client"
import {
  FORECAST_TYPES,
  QUESTION_EXAMPLES,
  emptyQuestionDraft,
  prepareQuestionDraft,
  savePrivatePrior,
  toRunPayload,
  type ForecastType,
  type PrivatePrior,
  type QuestionPreparation,
  type QuestionStudioDraft,
} from "@/lib/question-studio"
import { cn } from "@/lib/utils"

type StudioStage = "draft" | "contract" | "review"

const TYPE_LABELS: Record<ForecastType, string> = {
  binary: "Yes / no",
  categorical: "One of several outcomes",
  numeric: "A number",
  date: "A date",
  thresholded: "Thresholds",
  conditional: "Conditional",
}

export function QuestionStudio({ className }: { className?: string }) {
  const router = useRouter()
  const [stage, setStage] = useState<StudioStage>("draft")
  const [draft, setDraft] = useState<QuestionStudioDraft>(emptyQuestionDraft)
  const [preparation, setPreparation] = useState<QuestionPreparation | null>(null)
  const [privateEstimate, setPrivateEstimate] = useState("")
  const [privateRationale, setPrivateRationale] = useState("")
  const [preparing, setPreparing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentPreparation = useMemo(
    () => (stage === "draft" ? preparation : prepareQuestionDraft(draft)),
    [draft, preparation, stage],
  )

  function updateDraft(patch: Partial<QuestionStudioDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
    setError(null)
  }

  async function prepare() {
    if (!draft.prompt.trim() || preparing) {
      return
    }
    setPreparing(true)
    setError(null)
    try {
      const response = await postJson<{ ok: true; preparation: QuestionPreparation }>("/api/questions/prepare", draft)
      setPreparation(response.preparation)
      setDraft((current) => ({ ...current, forecastType: current.forecastType ?? response.preparation.forecastType }))
      setStage("contract")
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setPreparing(false)
    }
  }

  function reset() {
    setDraft(emptyQuestionDraft())
    setPreparation(null)
    setPrivateEstimate("")
    setPrivateRationale("")
    setStage("draft")
    setError(null)
  }

  async function launch() {
    const latest = prepareQuestionDraft(draft)
    if (!latest.ready || submitting) {
      setStage("contract")
      setError("Complete every required contract item before launching.")
      return
    }

    setSubmitting(true)
    setError(null)
    const prior = privateEstimate.trim() || privateRationale.trim() ? createPrivatePrior(draft, latest.forecastType, privateEstimate, privateRationale) : null
    if (prior) {
      savePrivatePrior(prior)
    }

    try {
      // Deliberately construct the run payload from the question contract only.
      // The private estimate and rationale never enter this request.
      const payload = await postJson<{ taskId?: string }>("/api/runs", toRunPayload(draft))
      if (!payload.taskId) {
        throw new Error("Could not start the forecast run.")
      }
      if (prior) {
        savePrivatePrior({ ...prior, taskId: payload.taskId, launchStatus: "launched" })
      }
      router.push(`/runs/${payload.taskId}`)
    } catch (caught) {
      if (prior) {
        savePrivatePrior({ ...prior, launchStatus: "launch_failed" })
      }
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className={cn("w-full", className)} aria-labelledby="question-studio-title">
      <div className="fs-panel relative overflow-hidden rounded-xl border border-primary/15 bg-background/75 shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur-md">
        <div className="pointer-events-none absolute left-6 right-6 top-0 h-px bg-primary/45" />
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/80 px-5 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <p className="fs-eyebrow text-primary/90">Question studio</p>
            </div>
            <h2 id="question-studio-title" className="mt-1 text-base font-medium tracking-tight sm:text-lg">
              Turn an idea into a resolvable forecast
            </h2>
          </div>
          <StageIndicator stage={stage} />
        </div>

        {stage === "draft" ? (
          <DraftStage
            draft={draft}
            preparing={preparing}
            onDraft={updateDraft}
            onExample={(example) => {
              setDraft({ ...example })
              setPreparation(null)
            }}
            onPrepare={() => void prepare()}
          />
        ) : null}

        {stage === "contract" && currentPreparation ? (
          <ContractStage
            draft={draft}
            preparation={currentPreparation}
            onDraft={updateDraft}
            onBack={() => setStage("draft")}
            onReview={() => {
              if (currentPreparation.ready) {
                setError(null)
                setStage("review")
              } else {
                setError("Complete every required contract item before reviewing.")
              }
            }}
          />
        ) : null}

        {stage === "review" && currentPreparation ? (
          <ReviewStage
            draft={draft}
            preparation={currentPreparation}
            estimate={privateEstimate}
            rationale={privateRationale}
            submitting={submitting}
            onEstimate={setPrivateEstimate}
            onRationale={setPrivateRationale}
            onBack={() => setStage("contract")}
            onLaunch={() => void launch()}
          />
        ) : null}

        {error ? (
          <div className="border-t border-destructive/20 bg-destructive/5 px-5 py-3 text-sm text-destructive" role="alert">
            {error}
          </div>
        ) : null}

        {stage !== "draft" ? (
          <div className="flex justify-end border-t border-border/70 px-5 py-2 sm:px-6">
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={reset}>
              <RotateCcw data-icon="inline-start" />
              Start over
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function DraftStage({
  draft,
  preparing,
  onDraft,
  onExample,
  onPrepare,
}: {
  draft: QuestionStudioDraft
  preparing: boolean
  onDraft: (patch: Partial<QuestionStudioDraft>) => void
  onExample: (draft: QuestionStudioDraft) => void
  onPrepare: () => void
}) {
  return (
    <div className="p-5 sm:p-6">
      <label htmlFor="question-draft" className="text-sm font-medium">
        What uncertain future outcome do you want to forecast?
      </label>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Write naturally. Next, you will define the deadline and exact resolution rule before anything launches.
      </p>
      <Textarea
        id="question-draft"
        value={draft.prompt}
        onChange={(event) => onDraft({ prompt: event.target.value, forecastType: undefined })}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault()
            onPrepare()
          }
        }}
        className="mt-4 min-h-32 resize-y border-primary/20 bg-background/45 text-base leading-7 shadow-inner md:text-base"
        placeholder="Example: Will the ECB deposit facility rate be below 2.0% on December 18, 2026?"
        autoFocus
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs text-muted-foreground">Try a complete example:</span>
        {QUESTION_EXAMPLES.map((example) => (
          <Button key={example.label} type="button" variant="outline" size="sm" onClick={() => onExample(example.draft)}>
            {example.label}
          </Button>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-4">
        <div className="flex max-w-lg items-start gap-2 text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>Your wording is preserved. The studio checks the contract but never silently rewrites your question.</span>
        </div>
        <Button type="button" onClick={onPrepare} disabled={preparing || draft.prompt.trim().length < 12}>
          {preparing ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <ArrowRight data-icon="inline-start" />}
          Prepare question
        </Button>
      </div>
    </div>
  )
}

function ContractStage({
  draft,
  preparation,
  onDraft,
  onBack,
  onReview,
}: {
  draft: QuestionStudioDraft
  preparation: QuestionPreparation
  onDraft: (patch: Partial<QuestionStudioDraft>) => void
  onBack: () => void
  onReview: () => void
}) {
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5 p-5 sm:p-6 lg:border-r lg:border-border/70">
        <Field label="Exact question" hint="This exact text—not a rewritten version—will be forecast.">
          <Textarea value={draft.prompt} onChange={(event) => onDraft({ prompt: event.target.value })} className="min-h-24 resize-y" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Forecast shape" hint="Choose what kind of answer the question needs.">
            <select
              value={preparation.forecastType}
              onChange={(event) => onDraft({ forecastType: event.target.value as ForecastType })}
              className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {FORECAST_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Resolution deadline" hint="The latest date by which the outcome should be knowable.">
            <Input type="date" value={draft.resolutionDate} onChange={(event) => onDraft({ resolutionDate: event.target.value })} />
          </Field>
        </div>

        <Field label="Resolution rule" hint="Say exactly what counts, which source decides, and how edge cases resolve.">
          <Textarea
            value={draft.resolutionCriteria}
            onChange={(event) => onDraft({ resolutionCriteria: event.target.value })}
            className="min-h-28 resize-y"
            placeholder="Resolve YES if …; otherwise resolve NO. Use … as the primary source. If …, then …"
          />
        </Field>

        <TypeFields draft={draft} forecastType={preparation.forecastType} onDraft={onDraft} />

        <details className="rounded-lg border border-border/70 bg-muted/15 p-4">
          <summary className="cursor-pointer text-sm font-medium">Background and evidence boundary</summary>
          <div className="mt-4 space-y-4">
            <Field label="Background (optional)" hint="Context the researchers should know. Do not include your preferred answer.">
              <Textarea
                value={draft.background}
                onChange={(event) => onDraft({ background: event.target.value })}
                className="min-h-20 resize-y"
                placeholder="Relevant definitions, constraints, or context…"
              />
            </Field>
            <Field label="Evidence cutoff (optional)" hint="Use only information available through this date. Leave blank for a live forecast.">
              <Input type="date" value={draft.cutoffDate} onChange={(event) => onDraft({ cutoffDate: event.target.value })} />
            </Field>
          </div>
        </details>

        <div className="flex flex-wrap justify-between gap-3 border-t border-border/70 pt-4">
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" />
            Back
          </Button>
          <Button type="button" onClick={onReview} disabled={!preparation.ready}>
            Review exact contract
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>

      <aside className="bg-muted/10 p-5 sm:p-6" aria-label="Question quality checks">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Transparent preflight</h3>
          <Badge variant={preparation.ready ? "secondary" : "outline"}>{preparation.ready ? "Ready" : "Needs work"}</Badge>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{preparation.summary}</p>
        <div className="mt-4 space-y-3" aria-live="polite">
          {preparation.checks.map((item) => (
            <div key={item.id} className="flex items-start gap-2.5 rounded-lg border border-border/65 bg-background/35 p-3">
              {item.status === "pass" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              ) : item.level === "required" ? (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0 text-amber-500" />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium leading-5">{item.label}</p>
                  <span className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">{item.level}</span>
                </div>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}

function TypeFields({
  draft,
  forecastType,
  onDraft,
}: {
  draft: QuestionStudioDraft
  forecastType: ForecastType
  onDraft: (patch: Partial<QuestionStudioDraft>) => void
}) {
  if (forecastType === "categorical") {
    return (
      <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Outcome categories" hint="Comma-separated; make them mutually exclusive.">
          <Input
            value={draft.categories.join(", ")}
            onChange={(event) => onDraft({ categories: splitList(event.target.value) })}
            placeholder="Outcome A, Outcome B, Other / tie"
          />
        </Field>
        <label className="flex h-8 items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={draft.categoriesExhaustive}
            onChange={(event) => onDraft({ categoriesExhaustive: event.target.checked })}
            className="size-4 accent-primary"
          />
          Covers every outcome
        </label>
      </div>
    )
  }
  if (forecastType === "numeric") {
    return (
      <Field label="Unit" hint="The scale used in the answer distribution.">
        <Input value={draft.unit} onChange={(event) => onDraft({ unit: event.target.value })} placeholder="%, USD, people, index points…" />
      </Field>
    )
  }
  if (forecastType === "thresholded") {
    return (
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Thresholds" hint="Comma-separated values.">
          <Input
            value={draft.thresholds.join(", ")}
            onChange={(event) => onDraft({ thresholds: splitList(event.target.value) })}
            placeholder="2.0"
          />
        </Field>
        <Field label="Direction" hint="How each threshold is evaluated.">
          <select
            value={draft.thresholdDirection}
            onChange={(event) => onDraft({ thresholdDirection: event.target.value as "at_least" | "at_most" })}
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            <option value="at_least">At least</option>
            <option value="at_most">At most</option>
          </select>
        </Field>
        <Field label="Unit" hint="The threshold scale.">
          <Input value={draft.unit} onChange={(event) => onDraft({ unit: event.target.value })} placeholder="%, USD…" />
        </Field>
      </div>
    )
  }
  if (forecastType === "conditional") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Condition" hint="The event this forecast assumes occurs.">
          <Textarea value={draft.condition} onChange={(event) => onDraft({ condition: event.target.value })} className="min-h-20 resize-y" />
        </Field>
        <Field label="Condition resolution rule" hint="How to decide independently whether the condition occurred.">
          <Textarea
            value={draft.conditionResolutionCriteria}
            onChange={(event) => onDraft({ conditionResolutionCriteria: event.target.value })}
            className="min-h-20 resize-y"
          />
        </Field>
      </div>
    )
  }
  return null
}

function ReviewStage({
  draft,
  preparation,
  estimate,
  rationale,
  submitting,
  onEstimate,
  onRationale,
  onBack,
  onLaunch,
}: {
  draft: QuestionStudioDraft
  preparation: QuestionPreparation
  estimate: string
  rationale: string
  submitting: boolean
  onEstimate: (value: string) => void
  onRationale: (value: string) => void
  onBack: () => void
  onLaunch: () => void
}) {
  return (
    <div className="p-5 sm:p-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <p className="fs-eyebrow text-primary/85">Exact launch contract</p>
          <blockquote className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-base font-medium leading-7">
            {draft.prompt.trim()}
          </blockquote>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <ReviewItem label="Forecast shape" value={TYPE_LABELS[preparation.forecastType]} />
            <ReviewItem label="Resolution deadline" value={draft.resolutionDate} />
            <div className="sm:col-span-2">
              <ReviewItem label="Resolution rule" value={draft.resolutionCriteria.trim()} />
            </div>
            {draft.cutoffDate ? <ReviewItem label="Evidence cutoff" value={draft.cutoffDate} /> : null}
            <ReviewItem label="Forecast as of" value="Launch time" />
          </dl>

          <div className="mt-5 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-5 text-muted-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            <span>The forecast starts only after you confirm this exact contract. Recommended warnings do not block an intentional forecast.</span>
          </div>
        </div>

        <aside className="rounded-lg border border-border/75 bg-muted/15 p-4">
          <div className="flex items-center gap-2">
            <LockKeyhole className="size-4 text-primary" />
            <h3 className="text-sm font-medium">Make a private estimate</h3>
            <Badge variant="outline">Optional</Badge>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Commit before seeing the machine result. It is saved only in this browser and is never sent to the forecasting workflow.
          </p>
          <div className="mt-4 space-y-4">
            <Field label={privateEstimateLabel(preparation.forecastType)} hint={privateEstimateHint(preparation.forecastType)}>
              <Input
                type={["binary", "conditional"].includes(preparation.forecastType) ? "number" : "text"}
                min={["binary", "conditional"].includes(preparation.forecastType) ? 0 : undefined}
                max={["binary", "conditional"].includes(preparation.forecastType) ? 100 : undefined}
                value={estimate}
                onChange={(event) => onEstimate(event.target.value)}
                placeholder={privateEstimatePlaceholder(preparation.forecastType)}
              />
            </Field>
            <Field label="Your reasoning" hint="A base rate, strongest reason, or what would change your mind.">
              <Textarea
                value={rationale}
                onChange={(event) => onRationale(event.target.value)}
                className="min-h-24 resize-y"
                placeholder="My starting reference class is…"
              />
            </Field>
          </div>
        </aside>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          Edit contract
        </Button>
        <Button type="button" onClick={onLaunch} disabled={submitting} className="min-w-36">
          {submitting ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <SendHorizonal data-icon="inline-start" />}
          Launch forecast
        </Button>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint ? <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{hint}</span> : null}
      <span className="mt-2 block">{children}</span>
    </label>
  )
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/65 bg-background/35 p-3">
      <dt className="text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words leading-6">{value}</dd>
    </div>
  )
}

function StageIndicator({ stage }: { stage: StudioStage }) {
  const active = stage === "draft" ? 0 : stage === "contract" ? 1 : 2
  return (
    <ol className="flex items-center gap-1" aria-label="Question studio progress">
      {["Draft", "Contract", "Review"].map((label, index) => (
        <li key={label} className="flex items-center gap-1">
          {index > 0 ? <span className="h-px w-3 bg-border" aria-hidden="true" /> : null}
          <span
            className={cn(
              "rounded-full border px-2 py-1 text-[0.62rem] uppercase tracking-[0.14em]",
              index === active ? "border-primary/40 bg-primary/10 text-primary" : index < active ? "border-border text-foreground" : "border-border/70 text-muted-foreground",
            )}
            aria-current={index === active ? "step" : undefined}
          >
            {index + 1}. {label}
          </span>
        </li>
      ))}
    </ol>
  )
}

function createPrivatePrior(
  draft: QuestionStudioDraft,
  forecastType: ForecastType,
  estimate: string,
  rationale: string,
): PrivatePrior {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    question: draft.prompt.trim(),
    forecastType,
    estimate: estimate.trim(),
    rationale: rationale.trim(),
    capturedAt: new Date().toISOString(),
    launchStatus: "pending",
  }
}

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50)
}

function privateEstimateLabel(type: ForecastType) {
  if (type === "binary" || type === "conditional") return "Your probability (0–100%)"
  if (type === "categorical") return "Your outcome probabilities"
  if (type === "date") return "Your median date"
  if (type === "numeric") return "Your median estimate"
  return "Your threshold estimate"
}

function privateEstimateHint(type: ForecastType) {
  if (type === "categorical") return "Example: A 50%, B 30%, Other 20%."
  if (type === "date") return "The date by which you think the event is equally likely to have occurred or not."
  if (type === "numeric") return "Your central estimate, using the unit defined in the contract."
  if (type === "thresholded") return "Which threshold do you expect to be crossed, and with what probability?"
  return "Use a number, not likely/unlikely. A 70% forecast can still resolve NO."
}

function privateEstimatePlaceholder(type: ForecastType) {
  if (type === "binary" || type === "conditional") return "70"
  if (type === "categorical") return "A 50%, B 30%, Other 20%"
  if (type === "date") return "2027-06-30"
  if (type === "numeric") return "3.8"
  return "At least 100: 65%"
}
