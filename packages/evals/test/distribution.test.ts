import { describe, expect, test } from "bun:test";
import {
  datePinballLoss,
  datePredictionIntervalMetrics,
  dateWeightedIntervalScore,
  intervalScore,
  meanQuantileLoss,
  pinballLoss,
  predictionIntervalMetrics,
  validateQuantileForecast,
  weightedIntervalScore,
} from "../src";

describe("probabilistic distribution metrics", () => {
  test("pinball loss penalizes the relevant quantile tail asymmetrically", () => {
    expect(pinballLoss({ quantile: 0.25, forecast: 10, outcome: 14 })).toBe(1);
    expect(pinballLoss({ quantile: 0.25, forecast: 10, outcome: 6 })).toBe(3);
    expect(pinballLoss({ quantile: 0.5, forecast: 10, outcome: 14 })).toBe(2);
  });

  test("scores a valid monotonic quantile distribution without mutating its order", () => {
    const quantiles = [
      { quantile: 0.9, value: 20 },
      { quantile: 0.1, value: 5 },
      { quantile: 0.5, value: 12 },
    ];
    expect(validateQuantileForecast(quantiles).map((point) => point.quantile)).toEqual([0.1, 0.5, 0.9]);
    expect(quantiles.map((point) => point.quantile)).toEqual([0.9, 0.1, 0.5]);
    expect(meanQuantileLoss({ quantiles, outcome: 12 })).toBeCloseTo(0.5, 12);
  });

  test("rejects crossed, duplicate, and boundary quantiles", () => {
    expect(() => validateQuantileForecast([
      { quantile: 0.1, value: 10 },
      { quantile: 0.9, value: 9 },
    ])).toThrow("nondecreasing");
    expect(() => validateQuantileForecast([
      { quantile: 0.5, value: 10 },
      { quantile: 0.5, value: 11 },
    ])).toThrow("Duplicate");
    expect(() => pinballLoss({ quantile: 1, forecast: 10, outcome: 10 })).toThrow("less than 1");
  });

  test("reports interval coverage, sharpness, and proper interval score", () => {
    expect(predictionIntervalMetrics({
      lower: 10,
      upper: 20,
      outcome: 12,
      miscoverage: 0.2,
      scale: 40,
    })).toEqual({
      covered: true,
      coverage: 1,
      width: 10,
      normalizedWidth: 0.25,
      score: 10,
    });
    expect(intervalScore({ lower: 10, upper: 20, outcome: 8, miscoverage: 0.2 })).toBe(30);
    expect(intervalScore({ lower: 10, upper: 20, outcome: 22, miscoverage: 0.2 })).toBe(30);
  });

  test("weighted interval score combines median and central intervals as a CRPS approximation", () => {
    expect(weightedIntervalScore({
      median: 15,
      intervals: [{ lower: 10, upper: 20, miscoverage: 0.2 }],
      outcome: 12,
    })).toBeCloseTo(5 / 3, 12);
    expect(weightedIntervalScore({
      median: 15,
      intervals: [
        { lower: 5, upper: 25, miscoverage: 0.2 },
        { lower: 10, upper: 20, miscoverage: 0.5 },
      ],
      outcome: 15,
    })).toBeCloseTo(1.8, 12);
    expect(() => weightedIntervalScore({
      median: 15,
      intervals: [{ lower: 16, upper: 20, miscoverage: 0.2 }],
      outcome: 17,
    })).toThrow("Median");
    expect(() => weightedIntervalScore({
      median: 15,
      intervals: [
        { lower: 10, upper: 20, miscoverage: 0.2 },
        { lower: 9, upper: 19, miscoverage: 0.5 },
      ],
      outcome: 15,
    })).toThrow("nested");
  });

  test("date wrappers score in UTC calendar days", () => {
    expect(datePinballLoss({ quantile: 0.5, forecast: "2026-01-11", outcome: "2026-01-15" })).toBe(2);
    expect(datePredictionIntervalMetrics({
      lower: "2026-01-10",
      upper: "2026-01-20",
      outcome: "2026-01-08",
      miscoverage: 0.2,
    })).toEqual({
      covered: false,
      coverage: 0,
      widthDays: 10,
      intervalScoreDays: 30,
    });
    expect(dateWeightedIntervalScore({
      median: "2026-01-15",
      intervals: [{ lower: "2026-01-10", upper: "2026-01-20", miscoverage: 0.2 }],
      outcome: "2026-01-12",
    })).toBeCloseTo(5 / 3, 12);
  });

  test("date metrics reject normalized-over invalid dates", () => {
    expect(() => datePinballLoss({
      quantile: 0.5,
      forecast: "2026-02-30",
      outcome: "2026-03-01",
    })).toThrow("Invalid calendar date");
    expect(() => datePinballLoss({
      quantile: 0.5,
      forecast: "March 1, 2026",
      outcome: "2026-03-01",
    })).toThrow("YYYY-MM-DD");
  });
});
