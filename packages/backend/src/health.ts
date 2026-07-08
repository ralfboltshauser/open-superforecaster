import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { type AppConfig, loadAppConfig, redactConfig } from "@open-superforecaster/config";
import { type HealthSnapshot } from "@open-superforecaster/workflow-contracts";

export async function buildHealthSnapshot(
  config: AppConfig = loadAppConfig(),
  options: { requireCodex?: boolean } = {},
): Promise<HealthSnapshot> {
  const requireCodex = options.requireCodex ?? false;
  const codexHomeExists = existsSync(config.CODEX_HOME);
  const codexCliPath = findExecutable("codex");
  const checks = {
    config: {
      ok: true,
      label: "Configuration parsed",
      detail: JSON.stringify(redactConfig(config)),
    },
    codexHome: {
      ok: requireCodex ? codexHomeExists : true,
      label: requireCodex ? "Codex auth directory is mounted" : "Codex auth directory visible to this process",
      detail: codexHomeExists ? config.CODEX_HOME : `${config.CODEX_HOME} (not visible here${requireCodex ? "" : ", optional for app"})`,
    },
    codexCli: {
      ok: requireCodex ? Boolean(codexCliPath) : true,
      label: requireCodex ? "Codex CLI is available" : "Codex CLI visible to this process",
      detail: codexCliPath ?? `not found on PATH${requireCodex ? "" : " (optional for app)"}`,
    },
    smithersState: {
      ok: existsSync(config.SMITHERS_STATE_DIR),
      label: "Smithers state directory exists",
      detail: config.SMITHERS_STATE_DIR,
    },
    duckdbDirectory: {
      ok: existsSync(dirname(config.DUCKDB_PATH)),
      label: "DuckDB directory exists",
      detail: dirname(config.DUCKDB_PATH),
    },
    artifactsDirectory: {
      ok: existsSync(config.ARTIFACTS_DIR),
      label: "Artifacts directory exists",
      detail: config.ARTIFACTS_DIR,
    },
    postgresConfigured: {
      ok: config.DATABASE_URL.startsWith("postgres://") || config.DATABASE_URL.startsWith("postgresql://"),
      label: "Postgres URL configured",
    },
    minioConfigured: {
      ok: config.MINIO_ENDPOINT.length > 0,
      label: "MinIO endpoint configured",
      detail: config.MINIO_ENDPOINT,
    },
    objectStorageBucketsConfigured: {
      ok: [config.MINIO_BUCKET_ARTIFACTS, config.MINIO_BUCKET_EVALS, config.MINIO_BUCKET_EXPORTS].every((bucket) => bucket.length > 0),
      label: "Object storage bucket names configured",
      detail: JSON.stringify({
        artifacts: config.MINIO_BUCKET_ARTIFACTS,
        evals: config.MINIO_BUCKET_EVALS,
        exports: config.MINIO_BUCKET_EXPORTS,
      }),
    },
  };

  return {
    ok: Object.values(checks).every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    service: "open-superforecaster",
    checks,
  };
}

function findExecutable(name: string) {
  try {
    return execFileSync("sh", ["-lc", `command -v ${name}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
