import { startWorkflowChangeProposalValidation } from "@open-superforecaster/backend"

import { errorJson, getServerContext } from "@/lib/server-db"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ benchmarkRunId: string; proposalId: string }> },
) {
  const { benchmarkRunId, proposalId } = await params
  const body = await request.json().catch(() => ({}))
  const { db, root, sql } = getServerContext()
  try {
    const result = await startWorkflowChangeProposalValidation(db, {
      root,
      benchmarkRunId,
      proposalId,
      launchedBy: typeof body.launchedBy === "string" ? body.launchedBy : "local-user",
      maxCases: Number.isFinite(Number(body.maxCases)) ? Number(body.maxCases) : 1,
      rollouts: Number.isFinite(Number(body.rollouts)) ? Number(body.rollouts) : undefined,
    })
    return Response.json({ ok: true, ...result })
  } catch (error) {
    return errorJson(error, 400)
  } finally {
    await sql.end()
  }
}
