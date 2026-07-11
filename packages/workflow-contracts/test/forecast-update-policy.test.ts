import { describe, expect, test } from "bun:test";
import { planNextForecastReview } from "../src/forecast-update-policy";

describe("forecast review cadence policy", () => {
  test("uses a deterministic, versioned cadence and treats date-only boundaries as end-of-day", () => {
    const plan = planNextForecastReview({
      asOf: "2026-07-10T12:00:00Z",
      resolutionDate: "2026-07-20",
    });

    expect(plan).toMatchObject({
      version: "forecast-review-cadence-v1",
      status: "scheduled",
      cadenceDays: 1,
      nextReviewAt: "2026-07-11T12:00:00.000Z",
    });
  });

  test("does not conflate a past evidence cutoff with the resolution boundary", () => {
    expect(planNextForecastReview({
      asOf: "2026-07-10T12:00:00Z",
      cutoffDate: "2026-07-09",
    })).toMatchObject({
      status: "scheduled",
      nextReviewAt: "2026-08-09T12:00:00.000Z",
    });
  });
});
