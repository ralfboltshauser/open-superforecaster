import { createFileRoute } from "@tanstack/react-router";
import { jsonResponse, recordWorkflowPromotionDecision } from "@open-superforecaster/backend";
import { loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/benchmarks/$benchmarkRunId/promotion")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const body = await request.json().catch(() => ({}));
        const config = loadAppConfig();
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          const decision = await recordWorkflowPromotionDecision(db, {
            benchmarkRunId: params.benchmarkRunId,
            state: typeof body.state === "string" ? body.state : "candidate",
            decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : "",
            decidedBy: typeof body.decidedBy === "string" ? body.decidedBy : "local-user",
          });
          return jsonResponse({ ok: true, decision });
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
