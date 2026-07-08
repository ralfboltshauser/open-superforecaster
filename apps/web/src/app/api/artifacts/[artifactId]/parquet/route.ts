import {
  createObjectStorageTargets,
  exportArtifactRowsParquet,
  tryPutArtifactObject,
} from "@open-superforecaster/backend"

import { errorJson, getServerContext } from "@/lib/server-db"

export async function GET(_: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params
  const { config, db, sql } = getServerContext()
  const objectStorage = createObjectStorageTargets(config)
  try {
    const exported = await exportArtifactRowsParquet(db, artifactId)
    const objectUpload = await tryPutArtifactObject(objectStorage.artifacts, {
      artifactId: exported.artifact.id,
      fileName: "rows.parquet",
      body: exported.parquet,
      contentType: "application/vnd.apache.parquet",
    })
    return new Response(exported.parquet, {
      headers: {
        "content-type": "application/vnd.apache.parquet",
        "content-disposition": `attachment; filename="${exported.filename}"`,
        "x-artifact-row-count": String(exported.rowCount),
        "x-object-storage-uri": objectUpload.storageUri ?? "",
        "x-object-storage-error": objectUpload.error ?? "",
      },
    })
  } catch (error) {
    return errorJson(error, 404)
  } finally {
    await sql.end()
  }
}
