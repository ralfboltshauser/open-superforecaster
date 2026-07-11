import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";

export type ProviderObservedResearchActivity = {
  version: "provider-observed-research-activity-v1";
  provenanceMode: "provider_observed_activity";
  provider: "codex";
  threadId: string;
  sessionFile: string;
  observedAt: string | null;
  callId: string | null;
  activityType: "search" | "open_page" | "find_in_page" | "other";
  query: string | null;
  queries: string[];
  url: string | null;
  pattern: string | null;
  contentObserved: false;
};

export type CodexProviderObservedResearchActivityInput = {
  codexHome: string;
  threadId: string;
  startedAtMs?: number | null;
  finishedAtMs?: number | null;
  maxSessionBytes?: number;
};

export class CodexProviderObservationIncompleteError extends Error {
  readonly threadId: string;
  readonly lineNumber: number | null;

  constructor(threadId: string, lineNumber: number | null, reason: string) {
    const location = lineNumber === null ? "" : ` at JSONL line ${lineNumber}`;
    super(`Codex provider activity observation incomplete for thread ${threadId}${location}: ${reason}.`);
    this.name = "CodexProviderObservationIncompleteError";
    this.threadId = threadId;
    this.lineNumber = lineNumber;
  }
}

const maximumSessionBytes = 64 * 1024 * 1024;

/**
 * Read provider-side activity only from the exact Codex rollout named by the
 * provider thread ID. This deliberately does not use Smithers' timestamp/cwd
 * session backfill, which can select an unrelated rollout. These records prove
 * an action request, not the snippets or page content the model received.
 */
export async function readCodexProviderObservedResearchActivity(
  input: CodexProviderObservedResearchActivityInput,
): Promise<ProviderObservedResearchActivity[]> {
  const threadId = input.threadId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(threadId)) {
    throw new Error(`Invalid Codex thread ID: ${input.threadId}`);
  }
  const sessionPath = await resolveExactCodexSessionFile(input.codexHome, threadId);
  const sessionStat = await stat(sessionPath);
  const byteLimit = input.maxSessionBytes ?? maximumSessionBytes;
  if (sessionStat.size > byteLimit) {
    throw new Error(`Codex rollout ${threadId} exceeds the ${byteLimit}-byte activity limit.`);
  }
  const startedAtMs = optionalTimestamp(input.startedAtMs, "startedAtMs");
  const finishedAtMs = optionalTimestamp(input.finishedAtMs, "finishedAtMs");
  if (startedAtMs !== null && finishedAtMs !== null && finishedAtMs < startedAtMs) {
    throw new Error("Codex activity execution window ends before it starts.");
  }
  const lines = (await readFile(sessionPath, "utf8")).split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const rows = lines.map((line, index) => {
    if (line.length === 0) {
      throw incompleteObservationError(threadId, index + 1, "unexpected empty JSONL row");
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) {
        throw incompleteObservationError(threadId, index + 1, "JSONL row is not an object");
      }
      return parsed;
    } catch (error) {
      if (error instanceof CodexProviderObservationIncompleteError) {
        throw error;
      }
      throw incompleteObservationError(threadId, index + 1, "invalid JSON");
    }
  });
  const sessionMeta = rows.find((row) => row.type === "session_meta");
  const sessionPayload = isRecord(sessionMeta?.payload) ? sessionMeta.payload : null;
  const observedThreadId = stringValue(sessionPayload?.id) ?? stringValue(sessionPayload?.session_id);
  if (observedThreadId !== threadId) {
    throw new Error(
      `Codex rollout filename matched ${threadId}, but session metadata identified ${observedThreadId ?? "nothing"}.`,
    );
  }

  const sessionFile = relative(input.codexHome, sessionPath);
  const byKey = new Map<string, ProviderObservedResearchActivity>();
  for (const row of rows) {
    if (row.type !== "event_msg") {
      continue;
    }
    const payload = isRecord(row.payload) ? row.payload : null;
    if (payload?.type !== "web_search_end") {
      continue;
    }
    const action = isRecord(payload.action) ? payload.action : {};
    const activityType = normalizeActivityType(action.type);
    const queries = stringArray(action.queries);
    const query = stringValue(payload.query) ?? queries[0] ?? null;
    const url = stringValue(action.url);
    const pattern = stringValue(action.pattern);
    const callId = stringValue(payload.call_id);
    const observedAt = normalizeTimestamp(row.timestamp);
    if (startedAtMs !== null || finishedAtMs !== null) {
      if (!observedAt) {
        throw incompleteObservationError(
          threadId,
          null,
          `web activity ${callId ?? "without a call ID"} has no valid timestamp for execution-window attribution`,
        );
      }
      const observedAtMs = Date.parse(observedAt);
      if ((startedAtMs !== null && observedAtMs < startedAtMs) ||
        (finishedAtMs !== null && observedAtMs > finishedAtMs)) {
        continue;
      }
    }
    const key = [callId, activityType, query, queries.join("\n"), url, pattern].join("|");
    byKey.set(key, {
      version: "provider-observed-research-activity-v1",
      provenanceMode: "provider_observed_activity",
      provider: "codex",
      threadId,
      sessionFile,
      observedAt,
      callId,
      activityType,
      query,
      queries,
      url,
      pattern,
      contentObserved: false,
    });
  }
  return [...byKey.values()].sort((left, right) =>
    (left.observedAt ?? "").localeCompare(right.observedAt ?? "") ||
    (left.callId ?? "").localeCompare(right.callId ?? ""));
}

async function resolveExactCodexSessionFile(codexHome: string, threadId: string) {
  // Always refresh the index. A Codex rollout can move from sessions/ to
  // archived_sessions/ after the first read, and a later duplicate must turn
  // an apparently exact match into an explicit ambiguity instead of being
  // hidden by a stale cached path.
  const index = await indexCodexSessions(codexHome);
  const matches = index.get(threadId) ?? [];
  if (matches.length === 0) {
    throw new Error(`No exact Codex rollout found for thread ${threadId} under ${codexHome}.`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple Codex rollouts matched thread ${threadId}; exact provenance is ambiguous.`);
  }
  return matches[0];
}

async function indexCodexSessions(codexHome: string) {
  const index = new Map<string, string[]>();
  for (const root of [join(codexHome, "sessions"), join(codexHome, "archived_sessions")]) {
    for (const path of await walkFiles(root)) {
      if (!path.endsWith(".jsonl")) {
        continue;
      }
      const name = basename(path);
      const match = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
      if (!match) {
        continue;
      }
      const existing = index.get(match[1]) ?? [];
      existing.push(path);
      index.set(match[1], existing);
    }
  }
  return index;
}

async function walkFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function normalizeActivityType(value: unknown): ProviderObservedResearchActivity["activityType"] {
  return value === "search" || value === "open_page" || value === "find_in_page"
    ? value
    : "other";
}

function normalizeTimestamp(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
}

function optionalTimestamp(value: number | null | undefined, label: string) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid Codex activity ${label}: ${value}`);
  }
  return value;
}

function incompleteObservationError(threadId: string, lineNumber: number | null, reason: string) {
  return new CodexProviderObservationIncompleteError(threadId, lineNumber, reason);
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))]
    : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
