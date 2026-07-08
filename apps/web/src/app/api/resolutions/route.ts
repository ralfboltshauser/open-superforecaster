import {
  backfillBinaryForecastLedgers,
  getResolutionDashboard,
  resolveForecastTask,
} from "@open-superforecaster/backend"

import { errorJson, getServerContext } from "@/lib/server-db"
import { isRecord } from "@/lib/records"

export async function GET() {
  const { db, root, sql } = getServerContext()
  try {
    await backfillBinaryForecastLedgers(db, root)
    return Response.json(await getResolutionDashboard(db))
  } finally {
    await sql.end()
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const taskId = typeof body.taskId === "string" ? body.taskId : ""
  const resolvedValue = extractResolvedValue(body)
  if (!taskId || !resolvedValue) {
    return Response.json({ ok: false, error: "Expected taskId and a resolution value." }, { status: 400 })
  }

  const { db, root, sql } = getServerContext()
  try {
    await backfillBinaryForecastLedgers(db, root)
    const result = await resolveForecastTask(db, {
      taskId,
      resolvedValue,
      resolutionSource: typeof body.resolutionSource === "string" ? body.resolutionSource : "manual",
      resolutionExplanation: typeof body.resolutionExplanation === "string" ? body.resolutionExplanation : undefined,
      forceNew: body.forceNew === true,
    })
    return Response.json({
      ok: true,
      result,
      dashboard: await getResolutionDashboard(db),
    })
  } catch (error) {
    return errorJson(error, 400)
  } finally {
    await sql.end()
  }
}

function extractResolvedValue(body: Record<string, unknown>) {
  if (isRecord(body.resolvedValue)) {
    return body.resolvedValue
  }
  const resolvedValue: Record<string, unknown> = {}
  if (typeof body.resolved === "boolean") {
    resolvedValue.resolved = body.resolved
  }
  if (typeof body.value === "number" && Number.isFinite(body.value)) {
    resolvedValue.value = body.value
  }
  if (typeof body.value === "string" && Number.isFinite(Number(body.value))) {
    resolvedValue.value = Number(body.value)
  }
  if (typeof body.date === "string" && body.date.trim()) {
    resolvedValue.date = body.date.trim()
  }
  if (typeof body.category === "string" && body.category.trim()) {
    resolvedValue.category = body.category.trim()
  }
  if (typeof body.conditionResolved === "boolean") {
    resolvedValue.conditionResolved = body.conditionResolved
  }
  if (typeof body.outcomeResolved === "boolean") {
    resolvedValue.outcomeResolved = body.outcomeResolved
  }
  return Object.keys(resolvedValue).length ? resolvedValue : null
}
