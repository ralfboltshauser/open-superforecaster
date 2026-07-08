import { createFileRoute } from "@tanstack/react-router";
import { backfillBinaryForecastLedgers, getTaskDetail, jsonResponse, reconcileRunningTasks } from "@open-superforecaster/backend";
import { findProjectRoot, loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/runs/$taskId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const config = loadAppConfig();
        const root = findProjectRoot(process.cwd());
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          await reconcileRunningTasks(db, root);
          await backfillBinaryForecastLedgers(db, root);
          return jsonResponse({ run: await getTaskDetail(db, params.taskId) });
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
