export type ConditionalForecastSnapshot = {
  conditionProbability: number | null;
  probabilityGivenCondition: number | null;
  probabilityGivenNotCondition: number | null;
  probabilityDelta: number | null;
  effectBand: "none" | "small" | "moderate" | "large" | "unknown";
  condition: string | null;
  attemptCount: number | null;
};

export function readConditionalForecastSnapshot(value: unknown): ConditionalForecastSnapshot | null {
  const record = asRecord(value);
  const conditional = asRecord(record?.conditionalForecast) ?? record;
  if (!conditional) {
    return null;
  }
  const probabilityGivenCondition = readNumber(conditional, "probabilityGivenCondition", "probability_given_condition");
  const probabilityGivenNotCondition = readNumber(conditional, "probabilityGivenNotCondition", "probability_given_not_condition");
  const explicitDelta = readNumber(conditional, "probabilityDelta", "probability_delta");
  const probabilityDelta =
    explicitDelta ??
    (probabilityGivenCondition === null || probabilityGivenNotCondition === null
      ? null
      : roundOne(probabilityGivenCondition - probabilityGivenNotCondition));
  const conditionProbability = readNumber(conditional, "conditionProbability", "condition_probability");
  const condition = readString(conditional, "condition");
  const attemptCount = readNumber(conditional, "attemptCount", "attempt_count");
  if (
    probabilityGivenCondition === null &&
    probabilityGivenNotCondition === null &&
    probabilityDelta === null &&
    conditionProbability === null &&
    condition === null &&
    attemptCount === null
  ) {
    return null;
  }
  return {
    conditionProbability,
    probabilityGivenCondition,
    probabilityGivenNotCondition,
    probabilityDelta,
    effectBand: conditionalEffectBand(probabilityDelta),
    condition,
    attemptCount,
  };
}

export function conditionalEffectBand(delta: number | null): ConditionalForecastSnapshot["effectBand"] {
  if (delta === null || !Number.isFinite(delta)) {
    return "unknown";
  }
  const absolute = Math.abs(delta);
  if (absolute >= 30) {
    return "large";
  }
  if (absolute >= 10) {
    return "moderate";
  }
  if (absolute >= 3) {
    return "small";
  }
  return "none";
}

function readString(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

function readNumber(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return null;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
