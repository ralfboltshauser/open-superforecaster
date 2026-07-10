export type BinaryBaselineSanityInput = {
  finalProbability: number;
  components: Array<{ baseRateProbability?: number }>;
};

export type BinaryBaselineSanityAudit = {
  status: "missing_component_base_rates" | "near_baseline" | "moderate_delta" | "large_delta";
  baselineProbability: number | null;
  finalProbability: number;
  baselineDelta: number | null;
  componentBaseRateCount: number;
  componentBaseRateDisagreement: number | null;
  note: string;
};

export function buildBinaryBaselineSanityAudit(input: BinaryBaselineSanityInput): BinaryBaselineSanityAudit {
  const baseRates = input.components
    .map((component) => component.baseRateProbability)
    .filter((probability): probability is number => Number.isFinite(probability));
  if (baseRates.length === 0) {
    return {
      status: "missing_component_base_rates",
      baselineProbability: null,
      finalProbability: input.finalProbability,
      baselineDelta: null,
      componentBaseRateCount: 0,
      componentBaseRateDisagreement: null,
      note:
        "No component base-rate probabilities were available, so the final forecast cannot be audited against a numeric baseline anchor.",
    };
  }
  const baselineProbability = roundProbability(mean(baseRates));
  const baselineDelta = roundProbability(input.finalProbability - baselineProbability);
  const componentBaseRateDisagreement = roundProbability(disagreement(baseRates));
  const absoluteDelta = Math.abs(baselineDelta);
  const status = absoluteDelta >= 25
    ? "large_delta"
    : absoluteDelta >= 12.5
      ? "moderate_delta"
      : "near_baseline";
  return {
    status,
    baselineProbability,
    finalProbability: input.finalProbability,
    baselineDelta,
    componentBaseRateCount: baseRates.length,
    componentBaseRateDisagreement,
    note:
      `Final probability is ${formatSigned(baselineDelta)} points from the mean component base-rate anchor across ${baseRates.length} component(s).`,
  };
}

function roundProbability(value: number) {
  return Math.round(value * 10) / 10;
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 50;
}

function disagreement(values: number[]) {
  return values.length ? Math.max(...values) - Math.min(...values) : 0;
}

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${roundProbability(value)}`;
}
