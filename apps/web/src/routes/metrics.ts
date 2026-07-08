import { createFileRoute } from "@tanstack/react-router";
import { renderPrometheusMetrics } from "@open-superforecaster/backend";
import { findProjectRoot, loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/metrics")({
  server: {
    handlers: {
      GET: async () => {
        const config = loadAppConfig();
        const root = findProjectRoot(process.cwd());
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          return new Response(await renderPrometheusMetrics(db, { root }), {
            headers: {
              "content-type": "text/plain; version=0.0.4; charset=utf-8",
            },
          });
        } finally {
          await sql.end();
        }
      },
    },
  },
});
