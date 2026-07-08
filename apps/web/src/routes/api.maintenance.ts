import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, listMaintenanceActions, listMaintenanceJobs, runMaintenanceJob } from "@open-superforecaster/backend";
import { findProjectRoot, loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/maintenance")({
  server: {
    handlers: {
      GET: async () => {
        const config = loadAppConfig();
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          return jsonResponse({
            actions: listMaintenanceActions(),
            jobs: await listMaintenanceJobs(db),
          });
        } finally {
          await sql.end();
        }
      },
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const action = typeof body.action === "string" ? body.action : "";
        const config = loadAppConfig();
        const root = findProjectRoot(process.cwd());
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          const job = await runMaintenanceJob(db, { root, action });
          return jsonResponse({ ok: job.status === "completed", job }, { status: job.status === "completed" ? 200 : 500 });
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
