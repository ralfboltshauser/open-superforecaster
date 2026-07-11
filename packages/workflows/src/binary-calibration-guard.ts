export type BinaryCalibrationGuardInput = {
  probability: number;
  question: string;
  resolutionCriteria: string;
  background: string;
  fixedEvidence: string;
  cutoffHorizonDays?: number;
  variant?: BinaryCalibrationGuardVariant;
};

export type BinaryCalibrationGuardResult = {
  variant: BinaryCalibrationGuardVariant;
  experimental: boolean;
  rawProbability: number;
  probability: number;
  adjustment: number;
  notes: string[];
  appliedRules: BinaryCalibrationGuardRule[];
};

export const binaryCalibrationGuardVariantNone = "none" as const;
export const binaryCalibrationGuardVariantTopicalRegexExperimentalV1 = "topical_regex_experimental_v1" as const;

export const binaryCalibrationGuardVariants = [
  binaryCalibrationGuardVariantNone,
  binaryCalibrationGuardVariantTopicalRegexExperimentalV1,
] as const;

export type BinaryCalibrationGuardVariant = typeof binaryCalibrationGuardVariants[number];

export type BinaryCalibrationGuardRule = {
  id: string;
  adjustment: number;
  note: string;
};

export type BinaryCalibrationGuardRuleDefinition = BinaryCalibrationGuardRule & {
  applies: (context: BinaryCalibrationGuardContext) => boolean;
};

export type BinaryCalibrationGuardContext = BinaryCalibrationGuardInput & {
  questionText: string;
  contextText: string;
};

export const BINARY_CALIBRATION_GUARD_RULES: readonly BinaryCalibrationGuardRuleDefinition[] = [
  {
    id: "electoral-seat-amplification",
    adjustment: 2,
    note: "Added 2 points for a large persistent lead in a seat-amplifying electoral system.",
    applies: ({ probability, questionText, contextText }) =>
      /outright majority|seat majority|majority in/.test(questionText) &&
      /large and persistent|persistent national lead|large.*lead/.test(contextText) &&
      /first-past-the-post|amplify|seat majorit/.test(contextText) &&
      probability >= 70 &&
      probability <= 90,
  },
  {
    id: "boj-normalization-triggers",
    adjustment: 1,
    note: "Added 1 point for named BOJ normalization triggers plus first-half market debate.",
    applies: ({ probability, questionText, contextText }) =>
      /bank of japan|boj|negative interest rate/.test(questionText) &&
      /wage/.test(contextText) &&
      /first half|h1|first hike|normalization/.test(contextText) &&
      probability >= 30 &&
      probability <= 55,
  },
  {
    id: "production-ramp-threshold",
    adjustment: -5,
    note: "Subtracted 5 points for a hard production-ramp threshold with limited initial output evidence.",
    applies: ({ probability, questionText, contextText }) =>
      /deliver at least|deliver .* or more|production|deliveries/.test(questionText) &&
      includesAny(contextText, [/limited initial production/, /ramp .* hard/, /recently begun/, /unusual .* manufacturing/]) &&
      probability >= 10,
  },
  {
    id: "labor-deterioration-threshold",
    adjustment: -2.5,
    note: "Subtracted 2.5 points for a deterioration threshold starting from a strong labor-market base.",
    applies: ({ probability, questionText, contextText }) =>
      /unemployment|jobless|labor market|labour market/.test(questionText) &&
      /at least|or higher|threshold/.test(contextText) &&
      /below 4|below four|would require|material .*deterioration|remained resilient/.test(contextText) &&
      probability >= 10,
  },
  {
    id: "near-deadline-central-bank-easing",
    adjustment: -3.5,
    note: "Subtracted 3.5 points for a near-deadline central-bank easing question with explicit no-commitment/caution evidence.",
    applies: ({ probability, cutoffHorizonDays, contextText }) =>
      (cutoffHorizonDays ?? Infinity) <= 90 &&
      /federal reserve|fomc|central bank/.test(contextText) &&
      /cut|reduction|reduce/.test(contextText) &&
      /not committed|caution|cautioned|data dependence/.test(contextText) &&
      probability >= 15 &&
      probability <= 45,
  },
];

export function applyBinaryCalibrationGuard(input: BinaryCalibrationGuardInput): BinaryCalibrationGuardResult {
  const variant = input.variant ?? binaryCalibrationGuardVariantNone;
  const rawProbability = roundProbability(Math.min(100, Math.max(0, input.probability)));
  if (variant === binaryCalibrationGuardVariantNone) {
    return {
      variant,
      experimental: false,
      rawProbability,
      probability: rawProbability,
      adjustment: 0,
      notes: [],
      appliedRules: [],
    };
  }

  const context = buildCalibrationGuardContext(input);
  let probability = rawProbability;
  const appliedRules: BinaryCalibrationGuardRule[] = [];

  for (const rule of BINARY_CALIBRATION_GUARD_RULES) {
    if (!rule.applies({ ...context, probability })) {
      continue;
    }
    probability += rule.adjustment;
    appliedRules.push(appliedRule(rule));
  }

  const calibratedProbability = roundProbability(Math.min(100, Math.max(0, probability)));
  return {
    variant,
    experimental: true,
    rawProbability,
    probability: calibratedProbability,
    adjustment: roundProbability(calibratedProbability - rawProbability),
    notes: appliedRules.map((rule) => rule.note),
    appliedRules,
  };
}

export function readBinaryCalibrationGuardVariant(value: unknown): BinaryCalibrationGuardVariant {
  return value === binaryCalibrationGuardVariantTopicalRegexExperimentalV1
    ? binaryCalibrationGuardVariantTopicalRegexExperimentalV1
    : binaryCalibrationGuardVariantNone;
}

function buildCalibrationGuardContext(input: BinaryCalibrationGuardInput): BinaryCalibrationGuardContext {
  return {
    ...input,
    questionText: input.question.toLowerCase(),
    contextText: [
      input.question,
      input.resolutionCriteria,
      input.background,
      input.fixedEvidence,
    ].join("\n").toLowerCase(),
  };
}

function appliedRule(rule: BinaryCalibrationGuardRule): BinaryCalibrationGuardRule {
  return {
    id: rule.id,
    adjustment: rule.adjustment,
    note: rule.note,
  };
}

function includesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function roundProbability(value: number) {
  return Math.round(value * 10) / 10;
}
