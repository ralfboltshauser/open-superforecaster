import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

export type SmithersLaunchInput = {
  workflowPath: string;
  runId?: string;
  input?: Record<string, unknown>;
  root?: string;
};

export type SmithersLaunchResult = {
  runId: string;
  workflowPath: string;
  stdout: string;
  stderr: string;
};

export type SmithersInspectResult = {
  run?: {
    id: string;
    status: string;
  };
  runState?: {
    state: string;
  };
};

export async function launchSmithersDetached(input: SmithersLaunchInput): Promise<SmithersLaunchResult> {
  const runId = input.runId ?? `osf-${randomUUID()}`;
  const workflowPath = resolve(input.root ?? process.cwd(), input.workflowPath);

  const { stdout, stderr } = await runCommand([
    "smithers-orchestrator",
    "up",
    workflowPath,
    "--detach",
    "--run-id",
    runId,
    "--input",
    JSON.stringify(input.input ?? {}),
    "--format",
    "json",
  ], input.root);

  return {
    runId,
    workflowPath,
    stdout,
    stderr,
  };
}

export async function inspectSmithersRun(runId: string, root?: string): Promise<SmithersInspectResult> {
  const { stdout } = await runCommand([
    "smithers-orchestrator",
    "inspect",
    runId,
    "--format",
    "json",
  ], root);
  return JSON.parse(stdout) as SmithersInspectResult;
}

export async function readSmithersNodeOutput<T = Record<string, unknown>>(
  runId: string,
  nodeId: string,
  root?: string,
): Promise<T> {
  const { stdout } = await runCommand([
    "smithers-orchestrator",
    "output",
    runId,
    nodeId,
    "--format",
    "json",
  ], root);
  return JSON.parse(stdout) as T;
}

async function runCommand(args: string[], cwd = process.cwd()) {
  const smithersStateDir = process.env.SMITHERS_STATE_DIR ?? resolve(cwd, "data/smithers");
  const codexHome = process.env.CODEX_HOME;
  const codexModel = process.env.CODEX_MODEL;
  const agentEngine = process.env.AGENT_ENGINE;
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
  const claudeModel = process.env.CLAUDE_MODEL;
  const claudeWebSearch = process.env.CLAUDE_WEB_SEARCH;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const proc = spawn("bunx", args, {
    cwd,
    env: {
      ...process.env,
      SMITHERS_STATE_DIR: smithersStateDir,
      ...(codexHome ? { CODEX_HOME: codexHome } : {}),
      ...(codexModel ? { CODEX_MODEL: codexModel } : {}),
      ...(agentEngine ? { AGENT_ENGINE: agentEngine } : {}),
      ...(claudeConfigDir ? { CLAUDE_CONFIG_DIR: claudeConfigDir } : {}),
      ...(claudeModel ? { CLAUDE_MODEL: claudeModel } : {}),
      ...(claudeWebSearch ? { CLAUDE_WEB_SEARCH: claudeWebSearch } : {}),
      ...(anthropicApiKey ? { ANTHROPIC_API_KEY: anthropicApiKey } : {}),
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    new Promise<number | null>((resolveExit) => proc.once("exit", resolveExit)),
  ]);

  if (exitCode !== 0) {
    throw new Error(`Command failed with exit ${exitCode}: bunx ${args.join(" ")}\n${stderr || stdout}`);
  }

  return { stdout, stderr };
}

async function readStream(stream: NodeJS.ReadableStream | null) {
  if (!stream) {
    return "";
  }

  let output = "";
  for await (const chunk of stream) {
    output += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  }
  return output;
}
