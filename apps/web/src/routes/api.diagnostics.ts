import { createFileRoute } from "@tanstack/react-router";
import { buildDiagnosticsSnapshot, jsonResponse } from "@open-superforecaster/backend";
import { findProjectRoot, loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/diagnostics")({
  server: {
    handlers: {
      GET: async () => {
        const config = loadAppConfig();
        const root = findProjectRoot(process.cwd());
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          const diagnostics = await buildDiagnosticsSnapshot(db, config, { root });
          return jsonResponse(diagnostics, { status: diagnostics.ok ? 200 : 503 });
        } finally {
          await sql.end();
        }
      },
    },
  },
});
