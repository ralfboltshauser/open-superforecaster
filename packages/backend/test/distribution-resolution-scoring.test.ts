import { describe, expect, test } from "bun:test";
import { scoreForecastPrediction } from "../src/resolution-service";

describe("distributional resolution scoring", () => {
  test("scores numeric quantiles with proper losses and interval diagnostics", () => {
    const rows = scoreForecastPrediction({
      forecastType: "numeric",
      prediction: {
        value: 50,
        distribution: { p10: 10, p25: 25, p50: 50, p75: 75, p90: 90 },
      },
      resolvedValue: { value: 60 },
    });
    const scores = Object.fromEntries(rows.map((row) => [row.scoreType, row.scoreValue]));

    expect(scores.absolute_error).toBe(10);
    expect(scores.numeric_pinball_p50).toBe(5);
    expect(scores.numeric_crps_approx_wis).toBeGreaterThan(0);
    expect(scores.numeric_80_interval_coverage).toBe(1);
    expect(scores.numeric_50_interval_coverage).toBe(1);
    expect(scores.numeric_quantile_coherence_violation).toBe(0);
  });

  test("makes crossed numeric quantiles an explicit invalidity instead of scoring them", () => {
    const rows = scoreForecastPrediction({
      forecastType: "numeric",
      prediction: {
        value: 50,
        distribution: { p10: 60, p25: 25, p50: 50, p75: 75, p90: 90 },
      },
      resolvedValue: { value: 60 },
    });
    const scores = Object.fromEntries(rows.map((row) => [row.scoreType, row.scoreValue]));

    expect(scores.numeric_quantile_coherence_violation).toBe(1);
    expect(scores.numeric_crps_approx_wis).toBeUndefined();
    expect(scores.absolute_error).toBe(10);
  });

  test("scores date distributions in calendar days", () => {
    const rows = scoreForecastPrediction({
      forecastType: "date",
      prediction: {
        targetDate: "2026-01-20",
        dateDistribution: {
          p10: "2026-01-01",
          p25: "2026-01-10",
          p50: "2026-01-20",
          p75: "2026-01-30",
          p90: "2026-02-10",
        },
      },
      resolvedValue: { date: "2026-01-25" },
    });
    const scores = Object.fromEntries(rows.map((row) => [row.scoreType, row.scoreValue]));

    expect(scores.absolute_days_error).toBe(5);
    expect(scores.date_pinball_p50).toBe(2.5);
    expect(scores.date_crps_approx_wis_days).toBeGreaterThan(0);
    expect(scores.date_80_interval_coverage).toBe(1);
    expect(scores.date_50_interval_coverage).toBe(1);
    expect(scores.date_quantile_coherence_violation).toBe(0);
  });
});
