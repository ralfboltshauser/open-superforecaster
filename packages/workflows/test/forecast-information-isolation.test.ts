import { describe, expect, test } from "bun:test";
import {
  componentEvidenceIsolationFlags,
  componentHumanForecastExposureFlags,
  sanitizeAutonomousContextText,
  textReportsPossibleHumanForecastExposure,
} from "../src/forecast-information-isolation";

describe("autonomous information isolation", () => {
  test("does not treat a negative warning as evidence of human-forecast exposure", () => {
    expect(componentHumanForecastExposureFlags([{
      roleId: "base-rate",
      usedDisallowedEvidence: false,
      calibrationWarnings: [
        "No prediction-market, crowd, bookmaker, or analyst-probability evidence was used.",
      ],
    }])).toEqual([]);
    expect(textReportsPossibleHumanForecastExposure(
      "Used no external research, prediction markets, crowd forecasts, bookmaker odds, analyst probability calls, or redacted human forecast.",
    )).toBe(false);
    expect(textReportsPossibleHumanForecastExposure(
      "Kept the autonomous track clean by not using prediction markets, crowd forecasts, bookmaker odds, analyst probabilities, or the redacted human forecast.",
    )).toBe(false);
    expect(textReportsPossibleHumanForecastExposure(
      "No prediction markets, crowd forecasts, or bookmaker odds were used.",
    )).toBe(false);
    expect(textReportsPossibleHumanForecastExposure("We never consulted PredictIt.")).toBe(false);
    expect(textReportsPossibleHumanForecastExposure("The Metaculus forecast was not used or inferred.")).toBe(false);
    expect(textReportsPossibleHumanForecastExposure("The Metaculus 70% forecast was not used.")).toBe(true);
  });

  test("retains explicit structured exposure admissions", () => {
    expect(componentHumanForecastExposureFlags([{
      roleId: "inside-view",
      usedDisallowedEvidence: true,
      calibrationWarnings: [],
    }])).toEqual(["component_used_disallowed_evidence:inside-view"]);
  });

  test("distinguishes prohibitions from supplied human-forecast context", () => {
    expect(textReportsPossibleHumanForecastExposure(
      "Do not use prediction markets or crowd forecasts for this autonomous run.",
    )).toBe(false);
    expect(textReportsPossibleHumanForecastExposure(
      "Metaculus forecasters currently assign 70% to YES.",
    )).toBe(true);
    expect(textReportsPossibleHumanForecastExposure(
      "No prediction market was used, but Metaculus forecasters currently assign 70% to YES.",
    )).toBe(true);
    expect(textReportsPossibleHumanForecastExposure("Prediction market evidence was not used.")).toBe(false);
    expect(textReportsPossibleHumanForecastExposure("Bookmaker odds were not used.")).toBe(false);
    expect(textReportsPossibleHumanForecastExposure("We did not ignore Metaculus, which currently assigns 70%.")).toBe(true);
    expect(textReportsPossibleHumanForecastExposure("No source contradicted the Metaculus forecast of 70%.")).toBe(true);
    expect(textReportsPossibleHumanForecastExposure("Prediction-market odds were 70%.")).toBe(true);
    expect(textReportsPossibleHumanForecastExposure(
      "Do not use prediction markets, because Metaculus says 70%.",
    )).toBe(true);
    expect(textReportsPossibleHumanForecastExposure("Experts put probability at 70%.")).toBe(true);
    expect(textReportsPossibleHumanForecastExposure("Forecasters estimate 70%.")).toBe(true);
    expect(textReportsPossibleHumanForecastExposure("Good Judgment Open assigns 70%.")).toBe(true);
    expect(textReportsPossibleHumanForecastExposure("The market prices YES at 70%.")).toBe(true);
  });

  test("redacts supplied probabilities but preserves non-use instructions", () => {
    const sanitized = sanitizeAutonomousContextText(
      "Do not use prediction markets. Metaculus currently assigns 70%. Use underlying facts instead.",
    );
    expect(sanitized).toContain("Do not use prediction markets.");
    expect(sanitized).toContain("[REDACTED");
    expect(sanitized).not.toContain("70%");
  });

  test("carries human-forecast and temporal citation violations across every round", () => {
    expect(componentEvidenceIsolationFlags([{
      roleId: "base-rate",
      round: 1,
      usedDisallowedEvidence: false,
      citedSources: [{
        title: "PredictIt market",
        url: "https://www.predictit.org/markets/example",
        publishedAt: "2026-07-11T00:00:00Z",
        claim: "YES traded at 70%.",
      }],
    }], {
      cutoffDate: "2026-07-10T23:59:59Z",
      evidenceAsOf: "2026-07-10T12:00:00Z",
    })).toEqual([
      "component_human_forecast_source:base-rate:round-1:attempt-0:source-0",
      "component_post_cutoff_source:base-rate:round-1:attempt-0:source-0",
      "component_source_after_evidence_as_of:base-rate:round-1:attempt-0:source-0",
    ]);
    expect(componentEvidenceIsolationFlags([{
      roleId: "inside-view",
      round: 1,
      usedDisallowedEvidence: false,
      keyUncertainties: ["Metaculus currently says 70%; will it be right?"],
    }])).toEqual([
      "component_reported_human_forecast_content:inside-view:round-1:attempt-0",
    ]);
  });
});
