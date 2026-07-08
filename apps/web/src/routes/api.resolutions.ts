import { createFileRoute } from "@tanstack/react-router";
import {
  backfillBinaryForecastLedgers,
  getResolutionDashboard,
  jsonResponse,
  resolveForecastTask,
} from "@open-superforecaster/backend";
import { findProjectRoot, loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/resolutions")({
  server: {
    handlers: {
      GET: async () => {
        const config = loadAppConfig();
        const root = findProjectRoot(process.cwd());
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          await backfillBinaryForecastLedgers(db, root);
          return jsonResponse(await getResolutionDashboard(db));
        } finally {
          await sql.end();
        }
      },
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const taskId = typeof body.taskId === "string" ? body.taskId : "";
        const resolvedValue = extractResolvedValue(body);
        if (!taskId || !resolvedValue) {
          return jsonResponse({ ok: false, error: "Expected taskId and a resolution value." }, { status: 400 });
        }

        const config = loadAppConfig();
        const root = findProjectRoot(process.cwd());
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          await backfillBinaryForecastLedgers(db, root);
          const result = await resolveForecastTask(db, {
            taskId,
            resolvedValue,
            resolutionSource: typeof body.resolutionSource === "string" ? body.resolutionSource : "manual",
            resolutionExplanation:
              typeof body.resolutionExplanation === "string" ? body.resolutionExplanation : undefined,
            forceNew: body.forceNew === true,
          });
          return jsonResponse({
            ok: true,
            result,
            dashboard: await getResolutionDashboard(db),
          });
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

function extractResolvedValue(body: Record<string, unknown>) {
  if (isRecord(body.resolvedValue)) {
    return body.resolvedValue;
  }
  const resolvedValue: Record<string, unknown> = {};
  if (typeof body.resolved === "boolean") {
    resolvedValue.resolved = body.resolved;
  }
  if (typeof body.value === "number" && Number.isFinite(body.value)) {
    resolvedValue.value = body.value;
  }
  if (typeof body.value === "string" && Number.isFinite(Number(body.value))) {
    resolvedValue.value = Number(body.value);
  }
  if (typeof body.date === "string" && body.date.trim()) {
    resolvedValue.date = body.date.trim();
  }
  if (typeof body.category === "string" && body.category.trim()) {
    resolvedValue.category = body.category.trim();
  }
  if (typeof body.conditionResolved === "boolean") {
    resolvedValue.conditionResolved = body.conditionResolved;
  }
  if (typeof body.outcomeResolved === "boolean") {
    resolvedValue.outcomeResolved = body.outcomeResolved;
  }
  return Object.keys(resolvedValue).length ? resolvedValue : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
