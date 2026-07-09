import { ClaudeCodeAgent, CodexAgent, type AgentLike } from "smithers-orchestrator";

/**
 * The agent engine is selectable per user via AGENT_ENGINE (`codex` | `claude`)
 * so a mixed team can share one codebase: Codex users keep the default, Claude
 * users set AGENT_ENGINE=claude in their own env.
 *
 * For the Claude engine, native WebSearch/WebFetch are disabled by default and
 * enabled only when CLAUDE_WEB_SEARCH=on (live forecasts) — keep it off for
 * pastcasting/fixed-evidence eval, where agent-side search leaks post-cutoff data.
 */
type AgentEngine = "codex" | "claude";

function resolveAgentEngine(): AgentEngine {
  const raw = (process.env.AGENT_ENGINE ?? "codex").trim().toLowerCase();
  if (raw === "claude" || raw === "claude-code" || raw === "anthropic") {
    return "claude";
  }
  return "codex";
}

function createCodexAgents(): { structured: AgentLike; research: AgentLike } {
  const shared = {
    model: process.env.CODEX_MODEL ?? "gpt-5.5",
    configDir: process.env.CODEX_HOME,
    sandbox: "workspace-write" as const,
    skipGitRepoCheck: true,
  };
  return {
    // Native structured output emits only final JSON (no tool calls) — ideal for
    // the pure extraction tasks (plan, aggregate, quality review).
    structured: new CodexAgent({ ...shared, nativeStructuredOutput: true }),
    research: new CodexAgent({ ...shared, nativeStructuredOutput: false }),
  };
}

function createClaudeAgents(): { structured: AgentLike; research: AgentLike } {
  // Native web search stays off by default (non-reproducible, non-date-boundable).
  // CLAUDE_WEB_SEARCH=on gives Claude Code its WebSearch/WebFetch tools — for LIVE
  // forecasts only; leave it off for pastcasting / fixed-evidence eval, where
  // agent-side search would leak post-cutoff data.
  const allowNativeWebSearch = process.env.CLAUDE_WEB_SEARCH === "on";
  const shared = {
    ...(process.env.CLAUDE_MODEL ? { model: process.env.CLAUDE_MODEL } : {}),
    ...(process.env.CLAUDE_CONFIG_DIR ? { configDir: process.env.CLAUDE_CONFIG_DIR } : {}),
    // Run headless (Smithers spawns the CLI detached, so it cannot answer prompts).
    dangerouslySkipPermissions: true,
    ...(allowNativeWebSearch ? {} : { disallowedTools: ["WebSearch", "WebFetch"] }),
  };
  return {
    structured: new ClaudeCodeAgent({ ...shared }),
    research: new ClaudeCodeAgent({ ...shared }),
  };
}

const agents = resolveAgentEngine() === "claude" ? createClaudeAgents() : createCodexAgents();

// Names are kept for back-compat with every workflow import; both are
// engine-agnostic now (Codex or Claude Code depending on AGENT_ENGINE).
export const codexStructuredAgent = agents.structured;
export const codexResearchAgent = agents.research;
export const codexAgent = codexStructuredAgent;
