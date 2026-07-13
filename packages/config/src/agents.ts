import { isAbsolute, resolve } from "node:path";

export const agentProviderIds = [
  "amp",
  "antigravity",
  "claude",
  "codex",
  "forge",
  "gemini",
  "hermes",
  "kimi",
  "opencode",
  "openclaw",
  "pi",
  "vibe",
] as const;

export type AgentProviderId = (typeof agentProviderIds)[number];
export type AgentPurpose = "structured" | "research" | "forecast" | "critic";

export type AgentRef = {
  provider: AgentProviderId;
  profile: string;
};

export type AgentPolicy = {
  authRoot: string;
  defaultRef: AgentRef;
  allowNativeWeb: boolean;
  purposes: Record<AgentPurpose, AgentRef[]>;
  roleOverrides: Record<string, AgentRef[]>;
};

const agentProviderSet = new Set<string>(agentProviderIds);
const purposeEnv: Record<AgentPurpose, string> = {
  structured: "AGENT_STRUCTURED",
  research: "AGENT_RESEARCH",
  forecast: "AGENT_FORECAST",
  critic: "AGENT_CRITIC",
};

export function loadAgentPolicy(env: NodeJS.ProcessEnv = process.env, root = process.cwd()): AgentPolicy {
  const authRoot = resolveMaybeRelative(root, env.AGENT_AUTH_ROOT ?? env.AGENT_AUTH_CONTAINER_ROOT ?? "./data/agent-auth");
  const legacyDefault = legacyEngineRef(env.AGENT_ENGINE);
  const defaultRef = parseAgentRef(env.AGENT_DEFAULT ?? legacyDefault ?? "codex:default", "AGENT_DEFAULT");
  const purposes = Object.fromEntries(
    Object.entries(purposeEnv).map(([purpose, envName]) => [
      purpose,
      parseAgentRefList(env[envName] ?? formatAgentRef(defaultRef), envName),
    ]),
  ) as Record<AgentPurpose, AgentRef[]>;

  return {
    authRoot,
    defaultRef,
    allowNativeWeb: env.AGENT_ALLOW_NATIVE_WEB === "true" ||
      (env.AGENT_ALLOW_NATIVE_WEB === undefined && env.CLAUDE_WEB_SEARCH === "on"),
    purposes,
    roleOverrides: parseRoleOverrides(env),
  };
}

function legacyEngineRef(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "claude" || normalized === "claude-code" || normalized === "anthropic") {
    return "claude:default";
  }
  if (normalized === "codex") {
    return "codex:default";
  }
  return undefined;
}

export function parseAgentRef(value: string, source = "agent ref"): AgentRef {
  const [rawProvider, rawProfile = "default"] = value.split(":");
  const provider = rawProvider?.trim().toLowerCase();
  const profile = rawProfile.trim() || "default";
  if (!provider || !agentProviderSet.has(provider)) {
    throw new Error(`${source} must use a supported provider (${agentProviderIds.join(", ")}), got "${value}"`);
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(profile)) {
    throw new Error(`${source} profile must contain only letters, numbers, dots, underscores, or dashes, got "${profile}"`);
  }
  return { provider: provider as AgentProviderId, profile };
}

export function parseAgentRefList(value: string, source = "agent ref list"): AgentRef[] {
  const refs = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parseAgentRef(entry, source));
  if (refs.length === 0) {
    throw new Error(`${source} must include at least one provider profile`);
  }
  return refs;
}

export function selectAgentRef(policy: AgentPolicy, purpose: AgentPurpose, slot: string = purpose): AgentRef {
  const roleKey = normalizeRoleKey(slot);
  const candidates = policy.roleOverrides[roleKey] ?? policy.purposes[purpose] ?? [policy.defaultRef];
  return candidates[stableIndex(slot, candidates.length)];
}

export function agentAuthPath(policy: AgentPolicy, ref: AgentRef, ...parts: string[]): string {
  return resolve(policy.authRoot, ref.provider, ref.profile, ...parts);
}

export function formatAgentRef(ref: AgentRef): string {
  return `${ref.provider}:${ref.profile}`;
}

export function normalizeRoleKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function parseRoleOverrides(env: NodeJS.ProcessEnv): Record<string, AgentRef[]> {
  const overrides: Record<string, AgentRef[]> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("AGENT_ROLE_") || !value) {
      continue;
    }
    const roleKey = normalizeRoleKey(key.slice("AGENT_ROLE_".length));
    if (roleKey) {
      overrides[roleKey] = parseAgentRefList(value, key);
    }
  }
  return overrides;
}

function stableIndex(value: string, length: number): number {
  if (length <= 1) {
    return 0;
  }
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash % length;
}

function resolveMaybeRelative(root: string, value: string) {
  return isAbsolute(value) ? value : resolve(root, value);
}
