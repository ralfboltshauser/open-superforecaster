import { CodexAgent } from "smithers-orchestrator";

export const codexStructuredAgent = new CodexAgent({
  model: process.env.CODEX_MODEL ?? "gpt-5.5",
  configDir: process.env.CODEX_HOME,
  sandbox: "workspace-write",
  skipGitRepoCheck: true,
  nativeStructuredOutput: true,
});

export const codexResearchAgent = new CodexAgent({
  model: process.env.CODEX_MODEL ?? "gpt-5.5",
  configDir: process.env.CODEX_HOME,
  sandbox: "workspace-write",
  skipGitRepoCheck: true,
  nativeStructuredOutput: false,
});

export const codexAgent = codexStructuredAgent;
