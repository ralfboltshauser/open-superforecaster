import {
  isRecord,
  readArray,
  readNumber,
  readString,
  type JsonRecord,
} from "@/lib/records"

export type ForecastLifecycleState =
  | "in_progress"
  | "forecast_ready"
  | "awaiting_resolution"
  | "resolved"
  | "annulled"
  | "failed"

export type ForecastPortfolioItem = {
  id: string
  question: string
  questionAvailable: boolean
  forecastType: string
  state: ForecastLifecycleState
  stateLabel: string
  createdAt: string | null
  completedAt: string | null
  resolutionDate: string | null
  resolutionCriteria: string | null
  resultLabel: string | null
  probability: number | null
  score: number | null
  sourceCount: number
  error: string | null
}

type PortfolioInput = {
  runs: JsonRecord[]
  detailsByTaskId?: Record<string, JsonRecord>
  resolutions?: JsonRecord | null
  performance?: JsonRecord | null
}

export function buildForecastPortfolio(input: PortfolioInput): ForecastPortfolioItem[] {
  const detailsByTaskId = input.detailsByTaskId ?? {}
  const pendingTaskIds = new Set(
    readArray(input.resolutions, "pendingForecasts")
      .filter(isRecord)
      .map((row) => readString(row, "taskId"))
      .filter((value): value is string => Boolean(value)),
  )
  const resolutionByTaskId = resolutionRecordsByTaskId(input.resolutions)
  const scoreByTaskId = scoreRecordsByTaskId(input.performance, input.resolutions)

  return input.runs
    .filter(isForecastRun)
    .flatMap((run): ForecastPortfolioItem[] => {
      const id = readString(run, "id")
      if (!id) {
        return []
      }

      const detail = detailsByTaskId[id] ?? null
      const task = isRecord(detail?.task) ? detail.task : null
      const config = recordFrom(task?.configJson)
      const forecastInput = recordFrom(config?.forecastInput)
      const preview = recordFrom(run.outputPreview)
      const score = scoreByTaskId.get(id) ?? null
      const resolution = resolutionByTaskId.get(id) ?? null
      const question = readForecastQuestion(task, config, forecastInput)
      const forecastType = readForecastType(run, preview)
      const state = lifecycleState({
        pending: pendingTaskIds.has(id),
        resolution,
        runStatus: readString(run, "status"),
        scored: Boolean(score),
      })
      const probability = readForecastProbability(preview, score)

      return [{
        id,
        question: question ?? "Question details unavailable",
        questionAvailable: question !== null,
        forecastType,
        state,
        stateLabel: lifecycleStateLabel(state),
        createdAt: readDateString(run, "createdAt"),
        completedAt: readDateString(run, "completedAt"),
        resolutionDate: readDateString(forecastInput, "resolutionDate"),
        resolutionCriteria: readString(forecastInput, "resolutionCriteria"),
        resultLabel: forecastResultLabel(forecastType, preview, score, resolution),
        probability,
        score: score ? readNumber(score, "score") ?? readNumber(score, "scoreValue") : null,
        sourceCount: readNumber(run, "sourceCount") ?? 0,
        error: readString(run, "error"),
      }]
    })
}

export function isForecastRun(run: JsonRecord) {
  const mode = readString(run, "operationMode")
  const submode = readString(run, "operationSubmode")
  return mode === "forecast" || Boolean(submode?.endsWith("_forecast"))
}

export function lifecycleStateLabel(state: ForecastLifecycleState) {
  switch (state) {
    case "in_progress":
      return "Forecasting"
    case "forecast_ready":
      return "Forecast ready"
    case "awaiting_resolution":
      return "Awaiting resolution"
    case "resolved":
      return "Resolved"
    case "annulled":
      return "Annulled"
    case "failed":
      return "Needs attention"
  }
}

function lifecycleState(input: {
  pending: boolean
  resolution: JsonRecord | null
  runStatus: string | null
  scored: boolean
}): ForecastLifecycleState {
  if (input.resolution?.annulled === true) {
    return "annulled"
  }
  if (input.scored || input.resolution) {
    return "resolved"
  }
  if (input.runStatus === "failed") {
    return "failed"
  }
  if (input.runStatus === "queued" || input.runStatus === "running") {
    return "in_progress"
  }
  if (input.pending) {
    return "awaiting_resolution"
  }
  return "forecast_ready"
}

function readForecastQuestion(
  task: JsonRecord | null,
  config: JsonRecord | null,
  forecastInput: JsonRecord | null,
) {
  const taskInput = recordFrom(task?.input)
  const candidates = [
    readString(forecastInput, "question"),
    readString(config, "prompt"),
    readString(taskInput, "question"),
    readString(taskInput, "prompt"),
  ]
  return candidates.find((value) => value?.trim())?.trim() ?? null
}

function readForecastType(run: JsonRecord, preview: JsonRecord | null) {
  const previewType = readString(preview, "forecast_type") ?? readString(preview, "forecastType")
  if (previewType) {
    return previewType
  }
  return (readString(run, "operationSubmode") ?? "forecast").replace(/_forecast$/, "")
}

function readForecastProbability(preview: JsonRecord | null, score: JsonRecord | null) {
  return (
    readNumber(preview, "probability") ??
    readNumber(preview, "raw_probability") ??
    readNumber(preview, "rawProbability") ??
    readNumber(score, "probability")
  )
}

function forecastResultLabel(
  forecastType: string,
  preview: JsonRecord | null,
  score: JsonRecord | null,
  resolution: JsonRecord | null,
) {
  if (resolution?.annulled === true) {
    return "Question annulled"
  }
  const resolved = score?.resolved
  if (typeof resolved === "boolean") {
    return `Resolved ${resolved ? "YES" : "NO"}`
  }

  if (forecastType === "binary") {
    const probability = readForecastProbability(preview, score)
    return probability === null ? null : `${formatProbability(probability)} YES`
  }
  if (forecastType === "categorical") {
    const category = readString(preview, "top_category") ?? readString(preview, "topCategory")
    return category ? `Leading outcome: ${category}` : null
  }
  if (forecastType === "numeric") {
    const value = firstNumber(preview, ["p50", "median", "median_value", "medianValue"])
    const unit = readString(preview, "unit")
    return value === null ? null : `Median: ${formatNumber(value)}${unit ? ` ${unit}` : ""}`
  }
  if (forecastType === "date") {
    const date = firstString(preview, ["p50_date", "p50Date", "median_date", "medianDate"])
    return date ? `Median date: ${formatDate(date)}` : null
  }
  if (forecastType === "conditional") {
    const probability = firstNumber(preview, ["conditional_probability", "conditionalProbability", "probability"])
    return probability === null ? "Conditional forecast ready" : `${formatProbability(probability)} conditional probability`
  }
  if (forecastType === "thresholded") {
    return "Threshold curve ready"
  }
  return null
}

function resolutionRecordsByTaskId(resolutions: JsonRecord | null | undefined) {
  const records = new Map<string, JsonRecord>()
  for (const row of readArray(resolutions, "recentResolutions").filter(isRecord)) {
    const taskId = readString(row, "taskId")
    if (taskId) {
      records.set(taskId, row)
    }
  }
  return records
}

function scoreRecordsByTaskId(
  performance: JsonRecord | null | undefined,
  resolutions: JsonRecord | null | undefined,
) {
  const records = new Map<string, JsonRecord>()
  const scoreRows = [
    ...readArray(performance, "calibrationReplayRows"),
    ...readArray(resolutions, "recentScores"),
  ].filter(isRecord)

  for (const row of scoreRows) {
    const taskId = readString(row, "taskId")
    if (!taskId) {
      continue
    }
    const previous = records.get(taskId)
    const nextTimestamp = timestamp(readDateString(row, "createdAt"))
    const previousTimestamp = timestamp(readDateString(previous, "createdAt"))
    if (!previous || nextTimestamp >= previousTimestamp) {
      records.set(taskId, {
        ...row,
        score: readNumber(row, "score") ?? readNumber(row, "scoreValue"),
      })
    }
  }
  return records
}

function recordFrom(value: unknown): JsonRecord | null {
  if (isRecord(value)) {
    return value
  }
  if (typeof value !== "string") {
    return null
  }
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function readDateString(record: unknown, key: string) {
  if (!isRecord(record)) {
    return null
  }
  const value = record[key]
  if (value instanceof Date) {
    return value.toISOString()
  }
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null
}

function firstNumber(record: JsonRecord | null, keys: string[]) {
  for (const key of keys) {
    const value = readNumber(record, key)
    if (value !== null) {
      return value
    }
  }
  return null
}

function firstString(record: JsonRecord | null, keys: string[]) {
  for (const key of keys) {
    const value = readString(record, key)
    if (value) {
      return value
    }
  }
  return null
}

function timestamp(value: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

function formatProbability(value: number) {
  return `${Math.round(value * 10) / 10}%`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value)
}

function formatDate(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(parsed)
}
