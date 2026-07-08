import { createFileRoute } from "@tanstack/react-router";
import { createObjectStorageTargets, exportTraceBundle, jsonResponse } from "@open-superforecaster/backend";
import { findProjectRoot, loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/runs/$taskId/trace-bundle")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const config = loadAppConfig();
        const root = findProjectRoot(process.cwd());
        const objectStorage = createObjectStorageTargets(config);
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          const exported = await exportTraceBundle(db, {
            taskId: params.taskId,
            artifactsDir: config.ARTIFACTS_DIR,
            root,
            objectStorage: objectStorage.artifacts,
          });
          return jsonResponse(exported);
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
