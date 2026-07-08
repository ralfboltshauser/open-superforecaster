import {
  backfillBinaryForecastLedgers,
  createObjectStorageTargets,
  listBenchmarkRuns,
  listBenchmarkSuites,
  reconcileBenchmarkRuns,
  reconcileRunningTasks,
  startBenchmarkRun,
} from "@open-superforecaster/backend"

import { errorJson, getServerContext } from "@/lib/server-db"

export async function GET() {
  const { config, db, root, sql } = getServerContext()
  const objectStorage = createObjectStorageTargets(config)
  try {
    await reconcileRunningTasks(db, root)
    await backfillBinaryForecastLedgers(db, root)
    await reconcileBenchmarkRuns(db, {
      artifactsDir: config.ARTIFACTS_DIR,
      root,
      objectStorage: objectStorage.artifacts,
    })
    return Response.json({
      benchmarkRuns: await listBenchmarkRuns(db),
      benchmarkSuites: await listBenchmarkSuites(db),
    })
  } finally {
    await sql.end()
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { db, root, sql } = getServerContext()
  try {
    const maxCases = Number.isFinite(Number(body.maxCases)) ? Number(body.maxCases) : 1
    const benchmarkRun = await startBenchmarkRun(db, {
      root,
      maxCases,
      evalMode: typeof body.evalMode === "string" ? body.evalMode : undefined,
      rollouts: Number.isFinite(Number(body.rollouts)) ? Number(body.rollouts) : undefined,
      experimentLabel: typeof body.experimentLabel === "string" ? body.experimentLabel : "benchmark-smoke",
      suiteId: typeof body.suiteId === "string" ? body.suiteId : undefined,
    })
    return Response.json({ ok: true, benchmarkRun })
  } catch (error) {
    return errorJson(error)
  } finally {
    await sql.end()
  }
}
