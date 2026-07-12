import { isRecord, readArray, readNumber, readString } from "@/lib/records"

export type LiveNodeStatus = "pending" | "running" | "completed" | "failed"

export type LiveNode = {
  id: string
  label: string
  status: LiveNodeStatus
  startedAt: string | null
  finishedAt: string | null
}

export type LiveActivityItem = {
  id: string
  type: "workflow" | "node" | "search" | "research"
  nodeId: string | null
  label: string
  detail: string | null
  timestamp: string
}

export type LiveTokenUsage = {
  calls: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

export type LiveRunSnapshot = {
  version: 2
  runId: string
  cursor: number
  status: "starting" | "running" | "completed" | "failed"
  startedAt: string | null
  lastActivityAt: string | null
  progress: {
    total: number
    pending: number
    running: number
    completed: number
    failed: number
    percent: number
  }
  tokenUsage: LiveTokenUsage
  nodes: LiveNode[]
  recentActivity: LiveActivityItem[]
}

export function parseLiveRunSnapshot(value: unknown): LiveRunSnapshot | null {
  if (!isRecord(value) || value.version !== 2) return null
  const runId = readString(value, "runId")
  const cursor = readNumber(value, "cursor")
  const status = readString(value, "status")
  const progress = isRecord(value.progress) ? value.progress : null
  if (!runId || cursor === null || !isLiveStatus(status) || !progress) return null

  const total = readNumber(progress, "total")
  const pending = readNumber(progress, "pending")
  const running = readNumber(progress, "running")
  const completed = readNumber(progress, "completed")
  const failed = readNumber(progress, "failed")
  const percent = readNumber(progress, "percent")
  if ([total, pending, running, completed, failed, percent].some((item) => item === null)) return null
  const tokenUsage = parseTokenUsage(value.tokenUsage)
  if (!tokenUsage) return null

  return {
    version: 2,
    runId,
    cursor,
    status,
    startedAt: readString(value, "startedAt"),
    lastActivityAt: readString(value, "lastActivityAt"),
    progress: {
      total: total as number,
      pending: pending as number,
      running: running as number,
      completed: completed as number,
      failed: failed as number,
      percent: percent as number,
    },
    tokenUsage,
    nodes: readArray(value, "nodes").flatMap(parseLiveNode),
    recentActivity: readArray(value, "recentActivity").flatMap(parseLiveActivityItem),
  }
}

function parseTokenUsage(value: unknown): LiveTokenUsage | null {
  if (!isRecord(value)) return null
  const calls = readNumber(value, "calls")
  const inputTokens = readNumber(value, "inputTokens")
  const cachedInputTokens = readNumber(value, "cachedInputTokens")
  const outputTokens = readNumber(value, "outputTokens")
  const reasoningOutputTokens = readNumber(value, "reasoningOutputTokens")
  const totalTokens = readNumber(value, "totalTokens")
  if ([calls, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, totalTokens].some((item) => item === null)) return null
  return {
    calls: calls as number,
    inputTokens: inputTokens as number,
    cachedInputTokens: cachedInputTokens as number,
    outputTokens: outputTokens as number,
    reasoningOutputTokens: reasoningOutputTokens as number,
    totalTokens: totalTokens as number,
  }
}

function parseLiveNode(value: unknown): LiveNode[] {
  if (!isRecord(value)) return []
  const id = readString(value, "id")
  const label = readString(value, "label")
  const status = readString(value, "status")
  return id && label && isNodeStatus(status) ? [{
    id,
    label,
    status,
    startedAt: readString(value, "startedAt"),
    finishedAt: readString(value, "finishedAt"),
  }] : []
}

function parseLiveActivityItem(value: unknown): LiveActivityItem[] {
  if (!isRecord(value)) return []
  const id = readString(value, "id")
  const type = readString(value, "type")
  const label = readString(value, "label")
  const timestamp = readString(value, "timestamp")
  return id && label && timestamp && isActivityType(type) ? [{
    id,
    type,
    nodeId: readString(value, "nodeId"),
    label,
    detail: readString(value, "detail"),
    timestamp,
  }] : []
}

function isLiveStatus(value: string | null): value is LiveRunSnapshot["status"] {
  return value === "starting" || value === "running" || value === "completed" || value === "failed"
}

function isNodeStatus(value: string | null): value is LiveNodeStatus {
  return value === "pending" || value === "running" || value === "completed" || value === "failed"
}

function isActivityType(value: string | null): value is LiveActivityItem["type"] {
  return value === "workflow" || value === "node" || value === "search" || value === "research"
}
