import { describe, expect, test } from "bun:test"
import { parseLiveRunSnapshot } from "../src/components/run-workspace/live-activity"

describe("live activity client contract", () => {
  test("accepts the versioned backend snapshot", () => {
    const snapshot = parseLiveRunSnapshot({
      version: 2,
      runId: "osf-test",
      cursor: 14,
      status: "running",
      startedAt: "2026-07-12T00:00:00.000Z",
      lastActivityAt: "2026-07-12T00:00:05.000Z",
      progress: { total: 4, pending: 1, running: 2, completed: 1, failed: 0, percent: 25 },
      tokenUsage: { calls: 3, inputTokens: 1200, cachedInputTokens: 200, outputTokens: 300, reasoningOutputTokens: 50, totalTokens: 1500 },
      nodes: [{ id: "attempt-base-rate", label: "Base-rate forecaster", status: "running", startedAt: "2026-07-12T00:00:01.000Z", finishedAt: null }],
      recentActivity: [{ id: "smithers-14", type: "search", nodeId: "attempt-base-rate", label: "Base-rate forecaster searched the web", detail: "test query", timestamp: "2026-07-12T00:00:05.000Z" }],
    })

    expect(snapshot).toMatchObject({
      runId: "osf-test",
      cursor: 14,
      progress: { total: 4, running: 2, completed: 1, percent: 25 },
      tokenUsage: { calls: 3, inputTokens: 1200, outputTokens: 300, totalTokens: 1500 },
      nodes: [{ status: "running" }],
      recentActivity: [{ type: "search", detail: "test query" }],
    })
  })

  test("rejects unknown versions and incomplete progress", () => {
    expect(parseLiveRunSnapshot({ version: 3, runId: "osf-test" })).toBeNull()
    expect(parseLiveRunSnapshot({ version: 2, runId: "osf-test", cursor: 1, status: "running", progress: {} })).toBeNull()
  })
})
