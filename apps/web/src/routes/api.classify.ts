import { createFileRoute } from "@tanstack/react-router";
import { classifyRunRequest, jsonResponse } from "@open-superforecaster/backend";

export const Route = createFileRoute("/api/classify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const classification = classifyRunRequest({
          prompt: body.prompt,
          requestedMode: body.mode,
          forecastType: body.forecastType,
          workflow: body.workflow,
        });

        return jsonResponse({ ok: true, classification });
      },
    },
  },
});
