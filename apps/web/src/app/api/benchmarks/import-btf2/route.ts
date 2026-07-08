import {
  createObjectStorageTargets,
  importBtf2FixedEvidenceSuite,
  listBenchmarkSuites,
} from "@open-superforecaster/backend"

import { errorJson, getServerContext } from "@/lib/server-db"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { config, db, sql } = getServerContext()
  const objectStorage = createObjectStorageTargets(config)
  try {
    const maxRows = Number.isFinite(Number(body.maxRows)) ? Number(body.maxRows) : undefined
    const offset = Number.isFinite(Number(body.offset)) ? Number(body.offset) : undefined
    const result = await importBtf2FixedEvidenceSuite(db, {
      evalsDir: config.EVALS_DIR,
      maxRows,
      offset,
      objectStorage: objectStorage.evals,
    })
    return Response.json({
      ok: true,
      result,
      benchmarkSuites: await listBenchmarkSuites(db),
    })
  } catch (error) {
    return errorJson(error)
  } finally {
    await sql.end()
  }
}
