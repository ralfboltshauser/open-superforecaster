import { describe, expect, test } from "bun:test";
import { createRunPlan } from "../apps/web/src/app/api/runs/run-request";

describe("forecast run request timing", () => {
  test("preserves explicit timing in launch input, persisted config, and artifact schema", () => {
    const plan = createRunPlan({
      mode: "forecast",
      forecastType: "numeric",
      prompt: "How many launches will occur?",
      forecastAsOf: "2026-07-10T14:30:00+02:00",
      evidenceAsOf: "2026-07-09",
      cutoffDate: "2026-07-08",
    });

    expect(plan.smithersInput).toMatchObject({
      forecastAsOf: "2026-07-10T12:30:00.000Z",
      evidenceAsOf: "2026-07-09",
      cutoffDate: "2026-07-08",
    });
    expect(plan.configJson.forecastInput).toEqual(plan.smithersInput);
    const properties = (plan.schemaJson as { properties: Record<string, unknown> }).properties;
    expect(properties).toHaveProperty("forecastAsOf");
    expect(properties).toHaveProperty("evidenceAsOf");
    expect(properties).toHaveProperty("cutoffDate");
  });

  test("assigns an immutable request-time forecastAsOf while preserving missing cutoffs", () => {
    const plan = createRunPlan({
      mode: "forecast",
      forecastType: "binary",
      prompt: "Will the event happen?",
      present_date: "2026-07-09",
    }, {
      now: "2026-07-10T12:30:00Z",
    });

    expect(plan.smithersInput).toMatchObject({
      forecastAsOf: "2026-07-10T12:30:00.000Z",
      evidenceAsOf: "2026-07-09",
      cutoffDate: null,
    });
    expect(plan.configJson.forecastInput).toEqual(plan.smithersInput);
  });
});

describe("binary forecast variants", () => {
  test("preserves an explicitly named calibration-guard experiment in durable launch input", () => {
    const plan = createRunPlan({
      mode: "forecast",
      forecastType: "binary",
      prompt: "Will the event happen?",
      calibrationGuardVariant: "topical_regex_experimental_v1",
    }, {
      now: "2026-07-10T12:30:00Z",
    });

    expect(plan.smithersInput).toMatchObject({
      calibrationGuardVariant: "topical_regex_experimental_v1",
    });
    expect(plan.configJson.forecastInput).toEqual(plan.smithersInput);
  });

  test("preserves an explicit research treatment and rejects unknown treatments", () => {
    const plan = createRunPlan({
      mode: "forecast",
      forecastType: "binary",
      prompt: "Will the event happen?",
      researchTreatment: "shared_frozen_dossier",
    }, {
      now: "2026-07-10T12:30:00Z",
    });

    expect(plan.smithersInput).toMatchObject({
      researchTreatment: "shared_frozen_dossier",
    });
    expect(() => createRunPlan({
      mode: "forecast",
      forecastType: "binary",
      prompt: "Will the event happen?",
      researchTreatment: "research_everything_forever",
    })).toThrow("Unknown researchTreatment");
  });
});
