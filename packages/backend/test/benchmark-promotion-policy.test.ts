import { describe, expect, test } from "bun:test";
import {
  benchmarkEvidenceTiers,
  benchmarkSmokeEvidenceTier,
  benchmarkStatisticalPromotionEvidenceTier,
  minimumPromotionHoldoutCases,
  minimumPromotionPairedCases,
  minimumPromotionResultCases,
  summarizeBenchmarkEvidenceTier,
} from "../src/benchmark-promotion-policy";

describe("benchmark evidence tiers", () => {
  test("labels the legacy 10-case constants as smoke-only compatibility thresholds", () => {
    expect(minimumPromotionResultCases).toBe(10);
    expect(minimumPromotionPairedCases).toBe(10);
    expect(minimumPromotionHoldoutCases).toBe(10);
    expect(benchmarkSmokeEvidenceTier.statisticallyPromotable).toBeFalse();
    expect(benchmarkSmokeEvidenceTier.intendedUse).toContain("never a quality promotion claim");
  });

  test("does not call a small candidate-better run statistically promotable", () => {
    const summary = summarizeBenchmarkEvidenceTier({
      resultCount: 24,
      pairedCaseCount: 24,
      holdoutCaseCount: 10,
      independentEventFamilyCount: null,
      eventFamilyMetadataCoverage: null,
    });
    expect(summary.achievedTier).toBe("smoke");
    expect(summary.smokeOnly).toBeTrue();
    expect(summary.statisticalPromotionReady).toBeFalse();
    expect(summary.note).toContain("smoke evidence only");
  });

  test("requires substantial paired holdout and explicit event-family metadata", () => {
    const counts = {
      resultCount: benchmarkStatisticalPromotionEvidenceTier.minimumResultCases,
      pairedCaseCount: benchmarkStatisticalPromotionEvidenceTier.minimumPairedCases,
      holdoutCaseCount: benchmarkStatisticalPromotionEvidenceTier.minimumHoldoutCases,
      independentEventFamilyCount: benchmarkStatisticalPromotionEvidenceTier.minimumIndependentEventFamilies,
      eventFamilyMetadataCoverage: benchmarkStatisticalPromotionEvidenceTier.minimumEventFamilyMetadataCoverage,
    };
    const summary = summarizeBenchmarkEvidenceTier(counts);
    expect(summary.achievedTier).toBe("statistical_promotion");
    expect(summary.statisticalPromotionReady).toBeTrue();

    expect(summarizeBenchmarkEvidenceTier({
      ...counts,
      eventFamilyMetadataCoverage: null,
    }).statisticalPromotionReady).toBeFalse();
  });

  test("keeps a separate tier for experiments targeting small Brier effects", () => {
    const smallEffect = benchmarkEvidenceTiers.find((tier) => tier.id === "small_effect");
    expect(smallEffect?.minimumPairedCases).toBeGreaterThan(benchmarkStatisticalPromotionEvidenceTier.minimumPairedCases);
    expect(smallEffect?.approximateDetectableBrierEffect).toBe(0.004);
  });
});
