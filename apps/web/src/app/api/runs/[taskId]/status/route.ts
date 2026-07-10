import {
  backfillBinaryForecastLedgers,
  getRunStatus,
  reconcileRunningTasks,
} from "@open-superforecaster/backend";

import { errorJson, getServerContext } from "@/lib/server-db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const { db, root, sql } = getServerContext();
  try {
    await reconcileRunningTasks(db, root);
    await backfillBinaryForecastLedgers(db, root);
    return Response.json({ status: await getRunStatus(db, taskId) });
  } catch (error) {
    return errorJson(error, 404);
  } finally {
    await sql.end();
  }
}
