import { describe, expect, test } from "bun:test";
import {
  assertBenchmarkPromotionDecisionAllowed,
  summarizeBenchmarkPromotionGateEvidence,
} from "../src/benchmark-service";

describe("benchmark promotion gate tiers", () => {
  test("preserves the legacy smoke review while labeling it non-statistical", () => {
    const gate = summarizeBenchmarkPromotionGateEvidence({
      runStatus: "completed",
      resultCount: 24,
      traceMissing: 0,
      reviewOrFailed: 0,
      comparisonStatus: "candidate_better",
      splitFindings: { holdoutCaseResults: 10 },
    });
    expect(gate.status).toBe("review_for_promotion");
    expect(gate.gatePurpose).toBe("smoke_review");
    expect(gate.statisticalPromotionReady).toBeFalse();
    expect(gate.summary).toContain("compatibility smoke gate");
  });

  test("blocks an actual default promotion when only smoke evidence exists", () => {
    const gate = summarizeBenchmarkPromotionGateEvidence({
      runStatus: "completed",
      resultCount: 24,
      traceMissing: 0,
      reviewOrFailed: 0,
      comparisonStatus: "candidate_better",
      pairedCaseCount: 24,
      pairedHoldoutCaseCount: 10,
      requiredEvidenceTier: "statistical_promotion",
    });
    expect(gate.status).toBe("needs_more_evidence");
    expect(gate.blockers).toContain("insufficient_statistical_promotion_evidence");
    expect(() => assertBenchmarkPromotionDecisionAllowed("promoted_for_local_default", gate)).toThrow(
      "insufficient_statistical_promotion_evidence",
    );
  });

  test("uses aggregate evidence rather than a zero-miss rule at statistical scale", () => {
    const gate = summarizeBenchmarkPromotionGateEvidence({
      runStatus: "completed",
      resultCount: 500,
      traceMissing: 0,
      reviewOrFailed: 0,
      comparisonStatus: "candidate_better",
      pairedCaseCount: 500,
      pairedHoldoutCaseCount: 250,
      independentEventFamilyCount: 200,
      eventFamilyMetadataCoverage: 0.95,
      requiredEvidenceTier: "statistical_promotion",
      forecastErrorFindings: {
        largeProbabilityMissCases: 1,
        worseThanBaselineCases: 1,
      },
    });
    expect(gate.status).toBe("review_for_promotion");
    expect(gate.statisticalPromotionReady).toBeTrue();
    expect(gate.caseLevelQualityBlockersApplied).toBeFalse();
    expect(gate.blockers).not.toContain("large_probability_misses");
    expect(gate.blockers).not.toContain("worse_than_baseline_cases");
  });
});
