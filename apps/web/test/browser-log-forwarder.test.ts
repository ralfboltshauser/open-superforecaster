import { describe, expect, test } from "bun:test"

import { serializeBrowserLogValue } from "../src/lib/browser-log-forwarder"
import { parseBrowserLogBatch } from "../src/lib/browser-log-schema"

describe("browser log serialization", () => {
  test("preserves errors and circular object context", () => {
    const value: Record<string, unknown> = { error: new Error("browser exploded") }
    value.self = value

    const serialized = serializeBrowserLogValue(value)

    expect(serialized).toContain("browser exploded")
    expect(serialized).toContain("Error")
    expect(serialized).toContain("[Circular]")
  })

  test("redacts credential-shaped values", () => {
    const serialized = serializeBrowserLogValue({
      authorization: "Bearer should-never-appear",
      apiKey: "sk-abcdefghijklmnop1234",
      safe: "visible",
    })

    expect(serialized).not.toContain("should-never-appear")
    expect(serialized).not.toContain("abcdefghijklmnop1234")
    expect(serialized).toContain("[REDACTED]")
    expect(serialized).toContain("visible")
  })
})

describe("browser log batch validation", () => {
  test("accepts a bounded valid batch", () => {
    const batch = parseBrowserLogBatch({
      entries: [{
        level: "error",
        source: "window.error",
        timestamp: "2026-07-12T12:00:00.000Z",
        url: "http://localhost:3000/",
        userAgent: "test",
        args: ["boom"],
      }],
    })

    expect(batch?.entries).toHaveLength(1)
    expect(batch?.entries[0]?.args).toEqual(["boom"])
  })

  test("rejects malformed and unbounded batches", () => {
    expect(parseBrowserLogBatch({ entries: [] })).toBeNull()
    expect(parseBrowserLogBatch({ entries: [{ level: "fatal" }] })).toBeNull()
    expect(parseBrowserLogBatch({
      entries: [{
        level: "error",
        source: "console",
        timestamp: "now",
        url: "x".repeat(2_049),
        userAgent: "test",
        args: ["boom"],
      }],
    })).toBeNull()
  })
})
