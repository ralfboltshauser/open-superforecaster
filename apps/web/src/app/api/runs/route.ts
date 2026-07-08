import {
  createBootstrapArtifact,
  createQueuedWorkflowTask,
  launchSmithersDetached,
  markTaskFailed,
  markTaskRunning,
  markTaskRowsRunning,
  seedTaskRows,
} from "@open-superforecaster/backend";

import { getServerContext } from "@/lib/server-db";
import { listRecentRunsForServer } from "@/lib/server-runs";
import { createRunPlan } from "./run-request";

export async function GET() {
  return Response.json({ runs: await listRecentRunsForServer() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const plan = createRunPlan(body);
  const { db, root, sql } = getServerContext();
  const record = await createQueuedWorkflowTask(db, {
    operationMode: plan.operationMode,
    operationSubmode: plan.operationSubmode,
    label: plan.label,
    workflowPath: plan.workflowPath,
    configJson: plan.configJson,
  });

  try {
    if (plan.independentTableRows.length > 0) {
      await seedTaskRows(db, {
        taskId: record.taskId,
        rows: plan.independentTableRows,
        retryable: true,
        lineage: {
          prompt: body.prompt,
          workflow: plan.workflow,
        },
      });
    }

    await createBootstrapArtifact(db, {
      taskId: record.taskId,
      smithersRunId: record.smithersRunId,
      createdBy: plan.workflow,
      schemaJson: plan.schemaJson,
    });

    const launched = await launchSmithersDetached({
      root,
      workflowPath: plan.workflowPath,
      runId: record.smithersRunId,
      input: {
        taskId: record.taskId,
        ...plan.smithersInput,
      },
    });

    await markTaskRunning(db, {
      taskId: record.taskId,
      smithersRunId: launched.runId,
    });

    if (plan.independentTableRows.length > 0) {
      await markTaskRowsRunning(db, record.taskId);
    }

    return Response.json({
      ok: true,
      taskId: record.taskId,
      smithersRunId: launched.runId,
      workflowPath: launched.workflowPath,
      classification: plan.classification,
    });
  } catch (error) {
    await markTaskFailed(db, {
      taskId: record.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(
      {
        ok: false,
        taskId: record.taskId,
        smithersRunId: record.smithersRunId,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  } finally {
    await sql.end();
  }
}
