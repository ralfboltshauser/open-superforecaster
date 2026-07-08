import { recordWorkflowPromotionDecision } from "@open-superforecaster/backend"

import { errorJson, getServerContext } from "@/lib/server-db"

export async function POST(request: Request, { params }: { params: Promise<{ benchmarkRunId: string }> }) {
  const { benchmarkRunId } = await params
  const body = await request.json().catch(() => ({}))
  const { db, sql } = getServerContext()
  try {
    const decision = await recordWorkflowPromotionDecision(db, {
      benchmarkRunId,
      state: typeof body.state === "string" ? body.state : "candidate",
      decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : "",
      decidedBy: typeof body.decidedBy === "string" ? body.decidedBy : "local-user",
    })
    return Response.json({ ok: true, decision })
  } catch (error) {
    return errorJson(error, 400)
  } finally {
    await sql.end()
  }
}
