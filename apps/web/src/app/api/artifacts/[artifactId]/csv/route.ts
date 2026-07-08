import {
  createObjectStorageTargets,
  exportArtifactRowsCsv,
  tryPutArtifactObject,
} from "@open-superforecaster/backend";
import { errorJson, getServerContext } from "@/lib/server-db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  const { artifactId } = await params;
  const { config, db, sql } = getServerContext();
  const objectStorage = createObjectStorageTargets(config);
  try {
    const exported = await exportArtifactRowsCsv(db, artifactId);
    const objectUpload = await tryPutArtifactObject(objectStorage.artifacts, {
      artifactId: exported.artifact.id,
      fileName: "rows.csv",
      body: exported.csv,
      contentType: "text/csv; charset=utf-8",
    });
    return new Response(exported.csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${exported.filename}"`,
        "x-artifact-row-count": String(exported.rowCount),
        "x-object-storage-uri": objectUpload.storageUri ?? "",
        "x-object-storage-error": objectUpload.error ?? "",
      },
    });
  } catch (error) {
    return errorJson(error, 404);
  } finally {
    await sql.end();
  }
}
