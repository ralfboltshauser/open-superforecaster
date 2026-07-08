import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, retryTableTaskRow } from "@open-superforecaster/backend";
import { findProjectRoot, loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/runs/$taskId/rows/$rowId/retry")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        const config = loadAppConfig();
        const root = findProjectRoot(process.cwd());
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          const retry = await retryTableTaskRow(db, root, {
            taskId: params.taskId,
            taskRowId: params.rowId,
          });
          return jsonResponse({ ok: true, retry });
        } catch (error) {
          return jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            },
            { status: 400 },
          );
        } finally {
          await sql.end();
        }
      },
    },
  },
});
