import { describe, expect, test } from "bun:test";
import { forecastTimingArtifactFields, readForecastTiming } from "../src/forecast-timing";

describe("workflow forecast timing", () => {
  test("uses canonical timing in prompts and artifacts", () => {
    const timing = readForecastTiming({
      forecastAsOf: "2026-07-10T14:30:00+02:00",
      evidenceAsOf: "2026-07-09",
      cutoffDate: "2026-07-08",
    });

    expect(timing.forecastAsOf).toBe("2026-07-10T12:30:00.000Z");
    expect(timing.evidenceAsOf).toBe("2026-07-09");
    expect(timing.evidenceAsOfDate).toBe("2026-07-09");
    expect(timing.cutoffDate).toBe("2026-07-08");
    expect(timing.promptBlock).toContain("Hard evidence cutoff: 2026-07-08");
    expect(forecastTimingArtifactFields(timing)).toEqual({
      forecastAsOf: "2026-07-10T12:30:00.000Z",
      evidenceAsOf: "2026-07-09",
      cutoffDate: "2026-07-08",
      evidenceAsOfDate: "2026-07-09",
    });
  });

  test("keeps cutoff-only timing visibly distinct from evidence recency", () => {
    const timing = readForecastTiming({ cutoff_date: "2026-07-08" });

    expect(timing.evidenceAsOf).toBeUndefined();
    expect(timing.evidenceAsOfDate).toBeUndefined();
    expect(timing.cutoffDate).toBe("2026-07-08");
    expect(timing.promptBlock).toContain("Evidence as of: not provided");
  });

  test("keeps exact evidenceAsOf while exposing a day-granularity compatibility field", () => {
    const timing = readForecastTiming({ evidenceAsOf: "2026-07-09T12:34:56Z" });

    expect(timing.evidenceAsOf).toBe("2026-07-09T12:34:56.000Z");
    expect(timing.evidenceAsOfDate).toBe("2026-07-09");
  });
});
