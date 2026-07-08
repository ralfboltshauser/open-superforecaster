import { createFileRoute } from "@tanstack/react-router";
import {
  backfillBinaryForecastLedgers,
  createObjectStorageTargets,
  getBenchmarkRunDetail,
  jsonResponse,
  reconcileBenchmarkRuns,
  reconcileRunningTasks,
} from "@open-superforecaster/backend";
import { findProjectRoot, loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/benchmarks/$benchmarkRunId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
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
            benchmarkRun: await getBenchmarkRunDetail(db, params.benchmarkRunId),
          });
        } catch (error) {
          return jsonResponse(
            {
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
