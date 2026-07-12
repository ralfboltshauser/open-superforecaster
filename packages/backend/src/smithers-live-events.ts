import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parseSmithersTokenUsage, summarizeSmithersTokenUsage } from "./smithers-usage";

export type SmithersLiveNodeStatus = "pending" | "running" | "completed" | "failed";

export type SmithersLiveNode = {
  id: string;
  label: string;
  status: SmithersLiveNodeStatus;
  iteration: number;
  attempt: number | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type SmithersLiveActivity = {
  id: string;
  type: "workflow" | "node" | "search" | "research";
  nodeId: string | null;
  label: string;
  detail: string | null;
  timestamp: string;
};

export type SmithersLiveTokenUsage = {
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type SmithersLiveSnapshot = {
  version: 2;
  runId: string;
  cursor: number;
  status: "starting" | "running" | "completed" | "failed";
  startedAt: string | null;
  lastActivityAt: string | null;
  progress: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    percent: number;
  };
  tokenUsage: SmithersLiveTokenUsage;
  nodes: SmithersLiveNode[];
  recentActivity: SmithersLiveActivity[];
};

type RawEvent = Record<string, unknown>;

const snapshotCache = new Map<string, { size: number; modifiedAtMs: number; snapshot: SmithersLiveSnapshot }>();
const MAX_CACHED_RUNS = 100;

export async function readSmithersLiveSnapshot(root: string, runId: string): Promise<SmithersLiveSnapshot | null> {
  const path = resolve(root, ".smithers", "executions", runId, "logs", "stream.ndjson");
  try {
    const metadata = await stat(path);
    const cached = snapshotCache.get(path);
    if (cached && cached.size === metadata.size && cached.modifiedAtMs === metadata.mtimeMs) {
      return cached.snapshot;
    }
    const snapshot = parseSmithersLiveStream(await readFile(path, "utf8"), runId);
    snapshotCache.delete(path);
    snapshotCache.set(path, { size: metadata.size, modifiedAtMs: metadata.mtimeMs, snapshot });
    while (snapshotCache.size > MAX_CACHED_RUNS) {
      const oldest = snapshotCache.keys().next().value;
      if (typeof oldest !== "string") break;
      snapshotCache.delete(oldest);
    }
    return snapshot;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function parseSmithersLiveStream(text: string, expectedRunId: string): SmithersLiveSnapshot {
  const nodes = new Map<string, SmithersLiveNode>();
  const activity: SmithersLiveActivity[] = [];
  let cursor = 0;
  let status: SmithersLiveSnapshot["status"] = "starting";
  let startedAt: string | null = null;
  let lastActivityAt: string | null = null;

  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim()) {
      continue;
    }
    const event = parseJson(line);
    if (!event || readString(event, "runId") !== expectedRunId) {
      continue;
    }
    cursor = index + 1;
    const type = readString(event, "type") ?? "";
    const timestamp = isoTimestamp(readNumber(event, "timestampMs"));
    if (timestamp) {
      lastActivityAt = timestamp;
    }

    if (type === "RunStarted") {
      status = "running";
      startedAt = timestamp;
      pushActivity(activity, index, "workflow", null, "Workflow started", null, timestamp);
      continue;
    }
    if (type === "RunFinished") {
      status = "completed";
      pushActivity(activity, index, "workflow", null, "Workflow finished", "Materializing the forecast ledger.", timestamp);
      continue;
    }
    if (type === "RunFailed" || type === "RunError") {
      status = "failed";
      pushActivity(activity, index, "workflow", null, "Workflow failed", null, timestamp);
      continue;
    }

    const nodeId = readString(event, "nodeId");
    if (!nodeId) {
      continue;
    }
    const node = nodes.get(nodeId) ?? {
      id: nodeId,
      label: labelSmithersNode(nodeId),
      status: "pending" as const,
      iteration: readNumber(event, "iteration") ?? 0,
      attempt: readNumber(event, "attempt"),
      startedAt: null,
      finishedAt: null,
    };
    node.iteration = readNumber(event, "iteration") ?? node.iteration;
    node.attempt = readNumber(event, "attempt") ?? node.attempt;

    if (type === "NodePending") {
      node.status = "pending";
    } else if (type === "NodeStarted") {
      node.status = "running";
      node.startedAt = timestamp;
      pushActivity(activity, index, "node", nodeId, `${node.label} started`, null, timestamp);
    } else if (type === "NodeFinished") {
      node.status = "completed";
      node.finishedAt = timestamp;
      pushActivity(activity, index, "node", nodeId, `${node.label} completed`, null, timestamp);
    } else if (type === "NodeFailed" || type === "NodeError") {
      node.status = "failed";
      node.finishedAt = timestamp;
      pushActivity(activity, index, "node", nodeId, `${node.label} failed`, null, timestamp);
    } else if (type === "AgentEvent") {
      const agentEvent = readRecord(event, "event");
      const agentType = readString(agentEvent, "type");
      const phase = readString(agentEvent, "phase");
      const action = readRecord(agentEvent, "action");
      const kind = readString(action, "kind");
      if (agentType === "started") {
        pushActivity(activity, index, "research", nodeId, `${node.label} connected`, null, timestamp);
      } else if (agentType === "action" && phase === "completed" && kind === "web_search") {
        const detail = readRecord(action, "detail");
        const query = cleanDetail(readString(detail, "query"));
        if (query) {
          pushActivity(activity, index, "search", nodeId, `${node.label} searched the web`, query, timestamp);
        }
      } else if (agentType === "action" && phase === "started" && kind === "command") {
        pushActivity(activity, index, "research", nodeId, `${node.label} is processing research material`, null, timestamp);
      } else if (agentType === "action" && phase === "completed" && kind === "note") {
        pushActivity(activity, index, "research", nodeId, `${node.label} summarized its findings`, null, timestamp);
      }
    }
    nodes.set(nodeId, node);
  }

  const nodeList = [...nodes.values()];
  const counts = {
    pending: nodeList.filter((node) => node.status === "pending").length,
    running: nodeList.filter((node) => node.status === "running").length,
    completed: nodeList.filter((node) => node.status === "completed").length,
    failed: nodeList.filter((node) => node.status === "failed").length,
  };
  const total = nodeList.length;
  const percent = total > 0 ? Math.round(((counts.completed + counts.failed) / total) * 100) : status === "completed" ? 100 : 0;
  const tokenUsage = summarizeSmithersTokenUsage(
    parseSmithersTokenUsage(text).filter((usage) => usage.runId === expectedRunId),
  );

  return {
    version: 2,
    runId: expectedRunId,
    cursor,
    status,
    startedAt,
    lastActivityAt,
    progress: { total, ...counts, percent },
    tokenUsage,
    nodes: nodeList.slice(0, 64),
    recentActivity: uniqueRecentActivity(activity, 12),
  };
}

function uniqueRecentActivity(activity: SmithersLiveActivity[], limit: number) {
  const seen = new Set<string>();
  const recent: SmithersLiveActivity[] = [];
  for (let index = activity.length - 1; index >= 0 && recent.length < limit; index -= 1) {
    const item = activity[index];
    if (!item) continue;
    const key = [item.nodeId, item.label, item.detail].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push(item);
  }
  return recent;
}

export function labelSmithersNode(nodeId: string) {
  const known: Record<string, string> = {
    "attempt-base-rate": "Base-rate forecaster",
    "attempt-inside-view": "Inside-view forecaster",
    "attempt-incentives-timing": "Incentives-and-timing forecaster",
    "attempt-adversarial-tail": "Adversarial-tail forecaster",
    "attempt-reference-class": "Reference-class forecaster",
    "attempt-resolution-boundary": "Resolution-boundary reviewer",
    "attempt-skeptic": "Skeptical forecaster",
    plan: "Forecast plan",
    aggregate: "Forecast aggregation",
    "candidate-aggregate": "Candidate aggregation",
    "quality-review": "Quality review",
    "research-dossier": "Shared research dossier",
    "role-selection": "Research team selection",
  };
  return known[nodeId] ?? nodeId
    .replace(/^attempt-/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function pushActivity(
  activity: SmithersLiveActivity[],
  index: number,
  type: SmithersLiveActivity["type"],
  nodeId: string | null,
  label: string,
  detail: string | null,
  timestamp: string | null,
) {
  if (!timestamp) {
    return;
  }
  activity.push({ id: `smithers-${index + 1}`, type, nodeId, label, detail, timestamp });
}

function cleanDetail(value: string | null) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > 180 ? `${normalized.slice(0, 177)}…` : normalized;
}

function isoTimestamp(timestampMs: number | null) {
  if (timestampMs === null || !Number.isFinite(timestampMs)) {
    return null;
  }
  const date = new Date(timestampMs);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function parseJson(line: string): RawEvent | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as RawEvent : null;
  } catch {
    return null;
  }
}

function readRecord(record: RawEvent | null, key: string): RawEvent | null {
  const value = record?.[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RawEvent : null;
}

function readString(record: RawEvent | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: RawEvent | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
