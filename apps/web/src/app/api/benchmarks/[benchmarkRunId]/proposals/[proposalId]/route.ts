import { updateWorkflowChangeProposalStatus } from "@open-superforecaster/backend"

import { errorJson, getServerContext } from "@/lib/server-db"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ benchmarkRunId: string; proposalId: string }> },
) {
  const { benchmarkRunId, proposalId } = await params
  const body = await request.json().catch(() => ({}))
  const { db, sql } = getServerContext()
  try {
    const proposal = await updateWorkflowChangeProposalStatus(db, {
      benchmarkRunId,
      proposalId,
      status: typeof body.status === "string" ? body.status : "candidate",
      reviewNote: typeof body.reviewNote === "string" ? body.reviewNote : undefined,
      reviewedBy: typeof body.reviewedBy === "string" ? body.reviewedBy : "local-user",
      implementationTaskTitle: typeof body.implementationTaskTitle === "string" ? body.implementationTaskTitle : undefined,
      implementationStatus: typeof body.implementationStatus === "string" ? body.implementationStatus : undefined,
      implementationExperimentLabel: typeof body.implementationExperimentLabel === "string" ? body.implementationExperimentLabel : undefined,
      implementationNote: typeof body.implementationNote === "string" ? body.implementationNote : undefined,
    })
    return Response.json({ ok: true, proposal })
  } catch (error) {
    return errorJson(error, 400)
  } finally {
    await sql.end()
  }
}
