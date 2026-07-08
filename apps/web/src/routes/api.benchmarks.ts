import { createFileRoute } from "@tanstack/react-router";
import {
  backfillBinaryForecastLedgers,
  createObjectStorageTargets,
  jsonResponse,
  listBenchmarkSuites,
  listBenchmarkRuns,
  reconcileBenchmarkRuns,
  reconcileRunningTasks,
  startBenchmarkRun,
} from "@open-superforecaster/backend";
import { findProjectRoot, loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/benchmarks")({
  server: {
    handlers: {
      GET: async () => {
        const config = loadAppConfig();
        const root = findProjectRoot(process.cwd());
        const objectStorage = createObjectStorageTargets(config);
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          await reconcileRunningTasks(db, root);
          await backfillBinaryForecastLedgers(db, root);
          await reconcileBenchmarkRuns(db, {
            artifactsDir: config.ARTIFACTS_DIR,
            root,
            objectStorage: objectStorage.artifacts,
          });
          return jsonResponse({
            benchmarkRuns: await listBenchmarkRuns(db),
            benchmarkSuites: await listBenchmarkSuites(db),
          });
        } finally {
          await sql.end();
        }
      },
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const config = loadAppConfig();
        const root = findProjectRoot(process.cwd());
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          const maxCases = Number.isFinite(Number(body.maxCases)) ? Number(body.maxCases) : 1;
          const benchmarkRun = await startBenchmarkRun(db, {
            root,
            maxCases,
            evalMode: typeof body.evalMode === "string" ? body.evalMode : undefined,
            rollouts: Number.isFinite(Number(body.rollouts)) ? Number(body.rollouts) : undefined,
            experimentLabel: typeof body.experimentLabel === "string" ? body.experimentLabel : "benchmark-smoke",
            suiteId: typeof body.suiteId === "string" ? body.suiteId : undefined,
          });
          return jsonResponse({ ok: true, benchmarkRun });
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
