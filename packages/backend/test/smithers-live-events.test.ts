import { describe, expect, test } from "bun:test";
import { parseSmithersLiveStream } from "../src/smithers-live-events";

const runId = "osf-test";

function event(value: Record<string, unknown>) {
  return JSON.stringify({ runId, timestampMs: 1_700_000_000_000, ...value });
}

describe("Smithers live event projection", () => {
  test("projects honest node progress and safe user-facing activity", () => {
    const snapshot = parseSmithersLiveStream([
      event({ type: "RunStarted" }),
      event({ type: "NodePending", nodeId: "attempt-base-rate", iteration: 0 }),
      event({ type: "NodePending", nodeId: "attempt-inside-view", iteration: 0 }),
      event({ type: "NodePending", nodeId: "aggregate", iteration: 0 }),
      event({ type: "NodeStarted", nodeId: "attempt-base-rate", iteration: 0, attempt: 1 }),
      event({
        type: "AgentEvent",
        nodeId: "attempt-base-rate",
        iteration: 0,
        attempt: 1,
        event: { type: "action", phase: "completed", entryType: "thought", action: { kind: "web_search", detail: { query: "open model coding benchmark" } } },
      }),
      event({ type: "NodeFinished", nodeId: "attempt-base-rate", iteration: 0, attempt: 1 }),
      event({ type: "NodeStarted", nodeId: "attempt-inside-view", iteration: 0, attempt: 1 }),
      "{partial",
    ].join("\n"), runId);

    expect(snapshot.status).toBe("running");
    expect(snapshot.progress).toEqual({ total: 3, pending: 1, running: 1, completed: 1, failed: 0, percent: 33 });
    expect(snapshot.nodes).toMatchObject([
      { id: "attempt-base-rate", label: "Base-rate forecaster", status: "completed" },
      { id: "attempt-inside-view", label: "Inside-view forecaster", status: "running" },
      { id: "aggregate", label: "Forecast aggregation", status: "pending" },
    ]);
    expect(snapshot.recentActivity).toContainEqual(expect.objectContaining({
      type: "search",
      label: "Base-rate forecaster searched the web",
      detail: "open model coding benchmark",
    }));
    expect(JSON.stringify(snapshot)).not.toContain("entryType");
  });

  test("reports durable terminal completion", () => {
    const snapshot = parseSmithersLiveStream([
      event({ type: "RunStarted" }),
      event({ type: "NodePending", nodeId: "aggregate", iteration: 0 }),
      event({ type: "NodeStarted", nodeId: "aggregate", iteration: 0, attempt: 1 }),
      event({ type: "NodeFinished", nodeId: "aggregate", iteration: 0, attempt: 1 }),
      event({ type: "RunFinished" }),
    ].join("\n"), runId);

    expect(snapshot.status).toBe("completed");
    expect(snapshot.progress.percent).toBe(100);
    expect(snapshot.recentActivity[0]).toMatchObject({ label: "Workflow finished" });
  });

  test("coalesces repetitive safe activity without hiding liveness", () => {
    const command = (timestampMs: number) => JSON.stringify({
      runId,
      timestampMs,
      type: "AgentEvent",
      nodeId: "research-dossier",
      iteration: 0,
      attempt: 1,
      event: { type: "action", phase: "started", entryType: "thought", action: { kind: "command", title: "private command" } },
    });
    const snapshot = parseSmithersLiveStream([
      event({ type: "RunStarted" }),
      event({ type: "NodeStarted", nodeId: "research-dossier", iteration: 0, attempt: 1 }),
      command(1_700_000_001_000),
      command(1_700_000_002_000),
    ].join("\n"), runId);

    expect(snapshot.recentActivity.filter((item) => item.label.includes("processing research material"))).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain("private command");
  });

  test("totals all model calls while deduplicating alternate usage reports", () => {
    const snapshot = parseSmithersLiveStream([
      event({ type: "RunStarted" }),
      event({
        type: "AgentEvent",
        nodeId: "research-dossier",
        iteration: 0,
        attempt: 1,
        event: { type: "completed", usage: { inputTokens: 90, outputTokens: 35, totalTokens: 125 } },
      }),
      event({
        type: "TokenUsageReported",
        nodeId: "research-dossier",
        iteration: 0,
        attempt: 1,
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 50,
        reasoningOutputTokens: 10,
        totalTokens: 150,
      }),
      event({
        type: "TokenUsageReported",
        nodeId: "aggregate",
        iteration: 1,
        attempt: 2,
        inputTokens: 200,
        outputTokens: 75,
        totalTokens: 275,
      }),
    ].join("\n"), runId);

    expect(snapshot.tokenUsage).toEqual({
      calls: 2,
      inputTokens: 300,
      cachedInputTokens: 40,
      outputTokens: 125,
      reasoningOutputTokens: 10,
      totalTokens: 425,
    });
  });
});
