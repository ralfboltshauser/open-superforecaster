/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import { codexStructuredAgent } from "./agents";

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  claim: z.string(),
});

const simpleRow = z.object({
  rowId: z.string(),
  input: z.string(),
  values: z.record(z.string(), z.string()).default({}),
});

const rankScore = z.object({
  rowId: z.string(),
  input: z.string(),
  sortScore: z.number(),
  confidence: z.number().min(0).max(1).default(0.5),
  reasoning: z.string(),
  uncertaintyFlags: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const rankedRow = z.object({
  rowId: z.string(),
  sourceRowId: z.string(),
  input: z.string(),
  rank: z.number().int(),
  sortScore: z.number(),
  normalizedScore: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  tieBreaker: z.string(),
  reasoning: z.string(),
  uncertaintyFlags: z.array(z.string()).default([]),
  values: z.record(z.string(), z.string()).default({}),
  citedSources: z.array(citedSource).default([]),
});

const rankSummary = z.object({
  reportType: z.literal("rank"),
  objective: z.string(),
  sortDirection: z.enum(["ascending", "descending"]),
  rowCount: z.number().int(),
  completedRows: z.number().int(),
  scoreRange: z.object({
    min: z.number().nullable(),
    max: z.number().nullable(),
  }),
  results: z.array(rankedRow).default([]),
  citedSources: z.array(citedSource).default([]),
});

const { Workflow, smithers, outputs } = createSmithers({
  rankScore,
  rankSummary,
});

export default smithers((ctx) => {
  const input = (ctx.input ?? {}) as {
    prompt?: unknown;
    objective?: unknown;
    rows?: Array<Record<string, unknown>>;
    ascending?: unknown;
    sortDirection?: unknown;
    topN?: unknown;
  };
  const objective = String(input.objective ?? input.prompt ?? "Rank rows by the requested criterion.");
  const sortDirection = normalizeSortDirection(input.sortDirection, input.ascending, objective);
  const rows = normalizeRows(input.rows, objective);
  const scoreNeeds = Object.fromEntries(rows.map((row) => [`score-${row.rowId}`, `score-${row.rowId}`]));
  const scores = ctx.outputs.rankScore ?? [];
  const rankedRows = rankRows({
    rows,
    scores,
    sortDirection,
    topN: normalizeTopN(input.topN),
  });
  const citedSources = rankedRows.flatMap((row) => row.citedSources ?? []);
  const scoreValues = rankedRows.map((row) => row.sortScore);

  return (
    <Workflow name="rank">
      <Sequence>
        <Parallel maxConcurrency={Math.min(4, Math.max(1, rows.length))}>
          {rows.map((row) => (
            <Task key={row.rowId} id={`score-${row.rowId}`} output={outputs.rankScore} agent={codexStructuredAgent}>
              {`You score one row for Open Superforecaster rank mode.

Objective:
${objective}

Sort direction:
${sortDirection}

Scoring contract:
- Return sortScore as a comparable number for this objective.
- If sortDirection is descending, larger sortScore ranks earlier.
- If sortDirection is ascending, smaller sortScore ranks earlier.
- Use a 0 to 100 scale unless the objective clearly names a numeric unit.
- Use only the provided row unless the row itself includes enough source material. Do not browse.
- Include uncertaintyFlags when missing data makes the score weak.

Row id:
${row.rowId}

Row input:
${row.input}

Structured row values:
${JSON.stringify(row.values, null, 2)}

Return rowId "${row.rowId}", input exactly as shown, a numeric sortScore, confidence from 0 to 1, concise reasoning, uncertaintyFlags, and citedSources only when the row provides citeable source material.`}
            </Task>
          ))}
        </Parallel>

        <Task id="summary" output={outputs.rankSummary} needs={scoreNeeds}>
          {{
            reportType: "rank",
            objective,
            sortDirection,
            rowCount: rows.length,
            completedRows: rankedRows.length,
            scoreRange: {
              min: scoreValues.length ? Math.min(...scoreValues) : null,
              max: scoreValues.length ? Math.max(...scoreValues) : null,
            },
            results: rankedRows,
            citedSources,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});

function normalizeRows(rows: Array<Record<string, unknown>> | undefined, fallback: string) {
  const normalized = (rows ?? [])
    .map((row, index): z.infer<typeof simpleRow> => {
      const rowId = sanitizeRowId(String(row.rowId ?? row.id ?? `row-${index + 1}`));
      const values = Object.fromEntries(
        Object.entries(row)
          .filter(([key]) => !["rowId", "id", "input", "text", "value"].includes(key))
          .map(([key, value]) => [key, valueToText(value)]),
      );
      const input = String(row.input ?? row.text ?? row.value ?? row.name ?? Object.values(values).join(" ")).trim();
      return { rowId, input, values };
    })
    .filter((row) => row.input.length > 0)
    .slice(0, 80);

  if (normalized.length) {
    return normalized;
  }

  return [{ rowId: "row-1", input: fallback, values: {} }];
}

function normalizeSortDirection(raw: unknown, ascending: unknown, objective: string): "ascending" | "descending" {
  if (raw === "ascending" || raw === "asc" || ascending === true || ascending === "true") {
    return "ascending";
  }
  if (raw === "descending" || raw === "desc" || ascending === false || ascending === "false") {
    return "descending";
  }
  return /\b(lowest|least|cheapest|smallest|earliest|oldest|minimum|minimize|ascending)\b/i.test(objective) ? "ascending" : "descending";
}

function normalizeTopN(raw: unknown) {
  const value = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(100, Math.floor(value));
}

function rankRows(input: {
  rows: Array<z.infer<typeof simpleRow>>;
  scores: Array<z.infer<typeof rankScore>>;
  sortDirection: "ascending" | "descending";
  topN: number | null;
}) {
  const rowById = new Map(input.rows.map((row) => [row.rowId, row]));
  const scoredById = new Map(input.scores.map((score) => [score.rowId, score]));
  const materialized = input.rows.map((row) => {
    const score = scoredById.get(row.rowId);
    return {
      row,
      score: Number.isFinite(score?.sortScore) ? Number(score?.sortScore) : fallbackScore(input.sortDirection),
      confidence: Number.isFinite(score?.confidence) ? Number(score?.confidence) : 0,
      reasoning: score?.reasoning ?? "No score was returned for this row.",
      uncertaintyFlags: score?.uncertaintyFlags ?? ["missing_score"],
      citedSources: score?.citedSources ?? [],
    };
  });
  const scores = materialized.map((row) => row.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const spread = max - min;

  const ranked = materialized
    .sort((a, b) => compareRankRows(a, b, input.sortDirection))
    .slice(0, input.topN ?? materialized.length)
    .map((item, index) => {
      const sourceRow = rowById.get(item.row.rowId) ?? item.row;
      return {
        rowId: sourceRow.rowId,
        sourceRowId: sourceRow.rowId,
        input: sourceRow.input,
        rank: index + 1,
        sortScore: item.score,
        normalizedScore: spread === 0 ? 1 : (item.score - min) / spread,
        confidence: item.confidence,
        tieBreaker: normalizeText(sourceRow.input),
        reasoning: item.reasoning,
        uncertaintyFlags: item.uncertaintyFlags,
        values: sourceRow.values,
        citedSources: item.citedSources,
      };
    });

  return ranked;
}

function compareRankRows(
  a: { row: z.infer<typeof simpleRow>; score: number; confidence: number },
  b: { row: z.infer<typeof simpleRow>; score: number; confidence: number },
  sortDirection: "ascending" | "descending",
) {
  const scoreDelta = sortDirection === "ascending" ? a.score - b.score : b.score - a.score;
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  const confidenceDelta = b.confidence - a.confidence;
  if (confidenceDelta !== 0) {
    return confidenceDelta;
  }
  return normalizeText(a.row.input).localeCompare(normalizeText(b.row.input));
}

function fallbackScore(sortDirection: "ascending" | "descending") {
  return sortDirection === "ascending" ? Number.MAX_SAFE_INTEGER : Number.MIN_SAFE_INTEGER;
}

function sanitizeRowId(value: string) {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || "row";
}

function valueToText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
