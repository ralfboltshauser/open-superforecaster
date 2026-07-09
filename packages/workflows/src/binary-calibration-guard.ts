export type BinaryCalibrationGuardInput = {
  probability: number;
  question: string;
  resolutionCriteria: string;
  background: string;
  fixedEvidence: string;
  cutoffHorizonDays?: number;
};

export type BinaryCalibrationGuardResult = {
  probability: number;
  adjustment: number;
  notes: string[];
  appliedRules: BinaryCalibrationGuardRule[];
};

export type BinaryCalibrationGuardRule = {
  id: string;
  adjustment: number;
  note: string;
};

export function applyBinaryCalibrationGuard(input: BinaryCalibrationGuardInput): BinaryCalibrationGuardResult {
  const questionText = input.question.toLowerCase();
  const contextText = [
    input.question,
    input.resolutionCriteria,
    input.background,
    input.fixedEvidence,
  ].join("\n").toLowerCase();
  let probability = input.probability;
  const appliedRules: BinaryCalibrationGuardRule[] = [];

  if (
    /outright majority|seat majority|majority in/.test(questionText) &&
    /large and persistent|persistent national lead|large.*lead/.test(contextText) &&
    /first-past-the-post|amplify|seat majorit/.test(contextText) &&
    probability >= 70 &&
    probability <= 90
  ) {
    const rule = appliedRule(
      "electoral-seat-amplification",
      2,
      "Added 2 points for a large persistent lead in a seat-amplifying electoral system.",
    );
    probability += rule.adjustment;
    appliedRules.push(rule);
  }

  if (
    /bank of japan|boj|negative interest rate/.test(questionText) &&
    /wage/.test(contextText) &&
    /first half|h1|first hike|normalization/.test(contextText) &&
    probability >= 30 &&
    probability <= 55
  ) {
    const rule = appliedRule(
      "boj-normalization-triggers",
      1,
      "Added 1 point for named BOJ normalization triggers plus first-half market debate.",
    );
    probability += rule.adjustment;
    appliedRules.push(rule);
  }

  if (
    /deliver at least|deliver .* or more|production|deliveries/.test(questionText) &&
    includesAny(contextText, [/limited initial production/, /ramp .* hard/, /recently begun/, /unusual .* manufacturing/]) &&
    probability >= 10
  ) {
    const rule = appliedRule(
      "production-ramp-threshold",
      -5,
      "Subtracted 5 points for a hard production-ramp threshold with limited initial output evidence.",
    );
    probability += rule.adjustment;
    appliedRules.push(rule);
  }

  if (
    /unemployment|jobless|labor market|labour market/.test(questionText) &&
    /at least|or higher|threshold/.test(contextText) &&
    /below 4|below four|would require|material .*deterioration|remained resilient/.test(contextText) &&
    probability >= 10
  ) {
    const rule = appliedRule(
      "labor-deterioration-threshold",
      -2.5,
      "Subtracted 2.5 points for a deterioration threshold starting from a strong labor-market base.",
    );
    probability += rule.adjustment;
    appliedRules.push(rule);
  }

  if (
    (input.cutoffHorizonDays ?? Infinity) <= 90 &&
    /federal reserve|fomc|central bank/.test(contextText) &&
    /cut|reduction|reduce/.test(contextText) &&
    /not committed|caution|cautioned|data dependence/.test(contextText) &&
    probability >= 15 &&
    probability <= 45
  ) {
    const rule = appliedRule(
      "near-deadline-central-bank-easing",
      -3.5,
      "Subtracted 3.5 points for a near-deadline central-bank easing question with explicit no-commitment/caution evidence.",
    );
    probability += rule.adjustment;
    appliedRules.push(rule);
  }

  const calibratedProbability = roundProbability(Math.min(100, Math.max(0, probability)));
  return {
    probability: calibratedProbability,
    adjustment: roundProbability(calibratedProbability - input.probability),
    notes: appliedRules.map((rule) => rule.note),
    appliedRules,
  };
}

function appliedRule(id: string, adjustment: number, note: string): BinaryCalibrationGuardRule {
  return {
    id,
    adjustment,
    note,
  };
}

function includesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function roundProbability(value: number) {
  return Math.round(value * 10) / 10;
}
