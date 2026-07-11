export const binaryPlattCalibrationSchemaVersion = "binary-platt-calibration-candidate/v1" as const;
export const binaryPlattCalibrationMethodVersion = "platt-logit-l2/v1" as const;

export const binaryCalibrationCandidateStatuses = [
  "blocked_by_data_gates",
  "blocked_by_fit",
  "rejected_on_holdout",
  "ready_for_explicit_promotion_review",
] as const;

export type BinaryCalibrationCandidateStatus = typeof binaryCalibrationCandidateStatuses[number];

export type BinaryCalibrationObservation = Readonly<{
  id: string;
  /** Raw autonomous aggregate probability in percentage points. */
  probability: number;
  resolved: boolean;
  /** When the forecast was frozen. Must be an ISO date or offset-qualified ISO instant. */
  forecastAt: string;
  /** When the outcome became known and could enter calibration training. */
  resolvedAt: string;
  /** Stable underlying event/question family; repeated updates must share this ID. */
  eventFamilyId: string;
}>;

export type BinaryPlattCalibrationPolicy = Readonly<{
  minimumObservations: number;
  minimumTrainingObservations: number;
  minimumValidationObservations: number;
  minimumTrainingEventFamilies: number;
  minimumValidationEventFamilies: number;
  validationFraction: number;
  minimumTrainingOutcomesPerClass: number;
  minimumValidationOutcomesPerClass: number;
  probabilityEpsilon: number;
  slopeL2Regularization: number;
  interceptL2Regularization: number;
  maximumIterations: number;
  convergenceTolerance: number;
  confidenceZ: number;
  minimumBrierImprovement: number;
  minimumLogLossImprovement: number;
}>;

export const defaultBinaryPlattCalibrationPolicy: BinaryPlattCalibrationPolicy = {
  minimumObservations: 120,
  minimumTrainingObservations: 80,
  minimumValidationObservations: 40,
  minimumTrainingEventFamilies: 60,
  minimumValidationEventFamilies: 30,
  validationFraction: 0.25,
  minimumTrainingOutcomesPerClass: 10,
  minimumValidationOutcomesPerClass: 5,
  probabilityEpsilon: 1e-4,
  slopeL2Regularization: 1e-2,
  interceptL2Regularization: 1e-6,
  maximumIterations: 100,
  convergenceTolerance: 1e-9,
  confidenceZ: 1.959963984540054,
  minimumBrierImprovement: 0,
  minimumLogLossImprovement: 0,
};

export type BinaryCalibrationDataGate = {
  id: string;
  passed: boolean;
  actual: number | string | null;
  required: number | string;
  detail: string;
};

export type ChronologicalBinaryCalibrationSplit = {
  valid: boolean;
  issues: string[];
  gates: BinaryCalibrationDataGate[];
  training: BinaryCalibrationObservation[];
  validation: BinaryCalibrationObservation[];
  embargoed: BinaryCalibrationObservation[];
  trainingForecastFrom: string | null;
  validationForecastFrom: string | null;
  trainingForecastThrough: string | null;
  validationForecastThrough: string | null;
  trainingOutcomesAvailableThrough: string | null;
  familyOverlap: string[];
  trainingEventFamilies: number;
  validationEventFamilies: number;
};

export type PlattCalibrationParameters = {
  intercept: number;
  slope: number;
  probabilityEpsilon: number;
};

export type PlattCalibrationFit = {
  parameters: PlattCalibrationParameters;
  converged: boolean;
  iterations: number;
  objective: number;
  trainingLogLoss: number;
  trainingRows: number;
  independentUnits: number;
  weighting: "equal_event_family" | "equal_observation";
};

export type MeanMetricComparison = {
  identity: number;
  candidate: number;
  delta: number;
  pairedConfidenceInterval: {
    method: "paired_normal_approximation";
    confidenceLevel: 0.95 | null;
    z: number;
    count: number;
    mean: number;
    lower: number | null;
    upper: number | null;
    standardError: number | null;
  };
};

export type BinaryCalibrationValidation = {
  rows: number;
  independentUnits: number;
  inferenceUnit: "event_family" | "observation";
  brier: MeanMetricComparison;
  logLoss: MeanMetricComparison;
  improvesBrier: boolean;
  improvesLogLoss: boolean;
  brierIntervalBelowIdentity: boolean;
  logLossIntervalBelowIdentity: boolean;
  passesHeldoutGate: boolean;
};

export type BinaryPlattCalibrationCandidate = {
  schemaVersion: typeof binaryPlattCalibrationSchemaVersion;
  methodVersion: typeof binaryPlattCalibrationMethodVersion;
  candidateId: string;
  candidateVersion: string;
  createdAt: string;
  status: BinaryCalibrationCandidateStatus;
  active: false;
  requiresExplicitPromotion: true;
  promotionRecommendation: "blocked" | "reject" | "review_for_explicit_promotion";
  policy: BinaryPlattCalibrationPolicy;
  split: ChronologicalBinaryCalibrationSplit;
  fit: PlattCalibrationFit | null;
  parameters: PlattCalibrationParameters | null;
  validation: BinaryCalibrationValidation | null;
  applicationContract: {
    input: "raw_autonomous_aggregate_probability";
    output: "candidate_calibrated_probability";
    rawProbabilityRetained: true;
    rawMeanMedianRetained: true;
    crowdAssistedTrackExcluded: true;
  };
};

export function buildBinaryPlattCalibrationCandidate(input: {
  candidateVersion: string;
  createdAt: string;
  observations: readonly BinaryCalibrationObservation[];
  policy?: Partial<BinaryPlattCalibrationPolicy>;
}): BinaryPlattCalibrationCandidate {
  const candidateVersion = input.candidateVersion.trim();
  if (!candidateVersion) {
    throw new Error("candidateVersion must not be empty.");
  }
  const createdAtMs = parseCalibrationTimestamp(input.createdAt, "createdAt");
  const policy = normalizeBinaryPlattCalibrationPolicy(input.policy);
  const split = chronologicalBinaryCalibrationSplit(input.observations, {
    ...policy,
    candidateCreatedAt: input.createdAt,
  });
  const base = {
    schemaVersion: binaryPlattCalibrationSchemaVersion,
    methodVersion: binaryPlattCalibrationMethodVersion,
    candidateId: `binary-platt:${candidateVersion}`,
    candidateVersion,
    createdAt: new Date(createdAtMs).toISOString(),
    active: false as const,
    requiresExplicitPromotion: true as const,
    policy,
    split,
    applicationContract: {
      input: "raw_autonomous_aggregate_probability" as const,
      output: "candidate_calibrated_probability" as const,
      rawProbabilityRetained: true as const,
      rawMeanMedianRetained: true as const,
      crowdAssistedTrackExcluded: true as const,
    },
  };
  if (!split.valid) {
    return {
      ...base,
      status: "blocked_by_data_gates",
      promotionRecommendation: "blocked",
      fit: null,
      parameters: null,
      validation: null,
    };
  }

  const fit = fitPlattCalibration(split.training, policy);
  if (!fit.converged || fit.parameters.slope <= 0) {
    return {
      ...base,
      status: "blocked_by_fit",
      promotionRecommendation: "blocked",
      fit,
      parameters: null,
      validation: null,
    };
  }

  const validation = evaluatePlattCalibration(split.validation, fit.parameters, policy);
  const ready = validation.passesHeldoutGate;
  return {
    ...base,
    status: ready ? "ready_for_explicit_promotion_review" : "rejected_on_holdout",
    promotionRecommendation: ready ? "review_for_explicit_promotion" : "reject",
    fit,
    parameters: fit.parameters,
    validation,
  };
}

export function chronologicalBinaryCalibrationSplit(
  observations: readonly BinaryCalibrationObservation[],
  input: BinaryPlattCalibrationPolicy & { candidateCreatedAt: string },
): ChronologicalBinaryCalibrationSplit {
  const issues: string[] = [];
  const candidateCreatedAtMs = safeCalibrationTimestamp(input.candidateCreatedAt, "candidateCreatedAt", issues);
  const seenIds = new Set<string>();
  const normalized = observations.flatMap((observation, index) => {
    const prefix = `observations[${index}]`;
    const id = observation.id.trim();
    const family = observation.eventFamilyId.trim();
    if (!id) {
      issues.push(`${prefix}.id must not be empty.`);
    } else if (seenIds.has(id)) {
      issues.push(`Duplicate observation id: ${id}.`);
    }
    seenIds.add(id);
    if (!family) {
      issues.push(`${prefix}.eventFamilyId must not be empty.`);
    }
    if (!Number.isFinite(observation.probability) || observation.probability < 0 || observation.probability > 100) {
      issues.push(`${prefix}.probability must be between 0 and 100.`);
    }
    const forecastAtMs = safeCalibrationTimestamp(observation.forecastAt, `${prefix}.forecastAt`, issues);
    const resolvedAtMs = safeCalibrationTimestamp(observation.resolvedAt, `${prefix}.resolvedAt`, issues);
    if (forecastAtMs !== null && resolvedAtMs !== null && forecastAtMs > resolvedAtMs) {
      issues.push(`${prefix} resolves before its forecast was made.`);
    }
    if (resolvedAtMs !== null && candidateCreatedAtMs !== null && resolvedAtMs > candidateCreatedAtMs) {
      issues.push(`${prefix} was not resolved when the candidate was created.`);
    }
    if (!id || !family || forecastAtMs === null || resolvedAtMs === null) {
      return [];
    }
    return [{ observation: { ...observation, id, eventFamilyId: family }, forecastAtMs, resolvedAtMs }];
  }).sort((left, right) =>
    left.forecastAtMs - right.forecastAtMs ||
    left.resolvedAtMs - right.resolvedAtMs ||
    left.observation.id.localeCompare(right.observation.id)
  );
  for (const [family, familyRows] of groupBy(
    normalized,
    (row) => row.observation.eventFamilyId,
  )) {
    if (new Set(familyRows.map((row) => row.observation.resolved)).size > 1) {
      issues.push(`Event family ${family} has inconsistent resolved outcomes.`);
    }
  }

  const desiredValidationRows = Math.max(
    input.minimumValidationObservations,
    Math.ceil(normalized.length * input.validationFraction),
  );
  let validationStartIndex = Math.max(0, normalized.length - desiredValidationRows);
  const provisionalStart = normalized[validationStartIndex]?.forecastAtMs ?? null;
  while (
    validationStartIndex > 0 &&
    provisionalStart !== null &&
    normalized[validationStartIndex - 1]?.forecastAtMs === provisionalStart
  ) {
    validationStartIndex -= 1;
  }
  const validationStartMs = normalized[validationStartIndex]?.forecastAtMs ?? null;
  const validationRows = validationStartMs === null
    ? []
    : normalized.filter((row) => row.forecastAtMs >= validationStartMs);
  const preValidationRows = validationStartMs === null
    ? []
    : normalized.filter((row) => row.forecastAtMs < validationStartMs);
  const trainingRows = preValidationRows.filter((row) => row.resolvedAtMs <= validationStartMs);
  const embargoedRows = preValidationRows.filter((row) => row.resolvedAtMs > validationStartMs);

  const trainingFamilies = new Set(trainingRows.map((row) => row.observation.eventFamilyId));
  const validationFamilies = new Set(validationRows.map((row) => row.observation.eventFamilyId));
  const familyOverlap = [...trainingFamilies].filter((family) => validationFamilies.has(family)).sort();
  const trainingFamilyOutcomes = eventFamilyOutcomes(trainingRows.map((row) => row.observation));
  const validationFamilyOutcomes = eventFamilyOutcomes(validationRows.map((row) => row.observation));
  const trainingCounts = outcomeCounts(trainingFamilyOutcomes);
  const validationCounts = outcomeCounts(validationFamilyOutcomes);
  const maxTrainingForecastAt = maximum(trainingRows.map((row) => row.forecastAtMs));
  const minTrainingForecastAt = minimum(trainingRows.map((row) => row.forecastAtMs));
  const maxValidationForecastAt = maximum(validationRows.map((row) => row.forecastAtMs));
  const maxTrainingResolvedAt = maximum(trainingRows.map((row) => row.resolvedAtMs));
  const chronologicalOrderPassed =
    validationStartMs !== null &&
    (maxTrainingForecastAt === null || maxTrainingForecastAt < validationStartMs) &&
    (maxTrainingResolvedAt === null || maxTrainingResolvedAt <= validationStartMs);

  const gates: BinaryCalibrationDataGate[] = [
    gate("valid_rows", issues.length === 0, issues.length, 0, "Every row needs valid IDs, probabilities, timestamps, and an outcome available by candidate creation."),
    gate("minimum_total", normalized.length >= input.minimumObservations, normalized.length, input.minimumObservations, "Minimum resolved observations before any fit."),
    gate("minimum_training", trainingRows.length >= input.minimumTrainingObservations, trainingRows.length, input.minimumTrainingObservations, "Earlier rows whose outcomes were available before validation began."),
    gate("minimum_validation", validationRows.length >= input.minimumValidationObservations, validationRows.length, input.minimumValidationObservations, "Strictly later held-out forecasts."),
    gate("minimum_training_families", trainingFamilyOutcomes.length >= input.minimumTrainingEventFamilies, trainingFamilyOutcomes.length, input.minimumTrainingEventFamilies, "Independent event families in training."),
    gate("minimum_validation_families", validationFamilyOutcomes.length >= input.minimumValidationEventFamilies, validationFamilyOutcomes.length, input.minimumValidationEventFamilies, "Independent event families in validation."),
    gate("training_yes", trainingCounts.yes >= input.minimumTrainingOutcomesPerClass, trainingCounts.yes, input.minimumTrainingOutcomesPerClass, "Training YES event families."),
    gate("training_no", trainingCounts.no >= input.minimumTrainingOutcomesPerClass, trainingCounts.no, input.minimumTrainingOutcomesPerClass, "Training NO event families."),
    gate("validation_yes", validationCounts.yes >= input.minimumValidationOutcomesPerClass, validationCounts.yes, input.minimumValidationOutcomesPerClass, "Validation YES event families."),
    gate("validation_no", validationCounts.no >= input.minimumValidationOutcomesPerClass, validationCounts.no, input.minimumValidationOutcomesPerClass, "Validation NO event families."),
    gate("strict_chronology", chronologicalOrderPassed, chronologicalOrderPassed ? "ordered" : "not_ordered", "ordered", "Training forecasts precede validation forecasts and every training label was known by validation start."),
    gate("event_family_separation", familyOverlap.length === 0, familyOverlap.length, 0, "No underlying event family may appear in both training and validation."),
  ];

  return {
    valid: gates.every((item) => item.passed),
    issues,
    gates,
    training: trainingRows.map((row) => row.observation),
    validation: validationRows.map((row) => row.observation),
    embargoed: embargoedRows.map((row) => row.observation),
    trainingForecastFrom: timestampString(minTrainingForecastAt),
    validationForecastFrom: timestampString(validationStartMs),
    trainingForecastThrough: timestampString(maxTrainingForecastAt),
    validationForecastThrough: timestampString(maxValidationForecastAt),
    trainingOutcomesAvailableThrough: timestampString(maxTrainingResolvedAt),
    familyOverlap,
    trainingEventFamilies: trainingFamilyOutcomes.length,
    validationEventFamilies: validationFamilyOutcomes.length,
  };
}

export function fitPlattCalibration(
  observations: readonly (Pick<BinaryCalibrationObservation, "probability" | "resolved"> & Partial<Pick<BinaryCalibrationObservation, "eventFamilyId">>)[],
  policy: BinaryPlattCalibrationPolicy = defaultBinaryPlattCalibrationPolicy,
): PlattCalibrationFit {
  policy = normalizeBinaryPlattCalibrationPolicy(policy);
  if (observations.length === 0) {
    throw new Error("At least one training observation is required.");
  }
  const useEventFamilies = observations.every((observation) => Boolean(observation.eventFamilyId?.trim()));
  if (useEventFamilies) {
    for (const [family, familyRows] of groupBy(observations, (observation) => observation.eventFamilyId!.trim())) {
      if (new Set(familyRows.map((row) => row.resolved)).size > 1) {
        throw new Error(`Event family ${family} has inconsistent training outcomes.`);
      }
    }
  }
  const familySizes = useEventFamilies
    ? new Map([...groupBy(observations, (observation) => observation.eventFamilyId!.trim())].map(([family, rows]) => [family, rows.length]))
    : new Map<string, number>();
  const rows = observations.map((observation, index) => ({
    x: probabilityLogit(observation.probability, policy.probabilityEpsilon, `observations[${index}].probability`),
    y: observation.resolved ? 1 : 0,
    weight: useEventFamilies ? 1 / (familySizes.get(observation.eventFamilyId!.trim()) ?? 1) : 1,
  }));
  if (!rows.some((row) => row.y === 1) || !rows.some((row) => row.y === 0)) {
    throw new Error("Platt calibration training requires both YES and NO outcomes.");
  }

  let intercept = 0;
  let slope = 1;
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  let objective = plattObjective(rows, intercept, slope, policy);
  let converged = false;
  let iterations = 0;
  for (let iteration = 1; iteration <= policy.maximumIterations; iteration += 1) {
    iterations = iteration;
    let gradientIntercept = policy.interceptL2Regularization * intercept;
    let gradientSlope = policy.slopeL2Regularization * slope;
    let hessianIntercept = policy.interceptL2Regularization;
    let hessianCross = 0;
    let hessianSlope = policy.slopeL2Regularization;
    for (const row of rows) {
      const probability = sigmoid(intercept + slope * row.x);
      const error = probability - row.y;
      const weight = probability * (1 - probability);
      gradientIntercept += (row.weight * error) / totalWeight;
      gradientSlope += (row.weight * error * row.x) / totalWeight;
      hessianIntercept += (row.weight * weight) / totalWeight;
      hessianCross += (row.weight * weight * row.x) / totalWeight;
      hessianSlope += (row.weight * weight * row.x * row.x) / totalWeight;
    }
    const determinant = hessianIntercept * hessianSlope - hessianCross * hessianCross;
    if (!Number.isFinite(determinant) || determinant <= 1e-15) {
      break;
    }
    const interceptStep = (hessianSlope * gradientIntercept - hessianCross * gradientSlope) / determinant;
    const slopeStep = (-hessianCross * gradientIntercept + hessianIntercept * gradientSlope) / determinant;
    let scale = 1;
    let nextIntercept = intercept - interceptStep;
    let nextSlope = slope - slopeStep;
    let nextObjective = plattObjective(rows, nextIntercept, nextSlope, policy);
    while (nextObjective > objective && scale > 1 / 1024) {
      scale /= 2;
      nextIntercept = intercept - scale * interceptStep;
      nextSlope = slope - scale * slopeStep;
      nextObjective = plattObjective(rows, nextIntercept, nextSlope, policy);
    }
    if (!Number.isFinite(nextObjective) || nextObjective > objective) {
      break;
    }
    intercept = nextIntercept;
    slope = nextSlope;
    const maxStep = Math.max(Math.abs(scale * interceptStep), Math.abs(scale * slopeStep));
    const objectiveDelta = Math.abs(objective - nextObjective);
    objective = nextObjective;
    if (maxStep <= policy.convergenceTolerance || objectiveDelta <= policy.convergenceTolerance) {
      converged = true;
      break;
    }
  }

  const parameters = {
    intercept: roundMetric(intercept),
    slope: roundMetric(slope),
    probabilityEpsilon: policy.probabilityEpsilon,
  };
  return {
    parameters,
    converged,
    iterations,
    objective: roundMetric(objective),
    trainingLogLoss: roundMetric(weightedMean(rows.map((row) => ({
      value: binaryLogLoss(sigmoid(intercept + slope * row.x), row.y),
      weight: row.weight,
    })))),
    trainingRows: rows.length,
    independentUnits: useEventFamilies ? familySizes.size : rows.length,
    weighting: useEventFamilies ? "equal_event_family" : "equal_observation",
  };
}

export function applyPlattCalibration(probability: number, parameters: PlattCalibrationParameters) {
  const x = probabilityLogit(probability, parameters.probabilityEpsilon, "probability");
  return roundProbability(100 * sigmoid(parameters.intercept + parameters.slope * x));
}

export function evaluatePlattCalibration(
  observations: readonly (Pick<BinaryCalibrationObservation, "probability" | "resolved"> & Partial<Pick<BinaryCalibrationObservation, "eventFamilyId">>)[],
  parameters: PlattCalibrationParameters,
  policy: BinaryPlattCalibrationPolicy = defaultBinaryPlattCalibrationPolicy,
): BinaryCalibrationValidation {
  policy = normalizeBinaryPlattCalibrationPolicy(policy);
  if (observations.length === 0) {
    throw new Error("At least one validation observation is required.");
  }
  const useEventFamilies = observations.every((observation) => Boolean(observation.eventFamilyId?.trim()));
  if (useEventFamilies) {
    for (const [family, familyRows] of groupBy(observations, (observation) => observation.eventFamilyId!.trim())) {
      if (new Set(familyRows.map((row) => row.resolved)).size > 1) {
        throw new Error(`Event family ${family} has inconsistent validation outcomes.`);
      }
    }
  }
  const scoredRows = observations.map((observation, index) => {
    if (!Number.isFinite(observation.probability) || observation.probability < 0 || observation.probability > 100) {
      throw new Error(`Validation probability must be between 0 and 100: ${observation.probability}`);
    }
    const rawFraction = observation.probability / 100;
    const identityForLog = clampFraction(rawFraction, policy.probabilityEpsilon);
    const calibrated = clampFraction(applyPlattCalibration(observation.probability, parameters) / 100, policy.probabilityEpsilon);
    const outcome = observation.resolved ? 1 : 0;
    const rawBrier = (rawFraction - outcome) ** 2;
    const calibratedBrier = (calibrated - outcome) ** 2;
    const rawLog = binaryLogLoss(identityForLog, outcome);
    const calibratedLog = binaryLogLoss(calibrated, outcome);
    return {
      unitId: useEventFamilies ? observation.eventFamilyId!.trim() : `observation:${index}`,
      identityBrier: rawBrier,
      candidateBrier: calibratedBrier,
      identityLog: rawLog,
      candidateLog: calibratedLog,
    };
  });
  const units = [...groupBy(scoredRows, (row) => row.unitId).values()].map((rows) => ({
    identityBrier: mean(rows.map((row) => row.identityBrier)),
    candidateBrier: mean(rows.map((row) => row.candidateBrier)),
    identityLog: mean(rows.map((row) => row.identityLog)),
    candidateLog: mean(rows.map((row) => row.candidateLog)),
  }));
  const identityBrier = units.map((unit) => unit.identityBrier);
  const candidateBrier = units.map((unit) => unit.candidateBrier);
  const identityLog = units.map((unit) => unit.identityLog);
  const candidateLog = units.map((unit) => unit.candidateLog);
  const brierDeltas = units.map((unit) => unit.candidateBrier - unit.identityBrier);
  const logDeltas = units.map((unit) => unit.candidateLog - unit.identityLog);
  const brier = metricComparison(identityBrier, candidateBrier, brierDeltas, policy.confidenceZ);
  const logLoss = metricComparison(identityLog, candidateLog, logDeltas, policy.confidenceZ);
  const improvesBrier = brier.delta <= -policy.minimumBrierImprovement && brier.delta < 0;
  const improvesLogLoss = logLoss.delta <= -policy.minimumLogLossImprovement && logLoss.delta < 0;
  const brierIntervalBelowIdentity = brier.pairedConfidenceInterval.upper !== null && brier.pairedConfidenceInterval.upper < 0;
  const logLossIntervalBelowIdentity = logLoss.pairedConfidenceInterval.upper !== null && logLoss.pairedConfidenceInterval.upper < 0;
  return {
    rows: observations.length,
    independentUnits: units.length,
    inferenceUnit: useEventFamilies ? "event_family" : "observation",
    brier,
    logLoss,
    improvesBrier,
    improvesLogLoss,
    brierIntervalBelowIdentity,
    logLossIntervalBelowIdentity,
    passesHeldoutGate: improvesBrier && improvesLogLoss && brierIntervalBelowIdentity && logLossIntervalBelowIdentity,
  };
}

export function normalizeBinaryPlattCalibrationPolicy(
  override: Partial<BinaryPlattCalibrationPolicy> | undefined,
): BinaryPlattCalibrationPolicy {
  const policy = { ...defaultBinaryPlattCalibrationPolicy, ...override };
  for (const key of [
    "minimumObservations",
    "minimumTrainingObservations",
    "minimumValidationObservations",
    "minimumTrainingEventFamilies",
    "minimumValidationEventFamilies",
    "minimumTrainingOutcomesPerClass",
    "minimumValidationOutcomesPerClass",
    "maximumIterations",
  ] as const) {
    if (!Number.isInteger(policy[key]) || policy[key] < 1) {
      throw new Error(`${key} must be a positive integer.`);
    }
  }
  if (policy.minimumObservations < policy.minimumTrainingObservations + policy.minimumValidationObservations) {
    throw new Error("minimumObservations must cover minimum training plus validation observations.");
  }
  if (policy.minimumTrainingEventFamilies > policy.minimumTrainingObservations) {
    throw new Error("minimumTrainingEventFamilies cannot exceed minimumTrainingObservations.");
  }
  if (policy.minimumValidationEventFamilies > policy.minimumValidationObservations) {
    throw new Error("minimumValidationEventFamilies cannot exceed minimumValidationObservations.");
  }
  if (policy.validationFraction <= 0 || policy.validationFraction >= 1) {
    throw new Error("validationFraction must be greater than 0 and less than 1.");
  }
  if (policy.probabilityEpsilon <= 0 || policy.probabilityEpsilon >= 0.5) {
    throw new Error("probabilityEpsilon must be greater than 0 and less than 0.5.");
  }
  for (const key of ["slopeL2Regularization", "interceptL2Regularization", "minimumBrierImprovement", "minimumLogLossImprovement"] as const) {
    if (!Number.isFinite(policy[key]) || policy[key] < 0) {
      throw new Error(`${key} must be a finite non-negative number.`);
    }
  }
  if (!Number.isFinite(policy.convergenceTolerance) || policy.convergenceTolerance <= 0) {
    throw new Error("convergenceTolerance must be a positive finite number.");
  }
  if (!Number.isFinite(policy.confidenceZ) || policy.confidenceZ <= 0) {
    throw new Error("confidenceZ must be a positive finite number.");
  }
  return policy;
}

function metricComparison(identity: number[], candidate: number[], deltas: number[], confidenceZ: number): MeanMetricComparison {
  const identityMean = mean(identity);
  const candidateMean = mean(candidate);
  const interval = pairedMeanInterval(deltas, confidenceZ);
  return {
    identity: roundMetric(identityMean),
    candidate: roundMetric(candidateMean),
    delta: roundMetric(candidateMean - identityMean),
    pairedConfidenceInterval: interval,
  };
}

function pairedMeanInterval(values: number[], confidenceZ: number): MeanMetricComparison["pairedConfidenceInterval"] {
  const meanValue = mean(values);
  if (values.length < 2) {
    return {
      method: "paired_normal_approximation",
      confidenceLevel: confidenceLevelForZ(confidenceZ),
      z: confidenceZ,
      count: values.length,
      mean: roundMetric(meanValue),
      lower: null,
      upper: null,
      standardError: null,
    };
  }
  const variance = values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / (values.length - 1);
  const standardError = Math.sqrt(variance / values.length);
  return {
    method: "paired_normal_approximation",
    confidenceLevel: confidenceLevelForZ(confidenceZ),
    z: confidenceZ,
    count: values.length,
    mean: roundMetric(meanValue),
    lower: roundMetric(meanValue - confidenceZ * standardError),
    upper: roundMetric(meanValue + confidenceZ * standardError),
    standardError: roundMetric(standardError),
  };
}

function plattObjective(
  rows: readonly { x: number; y: number; weight: number }[],
  intercept: number,
  slope: number,
  policy: BinaryPlattCalibrationPolicy,
) {
  return weightedMean(rows.map((row) => ({
    value: binaryLogLoss(sigmoid(intercept + slope * row.x), row.y),
    weight: row.weight,
  })))
    + 0.5 * policy.interceptL2Regularization * intercept ** 2
    + 0.5 * policy.slopeL2Regularization * slope ** 2;
}

function confidenceLevelForZ(z: number): 0.95 | null {
  return Math.abs(z - defaultBinaryPlattCalibrationPolicy.confidenceZ) <= 1e-12 ? 0.95 : null;
}

function probabilityLogit(probability: number, epsilon: number, label: string) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
    throw new Error(`${label} must be between 0 and 100: ${probability}`);
  }
  const fraction = clampFraction(probability / 100, epsilon);
  return Math.log(fraction / (1 - fraction));
}

function binaryLogLoss(probability: number, outcome: number) {
  return -(outcome * Math.log(probability) + (1 - outcome) * Math.log1p(-probability));
}

function sigmoid(value: number) {
  if (value >= 0) {
    const exponential = Math.exp(-value);
    return 1 / (1 + exponential);
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function clampFraction(value: number, epsilon: number) {
  return Math.max(epsilon, Math.min(1 - epsilon, value));
}

function outcomeCounts(rows: readonly Pick<BinaryCalibrationObservation, "resolved">[]) {
  const yes = rows.filter((row) => row.resolved).length;
  return { yes, no: rows.length - yes };
}

function eventFamilyOutcomes(rows: readonly BinaryCalibrationObservation[]) {
  return [...groupBy(rows, (row) => row.eventFamilyId).values()].map((familyRows) => ({
    resolved: familyRows[0]!.resolved,
  }));
}

function groupBy<T>(values: readonly T[], keyFor: (value: T) => string) {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function gate(
  id: string,
  passed: boolean,
  actual: number | string | null,
  required: number | string,
  detail: string,
): BinaryCalibrationDataGate {
  return { id, passed, actual, required, detail };
}

function maximum(values: number[]) {
  return values.length ? Math.max(...values) : null;
}

function minimum(values: number[]) {
  return values.length ? Math.min(...values) : null;
}

function timestampString(value: number | null) {
  return value === null ? null : new Date(value).toISOString();
}

function safeCalibrationTimestamp(value: string, label: string, issues: string[]) {
  try {
    return parseCalibrationTimestamp(value, label);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
    return null;
  }
}

function parseCalibrationTimestamp(value: string, label: string) {
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const date = new Date(timestamp);
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return timestamp;
    }
    throw new Error(`${label} is not a valid calendar date: ${value}`);
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed)) {
    throw new Error(`${label} must be an ISO date or offset-qualified ISO instant: ${value}`);
  }
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} is not a valid ISO timestamp: ${value}`);
  }
  return timestamp;
}

function mean(values: readonly number[]) {
  if (values.length === 0) {
    throw new Error("Cannot calculate a mean over zero values.");
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedMean(values: readonly { value: number; weight: number }[]) {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0);
  if (values.length === 0 || !Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error("Cannot calculate a weighted mean without positive finite weight.");
  }
  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function roundMetric(value: number) {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function roundProbability(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
