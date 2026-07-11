import { describe, expect, test } from "bun:test";
import {
  applyBinaryCalibrationGuard,
  binaryCalibrationGuardVariantNone,
  binaryCalibrationGuardVariantTopicalRegexExperimentalV1,
  readBinaryCalibrationGuardVariant,
} from "../src/binary-calibration-guard";
import { agents } from "../src/agents";

const benchmarkShapedInput = {
  probability: 25,
  question: "Will the company deliver at least 100000 units before the deadline?",
  resolutionCriteria: "Resolve from official delivery totals.",
  background: "Recent output has recently begun from limited initial production.",
  fixedEvidence: "The ramp is hard and unusual manufacturing constraints remain.",
};

describe("binary calibration variants", () => {
  test("does not apply topical regex rules by default and retains the raw probability", () => {
    expect(applyBinaryCalibrationGuard(benchmarkShapedInput)).toEqual({
      variant: binaryCalibrationGuardVariantNone,
      experimental: false,
      rawProbability: 25,
      probability: 25,
      adjustment: 0,
      notes: [],
      appliedRules: [],
    });
  });

  test("applies the old behavior only under its named experimental variant", () => {
    const guarded = applyBinaryCalibrationGuard({
      ...benchmarkShapedInput,
      variant: binaryCalibrationGuardVariantTopicalRegexExperimentalV1,
    });

    expect(guarded.variant).toBe(binaryCalibrationGuardVariantTopicalRegexExperimentalV1);
    expect(guarded.experimental).toBe(true);
    expect(guarded.rawProbability).toBe(25);
    expect(guarded.probability).toBe(20);
    expect(guarded.adjustment).toBe(-5);
    expect(guarded.appliedRules.map((rule) => rule.id)).toEqual(["production-ramp-threshold"]);
  });

  test("requires an exact opt-in variant name", () => {
    expect(readBinaryCalibrationGuardVariant("topical_regex_experimental_v1"))
      .toBe(binaryCalibrationGuardVariantTopicalRegexExperimentalV1);
    expect(readBinaryCalibrationGuardVariant("legacy"))
      .toBe(binaryCalibrationGuardVariantNone);
    expect(readBinaryCalibrationGuardVariant(undefined))
      .toBe(binaryCalibrationGuardVariantNone);
  });
});

describe("forecast provider routing", () => {
  test("creates role agents through the forecast purpose rather than research purpose", () => {
    expect(agents.forecast("base-rate").id).toStartWith("forecast:base-rate:");
    expect(agents.research("base-rate").id).toStartWith("research:base-rate:");
  });
});
