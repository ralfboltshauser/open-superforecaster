/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import { codexResearchAgent } from "./agents";

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  claim: z.string(),
});

const rowResult = z.object({
  rowId: z.string(),
  input: z.string(),
  result: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  labels: z.array(z.string()).default([]),
  rationale: z.string().default(""),
  citedSources: z.array(citedSource).default([]),
});

const mapSummary = z.object({
  reportType: z.literal("agent_map"),
  objective: z.string(),
  rowCount: z.number().int(),
  completedRows: z.number().int(),
  results: z.array(rowResult).default([]),
  citedSources: z.array(citedSource).default([]),
});

const { Workflow, smithers, outputs } = createSmithers({
  rowResult,
  mapSummary,
});

export default smithers((ctx) => {
  const input = (ctx.input ?? {}) as {
    prompt?: unknown;
    objective?: unknown;
    mode?: unknown;
    rows?: Array<{ rowId?: unknown; input?: unknown }>;
  };
  const objective = String(input.objective ?? input.prompt ?? "Process each row.");
  const mode = String(input.mode ?? "agent_map");
  const rows = normalizeRows(input.rows, objective);
  const rowNeeds = Object.fromEntries(rows.map((row) => [`map-${row.rowId}`, `map-${row.rowId}`]));
  const results = ctx.outputs.rowResult ?? [];
  const citedSources = results.flatMap((result) => result.citedSources ?? []);

  return (
    <Workflow name="agent-map">
      <Sequence>
        <Parallel maxConcurrency={Math.min(4, Math.max(1, rows.length))}>
          {rows.map((row) => (
            <Task
              key={row.rowId}
              id={`map-${row.rowId}`}
              output={outputs.rowResult}
              agent={codexResearchAgent}
            >
              {`You are processing one row for Open Superforecaster.

Mode:
${mode}

Objective:
${objective}

Row id:
${row.rowId}

Row input:
${row.input}

Return a concise structured row result. Set rowId to "${row.rowId}" and input to the exact row input. Use labels for categories/ranking tags when useful, include confidence from 0 to 1, and include cited sources when the row result depends on external facts.`}
            </Task>
          ))}
        </Parallel>

        <Task id="summary" output={outputs.mapSummary} needs={rowNeeds}>
          {{
            reportType: "agent_map",
            objective,
            rowCount: rows.length,
            completedRows: results.length,
            results,
            citedSources,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});

function normalizeRows(rows: Array<{ rowId?: unknown; input?: unknown }> | undefined, fallback: string) {
  const normalized = (rows ?? [])
    .map((row, index) => ({
      rowId: sanitizeRowId(String(row.rowId ?? `row-${index + 1}`)),
      input: String(row.input ?? "").trim(),
    }))
    .filter((row) => row.input.length > 0);

  if (normalized.length) {
    return normalized;
  }

  return [{ rowId: "row-1", input: fallback }];
}

function sanitizeRowId(value: string) {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "row";
}
