import { createFileRoute } from "@tanstack/react-router";
import { buildHealthSnapshot, jsonResponse } from "@open-superforecaster/backend";
import { loadAppConfig } from "@open-superforecaster/config";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const health = await buildHealthSnapshot(loadAppConfig());
        return jsonResponse(health, { status: health.ok ? 200 : 503 });
      },
    },
  },
});
