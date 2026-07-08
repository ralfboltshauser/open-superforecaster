import { buildHealthSnapshot, jsonResponse } from "@open-superforecaster/backend";
import { loadAppConfig } from "@open-superforecaster/config";

const config = loadAppConfig();

const server = Bun.serve({
  hostname: config.APP_HOST,
  port: config.WORKER_PORT,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health" || url.pathname === "/ready") {
      const health = await buildHealthSnapshot(config, { requireCodex: true });
      return jsonResponse(health, { status: health.ok ? 200 : 503 });
    }

    if (url.pathname === "/codex-auth") {
      const health = await buildHealthSnapshot(config, { requireCodex: true });
      return jsonResponse({
        ok: (health.checks.codexHome?.ok ?? false) && (health.checks.codexCli?.ok ?? false),
        codexHome: config.CODEX_HOME,
        codexCli: health.checks.codexCli?.detail ?? null,
        authMode: config.CODEX_AUTH_MODE,
        model: config.CODEX_MODEL,
      });
    }

    return jsonResponse({ ok: false, error: "not_found" }, { status: 404 });
  },
});

console.log(`open-superforecaster worker listening on http://${server.hostname}:${server.port}`);
