import { ClaudeCodeAgent, CodexAgent, type AgentLike } from "smithers-orchestrator";

/**
 * The agent engine is selectable per user via AGENT_ENGINE (`codex` | `claude`)
 * so a mixed team can share one codebase: Codex users keep the default, Claude
 * users set AGENT_ENGINE=claude in their own env.
 *
 * Retrieval is deterministic (see packages/workflows/src/research), so agent-side
 * web search is disabled for the Claude engine — the pipeline supplies dated,
 * ledger-backed evidence, and letting the model run its own non-reproducible
 * search would undermine the source ledger and leak post-cutoff data in eval.
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
  // By default the deterministic Firecrawl pipeline is the sole retrieval path, so
  // the agent's own (non-reproducible, non-date-boundable) web search stays off.
  // CLAUDE_WEB_SEARCH=on lets Claude Code's native WebSearch/WebFetch supplement it
  // — for LIVE forecasts only; leave it off for pastcasting / fixed-evidence eval,
  // where agent-side search would leak post-cutoff data and pollute the ledger.
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
