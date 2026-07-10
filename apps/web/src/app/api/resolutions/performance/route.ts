import {
  backfillBinaryForecastLedgers,
  getForecastPerformanceReport,
} from "@open-superforecaster/backend"

import { getServerContext } from "@/lib/server-db"

export async function GET() {
  const { db, root, sql } = getServerContext()
  try {
    await backfillBinaryForecastLedgers(db, root)
    return Response.json(await getForecastPerformanceReport(db))
  } finally {
    await sql.end()
  }
}
