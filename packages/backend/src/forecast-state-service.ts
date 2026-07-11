import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  forecastMemoryEntries,
  forecastQuestions,
  forecastSnapshots,
  forecastUpdateTriggers,
  type createDb,
} from "@open-superforecaster/db";

type Db = ReturnType<typeof createDb>["db"];
export type ForecastStateDbExecutor = Pick<Db, "delete" | "execute" | "insert" | "select" | "update">;

type ForecastType = "binary" | "date" | "numeric" | "categorical" | "thresholded" | "conditional";
type ForecastUpdateKind = "initial" | "scheduled" | "event_triggered" | "manual";

export class ForecastQuestionNotOpenError extends Error {
  readonly questionId: string;
  readonly questionStatus: string;

  constructor(questionId: string, questionStatus: string) {
    super(`Forecast question ${questionId} is ${questionStatus}; no new snapshot may be committed.`);
    this.name = "ForecastQuestionNotOpenError";
    this.questionId = questionId;
    this.questionStatus = questionStatus;
  }
}

export type PersistableForecastState = {
  version: string;
  stateId: string;
  question: {
    question: string;
    resolutionCriteria: string;
    resolutionDate: string | null;
    condition: string | null;
    background: string | null;
  };
  temporal: {
    forecastAsOf: string | null;
    evidenceAsOf: string | null;
    cutoffDate: string | null;
    trustState: "complete" | "partial" | "inconsistent";
  };
  outputs: {
    autonomous: {
      rawProbability: number;
      selectedProbability: number;
      calibration: {
        status: "not_applied" | "applied" | "rejected";
        modelId: string | null;
      };
    };
    crowdAssisted: {
      probability: number;
      marketProbability: number;
    } | null;
  };
  update: {
    kind: ForecastUpdateKind;
    reason: string;
    previousStateId: string | null;
    probabilityDelta: number | null;
    newEvidenceClaimIds: string[];
    invalidatedEvidenceClaimIds: string[];
    nextScheduledUpdate: string | null;
    triggerConditions: string[];
  };
  memory: {
    scope: "question_local";
    activeFactors: Array<{ description: string; sourceClaimIds: string[] }>;
    unresolvedInformationNeeds: string[];
    transcriptStored: false;
  };
  provenance: {
    workflowVersion: string;
    aggregatorVersion: string;
    calibratorVersion: string | null;
    dossierVersion: string;
    schedulerVersion: string | null;
  };
};

export type PersistForecastStateInput = {
  state: PersistableForecastState;
  forecastType?: ForecastType;
  sessionId?: string;
  taskId?: string;
  taskRowId?: string;
  forecastAggregateId?: string;
  calibrationModelId?: string;
  componentAttemptIds?: string[];
  questionMetadata?: Record<string, unknown>;
};

export type ForecastMemoryActivationEvidence = {
  sourceQuestionIds: string[];
  sourceResolutionIds: string[];
  validationJson: Record<string, unknown>;
};

export const DEFAULT_FORECAST_UPDATE_LEASE_MS = 6 * 60 * 60 * 1_000;
export const MAX_PERSISTED_ACTIVE_MEMORY_FACTORS = 64;
export const MAX_PERSISTED_INFORMATION_NEEDS = 32;
export const MAX_PERSISTED_TRIGGER_CONDITIONS = 32;

export type ForecastSnapshotChronologyInput = {
  questionId: string;
  latestSnapshotId: string | null;
  previousStateId: string | null;
  previousSnapshot: {
    id: string;
    questionId: string;
    forecastAsOf: string | null;
  } | null;
  forecastAsOf: string | null;
};

export function canonicalForecastQuestionKey(input: {
  forecastType: ForecastType;
  question: string;
  resolutionCriteria: string;
  resolutionDate?: string | null;
  condition?: string | null;
}) {
  const canonical = [
    input.forecastType,
    normalizeQuestionText(input.question),
    normalizeQuestionText(input.resolutionCriteria),
    normalizeQuestionText(input.resolutionDate ?? ""),
    normalizeQuestionText(input.condition ?? ""),
  ].join("\n");
  return `forecast_question_${createHash("sha256").update(canonical).digest("hex")}`;
}

/**
 * Idempotently persist one immutable ForecastState snapshot and advance the
 * canonical question pointer. The full state remains available for replay while
 * headline fields remain queryable for scheduling and scoring.
 */
export async function persistForecastState(db: Db, input: PersistForecastStateInput) {
  return db.transaction((tx) => persistForecastStateInTransaction(tx, input));
}

/**
 * Transaction-scoped implementation used by the forecast-ledger materializer.
 * Callers must own the surrounding transaction; no write in this function is
 * intended to become visible independently of the others.
 */
export async function persistForecastStateInTransaction(
  db: ForecastStateDbExecutor,
  input: PersistForecastStateInput,
) {
  assertPersistableForecastState(input.state);
  const state = input.state;
  const forecastType = input.forecastType ?? "binary";
  const canonicalKey = canonicalForecastQuestionKey({
    forecastType,
    question: state.question.question,
    resolutionCriteria: state.question.resolutionCriteria,
    resolutionDate: state.question.resolutionDate,
    condition: state.question.condition,
  });
  const now = new Date();
  const [question] = await db
    .insert(forecastQuestions)
    .values({
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      canonicalKey,
      forecastType,
      question: state.question.question,
      resolutionCriteria: state.question.resolutionCriteria,
      resolutionDate: state.question.resolutionDate,
      condition: state.question.condition,
      background: state.question.background,
      metadataJson: input.questionMetadata ?? {},
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: forecastQuestions.canonicalKey,
      set: {
        question: state.question.question,
        resolutionCriteria: state.question.resolutionCriteria,
        resolutionDate: state.question.resolutionDate,
        condition: state.question.condition,
        background: state.question.background,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.questionMetadata ? { metadataJson: input.questionMetadata } : {}),
        updatedAt: now,
      },
    })
    .returning();

  if (question.status !== "open") {
    // The INSERT ... ON CONFLICT UPDATE above owns the canonical question row
    // lock until the surrounding transaction ends. Resolution acquires the
    // same lock before closing the question, so one side wins cleanly and a
    // post-resolution snapshot cannot slip through the lifecycle boundary.
    throw new ForecastQuestionNotOpenError(question.id, question.status);
  }

  const [existing] = await db
    .select()
    .from(forecastSnapshots)
    .where(eq(forecastSnapshots.stateId, state.stateId))
    .limit(1);
  if (existing) {
    if (existing.questionId !== question.id) {
      throw new Error(`ForecastState ${state.stateId} is already attached to another question.`);
    }
    if (input.taskId && existing.taskId !== input.taskId) {
      throw new Error(
        `ForecastState ${state.stateId} is already owned by task ${existing.taskId ?? "none"}; cross-task snapshot reuse is not a valid ledger commit.`,
      );
    }
    if (input.forecastAggregateId && existing.forecastAggregateId !== input.forecastAggregateId) {
      throw new Error(
        `ForecastState ${state.stateId} is already linked to aggregate ${existing.forecastAggregateId ?? "none"}; aggregate identity cannot change.`,
      );
    }
    return { question, snapshot: existing, created: false };
  }

  const previousSnapshot = await readPreviousSnapshot(db, state.update.previousStateId);
  assertForecastSnapshotChronology({
    questionId: question.id,
    latestSnapshotId: question.latestSnapshotId,
    previousStateId: state.update.previousStateId,
    previousSnapshot,
    forecastAsOf: state.temporal.forecastAsOf,
  });
  const previousSnapshotId = previousSnapshot?.id ?? null;
  const nextScheduledUpdate = parseOptionalTimestamp(
    state.update.nextScheduledUpdate,
    "nextScheduledUpdate",
  );
  const [snapshot] = await db
    .insert(forecastSnapshots)
    .values({
      questionId: question.id,
      stateId: state.stateId,
      stateVersion: state.version,
      stateJson: state as unknown as Record<string, unknown>,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.taskRowId ? { taskRowId: input.taskRowId } : {}),
      ...(input.forecastAggregateId ? { forecastAggregateId: input.forecastAggregateId } : {}),
      ...(previousSnapshotId ? { previousSnapshotId } : {}),
      forecastAsOf: state.temporal.forecastAsOf,
      evidenceAsOf: state.temporal.evidenceAsOf,
      cutoffDate: state.temporal.cutoffDate,
      temporalTrustState: state.temporal.trustState,
      rawAutonomousProbability: state.outputs.autonomous.rawProbability,
      selectedAutonomousProbability: state.outputs.autonomous.selectedProbability,
      crowdAssistedProbability: state.outputs.crowdAssisted?.probability ?? null,
      marketProbability: state.outputs.crowdAssisted?.marketProbability ?? null,
      ...(input.calibrationModelId && state.outputs.autonomous.calibration.status === "applied"
        ? { calibrationModelId: input.calibrationModelId }
        : {}),
      updateKind: state.update.kind,
      updateReason: state.update.reason,
      probabilityDelta: state.update.probabilityDelta,
      newEvidenceClaimIds: state.update.newEvidenceClaimIds,
      invalidatedEvidenceClaimIds: state.update.invalidatedEvidenceClaimIds,
      nextScheduledUpdate,
      triggerConditions: state.update.triggerConditions,
      componentAttemptIds: input.componentAttemptIds ?? [],
      workflowVersion: state.provenance.workflowVersion,
      aggregatorVersion: state.provenance.aggregatorVersion,
      calibratorVersion: state.provenance.calibratorVersion,
      dossierVersion: state.provenance.dossierVersion,
      schedulerVersion: state.provenance.schedulerVersion,
      updatedAt: now,
    })
    .returning();

  const [advancedQuestion] = await db
    .update(forecastQuestions)
    .set({
      latestSnapshotId: snapshot.id,
      updateLeaseOwner: null,
      updateLeaseExpiresAt: null,
      updateLeaseTriggerId: null,
      updatedAt: now,
    })
    .where(and(
      eq(forecastQuestions.id, question.id),
      previousSnapshotId
        ? eq(forecastQuestions.latestSnapshotId, previousSnapshotId)
        : isNull(forecastQuestions.latestSnapshotId),
    ))
    .returning();
  if (!advancedQuestion) {
    // The immutable insert happens before the pointer compare-and-swap. Remove
    // the losing candidate so a concurrent update cannot leave an orphan that
    // appears to be a valid path snapshot.
    await db.delete(forecastSnapshots).where(eq(forecastSnapshots.id, snapshot.id));
    throw new Error(
      `ForecastState ${state.stateId} is stale: the question advanced from its expected previous snapshot.`,
    );
  }

  await db
    .update(forecastUpdateTriggers)
    .set({ status: "retired", updatedAt: now })
    .where(and(
      eq(forecastUpdateTriggers.questionId, question.id),
      or(
        eq(forecastUpdateTriggers.status, "active"),
        eq(forecastUpdateTriggers.status, "snoozed"),
      ),
    ));
  const triggers = buildTriggerRows(question.id, snapshot.id, state, nextScheduledUpdate);
  if (triggers.length) {
    await db.insert(forecastUpdateTriggers).values(triggers);
  }
  await persistQuestionLocalMemory(db, {
    questionId: question.id,
    snapshotId: snapshot.id,
    state,
    now,
  });
  return { question: advancedQuestion, snapshot, created: true };
}

export async function listDueForecastTriggers(db: Db, input: { asOf?: Date; limit?: number } = {}) {
  const asOf = input.asOf ?? new Date();
  const asOfIso = asOf.toISOString();
  const limit = Math.min(500, Math.max(1, Math.round(input.limit ?? 100)));
  return db
    .select()
    .from(forecastUpdateTriggers)
    .where(and(
      inArray(forecastUpdateTriggers.status, ["active", "snoozed"]),
      lte(forecastUpdateTriggers.nextCheckAt, asOf),
      sql`exists (
        select 1
        from ${forecastQuestions}
        where ${forecastQuestions.id} = ${forecastUpdateTriggers.questionId}
          and ${forecastQuestions.status} = 'open'
          and (
            ${forecastQuestions.updateLeaseExpiresAt} is null
            or ${forecastQuestions.updateLeaseExpiresAt} <= ${asOfIso}::timestamptz
          )
          and (
            ${forecastUpdateTriggers.status} = 'active'
            or ${forecastQuestions.updateLeaseTriggerId} = ${forecastUpdateTriggers.id}
          )
      )`,
    ))
    .orderBy(asc(forecastUpdateTriggers.nextCheckAt))
    .limit(limit);
}

/**
 * Atomically claim at most one due trigger per open question. The question row
 * is the concurrency boundary, so two runners cannot claim sibling triggers
 * for the same forecast. An expired lease may reclaim its snoozed trigger.
 */
export async function claimDueForecastTriggers(
  db: Db,
  input: {
    leaseOwner: string;
    asOf?: Date;
    limit?: number;
    leaseDurationMs?: number;
  },
) {
  const leaseOwner = input.leaseOwner.trim();
  if (!leaseOwner) {
    throw new Error("Forecast update claims require a non-empty leaseOwner.");
  }
  const asOf = input.asOf ?? new Date();
  const asOfIso = asOf.toISOString();
  const limit = Math.min(500, Math.max(1, Math.round(input.limit ?? 100)));
  const leaseExpiresAt = forecastUpdateLeaseExpiresAt(asOf, input.leaseDurationMs);
  const leaseExpiresAtIso = leaseExpiresAt.toISOString();
  const rows = await db.execute(sql<{ id: string }>`
    with candidate_questions as (
      select q.id as question_id
      from ${forecastQuestions} q
      where q.status = 'open'
        and (q.update_lease_expires_at is null or q.update_lease_expires_at <= ${asOfIso}::timestamptz)
        and exists (
          select 1
          from ${forecastUpdateTriggers} t
          where t.question_id = q.id
            and t.next_check_at <= ${asOfIso}::timestamptz
            and (
              t.status = 'active'
              or (
                t.status = 'snoozed'
                and q.update_lease_trigger_id = t.id
                and q.update_lease_expires_at <= ${asOfIso}::timestamptz
              )
            )
        )
      order by (
        select min(t.next_check_at)
        from ${forecastUpdateTriggers} t
        where t.question_id = q.id
          and t.next_check_at <= ${asOfIso}::timestamptz
          and (
            t.status = 'active'
            or (t.status = 'snoozed' and q.update_lease_trigger_id = t.id)
          )
      ) asc
      limit ${limit}
      for update of q skip locked
    ),
    candidate_triggers as (
      select
        cq.question_id,
        coalesce(
          (
            select t.id
            from ${forecastUpdateTriggers} t
            where t.id = q.update_lease_trigger_id
              and t.status = 'snoozed'
              and t.next_check_at <= ${asOfIso}::timestamptz
            limit 1
          ),
          (
            select t.id
            from ${forecastUpdateTriggers} t
            where t.question_id = cq.question_id
              and t.status = 'active'
              and t.next_check_at <= ${asOfIso}::timestamptz
            order by t.next_check_at asc, t.created_at asc, t.id asc
            limit 1
          )
        ) as trigger_id
      from candidate_questions cq
      join ${forecastQuestions} q on q.id = cq.question_id
    ),
    leased_questions as (
      update ${forecastQuestions} q
      set
        update_lease_owner = ${leaseOwner},
        update_lease_expires_at = ${leaseExpiresAtIso}::timestamptz,
        update_lease_trigger_id = c.trigger_id,
        updated_at = ${asOfIso}::timestamptz
      from candidate_triggers c
      where q.id = c.question_id
        and c.trigger_id is not null
      returning q.update_lease_trigger_id as trigger_id
    )
    update ${forecastUpdateTriggers} t
    set
      status = 'snoozed',
      last_checked_at = ${asOfIso}::timestamptz,
      updated_at = ${asOfIso}::timestamptz
    from leased_questions l
    where t.id = l.trigger_id
    returning t.id
  `);
  const claimedIds = rows
    .map((row) => typeof row.id === "string" ? row.id : null)
    .filter((id): id is string => id !== null);
  if (!claimedIds.length) {
    return [];
  }
  const claimed = await db
    .select()
    .from(forecastUpdateTriggers)
    .where(inArray(forecastUpdateTriggers.id, claimedIds));
  const order = new Map(claimedIds.map((id, index) => [id, index]));
  return claimed.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
}

export function forecastUpdateLeaseExpiresAt(
  asOf: Date,
  leaseDurationMs = DEFAULT_FORECAST_UPDATE_LEASE_MS,
) {
  if (!Number.isFinite(asOf.getTime())) {
    throw new Error("Forecast update lease asOf must be a valid date.");
  }
  if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
    throw new Error("Forecast update lease duration must be positive.");
  }
  return new Date(asOf.getTime() + Math.round(leaseDurationMs));
}

export async function markForecastTriggerFired(
  db: Db,
  input: { triggerId: string; leaseOwner: string; firedAt?: Date },
) {
  const firedAt = input.firedAt ?? new Date();
  const firedAtIso = firedAt.toISOString();
  const leaseOwner = input.leaseOwner.trim();
  if (!leaseOwner) {
    throw new Error("Marking a forecast trigger fired requires its leaseOwner.");
  }
  const [trigger] = await db
    .update(forecastUpdateTriggers)
    .set({ status: "fired", firedAt, lastCheckedAt: firedAt, updatedAt: firedAt })
    .where(and(
      eq(forecastUpdateTriggers.id, input.triggerId),
      eq(forecastUpdateTriggers.status, "snoozed"),
      sql`exists (
        select 1
        from ${forecastQuestions}
        where ${forecastQuestions.id} = ${forecastUpdateTriggers.questionId}
          and ${forecastQuestions.updateLeaseTriggerId} = ${forecastUpdateTriggers.id}
          and ${forecastQuestions.updateLeaseOwner} = ${leaseOwner}
          and ${forecastQuestions.updateLeaseExpiresAt} > ${firedAtIso}::timestamptz
      )`,
    ))
    .returning();
  return trigger ?? null;
}

export async function retireForecastTriggersForQuestion(
  db: Db,
  questionId: string,
  retiredAt = new Date(),
) {
  return db
    .update(forecastUpdateTriggers)
    .set({ status: "retired", lastCheckedAt: retiredAt, updatedAt: retiredAt })
    .where(and(
      eq(forecastUpdateTriggers.questionId, questionId),
      or(
        eq(forecastUpdateTriggers.status, "active"),
        eq(forecastUpdateTriggers.status, "snoozed"),
      ),
    ))
    .returning()
    .then(async (triggers) => {
      await db
        .update(forecastQuestions)
        .set({
          updateLeaseOwner: null,
          updateLeaseExpiresAt: null,
          updateLeaseTriggerId: null,
          updatedAt: retiredAt,
        })
        .where(eq(forecastQuestions.id, questionId));
      return triggers;
    });
}

/**
 * Make a failed detached update retryable without reviving stale work. The
 * source snapshot must still be the open question's latest snapshot at the
 * instant of the update; a newer successful snapshot therefore wins races.
 */
export async function reactivateForecastTriggerAfterFailedUpdate(
  db: Db,
  triggerId: string,
  input: { leaseOwner?: string | null; checkedAt?: Date } = {},
) {
  const checkedAt = input.checkedAt ?? new Date();
  const leaseOwner = input.leaseOwner?.trim() || null;
  const [trigger] = await db
    .update(forecastUpdateTriggers)
    .set({
      status: "active",
      firedAt: null,
      lastCheckedAt: checkedAt,
      updatedAt: checkedAt,
    })
    .where(and(
      eq(forecastUpdateTriggers.id, triggerId),
      leaseOwner
        ? or(
            eq(forecastUpdateTriggers.status, "fired"),
            eq(forecastUpdateTriggers.status, "snoozed"),
          )
        : eq(forecastUpdateTriggers.status, "fired"),
      sql`exists (
        select 1
        from ${forecastQuestions}
        where ${forecastQuestions.id} = ${forecastUpdateTriggers.questionId}
          and ${forecastQuestions.status} = 'open'
          and ${forecastQuestions.latestSnapshotId} = ${forecastUpdateTriggers.sourceSnapshotId}
          ${leaseOwner ? sql`and ${forecastQuestions.updateLeaseTriggerId} = ${forecastUpdateTriggers.id}
            and ${forecastQuestions.updateLeaseOwner} = ${leaseOwner}` : sql``}
      )`,
    ))
    .returning();
  if (trigger && leaseOwner) {
    await db
      .update(forecastQuestions)
      .set({
        updateLeaseOwner: null,
        updateLeaseExpiresAt: null,
        updateLeaseTriggerId: null,
        updatedAt: checkedAt,
      })
      .where(and(
        eq(forecastQuestions.id, trigger.questionId),
        eq(forecastQuestions.updateLeaseTriggerId, trigger.id),
        eq(forecastQuestions.updateLeaseOwner, leaseOwner),
      ));
  }
  return trigger ?? null;
}

export async function getForecastUpdateContext(db: Db, triggerId: string, leaseOwner?: string) {
  const [trigger] = await db
    .select()
    .from(forecastUpdateTriggers)
    .where(eq(forecastUpdateTriggers.id, triggerId))
    .limit(1);
  if (!trigger) {
    throw new Error(`Forecast update trigger not found: ${triggerId}`);
  }
  const [question] = await db
    .select()
    .from(forecastQuestions)
    .where(eq(forecastQuestions.id, trigger.questionId))
    .limit(1);
  if (!question) {
    throw new Error(`Forecast question not found for trigger: ${triggerId}`);
  }
  if (question.status !== "open") {
    throw new Error(`Forecast question ${question.id} is not open.`);
  }
  if (leaseOwner && (
    trigger.status !== "snoozed"
    || question.updateLeaseTriggerId !== trigger.id
    || question.updateLeaseOwner !== leaseOwner
  )) {
    throw new Error(`Forecast update trigger ${trigger.id} is not leased by ${leaseOwner}.`);
  }
  if (!question.latestSnapshotId) {
    throw new Error(`Forecast question ${question.id} has no latest snapshot.`);
  }
  const [snapshot] = await db
    .select()
    .from(forecastSnapshots)
    .where(eq(forecastSnapshots.id, question.latestSnapshotId))
    .limit(1);
  if (!snapshot) {
    throw new Error(`Latest forecast snapshot ${question.latestSnapshotId} was not found.`);
  }
  return { trigger, question, snapshot };
}

export type CreateForecastMemoryInput = {
  scope: "question_local" | "cross_question";
  questionId?: string;
  sourceSnapshotId?: string;
  revisionOfId?: string;
  entryType: string;
  content: string;
  status?: "experimental" | "active";
  sourceQuestionIds?: string[];
  sourceResolutionIds?: string[];
  applicableTaxonomy?: Record<string, unknown>;
  counterexamples?: string[];
  validationJson?: Record<string, unknown>;
};

export async function createForecastMemory(db: Db, input: CreateForecastMemoryInput) {
  if (!input.entryType.trim() || !input.content.trim()) {
    throw new Error("Forecast memory requires a non-empty entryType and content.");
  }
  if (input.scope === "question_local" && !input.questionId) {
    throw new Error("Question-local memory requires questionId.");
  }
  const status = input.status ?? "experimental";
  const activationEvidence = {
    sourceQuestionIds: uniqueStrings(input.sourceQuestionIds ?? []),
    sourceResolutionIds: uniqueStrings(input.sourceResolutionIds ?? []),
    validationJson: input.validationJson ?? {},
  };
  if (input.scope === "cross_question" && status === "active") {
    assertCrossQuestionMemoryActivationEligible(activationEvidence);
  }
  const now = new Date();
  const [entry] = await db
    .insert(forecastMemoryEntries)
    .values({
      scope: input.scope,
      ...(input.questionId ? { questionId: input.questionId } : {}),
      ...(input.sourceSnapshotId ? { sourceSnapshotId: input.sourceSnapshotId } : {}),
      ...(input.revisionOfId ? { revisionOfId: input.revisionOfId } : {}),
      entryType: input.entryType.trim(),
      content: input.content.trim(),
      status,
      sourceQuestionIds: activationEvidence.sourceQuestionIds,
      sourceResolutionIds: activationEvidence.sourceResolutionIds,
      applicableTaxonomy: input.applicableTaxonomy ?? {},
      counterexamples: uniqueStrings(input.counterexamples ?? []),
      validationJson: activationEvidence.validationJson,
      ...(status === "active" ? { activatedAt: now } : {}),
      updatedAt: now,
    })
    .returning();
  return entry;
}

export function assertCrossQuestionMemoryActivationEligible(
  evidence: ForecastMemoryActivationEvidence,
) {
  if (evidence.sourceQuestionIds.length === 0 || evidence.sourceResolutionIds.length === 0) {
    throw new Error("Active cross-question memory requires source questions and resolved outcomes.");
  }
  if (evidence.validationJson.validatedOutOfTime !== true) {
    throw new Error("Active cross-question memory requires out-of-time validation.");
  }
  const holdoutCaseCount = Number(evidence.validationJson.holdoutCaseCount);
  if (!Number.isFinite(holdoutCaseCount) || holdoutCaseCount < 1) {
    throw new Error("Active cross-question memory requires a positive holdoutCaseCount.");
  }
  if (typeof evidence.validationJson.primaryMetric !== "string" || !evidence.validationJson.primaryMetric.trim()) {
    throw new Error("Active cross-question memory requires a named primaryMetric.");
  }
}

export function assertPersistableForecastState(
  state: PersistableForecastState,
): asserts state is PersistableForecastState {
  if (!state || typeof state !== "object") {
    throw new Error("Forecast state must be an object.");
  }
  if (!state.stateId?.trim() || !state.version?.trim()) {
    throw new Error("Forecast state requires stateId and version.");
  }
  if (!state.question?.question?.trim() || !state.question?.resolutionCriteria?.trim()) {
    throw new Error("Forecast state requires a question and resolution criteria.");
  }
  assertProbability(state.outputs?.autonomous?.rawProbability, "rawAutonomousProbability");
  assertProbability(state.outputs?.autonomous?.selectedProbability, "selectedAutonomousProbability");
  if (state.outputs.crowdAssisted) {
    assertProbability(state.outputs.crowdAssisted.probability, "crowdAssistedProbability");
    assertProbability(state.outputs.crowdAssisted.marketProbability, "marketProbability");
  }
  if (state.memory?.scope !== "question_local" || state.memory.transcriptStored !== false) {
    throw new Error("Persisted ForecastState memory must be bounded question-local state, not a transcript.");
  }
  if (state.memory.activeFactors.length > MAX_PERSISTED_ACTIVE_MEMORY_FACTORS) {
    throw new Error(`ForecastState activeFactors exceeds the ${MAX_PERSISTED_ACTIVE_MEMORY_FACTORS}-entry limit.`);
  }
  if (state.memory.unresolvedInformationNeeds.length > MAX_PERSISTED_INFORMATION_NEEDS) {
    throw new Error(
      `ForecastState unresolvedInformationNeeds exceeds the ${MAX_PERSISTED_INFORMATION_NEEDS}-entry limit.`,
    );
  }
  if (state.update.triggerConditions.length > MAX_PERSISTED_TRIGGER_CONDITIONS) {
    throw new Error(`ForecastState triggerConditions exceeds the ${MAX_PERSISTED_TRIGGER_CONDITIONS}-entry limit.`);
  }
}

/** Enforce a single forward-moving snapshot chain for each canonical question. */
export function assertForecastSnapshotChronology(input: ForecastSnapshotChronologyInput) {
  if (!input.previousStateId) {
    if (input.previousSnapshot) {
      throw new Error("An initial ForecastState cannot supply a previous snapshot.");
    }
    if (input.latestSnapshotId) {
      throw new Error(
        `ForecastState is stale: question ${input.questionId} already has a latest snapshot.`,
      );
    }
    if (input.forecastAsOf) {
      parseOptionalTimestamp(input.forecastAsOf, "forecastAsOf");
    }
    return;
  }
  if (!input.previousSnapshot) {
    throw new Error(`Previous ForecastState ${input.previousStateId} has not been persisted.`);
  }
  if (input.previousSnapshot.questionId !== input.questionId) {
    throw new Error(
      `Previous ForecastState ${input.previousStateId} belongs to another question.`,
    );
  }
  if (input.latestSnapshotId !== input.previousSnapshot.id) {
    throw new Error(
      `ForecastState is stale: ${input.previousStateId} is not the question's latest snapshot.`,
    );
  }
  const forecastAsOf = parseOptionalTimestamp(input.forecastAsOf, "forecastAsOf");
  if (!forecastAsOf) {
    throw new Error("An updated ForecastState requires forecastAsOf.");
  }
  const previousForecastAsOf = parseOptionalTimestamp(
    input.previousSnapshot.forecastAsOf,
    "previous forecastAsOf",
  );
  if (previousForecastAsOf && forecastAsOf.getTime() <= previousForecastAsOf.getTime()) {
    throw new Error(
      "An updated ForecastState forecastAsOf must be later than the previous snapshot.",
    );
  }
}

export function parsePersistableForecastState(value: unknown): PersistableForecastState {
  const state = value as PersistableForecastState;
  assertPersistableForecastState(state);
  return state;
}

async function readPreviousSnapshot(db: ForecastStateDbExecutor, previousStateId: string | null) {
  if (!previousStateId) {
    return null;
  }
  const [previous] = await db
    .select({
      id: forecastSnapshots.id,
      questionId: forecastSnapshots.questionId,
      forecastAsOf: forecastSnapshots.forecastAsOf,
    })
    .from(forecastSnapshots)
    .where(eq(forecastSnapshots.stateId, previousStateId))
    .limit(1);
  if (!previous) {
    throw new Error(`Previous ForecastState ${previousStateId} has not been persisted.`);
  }
  return previous;
}

function buildTriggerRows(
  questionId: string,
  snapshotId: string,
  state: PersistableForecastState,
  nextScheduledUpdate: Date | null,
) {
  const rows: Array<{
    questionId: string;
    sourceSnapshotId: string;
    triggerType: string;
    description: string;
    status: "active";
    nextCheckAt: Date | null;
    configJson: Record<string, unknown>;
  }> = uniqueStrings(state.update.triggerConditions).map((description) => ({
    questionId,
    sourceSnapshotId: snapshotId,
    triggerType: "signpost",
    description,
    status: "active" as const,
    nextCheckAt: null,
    configJson: { sourceStateId: state.stateId },
  }));
  if (nextScheduledUpdate) {
    rows.push({
      questionId,
      sourceSnapshotId: snapshotId,
      triggerType: "scheduled_review",
      description: "Scheduled forecast review",
      status: "active" as const,
      nextCheckAt: nextScheduledUpdate,
      configJson: { sourceStateId: state.stateId },
    });
  }
  return rows;
}

async function persistQuestionLocalMemory(
  db: ForecastStateDbExecutor,
  input: {
    questionId: string;
    snapshotId: string;
    state: PersistableForecastState;
    now: Date;
  },
) {
  await db
    .update(forecastMemoryEntries)
    .set({ status: "deprecated", deprecatedAt: input.now, updatedAt: input.now })
    .where(and(
      eq(forecastMemoryEntries.questionId, input.questionId),
      eq(forecastMemoryEntries.scope, "question_local"),
      eq(forecastMemoryEntries.status, "active"),
    ));
  const factors = input.state.memory.activeFactors.map((factor) => ({
    scope: "question_local" as const,
    questionId: input.questionId,
    sourceSnapshotId: input.snapshotId,
    entryType: "active_factor",
    content: factor.description,
    status: "active" as const,
    sourceQuestionIds: [input.questionId],
    sourceResolutionIds: [],
    applicableTaxonomy: {},
    counterexamples: [],
    validationJson: { sourceClaimIds: factor.sourceClaimIds },
    activatedAt: input.now,
    updatedAt: input.now,
  }));
  const informationNeeds = uniqueStrings(input.state.memory.unresolvedInformationNeeds).map((content) => ({
    scope: "question_local" as const,
    questionId: input.questionId,
    sourceSnapshotId: input.snapshotId,
    entryType: "unresolved_information_need",
    content,
    status: "active" as const,
    sourceQuestionIds: [input.questionId],
    sourceResolutionIds: [],
    applicableTaxonomy: {},
    counterexamples: [],
    validationJson: {},
    activatedAt: input.now,
    updatedAt: input.now,
  }));
  const rows = [...factors, ...informationNeeds];
  if (rows.length) {
    await db.insert(forecastMemoryEntries).values(rows);
  }
}

function parseOptionalTimestamp(value: string | null, label: string) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} must be an ISO date or timestamp.`);
  }
  return parsed;
}

function assertProbability(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be a finite probability from 0 to 100.`);
  }
}

function normalizeQuestionText(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
