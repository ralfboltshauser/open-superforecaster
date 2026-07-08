import { z } from "zod";

export const operationModeSchema = z.enum([
  "forecast",
  "multi_agent",
  "agent_map",
  "rank",
  "classify",
  "merge",
  "dedupe",
  "benchmark_iteration",
  "fixed_evidence_eval",
  "agentic_pastcasting_eval",
]);

export const forecastTypeSchema = z.enum([
  "binary",
  "date",
  "numeric",
  "categorical",
  "thresholded",
  "conditional",
]);

export const taskStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "revoked",
  "cancelled",
  "partial_failure",
  "waiting_approval",
  "waiting_event",
  "waiting_timer",
  "waiting_quota",
  "needs_review",
]);

export const artifactTypeSchema = z.enum([
  "table",
  "scalar",
  "file",
  "report",
  "source_bundle",
  "trace_bundle",
]);

export const traceEventTypeSchema = z.enum([
  "trace_start",
  "trace_summary",
  "tool_call",
  "search",
  "page_read",
  "source_added",
  "parser_result",
  "validation_result",
  "row_completed",
  "row_failed",
  "synthesis",
  "done",
]);

export const sourceEntrySchema = z.object({
  title: z.string().optional(),
  url: z.string().url().optional(),
  claim: z.string().min(1),
  qualityScore: z.number().min(0).max(1).optional(),
});

export const binaryForecastAttemptSchema = z.object({
  probability: z.number().min(0).max(100),
  rationale: z.string().min(1),
  strongestYes: z.string().min(1),
  strongestNo: z.string().min(1),
  keyUncertainties: z.array(z.string()).default([]),
  premortem: z.string().default(""),
  wildcards: z.array(z.string()).default([]),
  citedSources: z.array(sourceEntrySchema).default([]),
  traceDigest: z
    .object({
      searchesRun: z.array(z.string()).default([]),
      pagesRead: z.array(z.string()).default([]),
      keyIntermediateJudgments: z.array(z.string()).default([]),
    })
    .default({ searchesRun: [], pagesRead: [], keyIntermediateJudgments: [] }),
});

export const routerDecisionSchema = z.object({
  mode: operationModeSchema,
  confidence: z.number().min(0).max(1),
  forecastType: forecastTypeSchema.optional(),
  requiresTable: z.boolean(),
  rationale: z.string(),
  suggestedEffort: z.enum(["low", "medium", "high"]),
});

export const healthSnapshotSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string(),
  service: z.string(),
  checks: z.record(
    z.string(),
    z.object({
      ok: z.boolean(),
      label: z.string(),
      detail: z.string().optional(),
    }),
  ),
});

export type OperationMode = z.infer<typeof operationModeSchema>;
export type ForecastType = z.infer<typeof forecastTypeSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type ArtifactType = z.infer<typeof artifactTypeSchema>;
export type TraceEventType = z.infer<typeof traceEventTypeSchema>;
export type BinaryForecastAttempt = z.infer<typeof binaryForecastAttemptSchema>;
export type HealthSnapshot = z.infer<typeof healthSnapshotSchema>;
