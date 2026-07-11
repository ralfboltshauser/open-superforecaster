import { describe, expect, test } from "bun:test";
import { traceEventTypeSchema } from "../src";

describe("trace event contract", () => {
  test("accepts provider-observed activity and its observation lifecycle", () => {
    for (const eventType of [
      "provider_activity_observation_completed",
      "provider_activity_observation_failed",
      "provider_observed_activity",
    ] as const) {
      expect(traceEventTypeSchema.parse(eventType)).toBe(eventType);
    }
  });
});
