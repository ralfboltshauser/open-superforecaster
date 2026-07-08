import { createFileRoute } from "@tanstack/react-router";
import {
  backfillBinaryForecastLedgers,
  backfillTableTaskRows,
  classifyRunRequest,
  createBootstrapArtifact,
  createQueuedWorkflowTask,
  jsonResponse,
  launchSmithersDetached,
  listRecentTasks,
  markTaskFailed,
  markTaskRunning,
  markTaskRowsRunning,
  reconcileRunningTasks,
  seedTaskRows,
} from "@open-superforecaster/backend";
import { loadAppConfig, findProjectRoot } from "@open-superforecaster/config";
import { createDb } from "@open-superforecaster/db";

export const Route = createFileRoute("/api/runs")({
  server: {
    handlers: {
      GET: async () => {
        const config = loadAppConfig();
        const root = findProjectRoot(process.cwd());
        const { db, sql } = createDb(config.DATABASE_URL);
        try {
          await reconcileRunningTasks(db, root);
          await backfillBinaryForecastLedgers(db, root);
          await backfillTableTaskRows(db);
          return jsonResponse({ runs: await listRecentTasks(db) });
        } finally {
          await sql.end();
        }
      },
      POST: async ({ request }) => {
        const body = await request.json().catch(() => ({}));
        const classification = classifyRunRequest({
          prompt: body.prompt,
          requestedMode: body.mode,
          forecastType: body.forecastType,
          workflow: body.workflow,
        });

        const config = loadAppConfig();
        const root = findProjectRoot(process.cwd());
        const { db, sql } = createDb(config.DATABASE_URL);

        const workflow = classification.workflow;
        const isForecast = workflow.endsWith("-forecast");
        const isDeepResearch = workflow === "deep-research";
        const isAgentMap = workflow === "agent-map";
        const isRank = workflow === "rank";
        const isMerge = workflow === "merge";
        const isDedupe = workflow === "dedupe";
        const workflowPath = isForecast
          ? `.smithers/workflows/${workflow}.tsx`
          : isDeepResearch
            ? ".smithers/workflows/deep-research.tsx"
            : isAgentMap
              ? ".smithers/workflows/agent-map.tsx"
              : isRank
                ? ".smithers/workflows/rank.tsx"
                : isMerge
                  ? ".smithers/workflows/merge.tsx"
                  : isDedupe
                    ? ".smithers/workflows/dedupe.tsx"
                    : ".smithers/workflows/codex-smoke.tsx";
        const rows = extractRows(body);
        const leftRows = extractObjectRows(body.leftRows ?? body.left);
        const rightRows = extractObjectRows(body.rightRows ?? body.right);
        const objectRows = extractObjectRows(body.rows);
        const rankRows = objectRows.length ? objectRows : rows;
        const independentTableRows = isAgentMap ? rows : isRank ? rankRows : [];
        const thresholds = extractThresholds(body);
        const record = await createQueuedWorkflowTask(db, {
          operationMode: classification.mode,
          operationSubmode: isForecast
            ? `${classification.forecastType ?? "binary"}_forecast`
            : isDeepResearch
              ? "deep_research"
              : isAgentMap
                ? classification.mode
                : isRank
                  ? "rank"
                : isMerge || isDedupe
                  ? classification.mode
                  : `${classification.mode}_placeholder`,
          label: isForecast
            ? forecastLabel(classification.forecastType)
            : isDeepResearch
              ? "Deep research"
              : isAgentMap
                ? `${classification.mode} table run`
                : isRank
                  ? "Rank table run"
                : isMerge || isDedupe
                  ? `${classification.mode} table run`
                  : `${classification.mode} placeholder`,
          workflowPath,
          configJson: {
            prompt: body.prompt,
            classification,
            ...(isAgentMap ? { rows } : {}),
            ...(isRank ? { rows: rankRows } : {}),
            ...(isMerge ? { leftRows, rightRows } : {}),
            ...(isDedupe ? { rows: objectRows } : {}),
          },
        });

        try {
          if (independentTableRows.length > 0) {
            await seedTaskRows(db, {
              taskId: record.taskId,
              rows: independentTableRows,
              retryable: true,
              lineage: {
                prompt: body.prompt,
                workflow,
              },
            });
          }
          await createBootstrapArtifact(db, {
            taskId: record.taskId,
            smithersRunId: record.smithersRunId,
            createdBy: workflow,
            schemaJson: isForecast
              ? forecastSchema(classification.forecastType)
              : isDeepResearch
                ? {
                    type: "object",
                    properties: {
                      reportType: { const: "deep_research" },
                      answer: { type: "string" },
                    },
                  }
                  : isAgentMap
                    ? {
                        type: "object",
                        properties: {
                          reportType: { const: "agent_map" },
                          rowCount: { type: "number" },
                          results: { type: "array" },
                        },
                      }
                    : isRank
                      ? {
                          type: "object",
                          properties: {
                            reportType: { const: "rank" },
                            rowCount: { type: "number" },
                            sortDirection: { enum: ["ascending", "descending"] },
                            results: { type: "array" },
                          },
                        }
                      : isMerge
                        ? {
                            type: "object",
                            properties: {
                              reportType: { const: "merge" },
                              rowCount: { type: "number" },
                              mergeBreakdown: { type: "object" },
                              results: { type: "array" },
                            },
                          }
                        : isDedupe
                          ? {
                              type: "object",
                              properties: {
                                reportType: { const: "dedupe" },
                                rowCount: { type: "number" },
                                classCount: { type: "number" },
                                results: { type: "array" },
                              },
                            }
                          : undefined,
          });
          const launched = await launchSmithersDetached({
            root,
            workflowPath,
            runId: record.smithersRunId,
            input: isForecast
              ? {
                  taskId: record.taskId,
                  source: "open-superforecaster-ui",
                  question: String(body.prompt ?? ""),
                  resolutionCriteria: body.resolutionCriteria,
                  background: body.background,
                  ...(classification.forecastType === "thresholded"
                    ? {
                        thresholds,
                        thresholdDirection: normalizeThresholdDirection(body.thresholdDirection, String(body.prompt ?? "")),
                        units: typeof body.units === "string" ? body.units : undefined,
                      }
                    : {}),
                  ...(classification.forecastType === "conditional"
                    ? {
                        condition: typeof body.condition === "string" ? body.condition : extractCondition(String(body.prompt ?? "")),
                        conditionResolutionCriteria:
                          typeof body.conditionResolutionCriteria === "string" ? body.conditionResolutionCriteria : undefined,
                      }
                    : {}),
                }
              : isDeepResearch
                ? {
                    taskId: record.taskId,
                    source: "open-superforecaster-ui",
                    question: String(body.prompt ?? ""),
                    background: body.background,
                  }
                : isAgentMap
                  ? {
                      taskId: record.taskId,
                      source: "open-superforecaster-ui",
                      mode: classification.mode,
                      prompt: String(body.prompt ?? ""),
                      objective: String(body.prompt ?? "Process each row."),
                      rows,
                    }
                  : isRank
                    ? {
                        taskId: record.taskId,
                        source: "open-superforecaster-ui",
                        prompt: String(body.prompt ?? ""),
                        objective: String(body.prompt ?? "Rank rows by the requested criterion."),
                        rows: rankRows,
                        ascending: body.ascending,
                        sortDirection: body.sortDirection,
                        topN: body.topN,
                      }
                    : isMerge
                      ? {
                          taskId: record.taskId,
                          source: "open-superforecaster-ui",
                          prompt: String(body.prompt ?? ""),
                          objective: String(body.prompt ?? "Merge left rows against right rows."),
                          task: String(body.prompt ?? "Merge left rows against right rows."),
                          leftRows,
                          rightRows,
                          leftKey: body.leftKey,
                          rightKey: body.rightKey,
                          relationshipType: body.relationshipType,
                        }
                      : isDedupe
                        ? {
                            taskId: record.taskId,
                            source: "open-superforecaster-ui",
                            prompt: String(body.prompt ?? ""),
                            objective: String(body.prompt ?? "Find duplicate rows."),
                            rows: objectRows.length ? objectRows : rows,
                            equivalenceRelation: body.equivalenceRelation,
                            strategy: body.strategy,
                            strategyPrompt: body.strategyPrompt,
                          }
                        : {
                            taskId: record.taskId,
                            source: "open-superforecaster-ui",
                          },
          });
          await markTaskRunning(db, {
            taskId: record.taskId,
            smithersRunId: launched.runId,
          });
          if (independentTableRows.length > 0) {
            await markTaskRowsRunning(db, record.taskId);
          }
          return jsonResponse({
            ok: true,
            taskId: record.taskId,
            smithersRunId: launched.runId,
            workflowPath: launched.workflowPath,
            classification,
          });
        } catch (error) {
          await markTaskFailed(db, {
            taskId: record.taskId,
            error: error instanceof Error ? error.message : String(error),
          });
          return jsonResponse(
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
      },
    },
  },
});

function extractRows(body: Record<string, unknown>) {
  if (Array.isArray(body.rows)) {
    return body.rows
      .map((row, index) => {
        if (typeof row === "string") {
          return { rowId: `row-${index + 1}`, input: row };
        }
        if (typeof row === "object" && row !== null && !Array.isArray(row)) {
          const record = row as Record<string, unknown>;
          return {
            rowId: String(record.rowId ?? record.id ?? `row-${index + 1}`),
            input: rowInput(record),
          };
        }
        return { rowId: `row-${index + 1}`, input: "" };
      })
      .filter((row) => row.input.trim().length > 0)
      .slice(0, 50);
  }

  const prompt = String(body.prompt ?? "");
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  const rows = lines.length > 1 ? lines : [prompt.trim()].filter(Boolean);
  return rows.slice(0, 50).map((line, index) => ({
    rowId: `row-${index + 1}`,
    input: line,
  }));
}

function rowInput(record: Record<string, unknown>) {
  const direct = record.input ?? record.value ?? record.text;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct;
  }
  const fields = Object.entries(record)
    .filter(([key]) => !["rowId", "row_id", "id"].includes(key))
    .map(([key, value]) => `${key}: ${String(value ?? "")}`)
    .filter((field) => !field.endsWith(": "));
  return fields.join("; ");
}

function extractObjectRows(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((row, index) => {
      if (typeof row === "string") {
        return { rowId: `row-${index + 1}`, input: row };
      }
      if (typeof row === "object" && row !== null && !Array.isArray(row)) {
        const record = row as Record<string, unknown>;
        return {
          ...record,
          rowId: String(record.rowId ?? record.id ?? `row-${index + 1}`),
          input: String(record.input ?? record.value ?? record.text ?? record.name ?? ""),
        };
      }
      return { rowId: `row-${index + 1}`, input: "" };
    })
    .filter((row) => String(row.input ?? "").trim().length > 0)
    .slice(0, 80);
}

function forecastLabel(forecastType: string | undefined) {
  if (forecastType === "date") {
    return "Date forecast";
  }
  if (forecastType === "numeric") {
    return "Numeric forecast";
  }
  if (forecastType === "categorical") {
    return "Categorical forecast";
  }
  if (forecastType === "thresholded") {
    return "Thresholded forecast";
  }
  if (forecastType === "conditional") {
    return "Conditional forecast";
  }
  return "Binary forecast";
}

function forecastSchema(forecastType: string | undefined) {
  if (forecastType === "date") {
    return {
      type: "object",
      properties: {
        forecastType: { const: "date" },
        targetDate: { type: "string" },
        dateDistribution: { type: "object" },
      },
    };
  }
  if (forecastType === "numeric") {
    return {
      type: "object",
      properties: {
        forecastType: { const: "numeric" },
        value: { type: "number" },
        distribution: { type: "object" },
      },
    };
  }
  if (forecastType === "categorical") {
    return {
      type: "object",
      properties: {
        forecastType: { const: "categorical" },
        topCategory: { type: "string" },
        probabilities: { type: "array" },
      },
    };
  }
  if (forecastType === "thresholded") {
    return {
      type: "object",
      properties: {
        forecastType: { const: "thresholded" },
        thresholdDirection: { enum: ["at_least", "at_most"] },
        probabilities: { type: "array" },
      },
    };
  }
  if (forecastType === "conditional") {
    return {
      type: "object",
      properties: {
        forecastType: { const: "conditional" },
        baseForecastType: { const: "binary" },
        probabilityGivenCondition: { type: "number" },
        probabilityGivenNotCondition: { type: "number" },
      },
    };
  }
  return {
    type: "object",
    properties: {
      forecastType: { const: "binary" },
      probability: { type: "number" },
      rationale: { type: "string" },
    },
  };
}

function extractThresholds(body: Record<string, unknown>) {
  if (Array.isArray(body.thresholds)) {
    return body.thresholds.map((threshold) => String(threshold).trim()).filter(Boolean).slice(0, 50);
  }
  const prompt = String(body.prompt ?? "");
  const matches = [...prompt.matchAll(/(?:[$€£]\s*)?\b\d+(?:\.\d+)?\s*(?:k|m|b|bn|million|billion|trillion|%|percent|launches|users|usd|dollars)?\b/gi)]
    .map((match) => match[0].trim())
    .filter((value, index, values) => values.indexOf(value) === index);
  return matches.slice(0, 50);
}

function normalizeThresholdDirection(raw: unknown, prompt: string) {
  if (raw === "at_most") {
    return "at_most";
  }
  if (/\b(at most|no more than|under|below|before)\b/i.test(prompt)) {
    return "at_most";
  }
  return "at_least";
}

function extractCondition(prompt: string) {
  const match = prompt.match(/\b(?:if|conditional on|assuming|given that|provided that|conditioned on)\b\s+(.+?)(?:,|\bwhat\b|\bwill\b|\bhow\b|\bwhen\b)/i);
  return match?.[1]?.trim() || undefined;
}
