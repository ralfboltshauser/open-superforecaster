import { describe, expect, test } from "bun:test";
import {
  bootstrapMeanInterval,
  clusteredBootstrapMeanInterval,
} from "../src/benchmark-statistics";

const options = {
  seedKey: "benchmark-statistics-test",
  samples: 4_000,
  confidenceLevel: 0.95,
};

describe("benchmark bootstrap statistics", () => {
  test("IID paired bootstrap is deterministic and preserves the observed mean", () => {
    const first = bootstrapMeanInterval([-0.03, -0.01, 0, 0.02], options);
    const second = bootstrapMeanInterval([-0.03, -0.01, 0, 0.02], options);
    expect(first).toEqual(second);
    expect(first.mean).toBeCloseTo(-0.005, 12);
    expect(first.lower).toBeLessThan(first.upper!);
  });

  test("cluster bootstrap resamples whole event families", () => {
    const rows = [
      ...Array.from({ length: 8 }, () => ({ clusterId: "event-a", value: -1 })),
      ...Array.from({ length: 8 }, () => ({ clusterId: "event-b", value: 1 })),
      ...Array.from({ length: 8 }, () => ({ clusterId: "event-c", value: -0.5 })),
      ...Array.from({ length: 8 }, () => ({ clusterId: "event-d", value: 0.5 })),
    ];
    const iid = bootstrapMeanInterval(rows.map((row) => row.value), options);
    const clustered = clusteredBootstrapMeanInterval(rows, options);
    expect(clustered.pairedCaseCount).toBe(32);
    expect(clustered.clusterCount).toBe(4);
    expect(clustered.mean).toBeCloseTo(0, 12);
    expect(clustered.standardError!).toBeGreaterThan(iid.standardError! * 2);
  });

  test("reports no artificial precision with a single event family", () => {
    expect(clusteredBootstrapMeanInterval([
      { clusterId: "one-event", value: -0.1 },
      { clusterId: "one-event", value: 0.2 },
    ], options)).toEqual({
      pairedCaseCount: 2,
      clusterCount: 1,
      mean: 0.05,
      lower: null,
      upper: null,
      standardError: null,
    });
  });
});
