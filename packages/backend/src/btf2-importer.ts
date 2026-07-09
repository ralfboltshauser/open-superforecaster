import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import {
  benchmarkCases,
  benchmarkSuites,
  type createDb,
} from "@open-superforecaster/db";
import type { ObjectStorageTarget } from "@open-superforecaster/artifact-store";
import { tryPutObject } from "./object-storage";

type Db = ReturnType<typeof createDb>["db"];

const DATASET_ID = "BTF-2/BTF-2";
const DATASET_API_URL = `https://huggingface.co/api/datasets/${DATASET_ID}`;
const ROWS_API_URL = "https://datasets-server.huggingface.co/rows";
const DATASET_PAGE_URL = `https://huggingface.co/datasets/${DATASET_ID}`;
const MAIN_PARQUET_URL = `${DATASET_PAGE_URL}/resolve/main/btf2_questions_and_forecasts.parquet`;
const DEFAULT_IMPORT_ROWS = 25;
const MAX_IMPORT_ROWS = 1_417;
const MAX_PAGE_SIZE = 100;

type HuggingFaceDatasetMetadata = {
  sha?: string;
  lastModified?: string;
  cardData?: {
    license?: string;
  };
};

type HuggingFaceRowsResponse = {
  rows?: Array<{
    row_idx: number;
    row: Record<string, unknown>;
    truncated_cells?: string[];
  }>;
  num_rows_total?: number;
};

export type ImportBtf2Input = {
  evalsDir: string;
  maxRows?: number;
  offset?: number;
  objectStorage?: ObjectStorageTarget;
};

export async function importBtf2FixedEvidenceSuite(db: Db, input: ImportBtf2Input) {
  const metadata = await fetchDatasetMetadata();
  const datasetSha = metadata.sha ?? "unknown";
  const offset = normalizeInteger(input.offset, 0, 0, MAX_IMPORT_ROWS - 1);
  const requestedRows = normalizeInteger(input.maxRows, DEFAULT_IMPORT_ROWS, 1, MAX_IMPORT_ROWS);
  const fetched = await fetchRows({ offset, maxRows: requestedRows });
  const rows = fetched.rows;
  const totalRows = fetched.totalRows;
  if (rows.length === 0) {
    throw new Error("BTF-2 import returned zero rows.");
  }

  const revision = `hf-${datasetSha.slice(0, 12)}-offset-${offset}-rows-${rows.length}`;
  const snapshot = await persistRawSnapshot(input.evalsDir, revision, {
    metadata,
    dataset: DATASET_ID,
    sourceUrl: DATASET_PAGE_URL,
    rows,
    objectStorage: input.objectStorage,
  });
  const suite = await upsertSuite(db, {
    revision,
    datasetSha,
    rowCount: rows.length,
    totalRows,
    offset,
    snapshotUri: snapshot.storageUri,
    license: metadata.cardData?.license ?? "cc-by-nc-4.0",
    lastModified: metadata.lastModified ?? null,
  });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const importErrors: Array<Record<string, unknown>> = [];

  for (const item of rows) {
    const normalized = normalizeBtf2Row(item, {
      datasetSha,
      suiteRevision: revision,
      snapshotUri: snapshot.storageUri,
      license: metadata.cardData?.license ?? "cc-by-nc-4.0",
    });
    if (!normalized) {
      skipped += 1;
      importErrors.push({
        rowIndex: item.row_idx,
        reason: "missing_required_fields",
      });
      continue;
    }

    const [existing] = await db
      .select({ id: benchmarkCases.id })
      .from(benchmarkCases)
      .where(and(eq(benchmarkCases.suiteId, suite.id), eq(benchmarkCases.externalId, normalized.externalId)))
      .limit(1);

    if (existing) {
      await db
        .update(benchmarkCases)
        .set({
          inputJson: normalized.inputJson,
          hiddenResolutionJson: normalized.hiddenResolutionJson,
          cutoffMetadataJson: normalized.cutoffMetadataJson,
          lineageJson: normalized.lineageJson,
          updatedAt: new Date(),
        })
        .where(eq(benchmarkCases.id, existing.id));
      updated += 1;
    } else {
      await db.insert(benchmarkCases).values({
        suiteId: suite.id,
        ...normalized,
      });
      inserted += 1;
    }
  }

  return {
    suiteId: suite.id,
    suiteName: suite.name,
    revision,
    datasetSha,
    totalRows,
    importedRows: rows.length,
    inserted,
    updated,
    skipped,
    snapshotUri: snapshot.storageUri,
    snapshotPath: snapshot.path,
    importErrors,
  };
}

async function fetchDatasetMetadata() {
  const response = await fetch(DATASET_API_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch BTF-2 dataset metadata: ${response.status} ${response.statusText}`);
  }
  return await response.json() as HuggingFaceDatasetMetadata;
}

async function fetchRows(input: { offset: number; maxRows: number }) {
  const rows: Array<{ row_idx: number; row: Record<string, unknown>; truncated_cells?: string[] }> = [];
  let totalRows = MAX_IMPORT_ROWS;

  while (rows.length < input.maxRows) {
    const remaining = input.maxRows - rows.length;
    const pageSize = Math.min(MAX_PAGE_SIZE, remaining);
    const pageOffset = input.offset + rows.length;
    const url = new URL(ROWS_API_URL);
    url.search = new URLSearchParams({
      dataset: DATASET_ID,
      config: "default",
      split: "test",
      offset: String(pageOffset),
      length: String(pageSize),
    }).toString();
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch BTF-2 rows: ${response.status} ${response.statusText}`);
    }
    const payload = await response.json() as HuggingFaceRowsResponse;
    totalRows = typeof payload.num_rows_total === "number" ? payload.num_rows_total : totalRows;
    const pageRows = payload.rows ?? [];
    if (pageRows.length === 0) {
      break;
    }
    rows.push(...pageRows);
    if (pageRows.length < pageSize || pageOffset + pageRows.length >= totalRows) {
      break;
    }
  }

  return {
    rows: rows.slice(0, input.maxRows),
    totalRows,
  };
}

async function persistRawSnapshot(
  evalsDir: string,
  revision: string,
  payload: {
    metadata: HuggingFaceDatasetMetadata;
    dataset: string;
    sourceUrl: string;
    rows: Array<{ row_idx: number; row: Record<string, unknown>; truncated_cells?: string[] }>;
    objectStorage?: ObjectStorageTarget;
  },
) {
  const dir = resolve(evalsDir, "btf2", revision);
  await mkdir(dir, { recursive: true });
  const metadataPath = resolve(dir, "metadata.json");
  const rowsPath = resolve(dir, "rows.jsonl");
  const metadataBody = `${JSON.stringify({
    dataset: payload.dataset,
    sourceUrl: payload.sourceUrl,
    importedAt: new Date().toISOString(),
    metadata: payload.metadata,
    rowCount: payload.rows.length,
  }, null, 2)}\n`;
  const rowsBody = `${payload.rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  await writeFile(metadataPath, metadataBody, "utf8");
  await writeFile(rowsPath, rowsBody, "utf8");
  const metadataKey = `evals/btf2/${revision}/metadata.json`;
  const rowsKey = `evals/btf2/${revision}/rows.jsonl`;
  await tryPutObject(payload.objectStorage, {
    key: metadataKey,
    body: metadataBody,
    contentType: "application/json; charset=utf-8",
  });
  const rowsUpload = await tryPutObject(payload.objectStorage, {
    key: rowsKey,
    body: rowsBody,
    contentType: "application/x-ndjson; charset=utf-8",
  });

  return {
    path: rowsPath,
    storageUri: rowsUpload.storageUri ?? rowsKey,
  };
}

async function upsertSuite(
  db: Db,
  input: {
    revision: string;
    datasetSha: string;
    rowCount: number;
    totalRows: number;
    offset: number;
    snapshotUri: string;
    license: string;
    lastModified: string | null;
  },
) {
  const name = "BTF-2 fixed-evidence import";
  const policy = {
    defaultMaxCases: Math.min(3, input.rowCount),
    importedRows: input.rowCount,
    totalRows: input.totalRows,
    offset: input.offset,
    dataset: DATASET_ID,
    datasetSha: input.datasetSha,
    datasetUrl: DATASET_PAGE_URL,
    mainParquetUrl: MAIN_PARQUET_URL,
    rawSnapshotUri: input.snapshotUri,
    license: input.license,
    lastModified: input.lastModified,
    evalUseWarning:
      "BTF-2 is a fixed-evidence pastcasting benchmark. Models with late-2025/2026 cutoffs may have contamination risk; use results for workflow iteration, not public quality claims.",
  };
  const [existing] = await db
    .select()
    .from(benchmarkSuites)
    .where(and(eq(benchmarkSuites.name, name), eq(benchmarkSuites.revision, input.revision)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(benchmarkSuites)
      .set({
        allowedEvalModes: ["fixed_evidence"],
        caseSelectionPolicy: policy,
        updatedAt: new Date(),
      })
      .where(eq(benchmarkSuites.id, existing.id))
      .returning();
    return updated;
  }

  const [suite] = await db
    .insert(benchmarkSuites)
    .values({
      name,
      revision: input.revision,
      allowedEvalModes: ["fixed_evidence"],
      caseSelectionPolicy: policy,
    })
    .returning();
  return suite;
}

function normalizeBtf2Row(
  item: { row_idx: number; row: Record<string, unknown>; truncated_cells?: string[] },
  context: {
    datasetSha: string;
    suiteRevision: string;
    snapshotUri: string;
    license: string;
  },
) {
  const row = item.row;
  const questionId = readString(row.question_id);
  const question = readString(row.question);
  const resolutionCriteria = readString(row.resolution_criteria);
  const background = readString(row.background);
  const researchSummary = readString(row.research_summary);
  const presentDate = readString(row.present_date);
  const resolution = readNumber(row.resolution);

  if (!questionId || !question || !resolutionCriteria || !background || !researchSummary || !presentDate || resolution === null) {
    return null;
  }

  const baselineProbability = readNumber(row.sota_forecast_probability);
  const baselineRationale = readString(row.sota_summary_rationale);
  const resolutionExplanation = readString(row.resolution_explanation) ?? "No resolution explanation provided by BTF-2.";
  const sourceHash = createHash("sha256").update(JSON.stringify(row)).digest("hex");
  const resolved = resolution >= 0.5;
  const truncatedCells = item.truncated_cells ?? [];

  return {
    externalId: `btf2-${questionId}`,
    inputJson: {
      question,
      resolutionCriteria,
      background,
      fixedEvidence: researchSummary,
      presentDate,
      cutoffDate: presentDate,
      baselineProbability,
      baselineLabel: baselineProbability === null ? "BTF-2 SOTA baseline unavailable" : "BTF-2 proprietary SOTA baseline",
      baselineRationale,
      benchmarkDataset: "BTF-2",
      benchmarkQuestionId: questionId,
    },
    hiddenResolutionJson: {
      resolved,
      resolvedAt: "2025-12-31T23:59:59.000Z",
      note: resolutionExplanation,
      originalResolution: resolution,
    },
    cutoffMetadataJson: {
      cutoff: presentDate,
      mode: "fixed_evidence",
      dataset: "BTF-2",
      datasetSha: context.datasetSha,
      questionId,
      contaminationCaveat:
        "BTF-2 questions were asked in October 2025 and resolved in December 2025; models with later cutoffs may have seen resolution-relevant information.",
      evidenceSource: "research_summary",
      split: "test",
    },
    lineageJson: {
      source: "huggingface-datasets-server",
      dataset: DATASET_ID,
      datasetUrl: DATASET_PAGE_URL,
      split: "test",
      datasetSha: context.datasetSha,
      suiteRevision: context.suiteRevision,
      rawSnapshotUri: context.snapshotUri,
      rowIndex: item.row_idx,
      questionId,
      originalRowHash: sourceHash,
      license: context.license,
      truncatedCells,
      importedAt: new Date().toISOString(),
    },
  };
}

function normalizeInteger(value: number | undefined, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
