import { describe, expect, test } from "bun:test";
import { readForecastInputContextSnapshot } from "../src/forecast-input-context-metadata";

describe("forecast input temporal metadata", () => {
  test("persists canonical timing and explicit trust-state bands", () => {
    const snapshot = readForecastInputContextSnapshot({
      forecastInput: {
        question: "Will the event happen?",
        forecastAsOf: "2026-07-10T14:30:00+02:00",
        evidenceAsOf: "2026-07-09",
        cutoffDate: "2026-07-08",
      },
    });

    expect(snapshot).toMatchObject({
      hasForecastAsOf: true,
      forecastAsOf: "2026-07-10T12:30:00.000Z",
      forecastAsOfBand: "specified",
      hasEvidenceAsOfDate: true,
      evidenceAsOfDate: "2026-07-09",
      evidenceAsOfDateBand: "specified",
      hasCutoffDate: true,
      cutoffDate: "2026-07-08",
      cutoffDateBand: "specified",
    });
  });

  test("does not treat a cutoff as evidenceAsOf", () => {
    const snapshot = readForecastInputContextSnapshot({
      forecastInput: {
        question: "Will the event happen?",
        forecastAsOf: "2026-07-10T12:30:00Z",
        cutoffDate: "2026-07-08",
      },
    });

    expect(snapshot).toMatchObject({
      hasEvidenceAsOfDate: false,
      evidenceAsOfDate: null,
      evidenceAsOfDateBand: "missing",
      hasCutoffDate: true,
      cutoffDate: "2026-07-08",
    });
  });
});
