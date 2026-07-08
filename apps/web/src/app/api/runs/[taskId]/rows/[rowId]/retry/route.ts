import { retryTableTaskRow } from "@open-superforecaster/backend";
import { errorJson, getServerContext } from "@/lib/server-db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string; rowId: string }> },
) {
  const { taskId, rowId } = await params;
  const { db, root, sql } = getServerContext();
  try {
    const retry = await retryTableTaskRow(db, root, {
      taskId,
      taskRowId: rowId,
    });
    return Response.json({ ok: true, retry });
  } catch (error) {
    return errorJson(error, 400);
  } finally {
    await sql.end();
  }
}
