import { describe, expect, test } from "bun:test";
import {
  parseSmithersNodeExecutionMetadata,
  parseSmithersNodeExecutionMetadataHistory,
} from "../src/smithers-launcher";

describe("Smithers node execution metadata", () => {
  test("selects the current iteration and last attempt even when older iterations are reversed", () => {
    const detail = {
      node: { nodeId: "attempt-inside-view", iteration: 2, lastAttempt: 1 },
      attempts: [
        execution(2, 1, "thread-current", 2_000, 2_900),
        execution(1, 8, "thread-old", 1_000, 1_900),
      ],
    };

    expect(parseSmithersNodeExecutionMetadata(detail, "fallback-node")).toMatchObject({
      nodeId: "attempt-inside-view",
      iteration: 2,
      attempt: 1,
      startedAtMs: 2_000,
      finishedAtMs: 2_900,
      agentResume: "thread-current",
    });
  });

  test("enumerates every execution across loop iterations and retries in execution order", () => {
    const history = parseSmithersNodeExecutionMetadataHistory({
      node: { nodeId: "attempt-skeptic", iteration: 3, lastAttempt: 2 },
      attempts: [
        execution(3, 2, "thread-3-2", 3_200, 3_300),
        execution(1, 2, "thread-1-2", 1_200, 1_300),
        { iteration: 2, attempt: 1, startedAtMs: 2_000, finishedAtMs: 2_100, meta: null },
        execution(3, 1, "thread-3-1", 3_000, 3_100),
        execution(1, 1, "thread-1-1", 1_000, 1_100),
      ],
    }, "fallback-node");

    expect(history.map(({ iteration, attempt, agentResume, startedAtMs, finishedAtMs }) => ({
      iteration,
      attempt,
      agentResume,
      startedAtMs,
      finishedAtMs,
    }))).toEqual([
      { iteration: 1, attempt: 1, agentResume: "thread-1-1", startedAtMs: 1_000, finishedAtMs: 1_100 },
      { iteration: 1, attempt: 2, agentResume: "thread-1-2", startedAtMs: 1_200, finishedAtMs: 1_300 },
      { iteration: 2, attempt: 1, agentResume: null, startedAtMs: 2_000, finishedAtMs: 2_100 },
      { iteration: 3, attempt: 1, agentResume: "thread-3-1", startedAtMs: 3_000, finishedAtMs: 3_100 },
      { iteration: 3, attempt: 2, agentResume: "thread-3-2", startedAtMs: 3_200, finishedAtMs: 3_300 },
    ]);
  });
});

function execution(
  iteration: number,
  attempt: number,
  agentResume: string,
  startedAtMs: number,
  finishedAtMs: number,
) {
  return {
    iteration,
    attempt,
    startedAtMs,
    finishedAtMs,
    meta: {
      agentId: `forecast:role:codex:${iteration}-${attempt}`,
      agentModel: "gpt-5.5",
      agentEngine: "CodexAgent",
      agentResume,
    },
  };
}
