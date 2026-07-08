import {
  backfillBinaryForecastLedgers,
  createObjectStorageTargets,
  getBenchmarkRunDetail,
  reconcileBenchmarkRuns,
  reconcileRunningTasks,
} from "@open-superforecaster/backend"

import { errorJson, getServerContext } from "@/lib/server-db"

export async function GET(_: Request, { params }: { params: Promise<{ benchmarkRunId: string }> }) {
  const { benchmarkRunId } = await params
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
    return Response.json({ benchmarkRun: await getBenchmarkRunDetail(db, benchmarkRunId) })
  } catch (error) {
    return errorJson(error, 404)
  } finally {
    await sql.end()
  }
}
