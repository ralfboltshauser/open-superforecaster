export * from "./distribution";
export * from "./binary-calibration";

export type BinaryScoreInput = {
  probability: number;
  resolved: boolean;
};

export function brierScore(input: BinaryScoreInput) {
  const p = clampProbability(input.probability) / 100;
  const y = input.resolved ? 1 : 0;
  return (p - y) ** 2;
}

export function logScore(input: BinaryScoreInput) {
  const p = clampProbability(input.probability) / 100;
  const y = input.resolved ? 1 : 0;
  const epsilon = 1e-6;
  const safeP = Math.min(1 - epsilon, Math.max(epsilon, p));
  return -(y * Math.log(safeP) + (1 - y) * Math.log(1 - safeP));
}

export function clampProbability(probability: number) {
  if (!Number.isFinite(probability)) {
    throw new Error(`Invalid probability: ${probability}`);
  }
  return Math.min(100, Math.max(0, probability));
}

export function scoreBinaryForecast(input: BinaryScoreInput) {
  return {
    brier: brierScore(input),
    log: logScore(input),
  };
}
