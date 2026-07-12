import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type SmithersTokenUsage = {
  runId: string;
  nodeId: string;
  iteration: number;
  attempt: number;
  model: string | null;
  inputTokens: number;
  cachedInputTokens: number | null;
  outputTokens: number;
  reasoningOutputTokens: number | null;
  totalTokens: number;
  timestampMs: number | null;
  source: "token_usage_reported" | "agent_event_usage" | "session_token_count";
};

type Candidate = {
  priority: number;
  usage: SmithersTokenUsage;
};

export async function readSmithersTokenUsage(root: string, runId: string) {
  const path = resolve(root, ".smithers", "executions", runId, "logs", "stream.ndjson");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return [];
  }

  return parseSmithersTokenUsage(text);
}

export function parseSmithersTokenUsage(text: string) {
  const byNodeAttempt = new Map<string, Candidate>();
  for (const line of text.split(/\n+/)) {
    if (!line.trim()) {
      continue;
    }
    const event = parseJson(line);
    if (!event) {
      continue;
    }
    const candidate = usageFromEvent(event);
    if (!candidate) {
      continue;
    }
    const key = [
      candidate.usage.runId,
      candidate.usage.nodeId,
      candidate.usage.iteration,
      candidate.usage.attempt,
    ].join(":");
    const existing = byNodeAttempt.get(key);
    if (!existing || candidate.priority >= existing.priority) {
      byNodeAttempt.set(key, candidate);
    }
  }

  return [...byNodeAttempt.values()]
    .map((candidate) => candidate.usage)
    .sort((left, right) =>
      left.nodeId.localeCompare(right.nodeId) || left.iteration - right.iteration || left.attempt - right.attempt,
    );
}

export function summarizeSmithersTokenUsage(usages: SmithersTokenUsage[]) {
  return usages.reduce(
    (summary, usage) => ({
      calls: summary.calls + 1,
      inputTokens: summary.inputTokens + usage.inputTokens,
      cachedInputTokens: summary.cachedInputTokens + (usage.cachedInputTokens ?? 0),
      outputTokens: summary.outputTokens + usage.outputTokens,
      reasoningOutputTokens: summary.reasoningOutputTokens + (usage.reasoningOutputTokens ?? 0),
      totalTokens: summary.totalTokens + usage.totalTokens,
    }),
    {
      calls: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  );
}

function usageFromEvent(event: Record<string, unknown>): Candidate | null {
  if (event.type === "TokenUsageReported") {
    const usage = buildUsage({
      runId: readString(event.runId),
      nodeId: readString(event.nodeId),
      iteration: readNumber(event.iteration),
      attempt: readNumber(event.attempt),
      model: readString(event.model),
      timestampMs: readNumber(event.timestampMs),
      source: "token_usage_reported",
      usage: event,
    });
    return usage ? { priority: 3, usage } : null;
  }

  const agentEvent = asRecord(event.event);
  const directUsage = asRecord(agentEvent?.usage);
  if (event.type === "AgentEvent" && directUsage) {
    const usage = buildUsage({
      runId: readString(event.runId),
      nodeId: readString(event.nodeId),
      iteration: readNumber(event.iteration),
      attempt: readNumber(event.attempt),
      model: readString(agentEvent?.model),
      timestampMs: readNumber(event.timestampMs),
      source: "agent_event_usage",
      usage: directUsage,
    });
    return usage ? { priority: 2, usage } : null;
  }

  const transcript = asRecord(event.transcript);
  const raw = asRecord(transcript?.raw);
  const payload = asRecord(raw?.payload);
  const info = asRecord(payload?.info);
  const tokenUsage = asRecord(info?.total_token_usage);
  if (event.type === "AgentSessionEvent" && payload?.type === "token_count" && tokenUsage) {
    const usage = buildUsage({
      runId: readString(event.runId),
      nodeId: readString(event.nodeId),
      iteration: readNumber(event.iteration),
      attempt: readNumber(event.attempt),
      model: null,
      timestampMs: readNumber(event.timestampMs),
      source: "session_token_count",
      usage: tokenUsage,
    });
    return usage ? { priority: 1, usage } : null;
  }

  return null;
}

function buildUsage(input: {
  runId: string | null;
  nodeId: string | null;
  iteration: number | null;
  attempt: number | null;
  model: string | null;
  timestampMs: number | null;
  source: SmithersTokenUsage["source"];
  usage: Record<string, unknown>;
}) {
  const inputTokens = readNumber(input.usage.inputTokens) ?? readNumber(input.usage.input_tokens);
  const outputTokens = readNumber(input.usage.outputTokens) ?? readNumber(input.usage.output_tokens);
  if (!input.runId || !input.nodeId || inputTokens === null || outputTokens === null) {
    return null;
  }
  const cachedInputTokens = readNumber(input.usage.cachedInputTokens) ?? readNumber(input.usage.cached_input_tokens);
  const reasoningOutputTokens = readNumber(input.usage.reasoningOutputTokens) ?? readNumber(input.usage.reasoning_output_tokens);
  const totalTokens = readNumber(input.usage.totalTokens) ?? readNumber(input.usage.total_tokens) ?? inputTokens + outputTokens;
  return {
    runId: input.runId,
    nodeId: input.nodeId,
    iteration: input.iteration ?? 0,
    attempt: input.attempt ?? 1,
    model: input.model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
    timestampMs: input.timestampMs,
    source: input.source,
  };
}

function parseJson(line: string) {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
