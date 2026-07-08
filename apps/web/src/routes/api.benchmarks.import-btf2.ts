import { createFileRoute } from "@tanstack/react-router";
import {
  createObjectStorageTargets,
  importBtf2FixedEvidenceSuite,
  jsonResponse,
  listBenchmarkSuites,
} from "@open-superforecaster/backend";
import { loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/benchmarks/import-btf2")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const config = loadAppConfig();
        const objectStorage = createObjectStorageTargets(config);
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          const maxRows = Number.isFinite(Number(body.maxRows)) ? Number(body.maxRows) : undefined;
          const offset = Number.isFinite(Number(body.offset)) ? Number(body.offset) : undefined;
          const result = await importBtf2FixedEvidenceSuite(db, {
            evalsDir: config.EVALS_DIR,
            maxRows,
            offset,
            objectStorage: objectStorage.evals,
          });
          return jsonResponse({
            ok: true,
            result,
            benchmarkSuites: await listBenchmarkSuites(db),
          });
        } catch (error) {
          return jsonResponse(
            {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 },
          );
        } finally {
          await sql.end();
        }
      },
    },
  },
});
