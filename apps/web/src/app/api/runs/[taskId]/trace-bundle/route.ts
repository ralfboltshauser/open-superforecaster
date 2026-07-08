import { createObjectStorageTargets, exportTraceBundle } from "@open-superforecaster/backend";
import { errorJson, getServerContext } from "@/lib/server-db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const { config, db, root, sql } = getServerContext();
  const objectStorage = createObjectStorageTargets(config);
  try {
    const exported = await exportTraceBundle(db, {
      taskId,
      artifactsDir: config.ARTIFACTS_DIR,
      root,
      objectStorage: objectStorage.artifacts,
    });
    return Response.json(exported);
  } catch (error) {
    return errorJson(error, 404);
  } finally {
    await sql.end();
  }
}
