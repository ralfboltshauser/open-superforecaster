import { findProjectRoot, loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export function getServerContext() {
  const config = loadAppConfig();
  const root = findProjectRoot(process.cwd());
  const { db, sql } = createDb(config.DATABASE_URL);
  return { config, db, root, sql };
}

export function errorJson(error: unknown, status = 500) {
  return Response.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    },
    { status },
  );
}
