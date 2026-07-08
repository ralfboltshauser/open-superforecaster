import "server-only"

import {
  backfillBinaryForecastLedgers,
  backfillTableTaskRows,
  listRecentTasks,
  reconcileRunningTasks,
} from "@open-superforecaster/backend"

import { getServerContext } from "@/lib/server-db"
import type { JsonRecord } from "@/lib/records"

export async function listRecentRunsForServer(limit = 20): Promise<JsonRecord[]> {
  const { db, root, sql } = getServerContext()
  try {
    await reconcileRunningTasks(db, root)
    await backfillBinaryForecastLedgers(db, root)
    await backfillTableTaskRows(db)
    return serializeRecords(await listRecentTasks(db, limit))
  } finally {
    await sql.end()
  }
}

function serializeRecords(records: unknown[]): JsonRecord[] {
  return records.map((record) => serializeValue(record) as JsonRecord)
}

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map(serializeValue)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, serializeValue(nested)])
    )
  }

  return value
}
