import { describe, expect, test } from "bun:test";
import { nextForecastUpdateAt, updateKindForTrigger } from "./forecast-update-runner";

describe("live forecast update scheduling", () => {
  const now = new Date("2026-07-10T12:00:00Z");

  test("increases review cadence as the resolution boundary approaches", () => {
    expect(nextForecastUpdateAt({ now, resolutionDate: "2026-07-20T12:00:00Z" })?.toISOString())
      .toBe("2026-07-11T12:00:00.000Z");
    expect(nextForecastUpdateAt({ now, resolutionDate: "2026-08-29T12:00:00Z" })?.toISOString())
      .toBe("2026-07-17T12:00:00.000Z");
    expect(nextForecastUpdateAt({ now })?.toISOString())
      .toBe("2026-08-09T12:00:00.000Z");
  });

  test("does not treat a past evidence cutoff as a resolution boundary", () => {
    expect(nextForecastUpdateAt({ now, cutoffDate: "2026-07-01" })?.toISOString())
      .toBe("2026-08-09T12:00:00.000Z");
  });

  test("keeps scheduled and event-triggered updates distinct", () => {
    expect(updateKindForTrigger("scheduled_review")).toBe("scheduled");
    expect(updateKindForTrigger("authoritative_source_changed")).toBe("event_triggered");
  });
});
