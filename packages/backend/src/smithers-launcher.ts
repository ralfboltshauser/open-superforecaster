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

export type SmithersNodeExecutionMetadata = {
  nodeId: string;
  iteration: number;
  attempt: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  agentId: string | null;
  agentModel: string | null;
  agentEngine: string | null;
  agentResume: string | null;
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

export async function readSmithersNodeExecutionMetadata(
  runId: string,
  nodeId: string,
  root?: string,
): Promise<SmithersNodeExecutionMetadata | null> {
  const { stdout } = await runCommand([
    "smithers-orchestrator",
    "node",
    nodeId,
    "--run-id",
    runId,
    "--format",
    "json",
  ], root);
  return parseSmithersNodeExecutionMetadata(JSON.parse(stdout), nodeId);
}

/**
 * Return every provider execution exposed for a Smithers node, including old
 * loop iterations and failed/retried attempts. The singular reader above is
 * intentionally retained for attributing the attempt that produced the
 * current node output.
 */
export async function readSmithersNodeExecutionMetadataHistory(
  runId: string,
  nodeId: string,
  root?: string,
): Promise<SmithersNodeExecutionMetadata[]> {
  const { stdout } = await runCommand([
    "smithers-orchestrator",
    "node",
    nodeId,
    "--run-id",
    runId,
    "--format",
    "json",
  ], root);
  const latestDetail = JSON.parse(stdout) as unknown;
  const latestNode = asRecord(asRecord(latestDetail)?.node);
  const latestIteration = nonNegativeInteger(latestNode?.iteration);
  if (latestIteration === null || latestIteration === 0) {
    return parseSmithersNodeExecutionMetadataHistory(latestDetail, nodeId);
  }

  const priorDetails = await Promise.all(
    Array.from({ length: latestIteration }, (_, iteration) => readSmithersNodeDetailAtIteration(
      runId,
      nodeId,
      iteration,
      root,
    )),
  );
  return [...priorDetails.filter((detail) => detail !== null), latestDetail]
    .flatMap((detail) => parseSmithersNodeExecutionMetadataHistory(detail, nodeId))
    .sort(compareSmithersExecutions);
}

export function parseSmithersNodeExecutionMetadata(
  value: unknown,
  fallbackNodeId: string,
): SmithersNodeExecutionMetadata | null {
  const detail = asRecord(value);
  const node = asRecord(detail?.node);
  const executions = parseSmithersNodeExecutionMetadataHistory(value, fallbackNodeId)
    .filter(hasObservedAgentMetadata);
  if (executions.length === 0) {
    return null;
  }
  const currentIteration = finiteNumber(node?.iteration);
  const lastAttempt = finiteNumber(node?.lastAttempt);

  if (currentIteration !== null && lastAttempt !== null) {
    const exact = executions.find((execution) =>
      execution.iteration === currentIteration && execution.attempt === lastAttempt);
    if (exact) {
      return exact;
    }
  }

  if (currentIteration !== null) {
    const currentIterationExecutions = executions.filter((execution) => execution.iteration === currentIteration);
    if (currentIterationExecutions.length > 0) {
      return currentIterationExecutions.at(-1) ?? null;
    }
  }

  if (lastAttempt !== null) {
    const matchingAttemptExecutions = executions.filter((execution) => execution.attempt === lastAttempt);
    if (matchingAttemptExecutions.length > 0) {
      return matchingAttemptExecutions.at(-1) ?? null;
    }
  }

  return executions.at(-1) ?? null;
}

export function parseSmithersNodeExecutionMetadataHistory(
  value: unknown,
  fallbackNodeId: string,
): SmithersNodeExecutionMetadata[] {
  const detail = asRecord(value);
  const node = asRecord(detail?.node);
  const attempts = Array.isArray(detail?.attempts)
    ? detail.attempts.filter((attempt): attempt is Record<string, unknown> => Boolean(asRecord(attempt)))
    : [];
  const nodeId = nonEmptyString(node?.nodeId) ?? fallbackNodeId;
  const nodeIteration = finiteNumber(node?.iteration) ?? 0;
  const nodeLastAttempt = finiteNumber(node?.lastAttempt) ?? 0;

  return attempts.flatMap((attempt) => {
    const meta = asRecord(attempt.meta) ?? {};
    const agentId = nonEmptyString(meta.agentId);
    const agentModel = nonEmptyString(meta.agentModel);
    const agentEngine = nonEmptyString(meta.agentEngine);
    const agentResume = nonEmptyString(meta.agentResume);
    return [{
      nodeId: nonEmptyString(attempt.nodeId) ?? nodeId,
      iteration: finiteNumber(attempt.iteration) ?? nodeIteration,
      attempt: finiteNumber(attempt.attempt) ?? nodeLastAttempt,
      startedAtMs: finiteNumber(attempt.startedAtMs),
      finishedAtMs: finiteNumber(attempt.finishedAtMs),
      agentId,
      agentModel,
      agentEngine,
      agentResume,
    }];
  }).sort(compareSmithersExecutions);
}

function hasObservedAgentMetadata(execution: SmithersNodeExecutionMetadata) {
  return Boolean(
    execution.agentId || execution.agentModel || execution.agentEngine || execution.agentResume,
  );
}

async function readSmithersNodeDetailAtIteration(
  runId: string,
  nodeId: string,
  iteration: number,
  root?: string,
) {
  try {
    const { stdout } = await runCommand([
      "smithers-orchestrator",
      "node",
      nodeId,
      "--run-id",
      runId,
      "--iteration",
      String(iteration),
      "--format",
      "json",
    ], root);
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Command failed with exit 4:")) {
      return null;
    }
    throw error;
  }
}

function compareSmithersExecutions(
  left: SmithersNodeExecutionMetadata,
  right: SmithersNodeExecutionMetadata,
) {
  return left.iteration - right.iteration ||
    left.attempt - right.attempt ||
    (left.startedAtMs ?? -1) - (right.startedAtMs ?? -1);
}

async function runCommand(args: string[], cwd = process.cwd()) {
  const smithersStateDir = process.env.SMITHERS_STATE_DIR ?? resolve(cwd, "data/smithers");
  const codexHome = process.env.CODEX_HOME;
  const codexModel = process.env.CODEX_MODEL;
  const proc = spawn("bunx", args, {
    cwd,
    env: {
      ...process.env,
      SMITHERS_STATE_DIR: smithersStateDir,
      ...(codexHome ? { CODEX_HOME: codexHome } : {}),
      ...(codexModel ? { CODEX_MODEL: codexModel } : {}),
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
