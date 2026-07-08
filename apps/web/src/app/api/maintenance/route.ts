import { listMaintenanceActions, listMaintenanceJobs, runMaintenanceJob } from "@open-superforecaster/backend"

import { errorJson, getServerContext } from "@/lib/server-db"

export async function GET() {
  const { db, sql } = getServerContext()
  try {
    return Response.json({
      actions: listMaintenanceActions(),
      jobs: await listMaintenanceJobs(db),
    })
  } finally {
    await sql.end()
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const action = typeof body.action === "string" ? body.action : ""
  const { db, root, sql } = getServerContext()
  try {
    const job = await runMaintenanceJob(db, { root, action })
    return Response.json({ ok: job.status === "completed", job }, { status: job.status === "completed" ? 200 : 500 })
  } catch (error) {
    return errorJson(error, 400)
  } finally {
    await sql.end()
  }
}
