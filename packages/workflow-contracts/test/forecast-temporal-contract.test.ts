import { describe, expect, test } from "bun:test";
import {
  formatForecastTemporalContextForPrompt,
  normalizeForecastInputRow,
  normalizeForecastTemporalContext,
} from "../src";

describe("forecast temporal contract", () => {
  test("normalizes canonical fields without conflating their meanings", () => {
    const timing = normalizeForecastTemporalContext({
      forecastAsOf: "2026-07-10T14:30:00+02:00",
      evidenceAsOf: "2026-07-09",
      cutoffDate: "2026-07-08T23:59:59Z",
    });

    expect(timing).toEqual({
      forecastAsOf: "2026-07-10T12:30:00.000Z",
      evidenceAsOf: "2026-07-09",
      cutoffDate: "2026-07-08T23:59:59.000Z",
    });
  });

  test("maps legacy aliases to canonical fields but does not turn a cutoff into evidence recency", () => {
    expect(normalizeForecastTemporalContext({
      forecast_as_of: "2026-07-10T12:30:00Z",
      present_date: "2026-07-09",
      cutoff: "2026-07-08",
    })).toEqual({
      forecastAsOf: "2026-07-10T12:30:00.000Z",
      evidenceAsOf: "2026-07-09",
      cutoffDate: "2026-07-08",
    });

    expect(normalizeForecastTemporalContext({ cutoffDate: "2026-07-08" })).toEqual({
      cutoffDate: "2026-07-08",
    });
  });

  test("carries normalized timing through the ordinary forecast row", () => {
    const row = normalizeForecastInputRow({
      question: "Will the event happen?",
      forecast_as_of: "2026-07-10T12:30:00Z",
      evidence_as_of_date: "2026-07-09",
      cutoff_date: "2026-07-08",
    });

    expect(row.forecastAsOf).toBe("2026-07-10T12:30:00.000Z");
    expect(row.evidenceAsOf).toBe("2026-07-09");
    expect(row.cutoffDate).toBe("2026-07-08");
  });

  test("makes a missing hard cutoff explicit in prompts", () => {
    const prompt = formatForecastTemporalContextForPrompt({
      forecastAsOf: "2026-07-10T12:30:00.000Z",
      evidenceAsOf: "2026-07-09",
    });

    expect(prompt).toContain("Forecast as of: 2026-07-10T12:30:00.000Z");
    expect(prompt).toContain("Evidence as of: 2026-07-09");
    expect(prompt).toContain("Hard evidence cutoff: not provided");
    expect(prompt).toContain("not proven to be time-bounded");
  });

  test("turns a supplied cutoff into an explicit evidence constraint", () => {
    const prompt = formatForecastTemporalContextForPrompt({
      cutoffDate: "2026-07-08",
    });

    expect(prompt).toContain("Hard evidence cutoff: 2026-07-08");
    expect(prompt).toContain("Do not use information that first became available after");
  });

  test("rejects ambiguous offset-less datetimes", () => {
    expect(() => normalizeForecastTemporalContext({
      forecastAsOf: "2026-07-10T12:30:00",
    })).toThrow();
  });
});
