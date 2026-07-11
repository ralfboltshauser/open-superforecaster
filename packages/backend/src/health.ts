import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";
import {
  agentAuthPath,
  formatAgentRef,
  loadAgentPolicy,
  type AgentProviderId,
  type AgentRef,
  type AppConfig,
  loadAppConfig,
  redactConfig,
} from "@open-superforecaster/config";
import { type HealthSnapshot } from "@open-superforecaster/workflow-contracts";

export async function buildHealthSnapshot(
  config: AppConfig = loadAppConfig(),
  options: { requireCodex?: boolean } = {},
): Promise<HealthSnapshot> {
  const requireCodex = options.requireCodex ?? false;
  const codexHomeExists = existsSync(config.CODEX_HOME);
  const codexCliPath = findExecutable("codex");
  const agentPolicy = loadAgentPolicy(process.env, process.cwd());
  const selectedAgentRefs = uniqueAgentRefs([
    agentPolicy.defaultRef,
    ...Object.values(agentPolicy.purposes).flat(),
    ...Object.values(agentPolicy.roleOverrides).flat(),
  ]);
  const agentChecks = Object.fromEntries(
    selectedAgentRefs.flatMap((ref) => {
      const binary = providerBinary(ref.provider);
      const binaryPath = findExecutable(binary);
      const authPath = resolveProviderAuthPath(config, agentPolicy, ref);
      return [
        [
          `agent_${ref.provider}_${ref.profile}_binary`,
          {
            ok: Boolean(binaryPath),
            label: `${formatAgentRef(ref)} CLI is available`,
            detail: binaryPath ?? `${binary} not found on PATH`,
          },
        ],
        [
          `agent_${ref.provider}_${ref.profile}_auth`,
          {
            ok: existsSync(authPath),
            label: `${formatAgentRef(ref)} auth profile exists`,
            detail: authPath,
          },
        ],
      ];
    }),
  );
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
    agentPolicy: {
      ok: selectedAgentRefs.length > 0,
      label: "Agent provider policy parsed",
      detail: JSON.stringify({
        default: formatAgentRef(agentPolicy.defaultRef),
        structured: agentPolicy.purposes.structured.map(formatAgentRef),
        research: agentPolicy.purposes.research.map(formatAgentRef),
        forecast: agentPolicy.purposes.forecast.map(formatAgentRef),
        critic: agentPolicy.purposes.critic.map(formatAgentRef),
        allowNativeWeb: agentPolicy.allowNativeWeb,
        authRoot: agentPolicy.authRoot,
      }),
    },
    ...agentChecks,
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

function uniqueAgentRefs(refs: AgentRef[]) {
  const seen = new Set<string>();
  const unique: AgentRef[] = [];
  for (const ref of refs) {
    const key = formatAgentRef(ref);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(ref);
    }
  }
  return unique;
}

function providerBinary(provider: AgentProviderId) {
  const binaries: Record<AgentProviderId, string> = {
    amp: "amp",
    antigravity: "agy",
    claude: "claude",
    codex: "codex",
    forge: "forge",
    gemini: "gemini",
    hermes: "hermes",
    kimi: "kimi",
    opencode: "opencode",
    openclaw: "openclaw",
    pi: "pi",
    vibe: "vibe",
  };
  return binaries[provider];
}

export function resolveProviderAuthPath(config: AppConfig, policy: ReturnType<typeof loadAgentPolicy>, ref: AgentRef) {
  if (ref.provider === "codex") {
    return config.CODEX_HOME;
  }
  if (ref.provider === "claude" && config.CLAUDE_CONFIG_DIR) {
    return config.CLAUDE_CONFIG_DIR;
  }
  if (ref.provider === "kimi" && config.KIMI_SHARE_DIR) {
    return config.KIMI_SHARE_DIR;
  }
  return agentAuthPath(policy, ref);
}
