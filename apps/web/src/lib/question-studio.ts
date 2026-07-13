export const FORECAST_TYPES = ["binary", "categorical", "numeric", "date", "thresholded", "conditional"] as const

export type ForecastType = (typeof FORECAST_TYPES)[number]
export type CheckLevel = "required" | "recommended"
export type CheckStatus = "pass" | "missing" | "warning"

export type QuestionStudioDraft = {
  prompt: string
  forecastType?: ForecastType
  resolutionDate: string
  resolutionCriteria: string
  background: string
  cutoffDate: string
  categories: string[]
  categoriesExhaustive: boolean
  unit: string
  thresholds: string[]
  thresholdDirection: "at_least" | "at_most"
  condition: string
  conditionResolutionCriteria: string
}

export type QuestionCheck = {
  id: string
  label: string
  level: CheckLevel
  status: CheckStatus
  detail: string
}

export type QuestionPreparation = {
  originalPrompt: string
  forecastType: ForecastType
  checks: QuestionCheck[]
  ready: boolean
  summary: string
}

export type PrivatePrior = {
  id: string
  taskId?: string
  question: string
  forecastType: ForecastType
  estimate: string
  rationale: string
  capturedAt: string
  launchStatus: "pending" | "launched" | "launch_failed"
}

export const PRIVATE_PRIOR_STORAGE_KEY = "open-superforecaster:private-priors:v1"

export const QUESTION_EXAMPLES: Array<{
  label: string
  draft: QuestionStudioDraft
}> = [
  {
    label: "Binary",
    draft: {
      prompt: "Will the European Central Bank deposit facility rate be below 2.0% on December 18, 2026?",
      forecastType: "binary",
      resolutionDate: "2026-12-18",
      resolutionCriteria:
        "Resolve YES if the ECB deposit facility rate published by the European Central Bank for December 18, 2026 is strictly below 2.0%; otherwise resolve NO. Use the ECB key interest rates page as the primary source.",
      background: "",
      cutoffDate: "",
      categories: [],
      categoriesExhaustive: false,
      unit: "%",
      thresholds: [],
      thresholdDirection: "at_least",
      condition: "",
      conditionResolutionCriteria: "",
    },
  },
  {
    label: "Numeric",
    draft: {
      prompt: "What will the annual average US unemployment rate be in 2027?",
      forecastType: "numeric",
      resolutionDate: "2028-02-15",
      resolutionCriteria:
        "Use the annual average unemployment rate for 2027 in the first Bureau of Labor Statistics annual release published by February 15, 2028. Ignore later revisions.",
      background: "",
      cutoffDate: "",
      categories: [],
      categoriesExhaustive: false,
      unit: "% of labor force",
      thresholds: [],
      thresholdDirection: "at_least",
      condition: "",
      conditionResolutionCriteria: "",
    },
  },
  {
    label: "Categorical",
    draft: {
      prompt: "Which party will win the most seats in the next German federal election?",
      forecastType: "categorical",
      resolutionDate: "2029-12-31",
      resolutionCriteria:
        "Resolve using the final official seat totals published by the Federal Returning Officer. If two parties tie for the most seats, resolve as Other / tie.",
      background: "",
      cutoffDate: "",
      categories: ["CDU/CSU", "AfD", "SPD", "Greens", "Other / tie"],
      categoriesExhaustive: true,
      unit: "seats",
      thresholds: [],
      thresholdDirection: "at_least",
      condition: "",
      conditionResolutionCriteria: "",
    },
  },
]

export function emptyQuestionDraft(): QuestionStudioDraft {
  return {
    prompt: "",
    resolutionDate: "",
    resolutionCriteria: "",
    background: "",
    cutoffDate: "",
    categories: [],
    categoriesExhaustive: false,
    unit: "",
    thresholds: [],
    thresholdDirection: "at_least",
    condition: "",
    conditionResolutionCriteria: "",
  }
}

export function prepareQuestionDraft(draft: QuestionStudioDraft, now = new Date()): QuestionPreparation {
  const originalPrompt = draft.prompt.trim()
  const forecastType = draft.forecastType ?? inferForecastType(originalPrompt)
  const checks: QuestionCheck[] = [
    check(
      "target",
      "A specific outcome is stated",
      "required",
      originalPrompt.length >= 12 ? "pass" : "missing",
      originalPrompt.length >= 12
        ? "The exact wording below will be sent unchanged."
        : "State one concrete future outcome or quantity.",
    ),
    resolutionDateCheck(draft.resolutionDate, now),
    check(
      "resolution",
      "An objective resolution rule is provided",
      "required",
      draft.resolutionCriteria.trim().length >= 24 ? "pass" : "missing",
      draft.resolutionCriteria.trim().length >= 24
        ? "The resolver has an explicit rule to apply."
        : "Describe exactly what observation makes each outcome resolve.",
    ),
    check(
      "source",
      "A primary source or dataset is named",
      "recommended",
      hasNamedSource(draft.resolutionCriteria) ? "pass" : "warning",
      hasNamedSource(draft.resolutionCriteria)
        ? "The rule appears to name where the outcome will be checked."
        : "Name the official page, authority, filing, release, or dataset the resolver should use.",
    ),
    check(
      "single_target",
      "The question has one resolution target",
      "recommended",
      hasLikelyCompoundTarget(originalPrompt) ? "warning" : "pass",
      hasLikelyCompoundTarget(originalPrompt)
        ? "The question may combine multiple events. Split it unless the joint outcome is intentional."
        : "No obvious compound target was detected.",
    ),
    ...typeSpecificChecks(draft, forecastType),
  ]

  const requiredMissing = checks.filter((item) => item.level === "required" && item.status !== "pass").length
  const warnings = checks.filter((item) => item.level === "recommended" && item.status !== "pass").length

  return {
    originalPrompt,
    forecastType,
    checks,
    ready: requiredMissing === 0,
    summary:
      requiredMissing > 0
        ? `${requiredMissing} required ${requiredMissing === 1 ? "item" : "items"} still need attention.`
        : warnings > 0
          ? `Ready to launch, with ${warnings} recommended ${warnings === 1 ? "improvement" : "improvements"}.`
          : "The question has the core parts of a resolvable forecast contract.",
  }
}

export function toRunPayload(draft: QuestionStudioDraft) {
  const forecastType = draft.forecastType ?? inferForecastType(draft.prompt)
  return compactRecord({
    prompt: draft.prompt.trim(),
    mode: "forecast",
    forecastType,
    resolutionDate: draft.resolutionDate || undefined,
    resolutionCriteria: draft.resolutionCriteria.trim() || undefined,
    background: draft.background.trim() || undefined,
    cutoffDate: draft.cutoffDate || undefined,
    categories: forecastType === "categorical" ? draft.categories : undefined,
    categoriesExhaustive: forecastType === "categorical" ? draft.categoriesExhaustive : undefined,
    unit: ["numeric", "thresholded"].includes(forecastType) ? draft.unit.trim() || undefined : undefined,
    thresholds: forecastType === "thresholded" ? draft.thresholds : undefined,
    thresholdDirection: forecastType === "thresholded" ? draft.thresholdDirection : undefined,
    condition: forecastType === "conditional" ? draft.condition.trim() || undefined : undefined,
    conditionResolutionCriteria:
      forecastType === "conditional" ? draft.conditionResolutionCriteria.trim() || undefined : undefined,
  })
}

export function inferForecastType(prompt: string): ForecastType {
  const lower = prompt.toLowerCase()
  if (/\b(conditional on|assuming|given that|provided that|conditioned on|if .+ then)\b/.test(lower)) {
    return "conditional"
  }
  if (/^\s*(will|did|does|do|is|are|was|were|has|have|had|can|could|should)\b/.test(lower)) {
    return "binary"
  }
  const numericLikeCount = (lower.match(/\b\d+(?:\.\d+)?\s*(?:k|m|b|bn|million|billion|trillion|%|percent|launches|users)?\b/g) ?? [])
    .length
  if (
    numericLikeCount >= 2 &&
    (/\b(threshold|thresholds|cutoff|cutoffs|breakpoint|breakpoints|bins)\b/.test(lower) ||
      (/\b(probabilities|chances|odds)\b/.test(lower) && /\b(exceed(?:s|ed|ing)?|above|over|at least|at most|below|under)\b/.test(lower)))
  ) {
    return "thresholded"
  }
  if (/\b(when|what (?:calendar )?date|by what (?:calendar )?date)\b/.test(lower)) {
    return "date"
  }
  if (/\b(how many|how much|what will (?:the )?(?:value|amount|level|price|count)|revenue|temperature)\b/.test(lower)) {
    return "numeric"
  }
  if (/\b(which|who will win|winner|which category)\b/.test(lower)) {
    return "categorical"
  }
  return "binary"
}

export function savePrivatePrior(prior: PrivatePrior) {
  if (typeof window === "undefined") {
    return
  }
  const key = PRIVATE_PRIOR_STORAGE_KEY
  const current = readPrivatePriors(key)
  const next = [prior, ...current.filter((item) => item.id !== prior.id)].slice(0, 250)
  window.localStorage.setItem(key, JSON.stringify(next))
}

export function getPrivatePriorForTask(taskId: string): PrivatePrior | null {
  if (typeof window === "undefined") {
    return null
  }
  return readPrivatePriors(PRIVATE_PRIOR_STORAGE_KEY).find((item) => item.taskId === taskId) ?? null
}

export function privatePriorFromSnapshot(snapshot: string | null, taskId: string): PrivatePrior | null {
  if (!snapshot) {
    return null
  }
  try {
    const parsed = JSON.parse(snapshot)
    return Array.isArray(parsed) ? (parsed as PrivatePrior[]).find((item) => item.taskId === taskId) ?? null : null
  } catch {
    return null
  }
}

function readPrivatePriors(key: string): PrivatePrior[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]")
    return Array.isArray(parsed) ? (parsed as PrivatePrior[]) : []
  } catch {
    return []
  }
}

function resolutionDateCheck(value: string, now: Date): QuestionCheck {
  if (!value) {
    return check("deadline", "A resolution deadline is set", "required", "missing", "Choose when this question can be resolved.")
  }
  const date = new Date(`${value}T23:59:59.999Z`)
  if (!Number.isFinite(date.getTime()) || date.getTime() <= now.getTime()) {
    return check(
      "deadline",
      "A future resolution deadline is set",
      "required",
      "missing",
      "Choose a valid future date; already-known outcomes cannot be forecast prospectively.",
    )
  }
  return check("deadline", "A future resolution deadline is set", "required", "pass", `Resolution is expected by ${value}.`)
}

function typeSpecificChecks(draft: QuestionStudioDraft, forecastType: ForecastType): QuestionCheck[] {
  if (forecastType === "categorical") {
    return [
      check(
        "categories",
        "At least two outcome categories are defined",
        "required",
        draft.categories.length >= 2 ? "pass" : "missing",
        draft.categories.length >= 2 ? `${draft.categories.length} outcomes are defined.` : "Enter comma-separated possible outcomes.",
      ),
      check(
        "exhaustive",
        "Outcomes cover ties and edge cases",
        "recommended",
        draft.categoriesExhaustive ? "pass" : "warning",
        draft.categoriesExhaustive
          ? "The outcome set is marked exhaustive."
          : "Add an Other / tie category or confirm that the listed outcomes are exhaustive.",
      ),
    ]
  }
  if (forecastType === "numeric") {
    return [
      check(
        "unit",
        "The numerical unit is defined",
        "required",
        draft.unit.trim() ? "pass" : "missing",
        draft.unit.trim() ? `Values will be expressed in ${draft.unit.trim()}.` : "Specify %, USD, people, index points, or another unit.",
      ),
    ]
  }
  if (forecastType === "thresholded") {
    return [
      check(
        "thresholds",
        "At least one threshold is defined",
        "required",
        draft.thresholds.length > 0 ? "pass" : "missing",
        draft.thresholds.length > 0 ? `${draft.thresholds.length} threshold(s) are defined.` : "Enter the exact threshold value.",
      ),
      check(
        "unit",
        "The threshold unit is defined",
        "required",
        draft.unit.trim() ? "pass" : "missing",
        draft.unit.trim() ? `Thresholds will use ${draft.unit.trim()}.` : "Specify the unit used by the threshold.",
      ),
    ]
  }
  if (forecastType === "conditional") {
    return [
      check(
        "condition",
        "The conditioning event is explicit",
        "required",
        draft.condition.trim().length >= 8 ? "pass" : "missing",
        draft.condition.trim().length >= 8 ? "The condition will be tracked separately." : "State the event on which this forecast is conditional.",
      ),
      check(
        "condition_resolution",
        "The condition has its own resolution rule",
        "recommended",
        draft.conditionResolutionCriteria.trim().length >= 16 ? "pass" : "warning",
        draft.conditionResolutionCriteria.trim().length >= 16
          ? "The conditioning event can be resolved independently."
          : "Explain how to decide whether the condition occurred.",
      ),
    ]
  }
  if (forecastType === "date") {
    return [
      check(
        "date_target",
        "The dated event is explicit",
        "recommended",
        /\b(when|what (?:calendar )?date|by what (?:calendar )?date)\b/i.test(draft.prompt) ? "pass" : "warning",
        "Phrase the target as the date of one observable event and define what happens if it misses the horizon.",
      ),
    ]
  }
  return []
}

function check(id: string, label: string, level: CheckLevel, status: CheckStatus, detail: string): QuestionCheck {
  return { id, label, level, status, detail }
}

function hasNamedSource(criteria: string) {
  return /https?:\/\/|\b(source|official|published|release|filing|dataset|register|commission|agency|bureau|bank|court|authority|statistics|website|page)\b/i.test(
    criteria,
  )
}

function hasLikelyCompoundTarget(prompt: string) {
  const conjunctions = prompt.match(/\b(and|as well as)\b/gi)?.length ?? 0
  return conjunctions > 0 && /\b(will|whether|when|which|what)\b/i.test(prompt)
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}
