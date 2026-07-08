import { buildHealthSnapshot } from "@open-superforecaster/backend";
import { loadAppConfig } from "@open-superforecaster/config";

export async function GET() {
  const health = await buildHealthSnapshot(loadAppConfig());
  return Response.json(health, { status: health.ok ? 200 : 503 });
}
