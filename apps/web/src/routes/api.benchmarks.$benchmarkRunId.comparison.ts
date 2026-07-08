import { createFileRoute } from "@tanstack/react-router";
import { createBenchmarkComparisonReport, jsonResponse } from "@open-superforecaster/backend";
import { loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/benchmarks/$benchmarkRunId/comparison")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const body = await request.json().catch(() => ({}));
        const config = loadAppConfig();
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          const baselineBenchmarkRunIds = Array.isArray(body.baselineBenchmarkRunIds)
            ? body.baselineBenchmarkRunIds.filter((id: unknown): id is string => typeof id === "string")
            : undefined;
          const comparison = await createBenchmarkComparisonReport(db, {
            benchmarkRunId: params.benchmarkRunId,
            baselineBenchmarkRunIds,
          });
          return jsonResponse({ ok: true, comparison });
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
