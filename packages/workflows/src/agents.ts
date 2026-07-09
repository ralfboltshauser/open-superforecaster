import {
  AmpAgent,
  AntigravityAgent,
  ClaudeCodeAgent,
  CodexAgent,
  ForgeAgent,
  GeminiAgent,
  HermesCliAgent,
  KimiAgent,
  OpenClawAgent,
  OpenCodeAgent,
  PiAgent,
  VibeAgent,
  type AgentLike,
} from "smithers-orchestrator";
import {
  agentAuthPath,
  formatAgentRef,
  loadAgentPolicy,
  selectAgentRef,
  type AgentPurpose,
  type AgentRef,
} from "@open-superforecaster/config";

type AgentFactoryInput = {
  purpose: AgentPurpose;
  slot?: string;
  structured?: boolean;
};

const policy = loadAgentPolicy(process.env, process.cwd());

export const agents = {
  structured(slot = "structured") {
    return createConfiguredAgent({ purpose: "structured", slot, structured: true });
  },
  research(slot = "research") {
    return createConfiguredAgent({ purpose: "research", slot });
  },
  forecast(roleId: string) {
    return createConfiguredAgent({ purpose: "forecast", slot: roleId });
  },
  critic(slot = "critic") {
    return createConfiguredAgent({ purpose: "critic", slot });
  },
};

export function createConfiguredAgent(input: AgentFactoryInput): AgentLike {
  const ref = selectAgentRef(policy, input.purpose, input.slot ?? input.purpose);
  const id = `${input.purpose}:${input.slot ?? input.purpose}:${formatAgentRef(ref)}`;
  const common = {
    id,
    timeoutMs: readIntEnv("AGENT_TIMEOUT_MS"),
    idleTimeoutMs: readIntEnv("AGENT_IDLE_TIMEOUT_MS"),
    maxOutputBytes: readIntEnv("AGENT_MAX_OUTPUT_BYTES"),
  };

  switch (ref.provider) {
    case "codex":
      return new CodexAgent({
        ...common,
        model: process.env.CODEX_MODEL ?? process.env.AGENT_MODEL ?? "gpt-5.5",
        configDir: process.env.CODEX_HOME ?? authPath(ref),
        sandbox: "workspace-write",
        skipGitRepoCheck: true,
        nativeStructuredOutput: input.structured === true,
      });
    case "claude":
      return new ClaudeCodeAgent({
        ...common,
        ...(process.env.CLAUDE_MODEL ? { model: process.env.CLAUDE_MODEL } : {}),
        configDir: process.env.CLAUDE_CONFIG_DIR ?? authPath(ref),
        allowDangerouslySkipPermissions: process.env.IS_SANDBOX === "1",
        dangerouslySkipPermissions: process.env.IS_SANDBOX === "1",
        ...(policy.allowNativeWeb ? {} : { disallowedTools: ["WebSearch", "WebFetch"] }),
      });
    case "kimi":
      return new KimiAgent({
        ...common,
        ...(process.env.KIMI_MODEL ? { model: process.env.KIMI_MODEL } : {}),
        configDir: process.env.KIMI_SHARE_DIR ?? authPath(ref),
      });
    case "pi":
      return new PiAgent({
        ...common,
        provider: process.env.PI_PROVIDER,
        model: process.env.PI_MODEL ?? process.env.AGENT_MODEL,
        apiKey: process.env.PI_API_KEY,
        sessionDir: authPath(ref, "sessions"),
        mode: input.structured ? "json" : undefined,
      });
    case "amp":
      return new AmpAgent({ ...common, settingsFile: optionalPath(ref, "settings.json") });
    case "antigravity":
      return new AntigravityAgent({
        ...common,
        ...(process.env.ANTIGRAVITY_MODEL ? { model: process.env.ANTIGRAVITY_MODEL } : {}),
        configDir: authPath(ref),
        yolo: process.env.IS_SANDBOX === "1",
      });
    case "forge":
      return new ForgeAgent({ ...common, provider: process.env.FORGE_PROVIDER, directory: process.cwd() });
    case "gemini":
      return new GeminiAgent({
        ...common,
        ...(process.env.GEMINI_MODEL ? { model: process.env.GEMINI_MODEL } : {}),
        yolo: process.env.IS_SANDBOX === "1",
      });
    case "hermes":
      return new HermesCliAgent({ ...common, provider: process.env.HERMES_PROVIDER });
    case "opencode":
      return new OpenCodeAgent({
        ...common,
        ...(process.env.OPENCODE_MODEL ? { model: process.env.OPENCODE_MODEL } : {}),
        agentName: process.env.OPENCODE_AGENT,
      });
    case "openclaw":
      return new OpenClawAgent({ ...common, agent: process.env.OPENCLAW_AGENT, workspace: process.cwd() });
    case "vibe":
      return new VibeAgent({ ...common, agent: process.env.VIBE_AGENT });
  }
}

function authPath(ref: AgentRef, ...parts: string[]) {
  return agentAuthPath(policy, ref, ...parts);
}

function optionalPath(ref: AgentRef, ...parts: string[]) {
  return authPath(ref, ...parts);
}

function readIntEnv(name: string) {
  const raw = process.env[name];
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

export const codexStructuredAgent = agents.structured();
export const codexResearchAgent = agents.research();
export const codexAgent = codexStructuredAgent;
