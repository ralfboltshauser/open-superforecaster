import { renderPrometheusMetrics } from "@open-superforecaster/backend";
import { errorJson, getServerContext } from "@/lib/server-db";

export async function GET() {
  const { db, root, sql } = getServerContext();
  try {
    const metrics = await renderPrometheusMetrics(db, { root });
    return new Response(metrics, {
      headers: {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
      },
    });
  } catch (error) {
    return errorJson(error, 500);
  } finally {
    await sql.end();
  }
}
