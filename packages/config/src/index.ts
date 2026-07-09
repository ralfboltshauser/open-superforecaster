import { z } from "zod";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
export {
  agentAuthPath,
  agentProviderIds,
  formatAgentRef,
  loadAgentPolicy,
  normalizeRoleKey,
  parseAgentRef,
  parseAgentRefList,
  selectAgentRef,
  type AgentPolicy,
  type AgentProviderId,
  type AgentPurpose,
  type AgentRef,
} from "./agents";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_HOST: z.string().default("0.0.0.0"),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  WORKER_PORT: z.coerce.number().int().positive().default(3010),
  DATABASE_URL: z.string().min(1).default("postgres://open_superforecaster:open_superforecaster@localhost:5432/open_superforecaster"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  MINIO_ENDPOINT: z.string().min(1).default("http://localhost:9000"),
  MINIO_ACCESS_KEY: z.string().min(1).default("open_superforecaster"),
  MINIO_SECRET_KEY: z.string().min(1).default("open-superforecaster-local-dev"),
  MINIO_REGION: z.string().min(1).default("local"),
  MINIO_BUCKET_ARTIFACTS: z.string().min(1).default("open-superforecaster-artifacts"),
  MINIO_BUCKET_EVALS: z.string().min(1).default("open-superforecaster-evals"),
  MINIO_BUCKET_EXPORTS: z.string().min(1).default("open-superforecaster-exports"),
  DUCKDB_PATH: z.string().min(1).default("./data/duckdb/open-superforecaster.duckdb"),
  ARTIFACTS_DIR: z.string().min(1).default("./data/artifacts"),
  EXPORTS_DIR: z.string().min(1).default("./data/exports"),
  EVALS_DIR: z.string().min(1).default("./data/evals"),
  SMITHERS_STATE_DIR: z.string().min(1).default("./data/smithers"),
  AGENT_AUTH_ROOT: z.string().min(1).default("./data/agent-auth"),
  AGENT_DEFAULT: z.string().min(1).default("codex:default"),
  AGENT_STRUCTURED: z.string().min(1).default("codex:default"),
  AGENT_RESEARCH: z.string().min(1).default("codex:default"),
  AGENT_FORECAST: z.string().min(1).default("codex:default"),
  AGENT_CRITIC: z.string().min(1).default("codex:default"),
  AGENT_ALLOW_NATIVE_WEB: z.enum(["true", "false"]).default("false"),
  CODEX_HOME: z.string().min(1).default(`${process.env.HOME ?? "/home/bun"}/.codex`),
  CODEX_MODEL: z.string().min(1).default("gpt-5.5"),
  CODEX_AUTH_MODE: z.enum(["mount", "copy"]).default("mount"),
  CLAUDE_CONFIG_DIR: z.string().optional(),
  CLAUDE_MODEL: z.string().optional(),
  KIMI_SHARE_DIR: z.string().optional(),
  KIMI_MODEL: z.string().optional(),
  PI_PROVIDER: z.string().optional(),
  PI_MODEL: z.string().optional(),
  PI_API_KEY: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().min(1).default("http://localhost:4318"),
  OTEL_SERVICE_NAME: z.string().min(1).default("open-superforecaster"),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const root = env.OPEN_SUPERFORECASTER_ROOT ?? findProjectRoot(process.cwd());

  return {
    ...parsed,
    DUCKDB_PATH: resolveProjectPath(root, parsed.DUCKDB_PATH),
    ARTIFACTS_DIR: resolveProjectPath(root, parsed.ARTIFACTS_DIR),
    EXPORTS_DIR: resolveProjectPath(root, parsed.EXPORTS_DIR),
    EVALS_DIR: resolveProjectPath(root, parsed.EVALS_DIR),
    SMITHERS_STATE_DIR: resolveProjectPath(root, parsed.SMITHERS_STATE_DIR),
    AGENT_AUTH_ROOT: resolveProjectPath(root, parsed.AGENT_AUTH_ROOT),
  };
}

export function redactConfig(config: AppConfig) {
  return {
    ...config,
    DATABASE_URL: redactUrl(config.DATABASE_URL),
    MINIO_SECRET_KEY: config.MINIO_SECRET_KEY ? "[redacted]" : "",
    PI_API_KEY: config.PI_API_KEY ? "[redacted]" : "",
  };
}

function redactUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = "redacted";
    }
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

function resolveProjectPath(root: string, value: string) {
  return isAbsolute(value) ? value : resolve(root, value);
}

export function findProjectRoot(start: string) {
  let current = resolve(start);

  while (true) {
    if (
      existsSync(resolve(current, "package.json")) &&
      (current.endsWith("open-superforecaster") || existsSync(resolve(current, "docker-compose.yml")))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return resolve(start);
    }
    current = parent;
  }
}
