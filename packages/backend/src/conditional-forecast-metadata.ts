export type ConditionalForecastSnapshot = {
  conditionProbability: number | null;
  probabilityGivenCondition: number | null;
  probabilityGivenNotCondition: number | null;
  probabilityDelta: number | null;
  effectBand: "none" | "small" | "moderate" | "large" | "unknown";
  condition: string | null;
  attemptCount: number | null;
  componentBranchCount: number | null;
  givenConditionDisagreement: number | null;
  givenNotConditionDisagreement: number | null;
  effectDisagreement: number | null;
  branchDisagreementBand: "tight" | "moderate" | "wide" | "unknown";
  effectDirectionAgreement: "aligned_positive" | "aligned_negative" | "aligned_none" | "mixed" | "unknown";
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
  const branchStats = readBranchStats(conditional);
  if (
    probabilityGivenCondition === null &&
    probabilityGivenNotCondition === null &&
    probabilityDelta === null &&
    conditionProbability === null &&
    condition === null &&
    attemptCount === null &&
    branchStats.componentBranchCount === null
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
    ...branchStats,
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

function readBranchStats(value: unknown): Pick<
  ConditionalForecastSnapshot,
  | "componentBranchCount"
  | "givenConditionDisagreement"
  | "givenNotConditionDisagreement"
  | "effectDisagreement"
  | "branchDisagreementBand"
  | "effectDirectionAgreement"
> {
  const record = asRecord(value);
  const explicitComponentBranchCount = readNumber(record, "componentBranchCount", "component_branch_count");
  const explicitGivenConditionDisagreement = readNumber(record, "givenConditionDisagreement", "given_condition_disagreement");
  const explicitGivenNotConditionDisagreement = readNumber(record, "givenNotConditionDisagreement", "given_not_condition_disagreement");
  const explicitEffectDisagreement = readNumber(record, "effectDisagreement", "effect_disagreement");
  const explicitBand = readBranchDisagreementBand(record);
  const explicitDirectionAgreement = readEffectDirectionAgreement(record);
  const componentBranches = readRecordArray(record, "componentBranches", "component_branches");
  if (componentBranches.length === 0) {
    const maxExplicitDisagreement = maxNullable([
      explicitGivenConditionDisagreement,
      explicitGivenNotConditionDisagreement,
      explicitEffectDisagreement,
    ]);
    return {
      componentBranchCount: explicitComponentBranchCount,
      givenConditionDisagreement: explicitGivenConditionDisagreement,
      givenNotConditionDisagreement: explicitGivenNotConditionDisagreement,
      effectDisagreement: explicitEffectDisagreement,
      branchDisagreementBand: explicitBand ?? conditionalBranchDisagreementBand(maxExplicitDisagreement),
      effectDirectionAgreement: explicitDirectionAgreement ?? "unknown",
    };
  }
  const givenConditionValues = componentBranches
    .map((branch) => readNumber(branch, "probabilityGivenCondition", "probability_given_condition"))
    .filter((value): value is number => value !== null);
  const givenNotConditionValues = componentBranches
    .map((branch) => readNumber(branch, "probabilityGivenNotCondition", "probability_given_not_condition"))
    .filter((value): value is number => value !== null);
  const effectValues = componentBranches
    .map((branch) => {
      const givenCondition = readNumber(branch, "probabilityGivenCondition", "probability_given_condition");
      const givenNotCondition = readNumber(branch, "probabilityGivenNotCondition", "probability_given_not_condition");
      return givenCondition === null || givenNotCondition === null ? null : roundOne(givenCondition - givenNotCondition);
    })
    .filter((value): value is number => value !== null);
  const givenConditionDisagreement = spread(givenConditionValues);
  const givenNotConditionDisagreement = spread(givenNotConditionValues);
  const effectDisagreement = spread(effectValues);
  return {
    componentBranchCount: componentBranches.length,
    givenConditionDisagreement,
    givenNotConditionDisagreement,
    effectDisagreement,
    branchDisagreementBand: conditionalBranchDisagreementBand(
      Math.max(givenConditionDisagreement ?? 0, givenNotConditionDisagreement ?? 0, effectDisagreement ?? 0),
    ),
    effectDirectionAgreement: conditionalEffectDirectionAgreement(effectValues),
  };
}

export function conditionalBranchDisagreementBand(value: number | null): ConditionalForecastSnapshot["branchDisagreementBand"] {
  if (value === null || !Number.isFinite(value)) {
    return "unknown";
  }
  if (value >= 30) {
    return "wide";
  }
  if (value >= 12) {
    return "moderate";
  }
  return "tight";
}

export function conditionalEffectDirectionAgreement(values: number[]): ConditionalForecastSnapshot["effectDirectionAgreement"] {
  if (values.length === 0) {
    return "unknown";
  }
  const directions = new Set(values.map((value) => effectDirection(value)));
  if (directions.size > 1) {
    return "mixed";
  }
  const [direction] = directions;
  if (direction === "positive") {
    return "aligned_positive";
  }
  if (direction === "negative") {
    return "aligned_negative";
  }
  return "aligned_none";
}

function effectDirection(value: number) {
  if (value >= 3) {
    return "positive";
  }
  if (value <= -3) {
    return "negative";
  }
  return "none";
}

function spread(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return roundOne(Math.max(...values) - Math.min(...values));
}

function maxNullable(values: Array<number | null>) {
  const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finiteValues.length === 0 ? null : Math.max(...finiteValues);
}

function readBranchDisagreementBand(value: unknown): ConditionalForecastSnapshot["branchDisagreementBand"] | null {
  const raw = readString(value, "branchDisagreementBand", "branch_disagreement_band");
  return raw === "tight" || raw === "moderate" || raw === "wide" || raw === "unknown" ? raw : null;
}

function readEffectDirectionAgreement(value: unknown): ConditionalForecastSnapshot["effectDirectionAgreement"] | null {
  const raw = readString(value, "effectDirectionAgreement", "effect_direction_agreement");
  return raw === "aligned_positive" || raw === "aligned_negative" || raw === "aligned_none" || raw === "mixed" || raw === "unknown" ? raw : null;
}

function readRecordArray(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  for (const key of keys) {
    const raw = record[key];
    if (Array.isArray(raw)) {
      return raw.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
    }
  }
  return [];
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
