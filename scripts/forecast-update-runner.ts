import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  claimDueForecastTriggers,
  createQueuedWorkflowTask,
  getForecastUpdateContext,
  launchSmithersDetached,
  listDueForecastTriggers,
  markForecastTriggerFired,
  markTaskFailed,
  markTaskRunning,
  retireForecastTriggersForQuestion,
} from "@open-superforecaster/backend";
import { loadAppConfig } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";
import { planNextForecastReview } from "@open-superforecaster/workflow-contracts";

const binaryWorkflowPath = ".smithers/workflows/binary-forecast.tsx";

export function nextForecastUpdateAt(input: {
  now: Date;
  resolutionDate?: string | null;
  cutoffDate?: string | null;
}) {
  const plan = planNextForecastReview({
    asOf: input.now,
    resolutionDate: input.resolutionDate,
  });
  return plan.nextReviewAt ? new Date(plan.nextReviewAt) : null;
}

export function updateKindForTrigger(triggerType: string) {
  return triggerType === "scheduled_review" ? "scheduled" as const : "event_triggered" as const;
}

async function main() {
  const root = resolve(import.meta.dir, "..");
  const config = loadAppConfig({ ...process.env, OPEN_SUPERFORECASTER_ROOT: root });
  const { db, sql } = createDb(config.DATABASE_URL);
  const execute = process.argv.includes("--execute");
  const limit = readIntegerArg("--limit", 100);
  const now = readNowArg();
  const leaseOwner = execute ? `forecast-update-runner:${randomUUID()}` : null;

  try {
    const triggers = execute
      ? await claimDueForecastTriggers(db, { asOf: now, limit, leaseOwner: leaseOwner! })
      : await listDueForecastTriggers(db, { asOf: now, limit });
    const seenQuestionIds = new Set<string>();
    const plans = [];
    for (const trigger of triggers) {
      if (seenQuestionIds.has(trigger.questionId)) {
        continue;
      }
      seenQuestionIds.add(trigger.questionId);
      const context = await getForecastUpdateContext(db, trigger.id, leaseOwner ?? undefined);
      const state = context.snapshot.stateJson;
      const nextScheduledUpdate = nextForecastUpdateAt({
        now,
        resolutionDate: context.question.resolutionDate,
      });
      const eligible = nextScheduledUpdate !== null;
      plans.push({ trigger, context, state, nextScheduledUpdate, eligible });
    }

    if (!execute) {
      console.log(JSON.stringify({
        ok: true,
        dryRun: true,
        asOf: now.toISOString(),
        dueTriggers: triggers.length,
        distinctQuestions: plans.length,
        plans: plans.map((plan) => ({
          triggerId: plan.trigger.id,
          triggerType: plan.trigger.triggerType,
          questionId: plan.context.question.id,
          question: plan.context.question.question,
          previousStateId: plan.context.snapshot.stateId,
          eligible: plan.eligible,
          nextScheduledUpdate: plan.nextScheduledUpdate?.toISOString() ?? null,
        })),
        note: "Dry run only. Pass --execute to launch detached update workflows.",
      }, null, 2));
      return;
    }

    const launched = [];
    for (const plan of plans) {
      if (!plan.eligible) {
        await retireForecastTriggersForQuestion(db, plan.context.question.id, now);
        launched.push({
          triggerId: plan.trigger.id,
          questionId: plan.context.question.id,
          status: "retired_boundary_passed",
        });
        continue;
      }
      const record = await createQueuedWorkflowTask(db, {
        operationMode: "forecast",
        operationSubmode: "binary_forecast",
        label: `Update: ${plan.context.question.question}`,
        workflowPath: binaryWorkflowPath,
        workflowVersion: "binary-forecast-stateful-v1",
        ...(plan.context.question.sessionId ? { sessionId: plan.context.question.sessionId } : {}),
        configJson: {
          forecastQuestionId: plan.context.question.id,
          forecastUpdateTriggerId: plan.trigger.id,
          forecastUpdateLeaseOwner: leaseOwner,
          previousForecastStateId: plan.context.snapshot.stateId,
          updateKind: updateKindForTrigger(plan.trigger.triggerType),
          prompt: plan.context.question.question,
          resolutionCriteria: plan.context.question.resolutionCriteria,
          resolutionDate: plan.context.question.resolutionDate,
          background: plan.context.question.background,
          forecastAsOf: now.toISOString(),
          evidenceAsOf: null,
          cutoffDate: now.toISOString(),
        },
      });
      try {
        const launchedRun = await launchSmithersDetached({
          root,
          workflowPath: binaryWorkflowPath,
          runId: record.smithersRunId,
          input: {
            source: "open-superforecaster-live-update",
            taskId: record.taskId,
            question: plan.context.question.question,
            resolutionCriteria: plan.context.question.resolutionCriteria,
            resolutionDate: plan.context.question.resolutionDate,
            condition: plan.context.question.condition,
            background: plan.context.question.background,
            forecastAsOf: now.toISOString(),
            // Prescribe a new hard information boundary for this update. The
            // newest evidence actually included is unknown until research runs,
            // so evidenceAsOf remains visibly missing rather than assumed.
            evidenceAsOf: null,
            cutoffDate: now.toISOString(),
            previousForecastState: plan.state,
            updateKind: updateKindForTrigger(plan.trigger.triggerType),
            updateReason: `${plan.trigger.triggerType}: ${plan.trigger.description}`,
            nextScheduledUpdate: plan.nextScheduledUpdate?.toISOString(),
            researchTreatment: readPreviousResearchTreatment(plan.state),
          },
        });
        await markTaskRunning(db, { taskId: record.taskId, smithersRunId: launchedRun.runId });
        const firedTrigger = await markForecastTriggerFired(db, {
          triggerId: plan.trigger.id,
          leaseOwner: leaseOwner!,
          firedAt: now,
        });
        if (!firedTrigger) {
          throw new Error(`Forecast update lease was lost before trigger ${plan.trigger.id} fired.`);
        }
        launched.push({
          triggerId: plan.trigger.id,
          questionId: plan.context.question.id,
          taskId: record.taskId,
          smithersRunId: launchedRun.runId,
          status: "launched",
        });
      } catch (error) {
        await markTaskFailed(db, {
          taskId: record.taskId,
          error: error instanceof Error ? error.message : String(error),
        });
        launched.push({
          triggerId: plan.trigger.id,
          questionId: plan.context.question.id,
          taskId: record.taskId,
          status: "launch_failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.log(JSON.stringify({
      ok: launched.every((item) => item.status !== "launch_failed"),
      dryRun: false,
      asOf: now.toISOString(),
      launched,
    }, null, 2));
  } finally {
    await sql.end();
  }
}

function readPreviousResearchTreatment(state: Record<string, unknown>) {
  const judgment = asRecord(state.judgment);
  const independence = asRecord(judgment?.independence);
  const value = independence?.researchTreatment;
  return value === "no_external_research"
    || value === "shared_frozen_dossier"
    || value === "independent_research"
    || value === "shared_plus_followup"
    ? value
    : "shared_plus_followup";
}

function readIntegerArg(name: string, fallback: number) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  const separateIndex = process.argv.indexOf(name);
  const raw = inline?.slice(name.length + 1)
    ?? (separateIndex >= 0 ? process.argv[separateIndex + 1] : undefined);
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) ? Math.min(500, Math.max(1, Math.round(value))) : fallback;
}

function readNowArg() {
  const inline = process.argv.find((arg) => arg.startsWith("--as-of="));
  const raw = inline?.slice("--as-of=".length);
  const value = raw ? new Date(raw) : new Date();
  if (!Number.isFinite(value.getTime())) {
    throw new Error("--as-of must be a valid ISO timestamp.");
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

if (import.meta.main) {
  await main();
}
