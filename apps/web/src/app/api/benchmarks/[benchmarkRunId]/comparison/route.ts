import { createBenchmarkComparisonReport } from "@open-superforecaster/backend"

import { errorJson, getServerContext } from "@/lib/server-db"

export async function POST(request: Request, { params }: { params: Promise<{ benchmarkRunId: string }> }) {
  const { benchmarkRunId } = await params
  const body = await request.json().catch(() => ({}))
  const { db, sql } = getServerContext()
  try {
    const baselineBenchmarkRunIds = Array.isArray(body.baselineBenchmarkRunIds)
      ? body.baselineBenchmarkRunIds.filter((id: unknown): id is string => typeof id === "string")
      : undefined
    const comparison = await createBenchmarkComparisonReport(db, {
      benchmarkRunId,
      baselineBenchmarkRunIds,
    })
    return Response.json({ ok: true, comparison })
  } catch (error) {
    return errorJson(error, 400)
  } finally {
    await sql.end()
  }
}
