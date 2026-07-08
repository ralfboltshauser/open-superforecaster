import { createFileRoute } from "@tanstack/react-router";
import { createObjectStorageTargets, exportArtifactRowsParquet, jsonResponse, tryPutArtifactObject } from "@open-superforecaster/backend";
import { loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/artifacts/$artifactId/parquet")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const config = loadAppConfig();
        const objectStorage = createObjectStorageTargets(config);
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          const exported = await exportArtifactRowsParquet(db, params.artifactId);
          const objectUpload = await tryPutArtifactObject(objectStorage.artifacts, {
            artifactId: exported.artifact.id,
            fileName: "rows.parquet",
            body: exported.parquet,
            contentType: "application/vnd.apache.parquet",
          });
          return new Response(exported.parquet, {
            headers: {
              "content-type": "application/vnd.apache.parquet",
              "content-disposition": `attachment; filename="${exported.filename}"`,
              "x-artifact-row-count": String(exported.rowCount),
              "x-object-storage-uri": objectUpload.storageUri ?? "",
              "x-object-storage-error": objectUpload.error ?? "",
            },
          });
        } catch (error) {
          return jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            },
            { status: 404 },
          );
        } finally {
          await sql.end();
        }
      },
    },
  },
});
