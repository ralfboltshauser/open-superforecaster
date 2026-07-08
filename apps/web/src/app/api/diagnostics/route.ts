import { buildDiagnosticsSnapshot } from "@open-superforecaster/backend";
import { errorJson, getServerContext } from "@/lib/server-db";

export async function GET() {
  const { config, db, root, sql } = getServerContext();
  try {
    const diagnostics = await buildDiagnosticsSnapshot(db, config, { root });
    return Response.json(diagnostics, { status: diagnostics.ok ? 200 : 503 });
  } catch (error) {
    return errorJson(error, 500);
  } finally {
    await sql.end();
  }
}
