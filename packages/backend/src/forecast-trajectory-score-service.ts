import { and, eq, inArray } from "drizzle-orm";
import {
  forecastQuestions,
  forecastSnapshots,
  forecastTrajectoryScores,
  type createDb,
} from "@open-superforecaster/db";
import {
  buildBinaryTrajectoryScoreRows,
  type BinaryTrajectorySnapshot,
} from "./forecast-trajectory-scoring";

type Db = ReturnType<typeof createDb>["db"];

/**
 * Idempotently score every snapshot belonging to the canonical binary question
 * linked to a resolved task. Existing aggregate/attempt score rows are neither
 * read nor modified.
 */
export async function scoreCanonicalBinaryForecastTrajectory(
  db: Db,
  input: {
    taskId: string;
    resolutionId: string;
    resolved: boolean;
    resolvedAt: Date;
    annulled: boolean;
  },
) {
  if (input.annulled) {
    return emptyTrajectoryScoreResult("resolution_annulled");
  }
  const anchorSnapshots = await db
    .select({ questionId: forecastSnapshots.questionId })
    .from(forecastSnapshots)
    .where(eq(forecastSnapshots.taskId, input.taskId));
  const anchorQuestionIds = uniqueStrings(anchorSnapshots.map((snapshot) => snapshot.questionId));
  if (anchorQuestionIds.length === 0) {
    return emptyTrajectoryScoreResult("no_canonical_question");
  }
  const binaryQuestions = await db
    .select({ id: forecastQuestions.id })
    .from(forecastQuestions)
    .where(and(
      inArray(forecastQuestions.id, anchorQuestionIds),
      eq(forecastQuestions.forecastType, "binary"),
    ));
  const questionIds = binaryQuestions.map((question) => question.id);
  if (questionIds.length === 0) {
    return emptyTrajectoryScoreResult("canonical_question_not_binary");
  }
  const snapshots = await db
    .select()
    .from(forecastSnapshots)
    .where(inArray(forecastSnapshots.questionId, questionIds));
  const built = buildBinaryTrajectoryScoreRows({
    snapshots: snapshots satisfies BinaryTrajectorySnapshot[],
    resolutionId: input.resolutionId,
    resolved: input.resolved,
    resolvedAt: input.resolvedAt,
  });
  if (built.rows.length === 0) {
    return {
      status: "no_scoreable_snapshots" as const,
      questionIds,
      snapshotCount: snapshots.length,
      proposedScoreRows: 0,
      insertedScoreRows: 0,
      existingScoreRows: 0,
      skippedSnapshots: built.skipped,
    };
  }
  const inserted = await db
    .insert(forecastTrajectoryScores)
    .values(built.rows)
    .onConflictDoNothing()
    .returning({ id: forecastTrajectoryScores.id });
  return {
    status: "scored" as const,
    questionIds,
    snapshotCount: snapshots.length,
    proposedScoreRows: built.rows.length,
    insertedScoreRows: inserted.length,
    existingScoreRows: built.rows.length - inserted.length,
    skippedSnapshots: built.skipped,
  };
}

function emptyTrajectoryScoreResult(reason: "resolution_annulled" | "no_canonical_question" | "canonical_question_not_binary") {
  return {
    status: "skipped" as const,
    reason,
    questionIds: [] as string[],
    snapshotCount: 0,
    proposedScoreRows: 0,
    insertedScoreRows: 0,
    existingScoreRows: 0,
    skippedSnapshots: [],
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
