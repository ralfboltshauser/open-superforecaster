import { z } from "zod";

const EPSILON_PERCENT = 0.01;

export const binaryEnsembleControlsSchema = z.object({
  version: z.literal("binary-ensemble-controls-v1"),
  componentCount: z.number().int().min(1),
  arithmeticMean: z.number().min(0).max(100),
  median: z.number().min(0).max(100),
  logitMean: z.number().min(0).max(100),
  trimmedMean: z.number().min(0).max(100).nullable(),
  minimum: z.number().min(0).max(100),
  maximum: z.number().min(0).max(100),
  range: z.number().min(0).max(100),
  standardDeviation: z.number().min(0).max(50),
});

export const binaryForecastOutputSchema = z.object({
  probability: z.number().min(0).max(100),
  method: z.string(),
  status: z.enum(["production_control", "experimental_candidate"]),
});

export const binaryEnsembleSchema = z.object({
  controls: binaryEnsembleControlsSchema,
  autonomous: binaryForecastOutputSchema,
  crowdAssisted: binaryForecastOutputSchema.extend({
    marketProbability: z.number().min(0).max(100),
    autonomousWeight: z.number().min(0).max(1),
  }).nullable(),
  candidates: z.object({
    logitPool: binaryForecastOutputSchema,
    priorShrinkage: binaryForecastOutputSchema.extend({
      priorProbability: z.number().min(0).max(100),
      effectiveForecasterCount: z.number().positive(),
      priorPseudoCount: z.number().nonnegative(),
    }).nullable(),
  }),
  invariant: z.literal("Market or crowd data never changes the autonomous forecast."),
});

export type BinaryEnsemble = z.infer<typeof binaryEnsembleSchema>;

export type BinaryEnsembleOptions = {
  /** A question-specific prior. It is exposed as an experimental candidate only. */
  priorProbability?: number;
  /**
   * Effective independent judgments represented by the panel. This is deliberately
   * separate from the raw component count because same-model agents are correlated.
   */
  effectiveForecasterCount?: number;
  /** Strength of the prior in pseudo-observations. */
  priorPseudoCount?: number;
  /** Timestamped crowd/market probability. It is never used by the autonomous output. */
  marketProbability?: number;
  /** Transparent linear-pool weight for the autonomous forecast in the assisted track. */
  crowdAssistedAutonomousWeight?: number;
};

/**
 * Produce immutable aggregation controls plus clearly labelled experimental
 * candidates. The unweighted arithmetic mean is the production control until a
 * different method wins a paired, out-of-time evaluation.
 */
export function buildBinaryEnsemble(
  rawProbabilities: number[],
  options: BinaryEnsembleOptions = {},
): BinaryEnsemble {
  const probabilities = rawProbabilities.map(assertProbability);
  if (probabilities.length === 0) {
    throw new Error("A binary ensemble requires at least one component probability.");
  }

  const arithmeticMean = mean(probabilities);
  const medianProbability = median(probabilities);
  const logitMeanProbability = logitMean(probabilities);
  const sorted = [...probabilities].sort((left, right) => left - right);
  const minimum = sorted[0];
  const maximum = sorted[sorted.length - 1];
  const standardDeviation = Math.sqrt(mean(probabilities.map((value) => (value - arithmeticMean) ** 2)));
  const trimmedMean = probabilities.length >= 5
    ? mean(sorted.slice(1, -1))
    : null;

  const controls = {
    version: "binary-ensemble-controls-v1" as const,
    componentCount: probabilities.length,
    arithmeticMean: roundProbability(arithmeticMean),
    median: roundProbability(medianProbability),
    logitMean: roundProbability(logitMeanProbability),
    trimmedMean: trimmedMean === null ? null : roundProbability(trimmedMean),
    minimum: roundProbability(minimum),
    maximum: roundProbability(maximum),
    range: roundProbability(maximum - minimum),
    standardDeviation: roundProbability(standardDeviation),
  };

  const priorShrinkage = options.priorProbability === undefined
    ? null
    : buildPriorShrinkageCandidate(arithmeticMean, probabilities.length, options);

  const crowdAssisted = options.marketProbability === undefined
    ? null
    : buildCrowdAssistedCandidate(arithmeticMean, options);

  return binaryEnsembleSchema.parse({
    controls,
    autonomous: {
      probability: controls.arithmeticMean,
      method: "unweighted_arithmetic_mean_v1",
      status: "production_control",
    },
    crowdAssisted,
    candidates: {
      logitPool: {
        probability: controls.logitMean,
        method: "unweighted_logit_pool_v1",
        status: "experimental_candidate",
      },
      priorShrinkage,
    },
    invariant: "Market or crowd data never changes the autonomous forecast.",
  });
}

function buildPriorShrinkageCandidate(
  arithmeticMean: number,
  componentCount: number,
  options: BinaryEnsembleOptions,
) {
  const priorProbability = assertProbability(options.priorProbability as number);
  const effectiveForecasterCount = assertNonNegativeFinite(
    options.effectiveForecasterCount ?? Math.min(1, componentCount),
    "effectiveForecasterCount",
  );
  if (effectiveForecasterCount === 0) {
    throw new Error("effectiveForecasterCount must be greater than zero.");
  }
  const priorPseudoCount = assertNonNegativeFinite(options.priorPseudoCount ?? 1, "priorPseudoCount");
  const denominator = effectiveForecasterCount + priorPseudoCount;
  const probability = denominator === 0
    ? arithmeticMean
    : (
      arithmeticMean * effectiveForecasterCount
      + priorProbability * priorPseudoCount
    ) / denominator;

  return {
    probability: roundProbability(probability),
    method: "prior_pseudocount_shrinkage_v1_unfitted",
    status: "experimental_candidate" as const,
    priorProbability,
    effectiveForecasterCount,
    priorPseudoCount,
  };
}

function buildCrowdAssistedCandidate(
  arithmeticMean: number,
  options: BinaryEnsembleOptions,
) {
  const marketProbability = assertProbability(options.marketProbability as number);
  const autonomousWeight = options.crowdAssistedAutonomousWeight ?? 0.5;
  if (!Number.isFinite(autonomousWeight) || autonomousWeight < 0 || autonomousWeight > 1) {
    throw new Error("crowdAssistedAutonomousWeight must be between 0 and 1.");
  }
  return {
    probability: roundProbability(
      arithmeticMean * autonomousWeight + marketProbability * (1 - autonomousWeight),
    ),
    method: "transparent_market_linear_pool_v1_unfitted",
    status: "experimental_candidate" as const,
    marketProbability,
    autonomousWeight,
  };
}

function assertProbability(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Invalid binary probability: ${String(value)}. Expected a finite value from 0 to 100.`);
  }
  return value;
}

function assertNonNegativeFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function logitMean(probabilities: number[]) {
  const logits = probabilities.map((probability) => {
    const bounded = Math.min(100 - EPSILON_PERCENT, Math.max(EPSILON_PERCENT, probability)) / 100;
    return Math.log(bounded / (1 - bounded));
  });
  const pooled = 1 / (1 + Math.exp(-mean(logits)));
  return pooled * 100;
}

function roundProbability(value: number) {
  return Math.round(value * 10) / 10;
}
