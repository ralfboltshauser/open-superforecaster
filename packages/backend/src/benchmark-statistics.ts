import { createHash } from "node:crypto";

export type BootstrapMeanInterval = {
  pairedCaseCount: number;
  mean: number | null;
  lower: number | null;
  upper: number | null;
  standardError: number | null;
};

export type ClusteredBootstrapMeanInterval = BootstrapMeanInterval & {
  clusterCount: number;
};

export type BootstrapOptions = {
  seedKey: string;
  samples: number;
  confidenceLevel: number;
};

/** IID paired bootstrap over individual case-level score differences. */
export function bootstrapMeanInterval(values: readonly number[], input: BootstrapOptions): BootstrapMeanInterval {
  validateBootstrapOptions(input);
  const finiteValues = values.filter(Number.isFinite);
  const mean = meanNumbers(finiteValues);
  if (finiteValues.length === 0 || mean === null) {
    return emptyInterval(0);
  }
  if (finiteValues.length === 1) {
    return pointInterval(1, mean);
  }

  const sampleMeans: number[] = [];
  const rng = seededRandom(input.seedKey);
  for (let sampleIndex = 0; sampleIndex < input.samples; sampleIndex += 1) {
    let sum = 0;
    for (let valueIndex = 0; valueIndex < finiteValues.length; valueIndex += 1) {
      sum += finiteValues[Math.floor(rng() * finiteValues.length)] ?? 0;
    }
    sampleMeans.push(sum / finiteValues.length);
  }
  return intervalFromSamples(finiteValues.length, mean, sampleMeans, input.confidenceLevel);
}

/**
 * Paired cluster bootstrap over whole event/question families. All score rows in
 * a sampled family travel together, preserving within-event dependence.
 */
export function clusteredBootstrapMeanInterval(
  rows: readonly Readonly<{ clusterId: string; value: number }>[],
  input: BootstrapOptions,
): ClusteredBootstrapMeanInterval {
  validateBootstrapOptions(input);
  const clusters = new Map<string, number[]>();
  let pairedCaseCount = 0;
  for (const [index, row] of rows.entries()) {
    if (!Number.isFinite(row.value)) {
      continue;
    }
    const clusterId = row.clusterId.trim();
    if (!clusterId) {
      throw new Error(`rows[${index}].clusterId must not be empty.`);
    }
    const values = clusters.get(clusterId) ?? [];
    values.push(row.value);
    clusters.set(clusterId, values);
    pairedCaseCount += 1;
  }

  const allValues = [...clusters.values()].flat();
  const mean = meanNumbers(allValues);
  const clusterIds = [...clusters.keys()].sort();
  if (pairedCaseCount === 0 || mean === null) {
    return { ...emptyInterval(0), clusterCount: 0 };
  }
  if (clusterIds.length === 1) {
    return {
      pairedCaseCount,
      clusterCount: 1,
      mean,
      lower: null,
      upper: null,
      standardError: null,
    };
  }

  const sampleMeans: number[] = [];
  const rng = seededRandom(input.seedKey);
  for (let sampleIndex = 0; sampleIndex < input.samples; sampleIndex += 1) {
    let sum = 0;
    let count = 0;
    for (let clusterIndex = 0; clusterIndex < clusterIds.length; clusterIndex += 1) {
      const sampledId = clusterIds[Math.floor(rng() * clusterIds.length)]!;
      for (const value of clusters.get(sampledId) ?? []) {
        sum += value;
        count += 1;
      }
    }
    sampleMeans.push(count === 0 ? 0 : sum / count);
  }
  return {
    ...intervalFromSamples(pairedCaseCount, mean, sampleMeans, input.confidenceLevel),
    clusterCount: clusterIds.length,
  };
}

function validateBootstrapOptions(input: BootstrapOptions) {
  if (!Number.isInteger(input.samples) || input.samples < 1) {
    throw new Error(`samples must be a positive integer: ${input.samples}`);
  }
  if (!Number.isFinite(input.confidenceLevel) || input.confidenceLevel <= 0 || input.confidenceLevel >= 1) {
    throw new Error(`confidenceLevel must be greater than 0 and less than 1: ${input.confidenceLevel}`);
  }
  if (!input.seedKey) {
    throw new Error("seedKey must not be empty.");
  }
}

function intervalFromSamples(
  pairedCaseCount: number,
  mean: number,
  sampleMeans: number[],
  confidenceLevel: number,
): BootstrapMeanInterval {
  sampleMeans.sort((left, right) => left - right);
  const alpha = 1 - confidenceLevel;
  return {
    pairedCaseCount,
    mean,
    lower: quantile(sampleMeans, alpha / 2),
    upper: quantile(sampleMeans, 1 - alpha / 2),
    standardError: standardDeviation(sampleMeans),
  };
}

function emptyInterval(pairedCaseCount: number): BootstrapMeanInterval {
  return {
    pairedCaseCount,
    mean: null,
    lower: null,
    upper: null,
    standardError: null,
  };
}

function pointInterval(pairedCaseCount: number, mean: number): BootstrapMeanInterval {
  return {
    pairedCaseCount,
    mean,
    lower: mean,
    upper: mean,
    standardError: 0,
  };
}

function meanNumbers(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function quantile(sortedValues: readonly number[], q: number) {
  if (sortedValues.length === 0) {
    return null;
  }
  const boundedQ = Math.max(0, Math.min(1, q));
  const position = (sortedValues.length - 1) * boundedQ;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex] ?? sortedValues[0] ?? 0;
  const upper = sortedValues[upperIndex] ?? sortedValues[sortedValues.length - 1] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function standardDeviation(values: readonly number[]) {
  if (values.length < 2) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function seededRandom(seedKey: string) {
  const seedBytes = createHash("sha256").update(seedKey).digest();
  let state = seedBytes.readUInt32LE(0);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
