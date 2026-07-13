import {
  emptyQuestionDraft,
  FORECAST_TYPES,
  prepareQuestionDraft,
  type ForecastType,
  type QuestionStudioDraft,
} from "@/lib/question-studio"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const draft = parseDraft(body)
  const result = prepareQuestionDraft(draft)

  return Response.json({ ok: true, preparation: result })
}

function parseDraft(body: Record<string, unknown>): QuestionStudioDraft {
  const empty = emptyQuestionDraft()
  const forecastType = FORECAST_TYPES.includes(body.forecastType as ForecastType)
    ? (body.forecastType as ForecastType)
    : undefined

  return {
    ...empty,
    prompt: asString(body.prompt),
    forecastType,
    resolutionDate: asString(body.resolutionDate),
    resolutionCriteria: asString(body.resolutionCriteria),
    background: asString(body.background),
    cutoffDate: asString(body.cutoffDate),
    categories: asStringArray(body.categories),
    categoriesExhaustive: body.categoriesExhaustive === true,
    unit: asString(body.unit),
    thresholds: asStringArray(body.thresholds),
    thresholdDirection: body.thresholdDirection === "at_most" ? "at_most" : "at_least",
    condition: asString(body.condition),
    conditionResolutionCriteria: asString(body.conditionResolutionCriteria),
  }
}

function asString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 50) : []
}
