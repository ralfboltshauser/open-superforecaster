import { and, desc, eq, inArray } from "drizzle-orm";
import {
  artifactRows,
  calibrationModels,
  forecastAggregates,
  forecastAttempts,
  forecastResolutions,
  forecastScores,
  tasks,
  type createDb,
} from "@open-superforecaster/db";
import { scoreBinaryForecast } from "@open-superforecaster/evals";

type Db = ReturnType<typeof createDb>["db"];

type BinaryResolutionInput = {
  taskId: string;
  resolved: boolean;
  resolutionSource?: string;
  resolutionExplanation?: string;
  resolvedAt?: Date;
  annulled?: boolean;
  forceNew?: boolean;
};

type ScoreTarget = "aggregate" | "attempt";
type ForecastResolutionInput = {
  taskId: string;
  resolvedValue: Record<string, unknown>;
  resolutionSource?: string;
  resolutionExplanation?: string;
  resolvedAt?: Date;
  annulled?: boolean;
  forceNew?: boolean;
};

type ScoreRowInput = {
  scoreType: string;
  scoreValue: number;
  scoreConfig?: Record<string, unknown>;
};

export async function resolveBinaryForecastTask(db: Db, input: BinaryResolutionInput) {
  return resolveForecastTask(db, {
    taskId: input.taskId,
    resolvedValue: {
      resolved: input.resolved,
    },
    resolutionSource: input.resolutionSource,
    resolutionExplanation: input.resolutionExplanation,
    resolvedAt: input.resolvedAt,
    annulled: input.annulled,
    forceNew: input.forceNew,
  });
}

export async function resolveForecastTask(db: Db, input: ForecastResolutionInput) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, input.taskId)).limit(1);
  if (!task) {
    throw new Error(`Task not found: ${input.taskId}`);
  }
  if (task.operationMode !== "forecast" || !isResolvableForecastSubmode(task.operationSubmode)) {
    throw new Error("Manual resolution is only enabled for completed product forecast tasks.");
  }
  if (task.benchmarkRunId) {
    throw new Error("Benchmark tasks must be resolved through benchmark imports, not manual product resolution.");
  }
  if (task.status !== "completed") {
    throw new Error(`Task must be completed before resolution; current status is ${task.status}.`);
  }
  if (!task.smithersRunId) {
    throw new Error("Task has no Smithers run id, so forecast attempts cannot be linked.");
  }

  const forecastType = forecastTypeFromSubmode(task.operationSubmode);
  validateResolvedValue(forecastType, input.resolvedValue);
  const resolutionSource = input.resolutionSource?.trim() || "manual";
  const existing = input.forceNew
    ? null
    : await findExistingResolution(db, {
        taskId: task.id,
        resolvedValue: input.resolvedValue,
        resolutionSource,
      });
  const resolution =
    existing ??
    (await insertResolution(db, {
      taskId: task.id,
      smithersRunId: task.smithersRunId,
      resolvedValue: input.resolvedValue,
      resolutionSource,
      resolutionExplanation: input.resolutionExplanation,
      resolvedAt: input.resolvedAt ?? new Date(),
      annulled: input.annulled ?? false,
    }));

  const attempts = await db
    .select()
    .from(forecastAttempts)
    .where(and(eq(forecastAttempts.researchPassId, task.smithersRunId), eq(forecastAttempts.forecastType, forecastType)));
  const attemptIds = attempts.map((attempt) => attempt.id);
  if (attemptIds.length === 0) {
    throw new Error(`No ${forecastType} forecast attempts are available to score.`);
  }

  const allAggregates = await db
    .select()
    .from(forecastAggregates)
    .where(eq(forecastAggregates.forecastType, forecastType));
  const aggregates = allAggregates.filter((aggregate) =>
    aggregate.componentAttemptIds.some((attemptId) => attemptIds.includes(attemptId)),
  );

  if (resolution.annulled) {
    return {
      resolutionId: resolution.id,
      createdResolution: !existing,
      insertedScores: 0,
      skippedScores: attempts.length + aggregates.length,
      note: "Resolution is annulled; no scores were written.",
    };
  }

  const insertedScores = [];
  let skippedScores = 0;

  for (const aggregate of aggregates) {
    const scoreRows = scoreForecastPrediction({
      forecastType,
      prediction: aggregate.calibratedAggregate ?? aggregate.rawAggregate,
      resolvedValue: input.resolvedValue,
    });
    if (scoreRows.length === 0) {
      skippedScores += 1;
      continue;
    }
    insertedScores.push(
      ...(await insertForecastScoreRows(db, {
        target: "aggregate",
        targetId: aggregate.id,
        resolutionId: resolution.id,
        scoreRows,
        scoreConfig: {
          source: "manual_resolution",
          taskId: task.id,
          smithersRunId: task.smithersRunId,
          target: "aggregate",
          forecastType,
          resolutionSource,
        },
      })),
    );
  }

  for (const attempt of attempts) {
    const scoreRows = scoreForecastPrediction({
      forecastType,
      prediction: attempt.parsedPrediction,
      resolvedValue: input.resolvedValue,
    });
    if (scoreRows.length === 0) {
      skippedScores += 1;
      continue;
    }
    insertedScores.push(
      ...(await insertForecastScoreRows(db, {
        target: "attempt",
        targetId: attempt.id,
        resolutionId: resolution.id,
        scoreRows,
        scoreConfig: {
          source: "manual_resolution",
          taskId: task.id,
          smithersRunId: task.smithersRunId,
          target: "attempt",
          forecastType,
          forecasterLabel: attempt.forecasterLabel,
          resolutionSource,
        },
      })),
    );
  }

  return {
    resolutionId: resolution.id,
    createdResolution: !existing,
    insertedScores: insertedScores.length,
    skippedScores,
    aggregateCount: aggregates.length,
    attemptCount: attempts.length,
  };
}

export async function getResolutionDashboard(db: Db) {
  const [scoreRows, resolutionRows, calibrationRows] = await Promise.all([
    db.select().from(forecastScores),
    db.select().from(forecastResolutions).orderBy(desc(forecastResolutions.createdAt)),
    db.select().from(calibrationModels).orderBy(desc(calibrationModels.createdAt)),
  ]);

  const productScores = scoreRows.filter(isProductScore);
  const benchmarkScores = scoreRows.filter(isBenchmarkScore);
  const aggregateScores = productScores.filter((score) => score.forecastAggregateId);
  const aggregateBrier = aggregateScores.filter((score) => score.scoreType === "brier");
  const aggregateLog = aggregateScores.filter((score) => score.scoreType === "log");
  const attemptScores = productScores.filter((score) => score.forecastAttemptId);
  const productResolutionIds = new Set(productScores.map((score) => score.resolutionId).filter(Boolean));
  const pendingForecasts = await listPendingBinaryForecasts(db, productScores);
  const taskLabels = await taskLabelsById(db, productScores);
  const calibrationBuckets = buildCalibrationBuckets(aggregateBrier);
  const calibrationSummary = summarizeCalibration(calibrationBuckets, productResolutionIds.size);

  return {
    summary: {
      productResolvedForecasts: productResolutionIds.size,
      pendingBinaryForecasts: pendingForecasts.length,
      aggregateScoreRows: aggregateScores.length,
      binaryAggregateScoreRows: aggregateBrier.length + aggregateLog.length,
      attemptScoreRows: attemptScores.length,
      meanAggregateBrier: meanScore(aggregateBrier),
      meanAggregateLog: meanScore(aggregateLog),
      benchmarkScoreRows: benchmarkScores.length,
      calibrationModels: calibrationRows.length,
      activeCalibrationModels: calibrationRows.filter((model) => model.active).length,
      calibrationStatus: calibrationSummary.status,
      calibrationSampleSize: calibrationSummary.sampleSize,
      expectedCalibrationError: calibrationSummary.expectedCalibrationError,
      maxBucketCalibrationError: calibrationSummary.maxBucketCalibrationError,
      calibrationMinimumForFitting: calibrationSummary.minimumForFitting,
    },
    calibrationBuckets,
    calibrationSummary,
    pendingForecasts,
    recentResolutions: resolutionRows.slice(0, 8).map((resolution) => ({
      id: resolution.id,
      taskId: readScoreTaskIdFromResolution(resolution.resolvedValue),
      resolved: readResolved(resolution.resolvedValue),
      resolutionSource: resolution.resolutionSource,
      annulled: resolution.annulled,
      resolvedAt: resolution.resolvedAt,
      createdAt: resolution.createdAt,
    })),
    recentScores: productScores
      .filter((score) => score.scoreType === "brier" && score.forecastAggregateId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 8)
      .map((score) => {
        const taskId = readScoreTaskId(score.scoreConfig);
        return {
          id: score.id,
          taskId,
          taskLabel: taskId ? taskLabels.get(taskId) ?? taskId : "Unknown task",
          scoreType: score.scoreType,
          scoreValue: score.scoreValue,
          probability: readProbability(score.scoreConfig),
          resolved: readResolved(score.scoreConfig),
          createdAt: score.createdAt,
        };
      }),
  };
}

async function findExistingResolution(
  db: Db,
  input: {
    taskId: string;
    resolvedValue: Record<string, unknown>;
    resolutionSource: string;
  },
) {
  const candidates = await db
    .select()
    .from(forecastResolutions)
    .where(eq(forecastResolutions.resolutionSource, input.resolutionSource));
  return (
    candidates.find(
      (candidate) =>
        readScoreTaskIdFromResolution(candidate.resolvedValue) === input.taskId &&
        resolvedValueMatches(candidate.resolvedValue, input.resolvedValue),
    ) ?? null
  );
}

async function insertResolution(
  db: Db,
  input: {
    taskId: string;
    smithersRunId: string;
    resolvedValue: Record<string, unknown>;
    resolutionSource: string;
    resolutionExplanation?: string;
    resolvedAt: Date;
    annulled: boolean;
  },
) {
  const [resolution] = await db
    .insert(forecastResolutions)
    .values({
      resolvedValue: {
        taskId: input.taskId,
        smithersRunId: input.smithersRunId,
        ...input.resolvedValue,
        status: input.annulled ? "annulled" : "resolved",
        explanation: input.resolutionExplanation ?? null,
      },
      resolutionSource: input.resolutionSource,
      resolverTraceIds: [],
      annulled: input.annulled,
      resolvedAt: input.resolvedAt,
    })
    .returning();
  return resolution;
}

async function insertBinaryScoreRows(
  db: Db,
  input: {
    target: ScoreTarget;
    targetId: string;
    resolutionId: string;
    resolved: boolean;
    probability: number;
    scoreConfig: Record<string, unknown>;
  },
) {
  const existing = await db
    .select({ id: forecastScores.id })
    .from(forecastScores)
    .where(
      and(
        eq(forecastScores.resolutionId, input.resolutionId),
        input.target === "aggregate"
          ? eq(forecastScores.forecastAggregateId, input.targetId)
          : eq(forecastScores.forecastAttemptId, input.targetId),
      ),
    );
  if (existing.length > 0) {
    return [];
  }

  const scores = scoreBinaryForecast({ probability: input.probability, resolved: input.resolved });
  return db
    .insert(forecastScores)
    .values(
      Object.entries(scores).map(([scoreType, scoreValue]) => ({
        forecastAggregateId: input.target === "aggregate" ? input.targetId : null,
        forecastAttemptId: input.target === "attempt" ? input.targetId : null,
        resolutionId: input.resolutionId,
        scoreType,
        scoreValue,
        scoreConfig: {
          ...input.scoreConfig,
          probability: input.probability,
          resolved: input.resolved,
        },
      })),
    )
    .returning({ id: forecastScores.id });
}

async function insertForecastScoreRows(
  db: Db,
  input: {
    target: ScoreTarget;
    targetId: string;
    resolutionId: string;
    scoreRows: ScoreRowInput[];
    scoreConfig: Record<string, unknown>;
  },
) {
  const existing = await db
    .select({ id: forecastScores.id })
    .from(forecastScores)
    .where(
      and(
        eq(forecastScores.resolutionId, input.resolutionId),
        input.target === "aggregate"
          ? eq(forecastScores.forecastAggregateId, input.targetId)
          : eq(forecastScores.forecastAttemptId, input.targetId),
      ),
    );
  if (existing.length > 0) {
    return [];
  }

  return db
    .insert(forecastScores)
    .values(
      input.scoreRows.map((row) => ({
        forecastAggregateId: input.target === "aggregate" ? input.targetId : null,
        forecastAttemptId: input.target === "attempt" ? input.targetId : null,
        resolutionId: input.resolutionId,
        scoreType: row.scoreType,
        scoreValue: row.scoreValue,
        scoreConfig: {
          ...input.scoreConfig,
          ...(row.scoreConfig ?? {}),
        },
      })),
    )
    .returning({ id: forecastScores.id });
}

function scoreForecastPrediction(input: {
  forecastType: "binary" | "date" | "numeric" | "categorical" | "thresholded" | "conditional";
  prediction: Record<string, unknown>;
  resolvedValue: Record<string, unknown>;
}): ScoreRowInput[] {
  if (input.forecastType === "binary") {
    const probability = readProbability(input.prediction);
    const resolved = readResolved(input.resolvedValue);
    if (probability === null || resolved === null) {
      return [];
    }
    return Object.entries(scoreBinaryForecast({ probability, resolved })).map(([scoreType, scoreValue]) => ({
      scoreType,
      scoreValue,
      scoreConfig: {
        probability,
        resolved,
      },
    }));
  }

  if (input.forecastType === "numeric") {
    const predicted = readNumber(input.prediction, "value");
    const actual = readNumber(input.resolvedValue, "value", "actual", "resolvedNumeric");
    if (predicted === null || actual === null) {
      return [];
    }
    const error = predicted - actual;
    const absoluteError = Math.abs(error);
    const rows: ScoreRowInput[] = [
      {
        scoreType: "absolute_error",
        scoreValue: absoluteError,
        scoreConfig: { predicted, actual, error },
      },
      {
        scoreType: "squared_error",
        scoreValue: error ** 2,
        scoreConfig: { predicted, actual, error },
      },
    ];
    if (actual !== 0) {
      rows.push({
        scoreType: "absolute_percentage_error",
        scoreValue: absoluteError / Math.abs(actual),
        scoreConfig: { predicted, actual, error },
      });
    }
    return rows;
  }

  if (input.forecastType === "date") {
    const predicted = readDate(input.prediction, "targetDate", "target_date");
    const actual = readDate(input.resolvedValue, "date", "targetDate", "target_date", "resolvedDate", "resolved_date");
    if (!predicted || !actual) {
      return [];
    }
    const errorDays = Math.round(((predicted.getTime() - actual.getTime()) / 86_400_000) * 100) / 100;
    const absoluteDays = Math.abs(errorDays);
    return [
      {
        scoreType: "absolute_days_error",
        scoreValue: absoluteDays,
        scoreConfig: {
          predictedDate: predicted.toISOString().slice(0, 10),
          actualDate: actual.toISOString().slice(0, 10),
          errorDays,
        },
      },
      {
        scoreType: "squared_days_error",
        scoreValue: errorDays ** 2,
        scoreConfig: {
          predictedDate: predicted.toISOString().slice(0, 10),
          actualDate: actual.toISOString().slice(0, 10),
          errorDays,
        },
      },
    ];
  }

  if (input.forecastType === "categorical") {
    const actualCategory = readString(input.resolvedValue, "category", "actual", "resolvedCategory", "resolved_category");
    if (!actualCategory) {
      return [];
    }
    const distribution = normalizedCategoryDistribution(input.prediction);
    if (distribution.length === 0) {
      return [];
    }
    const categories = uniqueStrings([...distribution.map((item) => item.category), actualCategory]);
    const probabilityByCategory = new Map(distribution.map((item) => [item.category, item.probability]));
    const brier = categories.reduce((sum, category) => {
      const predicted = probabilityByCategory.get(category) ?? 0;
      const observed = category === actualCategory ? 1 : 0;
      return sum + (predicted - observed) ** 2;
    }, 0);
    const actualProbability = probabilityByCategory.get(actualCategory) ?? 0;
    return [
      {
        scoreType: "categorical_brier",
        scoreValue: brier,
        scoreConfig: { actualCategory, distribution },
      },
      {
        scoreType: "categorical_log",
        scoreValue: -Math.log(Math.max(1e-6, actualProbability)),
        scoreConfig: { actualCategory, actualProbability, distribution },
      },
    ];
  }

  if (input.forecastType === "thresholded") {
    const actual = readNumber(input.resolvedValue, "value", "actual", "resolvedNumeric");
    if (actual === null) {
      return [];
    }
    const direction = readString(input.prediction, "thresholdDirection", "threshold_direction") === "at_most"
      ? "at_most"
      : "at_least";
    const points = readRecordArray(input.prediction, "probabilities").flatMap((item) => {
      const threshold = readString(item, "threshold");
      const probability = readProbability(item);
      const thresholdValue = threshold ? parseFirstNumber(threshold) : null;
      if (!threshold || probability === null || thresholdValue === null) {
        return [];
      }
      const resolved = direction === "at_most" ? actual <= thresholdValue : actual >= thresholdValue;
      return [{
        threshold,
        thresholdValue,
        probability,
        resolved,
        scores: scoreBinaryForecast({ probability, resolved }),
      }];
    });
    if (points.length === 0) {
      return [];
    }
    return [
      {
        scoreType: "thresholded_brier",
        scoreValue: meanNumber(points.map((point) => point.scores.brier)),
        scoreConfig: { actual, direction, points },
      },
      {
        scoreType: "thresholded_log",
        scoreValue: meanNumber(points.map((point) => point.scores.log)),
        scoreConfig: { actual, direction, points },
      },
    ];
  }

  const conditionResolved = readBoolean(input.resolvedValue, "conditionResolved", "condition_resolved", "condition");
  const outcomeResolved = readBoolean(input.resolvedValue, "outcomeResolved", "outcome_resolved", "resolved", "outcome");
  if (conditionResolved === null || outcomeResolved === null) {
    return [];
  }
  const branch = conditionResolved ? "condition" : "not_condition";
  const probability = conditionResolved
    ? readNumber(input.prediction, "probabilityGivenCondition", "probability_given_condition")
    : readNumber(input.prediction, "probabilityGivenNotCondition", "probability_given_not_condition");
  if (probability === null) {
    return [];
  }
  const branchScores = scoreBinaryForecast({ probability, resolved: outcomeResolved });
  const rows: ScoreRowInput[] = Object.entries(branchScores).map(([scoreType, scoreValue]) => ({
    scoreType: `conditional_${scoreType}`,
    scoreValue,
    scoreConfig: {
      branch,
      probability,
      conditionResolved,
      outcomeResolved,
    },
  }));
  const conditionProbability = readNumber(input.prediction, "conditionProbability", "condition_probability");
  if (conditionProbability !== null) {
    const conditionScores = scoreBinaryForecast({ probability: conditionProbability, resolved: conditionResolved });
    rows.push(
      {
        scoreType: "condition_brier",
        scoreValue: conditionScores.brier,
        scoreConfig: { probability: conditionProbability, conditionResolved },
      },
      {
        scoreType: "condition_log",
        scoreValue: conditionScores.log,
        scoreConfig: { probability: conditionProbability, conditionResolved },
      },
    );
  }
  return rows;
}

function validateResolvedValue(
  forecastType: "binary" | "date" | "numeric" | "categorical" | "thresholded" | "conditional",
  value: Record<string, unknown>,
) {
  if (forecastType === "binary" && readResolved(value) === null) {
    throw new Error("Binary resolution expects { resolved: boolean }.");
  }
  if ((forecastType === "numeric" || forecastType === "thresholded") && readNumber(value, "value", "actual", "resolvedNumeric") === null) {
    throw new Error(`${forecastType} resolution expects { value: number }.`);
  }
  if (forecastType === "date" && !readDate(value, "date", "targetDate", "target_date", "resolvedDate", "resolved_date")) {
    throw new Error("Date resolution expects { date: \"YYYY-MM-DD\" }.");
  }
  if (forecastType === "categorical" && !readString(value, "category", "actual", "resolvedCategory", "resolved_category")) {
    throw new Error("Categorical resolution expects { category: string }.");
  }
  if (
    forecastType === "conditional" &&
    (readBoolean(value, "conditionResolved", "condition_resolved", "condition") === null ||
      readBoolean(value, "outcomeResolved", "outcome_resolved", "resolved", "outcome") === null)
  ) {
    throw new Error("Conditional resolution expects { conditionResolved: boolean, outcomeResolved: boolean }.");
  }
}

async function listPendingBinaryForecasts(db: Db, productScores: Array<typeof forecastScores.$inferSelect>) {
  const scoredTaskIds = new Set(
    productScores
      .filter((score) => score.scoreType === "brier" && score.forecastAggregateId)
      .map((score) => readScoreTaskId(score.scoreConfig))
      .filter((taskId): taskId is string => Boolean(taskId)),
  );
  const forecastTasks = await db
    .select({
      id: tasks.id,
      label: tasks.label,
      benchmarkRunId: tasks.benchmarkRunId,
      outputArtifactId: tasks.outputArtifactId,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
    })
    .from(tasks)
    .where(and(eq(tasks.operationMode, "forecast"), eq(tasks.operationSubmode, "binary_forecast"), eq(tasks.status, "completed")))
    .orderBy(desc(tasks.createdAt))
    .limit(20);

  const pending = [];
  for (const task of forecastTasks) {
    if (task.benchmarkRunId || scoredTaskIds.has(task.id)) {
      continue;
    }
    const [outputRow] = task.outputArtifactId
      ? await db
          .select({ rowJson: artifactRows.rowJson })
          .from(artifactRows)
          .where(and(eq(artifactRows.artifactId, task.outputArtifactId), eq(artifactRows.rowIndex, 0)))
          .limit(1)
      : [];
    pending.push({
      taskId: task.id,
      label: task.label,
      probability: readProbability(outputRow?.rowJson ?? null),
      createdAt: task.createdAt,
      completedAt: task.completedAt,
    });
  }
  return pending;
}

async function taskLabelsById(db: Db, productScores: Array<typeof forecastScores.$inferSelect>) {
  const taskIds = [
    ...new Set(
      productScores
        .map((score) => readScoreTaskId(score.scoreConfig))
        .filter((taskId): taskId is string => Boolean(taskId)),
    ),
  ];
  if (taskIds.length === 0) {
    return new Map<string, string>();
  }
  const rows = await db.select({ id: tasks.id, label: tasks.label }).from(tasks).where(inArray(tasks.id, taskIds));
  return new Map(rows.map((row) => [row.id, row.label]));
}

function isProductScore(score: typeof forecastScores.$inferSelect) {
  const config = asRecord(score.scoreConfig);
  return config?.source === "manual_resolution" && typeof config.taskId === "string" && !("benchmarkRunId" in config);
}

function isBenchmarkScore(score: typeof forecastScores.$inferSelect) {
  const config = asRecord(score.scoreConfig);
  return Boolean(config?.benchmarkRunId);
}

function readScoreTaskId(value: unknown) {
  const record = asRecord(value);
  return typeof record?.taskId === "string" ? record.taskId : null;
}

function readScoreTaskIdFromResolution(value: unknown) {
  const record = asRecord(value);
  return typeof record?.taskId === "string" ? record.taskId : null;
}

function readProbability(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const raw = record.probability ?? record.probability_pct ?? record.probabilityPct;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
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
    if (typeof raw === "string") {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
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

function readBoolean(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "boolean") {
      return raw;
    }
    if (typeof raw === "string") {
      if (raw.toLowerCase() === "true") {
        return true;
      }
      if (raw.toLowerCase() === "false") {
        return false;
      }
    }
  }
  return null;
}

function readDate(value: unknown, ...keys: string[]) {
  const raw = readString(value, ...keys);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readResolved(value: unknown) {
  const record = asRecord(value);
  return typeof record?.resolved === "boolean" ? record.resolved : null;
}

function meanScore(rows: Array<typeof forecastScores.$inferSelect>) {
  if (rows.length === 0) {
    return null;
  }
  return rows.reduce((sum, row) => sum + row.scoreValue, 0) / rows.length;
}

function buildCalibrationBuckets(rows: Array<typeof forecastScores.$inferSelect>) {
  const bucketDefs = [
    { min: 0, max: 20 },
    { min: 20, max: 40 },
    { min: 40, max: 60 },
    { min: 60, max: 80 },
    { min: 80, max: 100 },
  ];
  return bucketDefs.map((bucket) => {
    const bucketRows = rows.filter((row) => {
      const probability = readProbability(row.scoreConfig);
      if (probability === null) {
        return false;
      }
      return bucket.max === 100
        ? probability >= bucket.min && probability <= bucket.max
        : probability >= bucket.min && probability < bucket.max;
    });
    const probabilities = bucketRows
      .map((row) => readProbability(row.scoreConfig))
      .filter((value): value is number => value !== null);
    const resolvedValues = bucketRows
      .map((row) => readResolved(row.scoreConfig))
      .filter((value): value is boolean => value !== null);
    const observedRate = resolvedValues.length
      ? (resolvedValues.filter(Boolean).length / resolvedValues.length) * 100
      : null;
    const meanForecast = probabilities.length ? meanNumber(probabilities) : null;
    return {
      label: `${bucket.min}-${bucket.max}%`,
      minProbability: bucket.min,
      maxProbability: bucket.max,
      count: bucketRows.length,
      meanForecast,
      observedRate,
      meanBrier: meanScore(bucketRows),
      calibrationError:
        meanForecast === null || observedRate === null
          ? null
          : Math.abs(meanForecast - observedRate),
    };
  });
}

function summarizeCalibration(
  buckets: Array<{
    count: number;
    calibrationError: number | null;
  }>,
  resolvedForecastCount: number,
) {
  const sampleSize = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const weightedErrors = buckets.filter((bucket) => bucket.count > 0 && bucket.calibrationError !== null);
  const expectedCalibrationError = weightedErrors.length
    ? weightedErrors.reduce((sum, bucket) => sum + bucket.count * (bucket.calibrationError ?? 0), 0) / sampleSize
    : null;
  const maxBucketCalibrationError = weightedErrors.length
    ? Math.max(...weightedErrors.map((bucket) => bucket.calibrationError ?? 0))
    : null;
  const minimumForFitting = 25;
  return {
    sampleSize,
    resolvedForecastCount,
    expectedCalibrationError,
    maxBucketCalibrationError,
    minimumForFitting,
    status:
      resolvedForecastCount < minimumForFitting
        ? "collecting_resolved_forecasts"
        : "ready_for_candidate_fitting",
  };
}

function meanNumber(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
        }
      } catch {
        continue;
      }
    }
  }
  return [];
}

function normalizedCategoryDistribution(prediction: Record<string, unknown>) {
  const rawDistribution = readRecordArray(prediction, "probabilities")
    .map((item) => ({
      category: readString(item, "category") ?? "",
      probability: readNumber(item, "probability") ?? 0,
    }))
    .filter((item) => item.category && item.probability > 0);
  const fallbackCategory = readString(prediction, "topCategory", "top_category");
  const distribution = rawDistribution.length || !fallbackCategory
    ? rawDistribution
    : [{ category: fallbackCategory, probability: 100 }];
  const total = distribution.reduce((sum, item) => sum + item.probability, 0);
  if (total <= 0) {
    return [];
  }
  return distribution.map((item) => ({
    category: item.category,
    probability: Math.max(0, Math.min(1, item.probability / total)),
  }));
}

function parseFirstNumber(value: string) {
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function isResolvableForecastSubmode(operationSubmode: string | null) {
  return (
    operationSubmode === "binary_forecast" ||
    operationSubmode === "date_forecast" ||
    operationSubmode === "numeric_forecast" ||
    operationSubmode === "categorical_forecast" ||
    operationSubmode === "thresholded_forecast" ||
    operationSubmode === "conditional_forecast"
  );
}

function forecastTypeFromSubmode(operationSubmode: string | null): "binary" | "date" | "numeric" | "categorical" | "thresholded" | "conditional" {
  if (operationSubmode === "date_forecast") {
    return "date";
  }
  if (operationSubmode === "numeric_forecast") {
    return "numeric";
  }
  if (operationSubmode === "categorical_forecast") {
    return "categorical";
  }
  if (operationSubmode === "thresholded_forecast") {
    return "thresholded";
  }
  if (operationSubmode === "conditional_forecast") {
    return "conditional";
  }
  return "binary";
}

function resolvedValueMatches(existing: unknown, target: Record<string, unknown>) {
  const existingRecord = asRecord(existing);
  if (!existingRecord) {
    return false;
  }
  for (const [key, value] of Object.entries(target)) {
    if (existingRecord[key] !== value) {
      return false;
    }
  }
  return true;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
