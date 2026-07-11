export type QuantileForecastPoint = Readonly<{
  /** Quantile level on the unit interval, for example 0.1 for p10. */
  quantile: number;
  value: number;
}>;

export type CentralPredictionInterval = Readonly<{
  lower: number;
  upper: number;
  /** Probability mass outside the central interval, for example 0.2 for p10-p90. */
  miscoverage: number;
}>;

export type DatePredictionInterval = Readonly<{
  lower: string;
  upper: string;
  miscoverage: number;
}>;

/**
 * Proper quantile (pinball) loss. Lower is better. At the median this is half
 * absolute error; asymmetric quantiles penalize misses in the relevant tail.
 */
export function pinballLoss(input: {
  quantile: number;
  forecast: number;
  outcome: number;
}) {
  assertOpenUnitInterval(input.quantile, "quantile");
  assertFinite(input.forecast, "forecast");
  assertFinite(input.outcome, "outcome");
  const error = input.outcome - input.forecast;
  return error >= 0
    ? input.quantile * error
    : (1 - input.quantile) * -error;
}

/** Mean pinball loss across a monotonic set of forecast quantiles. */
export function meanQuantileLoss(input: {
  quantiles: readonly QuantileForecastPoint[];
  outcome: number;
}) {
  assertFinite(input.outcome, "outcome");
  const quantiles = validateQuantileForecast(input.quantiles);
  return quantiles.reduce(
    (sum, point) => sum + pinballLoss({
      quantile: point.quantile,
      forecast: point.value,
      outcome: input.outcome,
    }),
    0,
  ) / quantiles.length;
}

/**
 * Validates and returns a sorted copy of a quantile forecast. Quantile values
 * must be nondecreasing so malformed or crossed distributions are not scored.
 */
export function validateQuantileForecast(points: readonly QuantileForecastPoint[]) {
  if (points.length === 0) {
    throw new Error("At least one forecast quantile is required.");
  }
  const sorted = points.map((point) => ({ ...point })).sort((left, right) => left.quantile - right.quantile);
  for (let index = 0; index < sorted.length; index += 1) {
    const point = sorted[index]!;
    assertOpenUnitInterval(point.quantile, `quantiles[${index}].quantile`);
    assertFinite(point.value, `quantiles[${index}].value`);
    const previous = sorted[index - 1];
    if (previous && point.quantile === previous.quantile) {
      throw new Error(`Duplicate forecast quantile: ${point.quantile}`);
    }
    if (previous && point.value < previous.value) {
      throw new Error(
        `Forecast quantiles must be nondecreasing: q=${point.quantile} has value ${point.value} below ${previous.value}.`,
      );
    }
  }
  return sorted;
}

/** Inclusive empirical coverage indicator for one resolved prediction interval. */
export function intervalCoverage(input: { lower: number; upper: number; outcome: number }): 0 | 1 {
  assertOrderedInterval(input.lower, input.upper);
  assertFinite(input.outcome, "outcome");
  return input.outcome >= input.lower && input.outcome <= input.upper ? 1 : 0;
}

/**
 * Interval width, the standard sharpness diagnostic. Lower is sharper, but it
 * must be interpreted alongside coverage rather than optimized by itself.
 */
export function intervalSharpness(input: { lower: number; upper: number }) {
  assertOrderedInterval(input.lower, input.upper);
  return input.upper - input.lower;
}

/**
 * Proper central interval score. It rewards narrow intervals while penalizing
 * outcomes below or above the interval by 2 / miscoverage.
 */
export function intervalScore(input: CentralPredictionInterval & { outcome: number }) {
  assertOrderedInterval(input.lower, input.upper);
  assertOpenUnitInterval(input.miscoverage, "miscoverage");
  assertFinite(input.outcome, "outcome");
  const width = input.upper - input.lower;
  if (input.outcome < input.lower) {
    return width + (2 / input.miscoverage) * (input.lower - input.outcome);
  }
  if (input.outcome > input.upper) {
    return width + (2 / input.miscoverage) * (input.outcome - input.upper);
  }
  return width;
}

export function predictionIntervalMetrics(input: CentralPredictionInterval & {
  outcome: number;
  /** Optional positive scale for comparing sharpness across differently scaled targets. */
  scale?: number;
}) {
  const width = intervalSharpness(input);
  if (input.scale !== undefined && (!Number.isFinite(input.scale) || input.scale <= 0)) {
    throw new Error(`scale must be a positive finite number: ${input.scale}`);
  }
  const coverage = intervalCoverage(input);
  return {
    covered: coverage === 1,
    coverage,
    width,
    normalizedWidth: input.scale === undefined ? null : width / input.scale,
    score: intervalScore(input),
  };
}

/**
 * Weighted interval score (WIS), a finite-quantile approximation to CRPS.
 * Each central interval with miscoverage alpha receives weight alpha / 2 and
 * the median absolute error receives weight 1 / 2. Lower is better.
 */
export function weightedIntervalScore(input: {
  median: number;
  intervals: readonly CentralPredictionInterval[];
  outcome: number;
}) {
  assertFinite(input.median, "median");
  assertFinite(input.outcome, "outcome");
  if (input.intervals.length === 0) {
    throw new Error("At least one central prediction interval is required for weighted interval score.");
  }
  const intervals = input.intervals
    .map((interval) => ({ ...interval }))
    .sort((left, right) => left.miscoverage - right.miscoverage);
  const seenMiscoverage = new Set<number>();
  let weightedScore = 0.5 * Math.abs(input.outcome - input.median);
  for (const [index, interval] of intervals.entries()) {
    assertOpenUnitInterval(interval.miscoverage, `intervals[${index}].miscoverage`);
    assertOrderedInterval(interval.lower, interval.upper, `intervals[${index}]`);
    if (input.median < interval.lower || input.median > interval.upper) {
      throw new Error(`Median ${input.median} must lie inside intervals[${index}].`);
    }
    if (seenMiscoverage.has(interval.miscoverage)) {
      throw new Error(`Duplicate interval miscoverage: ${interval.miscoverage}`);
    }
    const widerInterval = intervals[index - 1];
    if (
      widerInterval &&
      (interval.lower < widerInterval.lower || interval.upper > widerInterval.upper)
    ) {
      throw new Error("Central prediction intervals must be nested as miscoverage increases.");
    }
    seenMiscoverage.add(interval.miscoverage);
    weightedScore += (interval.miscoverage / 2) * intervalScore({ ...interval, outcome: input.outcome });
  }
  return weightedScore / (input.intervals.length + 0.5);
}

/** Pinball loss for ISO calendar-date forecasts, returned in days. */
export function datePinballLoss(input: {
  quantile: number;
  forecast: string;
  outcome: string;
}) {
  return pinballLoss({
    quantile: input.quantile,
    forecast: isoDateToEpochDay(input.forecast),
    outcome: isoDateToEpochDay(input.outcome),
  });
}

/** Prediction-interval diagnostics for ISO calendar dates, returned in days. */
export function datePredictionIntervalMetrics(input: DatePredictionInterval & { outcome: string }) {
  const metrics = predictionIntervalMetrics({
    lower: isoDateToEpochDay(input.lower),
    upper: isoDateToEpochDay(input.upper),
    outcome: isoDateToEpochDay(input.outcome),
    miscoverage: input.miscoverage,
  });
  return {
    covered: metrics.covered,
    coverage: metrics.coverage,
    widthDays: metrics.width,
    intervalScoreDays: metrics.score,
  };
}

/** WIS/CRPS approximation for ISO calendar-date quantiles, returned in days. */
export function dateWeightedIntervalScore(input: {
  median: string;
  intervals: readonly DatePredictionInterval[];
  outcome: string;
}) {
  return weightedIntervalScore({
    median: isoDateToEpochDay(input.median),
    intervals: input.intervals.map((interval) => ({
      lower: isoDateToEpochDay(interval.lower),
      upper: isoDateToEpochDay(interval.upper),
      miscoverage: interval.miscoverage,
    })),
    outcome: isoDateToEpochDay(input.outcome),
  });
}

/** Strict YYYY-MM-DD to UTC epoch-day conversion used by date scores. */
export function isoDateToEpochDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Date must use YYYY-MM-DD format: ${value}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return timestamp / 86_400_000;
}

function assertFinite(value: number, label: string): asserts value is number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite: ${value}`);
  }
}

function assertOpenUnitInterval(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`${label} must be greater than 0 and less than 1: ${value}`);
  }
}

function assertOrderedInterval(lower: number, upper: number, label = "interval") {
  assertFinite(lower, `${label}.lower`);
  assertFinite(upper, `${label}.upper`);
  if (lower > upper) {
    throw new Error(`${label}.lower must not exceed ${label}.upper: ${lower} > ${upper}`);
  }
}
