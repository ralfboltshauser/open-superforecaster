import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  artifactRows,
  artifacts,
  benchmarkAnalyses,
  benchmarkCaseResults,
  benchmarkCases,
  benchmarkRuns,
  benchmarkSuites,
  forecastAggregates,
  forecastAttempts,
  forecastResolutions,
  forecastScores,
  sourceBankEntries,
  tasks,
  workflowChangeProposals,
  workflowPromotionDecisions,
  workflowVariants,
  type createDb,
} from "@open-superforecaster/db";
import { scoreBinaryForecast } from "@open-superforecaster/evals";
import type { ObjectStorageTarget } from "@open-superforecaster/artifact-store";
import { createBootstrapArtifact, createQueuedWorkflowTask, markTaskFailed, markTaskRunning } from "./run-service";
import { launchSmithersDetached } from "./smithers-launcher";
import { exportTraceBundle } from "./trace-bundle";

type Db = ReturnType<typeof createDb>["db"];
type BenchmarkRunRow = typeof benchmarkRuns.$inferSelect;
type BenchmarkCaseResultRow = typeof benchmarkCaseResults.$inferSelect;
type BenchmarkCaseSplitRow = {
  id: string;
  cutoffMetadataJson: Record<string, unknown>;
  lineageJson: Record<string, unknown>;
};
type PairedMetricDeltaKey = "brierDelta" | "logDelta";
type PairedDeltaRow = {
  benchmarkCaseId: string;
  split: string;
  candidateBenchmarkCaseResultId: string;
  baselineBenchmarkCaseResultId: string;
  candidateStatus: string;
  baselineStatus: string;
  candidateBrier: number | null;
  baselineBrier: number | null;
  brierDelta: number | null;
  candidateLog: number | null;
  baselineLog: number | null;
  logDelta: number | null;
  candidateTraceBundleUri: string | null;
  baselineTraceBundleUri: string | null;
};

const fixedEvidenceWorkflowPath = ".smithers/workflows/fixed-evidence-eval.tsx";
const agenticPastcastingWorkflowPath = ".smithers/workflows/agentic-pastcasting-eval.tsx";
type BenchmarkEvalMode = "fixed_evidence" | "agentic_pastcasting_smoke";
const promotionStates = [
  "candidate",
  "promoted_for_local_default",
  "promoted_for_eval_only",
  "rejected",
  "needs_more_cases",
] as const;
export type WorkflowPromotionState = (typeof promotionStates)[number];
const workflowChangeProposalStatuses = ["candidate", "accepted", "rejected", "implemented"] as const;
export type WorkflowChangeProposalStatus = (typeof workflowChangeProposalStatuses)[number];
const workflowChangeProposalImplementationStatuses = ["not_started", "planned", "in_progress", "validated"] as const;
export type WorkflowChangeProposalImplementationStatus = (typeof workflowChangeProposalImplementationStatuses)[number];
type BenchmarkPromotionComparisonStatus =
  | "candidate_better"
  | "candidate_worse"
  | "indistinguishable"
  | "needs_baseline"
  | "needs_more_cases"
  | "needs_paired_cases"
  | "needs_holdout_evidence"
  | "wait_for_completion"
  | string;

export const benchmarkPromotionGateBlockerIds = [
  "benchmark_still_running",
  "too_few_cases_for_promotion",
  "missing_trace_bundles",
  "failed_or_review_cases_present",
  "missing_comparison_report",
  "missing_baseline_sanity",
  "unexplained_component_disagreement",
  "large_probability_misses",
  "worse_than_baseline_cases",
  "insufficient_holdout_evidence",
  "source_cutoff_leakage",
  "human_forecast_leakage",
  "weak_trace_completeness",
  "schema_or_scoring_failures",
  "missing_aggregate_rationale",
] as const;

const [
  blockerBenchmarkStillRunning,
  blockerTooFewCasesForPromotion,
  blockerMissingTraceBundles,
  blockerFailedOrReviewCasesPresent,
  blockerMissingComparisonReport,
  blockerMissingBaselineSanity,
  blockerUnexplainedComponentDisagreement,
  blockerLargeProbabilityMisses,
  blockerWorseThanBaselineCases,
  blockerInsufficientHoldoutEvidence,
  blockerSourceCutoffLeakage,
  blockerHumanForecastLeakage,
  blockerWeakTraceCompleteness,
  blockerSchemaOrScoringFailures,
  blockerMissingAggregateRationale,
] = benchmarkPromotionGateBlockerIds;

export const benchmarkHoldoutSplitIds = ["holdout", "test", "validation", "eval", "evaluation"] as const;
const minimumPromotionHoldoutCases = 10;

export type BenchmarkPromotionGateEvidenceInput = {
  runStatus: string;
  resultCount: number;
  traceMissing: number;
  reviewOrFailed: number;
  comparisonStatus: BenchmarkPromotionComparisonStatus | null;
  baselineSanityFindings?: Record<string, unknown> | null;
  componentDisagreementFindings?: Record<string, unknown> | null;
  forecastErrorFindings?: Record<string, unknown> | null;
  splitFindings?: Record<string, unknown> | null;
  sourceQualityFindings?: Record<string, unknown> | null;
  traceQualityFindings?: Record<string, unknown> | null;
};

export function summarizeBenchmarkPromotionGateEvidence(input: BenchmarkPromotionGateEvidenceInput) {
  const blockers = [];
  if (input.runStatus === "running" || input.runStatus === "queued") {
    blockers.push(blockerBenchmarkStillRunning);
  }
  if (input.resultCount < 10) {
    blockers.push(blockerTooFewCasesForPromotion);
  }
  if (input.traceMissing > 0) {
    blockers.push(blockerMissingTraceBundles);
  }
  if (input.reviewOrFailed > 0) {
    blockers.push(blockerFailedOrReviewCasesPresent);
  }
  if (!input.comparisonStatus) {
    blockers.push(blockerMissingComparisonReport);
  } else if (input.comparisonStatus !== "candidate_better") {
    blockers.push(`comparison_${input.comparisonStatus}`);
  }
  if (readFindingCount(input.baselineSanityFindings, "missingBaselineSanityCases", "missing_baseline_sanity_cases") > 0) {
    blockers.push(blockerMissingBaselineSanity);
  }
  if (readFindingCount(input.componentDisagreementFindings, "unexplainedHighDisagreementCases", "unexplained_high_disagreement_cases") > 0) {
    blockers.push(blockerUnexplainedComponentDisagreement);
  }
  if (readFindingCount(input.forecastErrorFindings, "largeProbabilityMissCases", "large_probability_miss_cases") > 0) {
    blockers.push(blockerLargeProbabilityMisses);
  }
  if (readFindingCount(input.forecastErrorFindings, "worseThanBaselineCases", "worse_than_baseline_cases") > 0) {
    blockers.push(blockerWorseThanBaselineCases);
  }
  if (readFindingCount(input.splitFindings, "holdoutCaseResults", "holdout_case_results") < minimumPromotionHoldoutCases) {
    blockers.push(blockerInsufficientHoldoutEvidence);
  }
  if (
    readFindingCount(input.sourceQualityFindings, "sourceLeakageCases", "source_leakage_cases") > 0 ||
    readFindingCount(input.sourceQualityFindings, "postCutoffSourceCases", "post_cutoff_source_cases") > 0
  ) {
    blockers.push(blockerSourceCutoffLeakage);
  }
  if (
    readFindingCount(input.sourceQualityFindings, "informationAdvantageCases", "information_advantage_cases") > 0 ||
    readFindingCount(input.sourceQualityFindings, "humanForecastSourceCases", "human_forecast_source_cases") > 0
  ) {
    blockers.push(blockerHumanForecastLeakage);
  }
  if (readFindingCount(input.traceQualityFindings, "weakTraceCompletenessCases", "weak_trace_completeness_cases") > 0) {
    blockers.push(blockerWeakTraceCompleteness);
  }
  if (
    readFindingCount(input.traceQualityFindings, "missingProbabilityCases", "missing_probability_cases") > 0 ||
    readFindingCount(input.traceQualityFindings, "missingScoreRowsCases", "missing_score_rows_cases") > 0
  ) {
    blockers.push(blockerSchemaOrScoringFailures);
  }
  if (readFindingCount(input.traceQualityFindings, "missingAggregateRationaleCases", "missing_aggregate_rationale_cases") > 0) {
    blockers.push(blockerMissingAggregateRationale);
  }
  return {
    status: blockers.length === 0 ? "review_for_promotion" : "needs_more_evidence",
    blockers: uniqueStrings(blockers),
    recommendationStatus: input.comparisonStatus,
    summary:
      blockers.length === 0
        ? "This run has paired evidence of candidate improvement and is ready for human promotion review."
        : "Use this run for iteration, but do not promote until blockers are resolved.",
  };
}

export function assertBenchmarkPromotionDecisionAllowed(
  state: WorkflowPromotionState,
  promotionGate: ReturnType<typeof summarizeBenchmarkPromotionGateEvidence>,
) {
  if (!isPromotedState(state) || promotionGate.status === "review_for_promotion") {
    return;
  }
  const blockers = promotionGate.blockers.length ? promotionGate.blockers.join(", ") : "unknown";
  throw new Error(`Cannot record ${state} while benchmark promotion gate is ${promotionGate.status}. Blockers: ${blockers}.`);
}

function isPromotedState(state: WorkflowPromotionState) {
  return state === "promoted_for_local_default" || state === "promoted_for_eval_only";
}

function readFindingCount(findings: Record<string, unknown> | null | undefined, ...keys: string[]) {
  if (!findings) {
    return 0;
  }
  for (const key of keys) {
    const value = findings[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function benchmarkSplitSummaryForResults(input: {
  results: Array<{ benchmarkCaseId: string }>;
  casesById: Map<string, BenchmarkCaseSplitRow>;
}) {
  const splitCounts: Record<string, number> = {};
  for (const result of input.results) {
    const benchmarkCase = input.casesById.get(result.benchmarkCaseId);
    const split = normalizeBenchmarkSplit(readCaseSplit(benchmarkCase));
    splitCounts[split] = (splitCounts[split] ?? 0) + 1;
  }
  const holdoutCaseResults = Object.entries(splitCounts)
    .filter(([split]) => isBenchmarkHoldoutSplit(split))
    .reduce((sum, [, count]) => sum + count, 0);
  const unspecifiedCaseResults = splitCounts.unspecified ?? 0;
  return {
    totalCaseResults: input.results.length,
    splitCounts,
    holdoutSplitIds: Object.keys(splitCounts).filter(isBenchmarkHoldoutSplit),
    holdoutCaseResults,
    nonHoldoutCaseResults: input.results.length - holdoutCaseResults - unspecifiedCaseResults,
    unspecifiedCaseResults,
    requiredHoldoutCaseResults: minimumPromotionHoldoutCases,
    status: holdoutCaseResults >= minimumPromotionHoldoutCases ? "sufficient_holdout_evidence" : "insufficient_holdout_evidence",
    note:
      holdoutCaseResults >= minimumPromotionHoldoutCases
        ? "This benchmark run includes enough held-out case results for promotion review."
        : "Promotion review requires enough held-out case results so workflow changes are not promoted from tuned smoke evidence.",
  };
}

async function loadBenchmarkCaseSplitRows(db: Db, results: Array<{ benchmarkCaseId: string }>) {
  const caseIds = uniqueStrings(results.map((result) => result.benchmarkCaseId));
  if (caseIds.length === 0) {
    return [];
  }
  return await db
    .select({
      id: benchmarkCases.id,
      cutoffMetadataJson: benchmarkCases.cutoffMetadataJson,
      lineageJson: benchmarkCases.lineageJson,
    })
    .from(benchmarkCases)
    .where(inArray(benchmarkCases.id, caseIds));
}

function splitRowsById(rows: BenchmarkCaseSplitRow[]) {
  return new Map(rows.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]));
}

function readCaseSplit(benchmarkCase?: BenchmarkCaseSplitRow) {
  if (!benchmarkCase) {
    return null;
  }
  const cutoffSplit = readString(benchmarkCase.cutoffMetadataJson, "split", "caseSplit", "case_split");
  if (cutoffSplit) {
    return cutoffSplit;
  }
  return readString(benchmarkCase.lineageJson, "split", "caseSplit", "case_split");
}

function normalizeBenchmarkSplit(raw: string | null) {
  if (!raw) {
    return "unspecified";
  }
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "unspecified";
}

function isBenchmarkHoldoutSplit(split: string) {
  return benchmarkHoldoutSplitIds.some((holdoutSplit) => split === holdoutSplit || split.startsWith(`${holdoutSplit}_`));
}

const benchmarkSuitesByMode: Record<BenchmarkEvalMode, {
  name: string;
  revision: string;
  allowedEvalModes: string[];
  caseSelectionPolicy: Record<string, unknown>;
}> = {
  fixed_evidence: {
    name: "Open Superforecaster fixed-evidence binary smoke",
    revision: "2026-07-08-v1",
    allowedEvalModes: ["fixed_evidence"],
    caseSelectionPolicy: {
      defaultMaxCases: 1,
      defaultRollouts: 5,
      warning: "Fixed-evidence cases test judgment and scoring, not live research quality.",
    },
  },
  agentic_pastcasting_smoke: {
    name: "Open Superforecaster live-web binary smoke",
    revision: "2026-07-08-v2",
    allowedEvalModes: ["agentic_pastcasting_smoke"],
    caseSelectionPolicy: {
      defaultMaxCases: 1,
      warning: "Pastcasting smoke cases prove infrastructure, not benchmark validity.",
    },
  },
};

const fixedEvidenceSeedCases = [
  {
    externalId: "fixed-spacex-2024-100",
    inputJson: {
      question: "As of January 1, 2024, will SpaceX conduct at least 100 orbital launches in calendar year 2024?",
      resolutionCriteria: "Resolve true if SpaceX completed 100 or more orbital launches between 2024-01-01 and 2024-12-31 UTC.",
      background: "Fixed-evidence benchmark case. The agent must use only the evidence packet and must not use live web research.",
      presentDate: "2024-01-01",
      cutoffDate: "2024-01-01",
      fixedEvidence:
        "SpaceX completed 96 orbital launches in 2023 after 61 in 2022 and 31 in 2021. Most launches were Falcon 9 missions supporting Starlink. The company had publicly discussed very high launch cadence ambitions, and operational cadence was already near twice weekly by late 2023. Main risks were Falcon 9 grounding, range constraints, weather, pad limits, customer delays, and any transition attention toward Starship. The threshold of 100 launches required only modest growth from 2023, but still required sustaining record cadence for another year.",
      baselineProbability: 74,
      baselineLabel: "simple trend baseline",
    },
    hiddenResolutionJson: {
      resolved: true,
      resolvedAt: "2025-01-01",
      note: "SpaceX completed more than 100 orbital launches in 2024.",
    },
    cutoffMetadataJson: {
      cutoff: "2024-01-01",
      mode: "fixed_evidence",
      split: "smoke",
    },
  },
  {
    externalId: "fixed-uk-election-2024",
    inputJson: {
      question: "As of January 1, 2024, will the United Kingdom hold a general election in calendar year 2024?",
      resolutionCriteria: "Resolve true if a UK general election polling day occurred from 2024-01-01 through 2024-12-31.",
      background: "Fixed-evidence benchmark case. The agent must use only the evidence packet and must not use live web research.",
      presentDate: "2024-01-01",
      cutoffDate: "2024-01-01",
      fixedEvidence:
        "The UK Parliament elected in December 2019 had to face another general election by January 2025 under the maximum term rules. The governing Conservatives were trailing Labour by a large margin in late-2023 polling. Prime Minister Rishi Sunak had discretion over election timing within the legal window. A 2024 election was broadly expected because waiting until January 2025 would leave little flexibility and could be politically risky. Possible months included spring, autumn, or very late 2024. A non-2024 outcome would require using the latest possible timetable.",
      baselineProbability: 86,
      baselineLabel: "deadline/base-rate baseline",
    },
    hiddenResolutionJson: {
      resolved: true,
      resolvedAt: "2024-07-04",
      note: "The UK general election polling day was 2024-07-04.",
    },
    cutoffMetadataJson: {
      cutoff: "2024-01-01",
      mode: "fixed_evidence",
      split: "smoke",
    },
  },
  {
    externalId: "fixed-foldable-iphone-2025",
    inputJson: {
      question: "As of January 1, 2025, will Apple release a foldable iPhone before January 1, 2026?",
      resolutionCriteria: "Resolve true only if Apple publicly released an iPhone model with a foldable display before 2026-01-01.",
      background: "Fixed-evidence benchmark case. The agent must use only the evidence packet and must not use live web research.",
      presentDate: "2025-01-01",
      cutoffDate: "2025-01-01",
      fixedEvidence:
        "By early 2025 Apple had not announced a foldable iPhone. Foldable phones had existed commercially for years, led by Samsung and Chinese vendors, but Apple had repeatedly delayed or avoided entering the category. Rumors and analyst notes pointed to exploratory work on foldable displays and hinges, with many reports discussing 2026 or later as a more plausible first launch window. Apple tends to wait for mature hardware categories and prioritizes display durability, crease quality, software polish, and margins. A release before January 2026 would require announcement and sale during the 2025 product cycle, despite no firm public launch signal at the start of 2025.",
      baselineProbability: 18,
      baselineLabel: "rumor-timeline baseline",
    },
    hiddenResolutionJson: {
      resolved: false,
      resolvedAt: "2026-01-01",
      note: "No foldable iPhone had been released before 2026-01-01.",
    },
    cutoffMetadataJson: {
      cutoff: "2025-01-01",
      mode: "fixed_evidence",
      split: "smoke",
    },
  },
];

const liveWebSmokeSeedCases = [
  {
    externalId: "binary-smoke-spacex-2024-100",
    inputJson: {
      question: "As of January 1, 2024, will SpaceX conduct at least 100 orbital launches in calendar year 2024?",
      resolutionCriteria: "Resolve true if SpaceX completed 100 or more orbital launches between 2024-01-01 and 2024-12-31 UTC.",
      background: "Pastcasting smoke case. The workflow may use current web evidence; this is for plumbing validation.",
      presentDate: "2024-01-01",
      cutoffDate: "2024-01-01",
    },
    hiddenResolutionJson: {
      resolved: true,
      resolvedAt: "2025-01-01",
      note: "SpaceX completed more than 100 orbital launches in 2024.",
    },
    cutoffMetadataJson: {
      cutoff: "2024-01-01",
      mode: "weak_live_web_pastcast",
      split: "smoke",
    },
  },
  {
    externalId: "binary-smoke-uk-election-2024",
    inputJson: {
      question: "As of January 1, 2024, will the United Kingdom hold a general election in calendar year 2024?",
      resolutionCriteria: "Resolve true if a UK general election polling day occurred from 2024-01-01 through 2024-12-31.",
      background: "Pastcasting smoke case. The workflow may use current web evidence; this is for plumbing validation.",
      presentDate: "2024-01-01",
      cutoffDate: "2024-01-01",
    },
    hiddenResolutionJson: {
      resolved: true,
      resolvedAt: "2024-07-04",
      note: "The UK general election was held on 2024-07-04.",
    },
    cutoffMetadataJson: {
      cutoff: "2024-01-01",
      mode: "weak_live_web_pastcast",
      split: "smoke",
    },
  },
  {
    externalId: "binary-smoke-foldable-iphone-2025",
    inputJson: {
      question: "As of January 1, 2025, will Apple release a foldable iPhone before January 1, 2026?",
      resolutionCriteria: "Resolve true only if Apple publicly released an iPhone model with a foldable display before 2026-01-01.",
      background: "Pastcasting smoke case. The workflow may use current web evidence; this is for plumbing validation.",
      presentDate: "2025-01-01",
      cutoffDate: "2025-01-01",
    },
    hiddenResolutionJson: {
      resolved: false,
      resolvedAt: "2026-01-01",
      note: "No foldable iPhone had been released before 2026-01-01.",
    },
    cutoffMetadataJson: {
      cutoff: "2025-01-01",
      mode: "weak_live_web_pastcast",
      split: "smoke",
    },
  },
];

export async function startBenchmarkRun(
  db: Db,
  input: {
    root: string;
    maxCases?: number;
    evalMode?: string;
    rollouts?: number;
    experimentLabel?: string;
    suiteId?: string;
  },
) {
  const evalMode = normalizeEvalMode(input.evalMode);
  const suite = input.suiteId
    ? await loadBenchmarkSuiteForRun(db, { suiteId: input.suiteId, evalMode })
    : await ensureSeedBenchmarkSuite(db, evalMode);
  const variant = await ensureWorkflowVariant(db, input.root, evalMode);
  const workflowPath = workflowPathForEvalMode(evalMode);
  const cases = await db
    .select()
    .from(benchmarkCases)
    .where(eq(benchmarkCases.suiteId, suite.id))
    .orderBy(benchmarkCases.externalId);
  if (cases.length === 0) {
    throw new Error(`Benchmark suite has no cases: ${suite.id}`);
  }
  const selectedCases = cases.slice(0, Math.max(1, Math.min(input.maxCases ?? readDefaultMaxCases(suite.caseSelectionPolicy), cases.length)));

  const [benchmarkRun] = await db
    .insert(benchmarkRuns)
    .values({
      suiteId: suite.id,
      evalMode,
      workflowVariantId: variant.id,
      status: "running",
      caseCount: selectedCases.length,
      startedAt: new Date(),
    })
    .returning({ id: benchmarkRuns.id });

  const launchedCases = [];
  for (const benchmarkCase of selectedCases) {
    const question = String(benchmarkCase.inputJson.question ?? "");
    const record = await createQueuedWorkflowTask(db, {
      operationMode: evalMode === "fixed_evidence" ? "fixed_evidence_eval" : "agentic_pastcasting_eval",
      operationSubmode: "binary_forecast",
      label: `Benchmark ${benchmarkCase.externalId}`,
      workflowPath,
      workflowVersion: variant.workflowSourceHash.slice(0, 12),
      benchmarkRunId: benchmarkRun.id,
      workflowVariantId: variant.id,
      experimentLabel: input.experimentLabel ?? "benchmark-smoke",
      configJson: {
        benchmarkRunId: benchmarkRun.id,
        benchmarkCaseId: benchmarkCase.id,
        benchmarkExternalId: benchmarkCase.externalId,
        evalMode,
        suiteId: suite.id,
        prompt: question,
        rollouts: input.rollouts,
      },
    });

    await createBootstrapArtifact(db, {
      taskId: record.taskId,
      smithersRunId: record.smithersRunId,
      createdBy: "benchmark-runner",
      benchmarkRunId: benchmarkRun.id,
      benchmarkCaseId: benchmarkCase.id,
      workflowVariantId: variant.id,
      schemaJson: {
        type: "object",
        properties: {
          forecastType: { const: "binary" },
          probability: { type: "number" },
        },
      },
    });

    try {
      const workflowInput =
        evalMode === "fixed_evidence"
          ? {
              taskId: record.taskId,
              benchmarkRunId: benchmarkRun.id,
              benchmarkCaseId: benchmarkCase.id,
              source: "open-superforecaster-fixed-evidence-benchmark",
              question,
              resolutionCriteria: benchmarkCase.inputJson.resolutionCriteria,
              background: benchmarkCase.inputJson.background,
              fixedEvidence: readCaseString(benchmarkCase.inputJson, "fixedEvidence", "fixed_evidence", "researchSummary", "research_summary"),
              presentDate: benchmarkCase.inputJson.presentDate,
              cutoffDate: benchmarkCase.inputJson.cutoffDate,
              cutoffMetadata: benchmarkCase.cutoffMetadataJson,
              rollouts: input.rollouts ?? readDefaultRollouts(suite.caseSelectionPolicy),
            }
          : {
              taskId: record.taskId,
              benchmarkRunId: benchmarkRun.id,
              benchmarkCaseId: benchmarkCase.id,
              source: "open-superforecaster-benchmark",
              question,
              resolutionCriteria: benchmarkCase.inputJson.resolutionCriteria,
              background: benchmarkCase.inputJson.background,
              presentDate: benchmarkCase.inputJson.presentDate,
              cutoffDate: benchmarkCase.inputJson.cutoffDate,
              cutoffMetadata: benchmarkCase.cutoffMetadataJson,
              corpusMode: "live_web_date_bounded",
            };
      const launched = await launchSmithersDetached({
        root: input.root,
        workflowPath,
        runId: record.smithersRunId,
        input: workflowInput,
      });

      await markTaskRunning(db, {
        taskId: record.taskId,
        smithersRunId: launched.runId,
      });

      const [caseResult] = await db
        .insert(benchmarkCaseResults)
        .values({
          benchmarkRunId: benchmarkRun.id,
          benchmarkCaseId: benchmarkCase.id,
          taskId: record.taskId,
          smithersRunId: launched.runId,
          workflowVariantId: variant.id,
          status: "running",
        })
        .returning({ id: benchmarkCaseResults.id });

      launchedCases.push({
        benchmarkCaseId: benchmarkCase.id,
        externalId: benchmarkCase.externalId,
        taskId: record.taskId,
        smithersRunId: launched.runId,
        benchmarkCaseResultId: caseResult.id,
      });
    } catch (error) {
      await markTaskFailed(db, {
        taskId: record.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      const [caseResult] = await db
        .insert(benchmarkCaseResults)
        .values({
          benchmarkRunId: benchmarkRun.id,
          benchmarkCaseId: benchmarkCase.id,
          taskId: record.taskId,
          smithersRunId: record.smithersRunId,
          workflowVariantId: variant.id,
          status: "failed",
          failureLabels: ["launch_failed"],
        })
        .returning({ id: benchmarkCaseResults.id });
      launchedCases.push({
        benchmarkCaseId: benchmarkCase.id,
        externalId: benchmarkCase.externalId,
        taskId: record.taskId,
        smithersRunId: record.smithersRunId,
        benchmarkCaseResultId: caseResult.id,
      });
    }
  }

  return {
    benchmarkRunId: benchmarkRun.id,
    suiteId: suite.id,
    workflowVariantId: variant.id,
    launchedCases,
  };
}

export async function reconcileBenchmarkRuns(db: Db, input: {
  artifactsDir: string;
  root?: string;
  objectStorage?: ObjectStorageTarget;
}) {
  await reconcileCaseResults(db, input);
  await backfillBenchmarkForecastScoreRows(db);
  await finalizeReadyBenchmarkRuns(db);
}

export async function listBenchmarkRuns(db: Db, limit = 20) {
  const rows = await db
    .select({
      id: benchmarkRuns.id,
      suiteId: benchmarkRuns.suiteId,
      suiteName: benchmarkSuites.name,
      evalMode: benchmarkRuns.evalMode,
      status: benchmarkRuns.status,
      caseCount: benchmarkRuns.caseCount,
      workflowVariantId: benchmarkRuns.workflowVariantId,
      baselineBenchmarkRunIds: benchmarkRuns.baselineBenchmarkRunIds,
      scoreReportArtifactId: benchmarkRuns.scoreReportArtifactId,
      analysisReportArtifactId: benchmarkRuns.analysisReportArtifactId,
      comparisonReportArtifactId: benchmarkRuns.comparisonReportArtifactId,
      promotionDecisionId: benchmarkRuns.promotionDecisionId,
      createdAt: benchmarkRuns.createdAt,
      startedAt: benchmarkRuns.startedAt,
      completedAt: benchmarkRuns.completedAt,
    })
    .from(benchmarkRuns)
    .leftJoin(benchmarkSuites, eq(benchmarkRuns.suiteId, benchmarkSuites.id))
    .orderBy(desc(benchmarkRuns.createdAt))
    .limit(limit);

  const enriched = [];
  for (const row of rows) {
    const results = await db
      .select({
        id: benchmarkCaseResults.id,
        benchmarkCaseId: benchmarkCaseResults.benchmarkCaseId,
        status: benchmarkCaseResults.status,
        taskId: benchmarkCaseResults.taskId,
        smithersRunId: benchmarkCaseResults.smithersRunId,
        scoreRows: benchmarkCaseResults.scoreRows,
        traceBundleUri: benchmarkCaseResults.traceBundleUri,
        sourceBundleUri: benchmarkCaseResults.sourceBundleUri,
        leakageFlags: benchmarkCaseResults.leakageFlags,
        failureLabels: benchmarkCaseResults.failureLabels,
        analystNotesArtifactId: benchmarkCaseResults.analystNotesArtifactId,
      })
      .from(benchmarkCaseResults)
      .where(eq(benchmarkCaseResults.benchmarkRunId, row.id));
    const caseRows = await loadBenchmarkCaseSplitRows(db, results);
    const splitFindings = benchmarkSplitSummaryForResults({
      results,
      casesById: splitRowsById(caseRows),
    });
    const [analysis] = await db
      .select({
        id: benchmarkAnalyses.id,
        summary: benchmarkAnalyses.summary,
        strongestCases: benchmarkAnalyses.strongestCases,
        worstCases: benchmarkAnalyses.worstCases,
        failureClusters: benchmarkAnalyses.failureClusters,
        metricDeltas: benchmarkAnalyses.metricDeltas,
        traceQualityFindings: benchmarkAnalyses.traceQualityFindings,
        sourceQualityFindings: benchmarkAnalyses.sourceQualityFindings,
        costLatencyFindings: benchmarkAnalyses.costLatencyFindings,
        holdoutRiskNotes: benchmarkAnalyses.holdoutRiskNotes,
        createdAt: benchmarkAnalyses.createdAt,
      })
      .from(benchmarkAnalyses)
      .where(eq(benchmarkAnalyses.benchmarkRunId, row.id))
      .orderBy(desc(benchmarkAnalyses.createdAt))
      .limit(1);
    const proposals = await db
      .select({
        id: workflowChangeProposals.id,
        targetWorkflowId: workflowChangeProposals.targetWorkflowId,
        problemStatement: workflowChangeProposals.problemStatement,
        evidenceCaseIds: workflowChangeProposals.evidenceCaseIds,
        proposedChange: workflowChangeProposals.proposedChange,
        expectedMetricEffect: workflowChangeProposals.expectedMetricEffect,
        expectedCostLatencyEffect: workflowChangeProposals.expectedCostLatencyEffect,
        overfitRisk: workflowChangeProposals.overfitRisk,
        validationPlan: workflowChangeProposals.validationPlan,
        status: workflowChangeProposals.status,
        reviewNote: workflowChangeProposals.reviewNote,
        reviewedBy: workflowChangeProposals.reviewedBy,
        reviewedAt: workflowChangeProposals.reviewedAt,
        implementationTaskTitle: workflowChangeProposals.implementationTaskTitle,
        implementationStatus: workflowChangeProposals.implementationStatus,
        implementationExperimentLabel: workflowChangeProposals.implementationExperimentLabel,
        implementationNote: workflowChangeProposals.implementationNote,
        implementationUpdatedBy: workflowChangeProposals.implementationUpdatedBy,
        implementationUpdatedAt: workflowChangeProposals.implementationUpdatedAt,
        validationBenchmarkRunId: workflowChangeProposals.validationBenchmarkRunId,
        validationLaunchedBy: workflowChangeProposals.validationLaunchedBy,
        validationLaunchedAt: workflowChangeProposals.validationLaunchedAt,
        validationResultStatus: workflowChangeProposals.validationResultStatus,
        validationResultSummary: workflowChangeProposals.validationResultSummary,
        validationMeanBrierDelta: workflowChangeProposals.validationMeanBrierDelta,
        validationCompletedCases: workflowChangeProposals.validationCompletedCases,
        validationGateStatus: workflowChangeProposals.validationGateStatus,
        validationGateBlockers: workflowChangeProposals.validationGateBlockers,
        validationCompletedAt: workflowChangeProposals.validationCompletedAt,
        createdAt: workflowChangeProposals.createdAt,
      })
      .from(workflowChangeProposals)
      .where(eq(workflowChangeProposals.sourceBenchmarkRunId, row.id))
      .orderBy(desc(workflowChangeProposals.createdAt))
      .limit(3);
    const [variant] = await db
      .select({
        workflowId: workflowVariants.workflowId,
        workflowSourceHash: workflowVariants.workflowSourceHash,
        promotionState: workflowVariants.promotionState,
      })
      .from(workflowVariants)
      .where(eq(workflowVariants.id, row.workflowVariantId))
      .limit(1);
    const [latestPromotionDecision] = await db
      .select({
        id: workflowPromotionDecisions.id,
        state: workflowPromotionDecisions.state,
        decisionNote: workflowPromotionDecisions.decisionNote,
        decidedBy: workflowPromotionDecisions.decidedBy,
        decidedAt: workflowPromotionDecisions.decidedAt,
      })
      .from(workflowPromotionDecisions)
      .where(eq(workflowPromotionDecisions.benchmarkRunId, row.id))
      .orderBy(desc(workflowPromotionDecisions.decidedAt))
      .limit(1);
    const [comparisonReportRow] = row.comparisonReportArtifactId
      ? await db
          .select({ rowJson: artifactRows.rowJson })
          .from(artifactRows)
          .where(and(eq(artifactRows.artifactId, row.comparisonReportArtifactId), eq(artifactRows.rowIndex, 0)))
          .limit(1)
      : [];
    const analysisReportRow = await readArtifactReportRow(db, row.analysisReportArtifactId);
    const baselineSanityFindings = readRecord(analysisReportRow, "baselineSanityFindings", "baseline_sanity_findings") ?? null;
    const componentDisagreementFindings = readRecord(analysisReportRow, "componentDisagreementFindings", "component_disagreement_findings") ?? null;
    const forecastErrorFindings = readRecord(analysisReportRow, "forecastErrorFindings", "forecast_error_findings") ?? null;
    const sourceQualityFindings = readRecord(analysisReportRow, "sourceQualityFindings", "source_quality_findings") ?? null;
    const traceQualityFindings = readRecord(analysisReportRow, "traceQualityFindings", "trace_quality_findings") ?? null;
    enriched.push({
      ...row,
      workflowId: variant?.workflowId ?? null,
      workflowSourceHash: variant?.workflowSourceHash ?? null,
      workflowPromotionState: variant?.promotionState ?? "candidate",
      latestPromotionDecision: latestPromotionDecision ?? null,
      comparison: comparisonReportRow?.rowJson ?? null,
      baselineSanityFindings,
      componentDisagreementFindings,
      forecastErrorFindings,
      sourceQualityFindings,
      traceQualityFindings,
      splitFindings,
      promotionGate: summarizeBenchmarkPromotionGateEvidence({
        runStatus: row.status,
        resultCount: results.length,
        traceMissing: results.filter((result) => !result.traceBundleUri).length,
        reviewOrFailed: results.filter((result) => result.status === "failed" || result.status === "needs_review").length,
        comparisonStatus: readComparisonRecommendationStatus(comparisonReportRow?.rowJson ?? null),
        baselineSanityFindings,
        componentDisagreementFindings,
        forecastErrorFindings,
        splitFindings,
        sourceQualityFindings,
        traceQualityFindings,
      }),
      completedCases: results.filter((result) => result.status === "completed").length,
      failedCases: results.filter((result) => result.status === "failed").length,
      runningCases: results.filter((result) => result.status === "running").length,
      reviewCases: results.filter((result) => result.status === "needs_review").length,
      meanBrier: meanScore(results, "brier"),
      meanLog: meanScore(results, "log"),
      meanBaselineBrier: meanScore(results, "baseline_brier"),
      meanBrierDelta: meanScore(results, "baseline_delta_brier"),
      caseResults: results,
      analysis: analysis ?? null,
      workflowChangeProposals: proposals,
    });
  }

  return enriched;
}

export async function getBenchmarkRunDetail(db: Db, benchmarkRunId: string) {
  const [run] = await db.select().from(benchmarkRuns).where(eq(benchmarkRuns.id, benchmarkRunId)).limit(1);
  if (!run) {
    throw new Error(`Benchmark run not found: ${benchmarkRunId}`);
  }

  const [[suite], [variant], results, [analysis], proposals, promotionDecisions] = await Promise.all([
    db.select().from(benchmarkSuites).where(eq(benchmarkSuites.id, run.suiteId)).limit(1),
    db.select().from(workflowVariants).where(eq(workflowVariants.id, run.workflowVariantId)).limit(1),
    db.select().from(benchmarkCaseResults).where(eq(benchmarkCaseResults.benchmarkRunId, run.id)),
    db
      .select()
      .from(benchmarkAnalyses)
      .where(eq(benchmarkAnalyses.benchmarkRunId, run.id))
      .orderBy(desc(benchmarkAnalyses.createdAt))
      .limit(1),
    db
      .select()
      .from(workflowChangeProposals)
      .where(eq(workflowChangeProposals.sourceBenchmarkRunId, run.id))
      .orderBy(desc(workflowChangeProposals.createdAt)),
    db
      .select()
      .from(workflowPromotionDecisions)
      .where(eq(workflowPromotionDecisions.benchmarkRunId, run.id))
      .orderBy(desc(workflowPromotionDecisions.decidedAt)),
  ]);

  const benchmarkCaseIds = uniqueStrings(results.map((result) => result.benchmarkCaseId));
  const taskIds = uniqueStrings(results.map((result) => result.taskId).filter((id): id is string => Boolean(id)));
  const artifactIds = uniqueStrings([
    ...results.map((result) => result.forecastOutputArtifactId).filter((id): id is string => Boolean(id)),
    run.scoreReportArtifactId,
    run.analysisReportArtifactId,
    run.comparisonReportArtifactId,
  ].filter((id): id is string => Boolean(id)));

  const [caseRows, taskRows, artifactRowsById, scoreReportRow, analysisReportRow, comparisonReportRow] = await Promise.all([
    benchmarkCaseIds.length ? db.select().from(benchmarkCases).where(inArray(benchmarkCases.id, benchmarkCaseIds)) : [],
    taskIds.length ? db.select().from(tasks).where(inArray(tasks.id, taskIds)) : [],
    artifactIds.length ? db.select().from(artifacts).where(inArray(artifacts.id, artifactIds)) : [],
    readArtifactReportRow(db, run.scoreReportArtifactId),
    readArtifactReportRow(db, run.analysisReportArtifactId),
    readArtifactReportRow(db, run.comparisonReportArtifactId),
  ]);

  const casesById = new Map(caseRows.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]));
  const tasksById = new Map(taskRows.map((task) => [task.id, task]));
  const artifactsById = new Map(artifactRowsById.map((artifact) => [artifact.id, artifact]));
  const splitFindings = benchmarkSplitSummaryForResults({ results, casesById });
  const detailedCases = results.map((result) => {
    const benchmarkCase = casesById.get(result.benchmarkCaseId);
    const task = result.taskId ? tasksById.get(result.taskId) : null;
    const outputArtifact = result.forecastOutputArtifactId ? artifactsById.get(result.forecastOutputArtifactId) : null;
    return {
      ...result,
      externalId: benchmarkCase?.externalId ?? result.benchmarkCaseId,
      question: readString(benchmarkCase?.inputJson ?? {}, "question") ?? "Benchmark case",
      resolutionCriteria: readString(benchmarkCase?.inputJson ?? {}, "resolutionCriteria") ?? null,
      cutoffMetadata: benchmarkCase?.cutoffMetadataJson ?? {},
      lineage: benchmarkCase?.lineageJson ?? {},
      hiddenResolutionSummary: summarizeHiddenResolution(benchmarkCase?.hiddenResolutionJson ?? null),
      task: task
        ? {
            id: task.id,
            label: task.label,
            status: task.status,
            smithersRunId: task.smithersRunId,
            operationMode: task.operationMode,
            operationSubmode: task.operationSubmode,
            startedAt: task.startedAt,
            completedAt: task.completedAt,
          }
        : null,
      outputArtifact: outputArtifact
        ? {
            id: outputArtifact.id,
            artifactType: outputArtifact.artifactType,
            rowCount: outputArtifact.rowCount,
            storageUri: outputArtifact.storageUri,
          }
        : null,
      metrics: {
        brier: scoreValue(result.scoreRows, "brier"),
        log: scoreValue(result.scoreRows, "log"),
        baselineBrier: scoreValue(result.scoreRows, "baseline_brier"),
        baselineLog: scoreValue(result.scoreRows, "baseline_log"),
        baselineDeltaBrier: scoreValue(result.scoreRows, "baseline_delta_brier"),
      },
      links: {
        runDetail: result.taskId ? `/runs/${result.taskId}` : null,
        traceBundle: result.taskId ? `/api/runs/${result.taskId}/trace-bundle` : null,
        artifactCsv: result.forecastOutputArtifactId ? `/api/artifacts/${result.forecastOutputArtifactId}/csv` : null,
        artifactParquet: result.forecastOutputArtifactId ? `/api/artifacts/${result.forecastOutputArtifactId}/parquet` : null,
      },
    };
  });

  const metrics = benchmarkRunMetrics(results);
  return {
    run: {
      ...run,
      suiteName: suite?.name ?? null,
      suiteRevision: suite?.revision ?? null,
      allowedEvalModes: suite?.allowedEvalModes ?? [],
      workflowId: variant?.workflowId ?? null,
      workflowSourceHash: variant?.workflowSourceHash ?? null,
      workflowPromotionState: variant?.promotionState ?? "candidate",
    },
    suite: suite ?? null,
    workflowVariant: variant ?? null,
    scorecard: {
      ...metrics,
      statusCounts: countBy(results.map((result) => result.status)),
      failureLabelCounts: countBy(results.flatMap((result) => result.failureLabels)),
      leakageFlagCounts: countBy(results.flatMap((result) => result.leakageFlags)),
      splitFindings,
      traceBundlesWritten: results.filter((result) => Boolean(result.traceBundleUri)).length,
      sourceBundlesWritten: results.filter((result) => Boolean(result.sourceBundleUri)).length,
      casesWithAnalystNotes: results.filter((result) => Boolean(result.analystNotesArtifactId)).length,
      caseCount: results.length,
      promotionGate: benchmarkPromotionGateSummary({
        run,
        metrics,
        results,
        comparison: comparisonReportRow,
        analysisReport: analysisReportRow,
        splitFindings,
      }),
    },
    cases: detailedCases,
    analysis: analysis ?? null,
    workflowChangeProposals: proposals,
    promotionDecisions,
    reports: {
      score: run.scoreReportArtifactId ? { artifactId: run.scoreReportArtifactId, row: scoreReportRow } : null,
      analysis: run.analysisReportArtifactId ? { artifactId: run.analysisReportArtifactId, row: analysisReportRow } : null,
      comparison: run.comparisonReportArtifactId ? { artifactId: run.comparisonReportArtifactId, row: comparisonReportRow } : null,
    },
  };
}

export async function recordWorkflowPromotionDecision(
  db: Db,
  input: {
    benchmarkRunId: string;
    state: string;
    decisionNote: string;
    decidedBy?: string;
  },
) {
  const state = normalizePromotionState(input.state);
  const decisionNote = input.decisionNote.trim();
  if (!decisionNote) {
    throw new Error("Promotion decision note is required.");
  }

  const [run] = await db.select().from(benchmarkRuns).where(eq(benchmarkRuns.id, input.benchmarkRunId)).limit(1);
  if (!run) {
    throw new Error(`Benchmark run not found: ${input.benchmarkRunId}`);
  }

  const [variant] = await db.select().from(workflowVariants).where(eq(workflowVariants.id, run.workflowVariantId)).limit(1);
  if (!variant) {
    throw new Error(`Workflow variant not found: ${run.workflowVariantId}`);
  }

  const promotionGate = await benchmarkPromotionGateForRun(db, run);
  assertBenchmarkPromotionDecisionAllowed(state, promotionGate);

  const [decision] = await db
    .insert(workflowPromotionDecisions)
    .values({
      workflowVariantId: run.workflowVariantId,
      benchmarkRunId: run.id,
      state,
      decisionNote,
      decidedBy: input.decidedBy?.trim() || "local-user",
    })
    .returning({
      id: workflowPromotionDecisions.id,
      workflowVariantId: workflowPromotionDecisions.workflowVariantId,
      benchmarkRunId: workflowPromotionDecisions.benchmarkRunId,
      state: workflowPromotionDecisions.state,
      decisionNote: workflowPromotionDecisions.decisionNote,
      decidedBy: workflowPromotionDecisions.decidedBy,
      decidedAt: workflowPromotionDecisions.decidedAt,
    });

  await db
    .update(workflowVariants)
    .set({
      promotionState: state,
      updatedAt: new Date(),
    })
    .where(eq(workflowVariants.id, run.workflowVariantId));

  await db
    .update(benchmarkRuns)
    .set({
      promotionDecisionId: decision.id,
      updatedAt: new Date(),
    })
    .where(eq(benchmarkRuns.id, run.id));

  return {
    ...decision,
    workflowId: variant.workflowId,
    workflowSourceHash: variant.workflowSourceHash,
    benchmarkStatus: run.status,
    promotionGate,
  };
}

export async function updateWorkflowChangeProposalStatus(
  db: Db,
  input: {
    benchmarkRunId: string;
    proposalId: string;
    status: string;
    reviewNote?: string;
    reviewedBy?: string;
    implementationTaskTitle?: string;
    implementationStatus?: string;
    implementationExperimentLabel?: string;
    implementationNote?: string;
  },
) {
  const status = normalizeWorkflowChangeProposalStatus(input.status);
  const reviewNote = input.reviewNote?.trim() || null;
  const reviewedBy = input.reviewedBy?.trim() || "local-user";
  const reviewedAt = status === "candidate" ? null : new Date();
  const [existing] = await db
    .select()
    .from(workflowChangeProposals)
    .where(and(eq(workflowChangeProposals.id, input.proposalId), eq(workflowChangeProposals.sourceBenchmarkRunId, input.benchmarkRunId)))
    .limit(1);
  if (!existing) {
    throw new Error(`Workflow change proposal not found for benchmark run: ${input.proposalId}`);
  }
  const implementationStatus = input.implementationStatus
    ? normalizeWorkflowChangeProposalImplementationStatus(input.implementationStatus)
    : implementationStatusForProposalTransition(status, existing.implementationStatus);
  const implementationUpdatedAt = implementationStatus === existing.implementationStatus ? existing.implementationUpdatedAt : new Date();
  const implementationUpdatedBy = implementationStatus === "not_started" ? null : reviewedBy;
  const implementationExperimentLabel =
    implementationStatus === "not_started"
      ? null
      : input.implementationExperimentLabel?.trim() || existing.implementationExperimentLabel || `proposal-${existing.id.slice(0, 8)}`;
  const implementationTaskTitle =
    implementationStatus === "not_started"
      ? null
      : input.implementationTaskTitle?.trim() || existing.implementationTaskTitle || `Patch ${existing.targetWorkflowId} from accepted proposal`;
  const implementationNote =
    implementationStatus === "not_started"
      ? null
      : input.implementationNote?.trim() || existing.implementationNote || implementationNoteForProposalTransition(status, implementationStatus);
  const [proposal] = await db
    .update(workflowChangeProposals)
    .set({
      status,
      reviewNote,
      reviewedBy: status === "candidate" ? null : reviewedBy,
      reviewedAt,
      implementationTaskTitle,
      implementationStatus,
      implementationExperimentLabel,
      implementationNote,
      implementationUpdatedBy,
      implementationUpdatedAt,
      updatedAt: new Date(),
    })
    .where(eq(workflowChangeProposals.id, existing.id))
    .returning({
      id: workflowChangeProposals.id,
      sourceBenchmarkRunId: workflowChangeProposals.sourceBenchmarkRunId,
      targetWorkflowId: workflowChangeProposals.targetWorkflowId,
      problemStatement: workflowChangeProposals.problemStatement,
      evidenceCaseIds: workflowChangeProposals.evidenceCaseIds,
      proposedChange: workflowChangeProposals.proposedChange,
      expectedMetricEffect: workflowChangeProposals.expectedMetricEffect,
      expectedCostLatencyEffect: workflowChangeProposals.expectedCostLatencyEffect,
      overfitRisk: workflowChangeProposals.overfitRisk,
      validationPlan: workflowChangeProposals.validationPlan,
      status: workflowChangeProposals.status,
      reviewNote: workflowChangeProposals.reviewNote,
      reviewedBy: workflowChangeProposals.reviewedBy,
      reviewedAt: workflowChangeProposals.reviewedAt,
      implementationTaskTitle: workflowChangeProposals.implementationTaskTitle,
      implementationStatus: workflowChangeProposals.implementationStatus,
      implementationExperimentLabel: workflowChangeProposals.implementationExperimentLabel,
      implementationNote: workflowChangeProposals.implementationNote,
      implementationUpdatedBy: workflowChangeProposals.implementationUpdatedBy,
      implementationUpdatedAt: workflowChangeProposals.implementationUpdatedAt,
      validationBenchmarkRunId: workflowChangeProposals.validationBenchmarkRunId,
      validationLaunchedBy: workflowChangeProposals.validationLaunchedBy,
      validationLaunchedAt: workflowChangeProposals.validationLaunchedAt,
      validationResultStatus: workflowChangeProposals.validationResultStatus,
      validationResultSummary: workflowChangeProposals.validationResultSummary,
      validationMeanBrierDelta: workflowChangeProposals.validationMeanBrierDelta,
      validationCompletedCases: workflowChangeProposals.validationCompletedCases,
      validationGateStatus: workflowChangeProposals.validationGateStatus,
      validationGateBlockers: workflowChangeProposals.validationGateBlockers,
      validationCompletedAt: workflowChangeProposals.validationCompletedAt,
      createdAt: workflowChangeProposals.createdAt,
      updatedAt: workflowChangeProposals.updatedAt,
    });
  return proposal;
}

export async function startWorkflowChangeProposalValidation(
  db: Db,
  input: {
    root: string;
    benchmarkRunId: string;
    proposalId: string;
    launchedBy?: string;
    maxCases?: number;
    rollouts?: number;
  },
) {
  const [existing] = await db
    .select()
    .from(workflowChangeProposals)
    .where(and(eq(workflowChangeProposals.id, input.proposalId), eq(workflowChangeProposals.sourceBenchmarkRunId, input.benchmarkRunId)))
    .limit(1);
  if (!existing) {
    throw new Error(`Workflow change proposal not found for benchmark run: ${input.proposalId}`);
  }
  if (existing.status !== "accepted" && existing.status !== "implemented") {
    throw new Error("Accept the workflow change proposal before launching validation.");
  }
  if (existing.validationBenchmarkRunId) {
    throw new Error(`Workflow change proposal already has validation benchmark run: ${existing.validationBenchmarkRunId}`);
  }
  const launchedBy = input.launchedBy?.trim() || "local-user";
  const implementationExperimentLabel = existing.implementationExperimentLabel || `proposal-${existing.id.slice(0, 8)}`;
  const validationRun = await startBenchmarkRun(db, {
    root: input.root,
    evalMode: evalModeForProposalTargetWorkflow(existing.targetWorkflowId),
    maxCases: input.maxCases ?? 1,
    rollouts: input.rollouts,
    experimentLabel: implementationExperimentLabel,
  });
  const [proposal] = await db
    .update(workflowChangeProposals)
    .set({
      implementationExperimentLabel,
      implementationStatus: existing.implementationStatus === "validated" ? "validated" : "in_progress",
      implementationUpdatedBy: launchedBy,
      implementationUpdatedAt: new Date(),
      implementationNote: `Validation benchmark ${validationRun.benchmarkRunId} launched for implementation evidence.`,
      validationBenchmarkRunId: validationRun.benchmarkRunId,
      validationLaunchedBy: launchedBy,
      validationLaunchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(workflowChangeProposals.id, existing.id))
    .returning();
  return {
    proposal,
    benchmarkRun: validationRun,
  };
}

export async function createBenchmarkComparisonReport(
  db: Db,
  input: {
    benchmarkRunId: string;
    baselineBenchmarkRunIds?: string[];
  },
) {
  const [candidateRun] = await db.select().from(benchmarkRuns).where(eq(benchmarkRuns.id, input.benchmarkRunId)).limit(1);
  if (!candidateRun) {
    throw new Error(`Benchmark run not found: ${input.benchmarkRunId}`);
  }

  const candidateResults = await db
    .select()
    .from(benchmarkCaseResults)
    .where(eq(benchmarkCaseResults.benchmarkRunId, candidateRun.id));
  const candidateCasesById = splitRowsById(await loadBenchmarkCaseSplitRows(db, candidateResults));
  const candidateSplitFindings = benchmarkSplitSummaryForResults({
    results: candidateResults,
    casesById: candidateCasesById,
  });
  const candidateVariant = await loadWorkflowVariantSummary(db, candidateRun.workflowVariantId);
  const explicitBaselineIds = (input.baselineBenchmarkRunIds ?? []).filter((id) => id && id !== candidateRun.id);
  const baselineRuns = explicitBaselineIds.length
    ? await loadBenchmarkRunsByIds(db, explicitBaselineIds)
    : await findDefaultBaselineRuns(db, candidateRun);

  const baselineComparisons = [];
  for (const baselineRun of baselineRuns) {
    const baselineResults = await db
      .select()
      .from(benchmarkCaseResults)
      .where(eq(benchmarkCaseResults.benchmarkRunId, baselineRun.id));
    const baselineVariant = await loadWorkflowVariantSummary(db, baselineRun.workflowVariantId);
    baselineComparisons.push(
      buildBaselineComparison({
        candidateRun,
        candidateResults,
        candidateCasesById,
        candidateVariant,
        baselineRun,
        baselineResults,
        baselineVariant,
      }),
    );
  }

  const recommendation = comparisonRecommendation({
    candidateRun,
    candidateResults,
    baselineComparisons,
  });
  const report = {
    reportType: "benchmark_comparison",
    benchmarkRunId: candidateRun.id,
    suiteId: candidateRun.suiteId,
    evalMode: candidateRun.evalMode,
    generatedAt: new Date().toISOString(),
    candidate: {
      ...benchmarkRunMetrics(candidateResults),
      id: candidateRun.id,
      status: candidateRun.status,
      caseCount: candidateRun.caseCount,
      workflowVariantId: candidateRun.workflowVariantId,
      workflowId: candidateVariant.workflowId,
      workflowSourceHash: candidateVariant.workflowSourceHash,
      workflowPromotionState: candidateVariant.promotionState,
      splitFindings: candidateSplitFindings,
    },
    baselines: baselineComparisons,
    recommendation,
    interpretation: [
      "Negative Brier delta means the candidate scored better than the baseline.",
      "Paired deltas compare only shared benchmark case IDs and are the primary signal when case selection differs.",
      "Do not promote from tiny smoke runs; use this report to decide what larger paired run should happen next.",
    ],
  };

  const [comparisonArtifact] = await db
    .insert(artifacts)
    .values({
      artifactType: "report",
      createdBy: "benchmark-comparator",
      rowCount: 1,
      schemaJson: {
        type: "object",
        properties: {
          reportType: { const: "benchmark_comparison" },
          benchmarkRunId: { type: "string" },
        },
      },
      storageUri: `benchmarks/${candidateRun.id}/comparison-report.json`,
    })
    .returning({ id: artifacts.id });
  await db.insert(artifactRows).values({
    artifactId: comparisonArtifact.id,
    rowIndex: 0,
    rowJson: report,
    status: "completed",
    completedAt: new Date(),
  });

  await db
    .update(benchmarkRuns)
    .set({
      baselineBenchmarkRunIds: baselineComparisons.map((baseline) => baseline.baselineBenchmarkRunId),
      comparisonReportArtifactId: comparisonArtifact.id,
      updatedAt: new Date(),
    })
    .where(eq(benchmarkRuns.id, candidateRun.id));

  return {
    comparisonReportArtifactId: comparisonArtifact.id,
    report,
  };
}

export async function listBenchmarkSuites(db: Db, limit = 25) {
  const suites = await db
    .select({
      id: benchmarkSuites.id,
      name: benchmarkSuites.name,
      revision: benchmarkSuites.revision,
      allowedEvalModes: benchmarkSuites.allowedEvalModes,
      caseSelectionPolicy: benchmarkSuites.caseSelectionPolicy,
      createdAt: benchmarkSuites.createdAt,
      updatedAt: benchmarkSuites.updatedAt,
    })
    .from(benchmarkSuites)
    .orderBy(desc(benchmarkSuites.createdAt))
    .limit(limit);

  const enriched = [];
  for (const suite of suites) {
    const cases = await db
      .select({ id: benchmarkCases.id })
      .from(benchmarkCases)
      .where(eq(benchmarkCases.suiteId, suite.id));
    enriched.push({
      ...suite,
      caseCount: cases.length,
      defaultMaxCases: readDefaultMaxCases(suite.caseSelectionPolicy),
    });
  }
  return enriched;
}

function normalizeEvalMode(raw: string | undefined): BenchmarkEvalMode {
  if (raw === "agentic_pastcasting_smoke" || raw === "live_web_smoke") {
    return "agentic_pastcasting_smoke";
  }
  return "fixed_evidence";
}

function normalizePromotionState(raw: string): WorkflowPromotionState {
  if (promotionStates.includes(raw as WorkflowPromotionState)) {
    return raw as WorkflowPromotionState;
  }
  throw new Error(`Unknown promotion state: ${raw}`);
}

function normalizeWorkflowChangeProposalStatus(raw: string): WorkflowChangeProposalStatus {
  if (workflowChangeProposalStatuses.includes(raw as WorkflowChangeProposalStatus)) {
    return raw as WorkflowChangeProposalStatus;
  }
  throw new Error(`Unknown workflow change proposal status: ${raw}`);
}

function normalizeWorkflowChangeProposalImplementationStatus(raw: string): WorkflowChangeProposalImplementationStatus {
  if (workflowChangeProposalImplementationStatuses.includes(raw as WorkflowChangeProposalImplementationStatus)) {
    return raw as WorkflowChangeProposalImplementationStatus;
  }
  throw new Error(`Unknown workflow change proposal implementation status: ${raw}`);
}

function implementationStatusForProposalTransition(
  status: WorkflowChangeProposalStatus,
  current: string,
): WorkflowChangeProposalImplementationStatus {
  if (status === "candidate" || status === "rejected") {
    return "not_started";
  }
  if (status === "implemented") {
    return "validated";
  }
  const normalized = workflowChangeProposalImplementationStatuses.includes(current as WorkflowChangeProposalImplementationStatus)
    ? (current as WorkflowChangeProposalImplementationStatus)
    : "not_started";
  return normalized === "not_started" ? "planned" : normalized;
}

function implementationNoteForProposalTransition(
  status: WorkflowChangeProposalStatus,
  implementationStatus: WorkflowChangeProposalImplementationStatus,
) {
  if (status === "implemented") {
    return "Marked implemented after workflow patch validation.";
  }
  if (implementationStatus === "in_progress") {
    return "Workflow patch work started from accepted proposal.";
  }
  return "Accepted for workflow implementation.";
}

function evalModeForProposalTargetWorkflow(targetWorkflowId: string): BenchmarkEvalMode {
  if (targetWorkflowId === "fixed-evidence-eval") {
    return "fixed_evidence";
  }
  if (targetWorkflowId === "agentic-pastcasting-eval") {
    return "agentic_pastcasting_smoke";
  }
  throw new Error(`Unknown proposal target workflow: ${targetWorkflowId}`);
}

async function loadWorkflowVariantSummary(db: Db, workflowVariantId: string) {
  const [variant] = await db
    .select({
      workflowId: workflowVariants.workflowId,
      workflowSourceHash: workflowVariants.workflowSourceHash,
      promotionState: workflowVariants.promotionState,
    })
    .from(workflowVariants)
    .where(eq(workflowVariants.id, workflowVariantId))
    .limit(1);
  return {
    workflowId: variant?.workflowId ?? "unknown",
    workflowSourceHash: variant?.workflowSourceHash ?? "unknown",
    promotionState: variant?.promotionState ?? "candidate",
  };
}

async function loadBenchmarkRunsByIds(db: Db, ids: string[]) {
  if (ids.length === 0) {
    return [];
  }
  const rows = await db.select().from(benchmarkRuns).where(inArray(benchmarkRuns.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is BenchmarkRunRow => Boolean(row));
}

async function findDefaultBaselineRuns(db: Db, candidateRun: BenchmarkRunRow) {
  const rows = await db
    .select()
    .from(benchmarkRuns)
    .where(and(eq(benchmarkRuns.suiteId, candidateRun.suiteId), eq(benchmarkRuns.evalMode, candidateRun.evalMode)))
    .orderBy(desc(benchmarkRuns.createdAt))
    .limit(8);
  return rows
    .filter((row) => row.id !== candidateRun.id && row.status !== "running" && row.status !== "queued")
    .slice(0, 3);
}

function buildBaselineComparison(input: {
  candidateRun: BenchmarkRunRow;
  candidateResults: BenchmarkCaseResultRow[];
  candidateCasesById: Map<string, BenchmarkCaseSplitRow>;
  candidateVariant: Awaited<ReturnType<typeof loadWorkflowVariantSummary>>;
  baselineRun: BenchmarkRunRow;
  baselineResults: BenchmarkCaseResultRow[];
  baselineVariant: Awaited<ReturnType<typeof loadWorkflowVariantSummary>>;
}) {
  const candidateMetrics = benchmarkRunMetrics(input.candidateResults);
  const baselineMetrics = benchmarkRunMetrics(input.baselineResults);
  const paired = pairedBenchmarkCaseDeltas(input.candidateResults, input.baselineResults, input.candidateCasesById);
  const pairedHoldoutCaseCount = paired.caseDeltas.filter((row) => isBenchmarkHoldoutSplit(row.split)).length;
  const pairedUncertainty = pairedBootstrapUncertainty({
    caseDeltas: paired.caseDeltas,
    seedKey: `${input.candidateRun.id}:${input.baselineRun.id}`,
  });
  return {
    baselineBenchmarkRunId: input.baselineRun.id,
    baselineStatus: input.baselineRun.status,
    baselineCaseCount: input.baselineRun.caseCount,
    baselineWorkflowVariantId: input.baselineRun.workflowVariantId,
    baselineWorkflowId: input.baselineVariant.workflowId,
    baselineWorkflowSourceHash: input.baselineVariant.workflowSourceHash,
    baselinePromotionState: input.baselineVariant.promotionState,
    baselineMetrics,
    metricDeltas: {
      meanBrier: diffNullable(candidateMetrics.meanBrier, baselineMetrics.meanBrier),
      meanLog: diffNullable(candidateMetrics.meanLog, baselineMetrics.meanLog),
      meanBaselineBrier: diffNullable(candidateMetrics.meanBaselineBrier, baselineMetrics.meanBaselineBrier),
      meanBrierDelta: diffNullable(candidateMetrics.meanBrierDelta, baselineMetrics.meanBrierDelta),
      completedCases: candidateMetrics.completedCases - baselineMetrics.completedCases,
      failedCases: candidateMetrics.failedCases - baselineMetrics.failedCases,
      reviewCases: candidateMetrics.reviewCases - baselineMetrics.reviewCases,
    },
    pairedCaseCount: paired.caseDeltas.length,
    pairedHoldoutCaseCount,
    pairedMeanBrierDelta: paired.pairedMeanBrierDelta,
    pairedMeanLogDelta: paired.pairedMeanLogDelta,
    pairedUncertainty,
    pairedCaseDeltas: paired.caseDeltas.slice(0, 25),
    interpretation:
      paired.caseDeltas.length > 0
        ? "Paired comparison is available because candidate and baseline share benchmark case IDs. Bootstrap intervals resample paired cases and are unstable on tiny suites."
        : "No paired case overlap. Treat aggregate deltas as weak evidence until a paired run exists.",
  };
}

function benchmarkRunMetrics(results: BenchmarkCaseResultRow[]) {
  return {
    completedCases: results.filter((result) => result.status === "completed").length,
    failedCases: results.filter((result) => result.status === "failed").length,
    reviewCases: results.filter((result) => result.status === "needs_review").length,
    runningCases: results.filter((result) => result.status === "running").length,
    meanBrier: meanScore(results, "brier"),
    meanLog: meanScore(results, "log"),
    meanBaselineBrier: meanScore(results, "baseline_brier"),
    meanBrierDelta: meanScore(results, "baseline_delta_brier"),
  };
}

function pairedBenchmarkCaseDeltas(
  candidateResults: BenchmarkCaseResultRow[],
  baselineResults: BenchmarkCaseResultRow[],
  candidateCasesById: Map<string, BenchmarkCaseSplitRow>,
) {
  const baselineByCase = new Map(baselineResults.map((result) => [result.benchmarkCaseId, result]));
  const caseDeltas: PairedDeltaRow[] = [];
  for (const candidate of candidateResults) {
    const baseline = baselineByCase.get(candidate.benchmarkCaseId);
    if (!baseline) {
      continue;
    }
    const candidateBrier = scoreValue(candidate.scoreRows, "brier");
    const baselineBrier = scoreValue(baseline.scoreRows, "brier");
    const candidateLog = scoreValue(candidate.scoreRows, "log");
    const baselineLog = scoreValue(baseline.scoreRows, "log");
    if (candidateBrier === null && candidateLog === null) {
      continue;
    }
    caseDeltas.push({
      benchmarkCaseId: candidate.benchmarkCaseId,
      split: normalizeBenchmarkSplit(readCaseSplit(candidateCasesById.get(candidate.benchmarkCaseId))),
      candidateBenchmarkCaseResultId: candidate.id,
      baselineBenchmarkCaseResultId: baseline.id,
      candidateStatus: candidate.status,
      baselineStatus: baseline.status,
      candidateBrier,
      baselineBrier,
      brierDelta: diffNullable(candidateBrier, baselineBrier),
      candidateLog,
      baselineLog,
      logDelta: diffNullable(candidateLog, baselineLog),
      candidateTraceBundleUri: candidate.traceBundleUri,
      baselineTraceBundleUri: baseline.traceBundleUri,
    });
  }
  return {
    caseDeltas,
    pairedMeanBrierDelta: meanNumbers(caseDeltas.map((row) => row.brierDelta).filter((value): value is number => value !== null)),
    pairedMeanLogDelta: meanNumbers(caseDeltas.map((row) => row.logDelta).filter((value): value is number => value !== null)),
  };
}

function pairedBootstrapUncertainty(input: { caseDeltas: PairedDeltaRow[]; seedKey: string }) {
  return {
    method: "paired_case_bootstrap",
    samples: 1000,
    confidenceLevel: 0.95,
    brierDelta: bootstrapMeanInterval(metricDeltas(input.caseDeltas, "brierDelta"), {
      seedKey: `${input.seedKey}:brier`,
      samples: 1000,
      confidenceLevel: 0.95,
    }),
    logDelta: bootstrapMeanInterval(metricDeltas(input.caseDeltas, "logDelta"), {
      seedKey: `${input.seedKey}:log`,
      samples: 1000,
      confidenceLevel: 0.95,
    }),
    warning:
      input.caseDeltas.length < 10
        ? "Fewer than 10 paired cases. Treat intervals as debugging context, not a promotion gate."
        : null,
  };
}

function metricDeltas(rows: PairedDeltaRow[], key: PairedMetricDeltaKey) {
  return rows.map((row) => row[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function bootstrapMeanInterval(
  values: number[],
  input: {
    seedKey: string;
    samples: number;
    confidenceLevel: number;
  },
) {
  const mean = meanNumbers(values);
  if (values.length === 0 || mean === null) {
    return {
      pairedCaseCount: 0,
      mean: null,
      lower: null,
      upper: null,
      standardError: null,
    };
  }
  if (values.length === 1) {
    return {
      pairedCaseCount: 1,
      mean,
      lower: mean,
      upper: mean,
      standardError: 0,
    };
  }

  const sampleMeans: number[] = [];
  const rng = seededRandom(input.seedKey);
  for (let sampleIndex = 0; sampleIndex < input.samples; sampleIndex += 1) {
    let sum = 0;
    for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
      sum += values[Math.floor(rng() * values.length)] ?? 0;
    }
    sampleMeans.push(sum / values.length);
  }
  sampleMeans.sort((a, b) => a - b);
  const alpha = 1 - input.confidenceLevel;
  return {
    pairedCaseCount: values.length,
    mean,
    lower: quantile(sampleMeans, alpha / 2),
    upper: quantile(sampleMeans, 1 - alpha / 2),
    standardError: standardDeviation(sampleMeans),
  };
}

function comparisonRecommendation(input: {
  candidateRun: BenchmarkRunRow;
  candidateResults: BenchmarkCaseResultRow[];
  baselineComparisons: Array<ReturnType<typeof buildBaselineComparison>>;
}) {
  if (input.candidateRun.status === "running" || input.candidateRun.status === "queued") {
    return {
      status: "wait_for_completion",
      summary: "Candidate benchmark run is still active. Compare only after all cases reconcile.",
    };
  }
  if (input.baselineComparisons.length === 0) {
    return {
      status: "needs_baseline",
      summary: "No completed baseline run exists for this suite/eval mode. Run the current default workflow on the same suite before promotion.",
    };
  }
  const primaryComparison = selectPrimaryBaselineComparison(input.baselineComparisons);
  if (!primaryComparison) {
    return {
      status: "needs_paired_cases",
      summary: "Baselines exist but share no case IDs with the candidate. Run paired candidate/baseline suites before interpreting score differences.",
      primaryBaselineBenchmarkRunId: null,
    };
  }
  if (primaryComparison.pairedCaseCount < 10) {
    return {
      status: "needs_more_cases",
      summary: `Only ${primaryComparison.pairedCaseCount} paired case(s) are available against the primary baseline. Use this as debugging evidence, not a promotion gate.`,
      primaryBaselineBenchmarkRunId: primaryComparison.baselineBenchmarkRunId,
    };
  }
  if (primaryComparison.pairedHoldoutCaseCount < minimumPromotionHoldoutCases) {
    return {
      status: "needs_holdout_evidence",
      summary: `Only ${primaryComparison.pairedHoldoutCaseCount} paired held-out case(s) are available against the primary baseline. Run paired holdout cases before promotion review.`,
      primaryBaselineBenchmarkRunId: primaryComparison.baselineBenchmarkRunId,
    };
  }
  const brierInterval = primaryComparison.pairedUncertainty.brierDelta;
  if (
    typeof primaryComparison.pairedMeanBrierDelta === "number" &&
    typeof brierInterval.upper === "number" &&
    primaryComparison.pairedMeanBrierDelta < -0.01 &&
    brierInterval.upper < 0
  ) {
    return {
      status: "candidate_better",
      summary: `Candidate improved paired mean Brier by ${Math.abs(primaryComparison.pairedMeanBrierDelta).toFixed(4)} against the primary baseline and the 95% bootstrap interval stays below zero. Check trace/source regressions before promotion.`,
      primaryBaselineBenchmarkRunId: primaryComparison.baselineBenchmarkRunId,
    };
  }
  if (
    typeof primaryComparison.pairedMeanBrierDelta === "number" &&
    typeof brierInterval.lower === "number" &&
    primaryComparison.pairedMeanBrierDelta > 0.01 &&
    brierInterval.lower > 0
  ) {
    return {
      status: "candidate_worse",
      summary: `Candidate worsened paired mean Brier by ${primaryComparison.pairedMeanBrierDelta.toFixed(4)} against the primary baseline and the 95% bootstrap interval stays above zero. Reject or revise the workflow.`,
      primaryBaselineBenchmarkRunId: primaryComparison.baselineBenchmarkRunId,
    };
  }
  return {
    status: "indistinguishable",
    summary: "Candidate and primary baseline are too close or the bootstrap interval crosses zero. Add cases or inspect secondary trace/cost metrics.",
    primaryBaselineBenchmarkRunId: primaryComparison.baselineBenchmarkRunId,
  };
}

function selectPrimaryBaselineComparison<T extends {
  baselineBenchmarkRunId: string;
  pairedCaseCount: number;
  pairedHoldoutCaseCount: number;
  baselinePromotionState: string;
}>(comparisons: T[]) {
  return comparisons
    .filter((comparison) => comparison.pairedCaseCount > 0)
    .sort((left, right) =>
      right.pairedHoldoutCaseCount - left.pairedHoldoutCaseCount ||
      right.pairedCaseCount - left.pairedCaseCount ||
      promotionStateRank(right.baselinePromotionState) - promotionStateRank(left.baselinePromotionState) ||
      left.baselineBenchmarkRunId.localeCompare(right.baselineBenchmarkRunId),
    )[0] ?? null;
}

function promotionStateRank(state: string) {
  if (state === "promoted_for_local_default") {
    return 3;
  }
  if (state === "promoted_for_eval_only") {
    return 2;
  }
  if (state === "candidate") {
    return 1;
  }
  return 0;
}

function diffNullable(candidate: number | null, baseline: number | null) {
  return candidate === null || baseline === null ? null : candidate - baseline;
}

function meanNumbers(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function quantile(sortedValues: number[], q: number) {
  if (sortedValues.length === 0) {
    return null;
  }
  const boundedQ = Math.max(0, Math.min(1, q));
  const position = (sortedValues.length - 1) * boundedQ;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex] ?? sortedValues[0] ?? 0;
  const upper = sortedValues[upperIndex] ?? sortedValues[sortedValues.length - 1] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function standardDeviation(values: number[]) {
  if (values.length < 2) {
    return 0;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function seededRandom(seedKey: string) {
  const seedBytes = createHash("sha256").update(seedKey).digest();
  let state = seedBytes.readUInt32LE(0);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function workflowPathForEvalMode(evalMode: BenchmarkEvalMode) {
  return evalMode === "fixed_evidence" ? fixedEvidenceWorkflowPath : agenticPastcastingWorkflowPath;
}

async function loadBenchmarkSuiteForRun(db: Db, input: { suiteId: string; evalMode: BenchmarkEvalMode }) {
  const [suite] = await db.select().from(benchmarkSuites).where(eq(benchmarkSuites.id, input.suiteId)).limit(1);
  if (!suite) {
    throw new Error(`Benchmark suite not found: ${input.suiteId}`);
  }
  if (!suite.allowedEvalModes.includes(input.evalMode)) {
    throw new Error(`Benchmark suite ${suite.id} does not allow eval mode ${input.evalMode}.`);
  }
  return suite;
}

async function ensureSeedBenchmarkSuite(db: Db, evalMode: BenchmarkEvalMode) {
  const seedSuite = benchmarkSuitesByMode[evalMode];
  const seedCases = evalMode === "fixed_evidence" ? fixedEvidenceSeedCases : liveWebSmokeSeedCases;
  const [existing] = await db
    .select()
    .from(benchmarkSuites)
    .where(and(eq(benchmarkSuites.name, seedSuite.name), eq(benchmarkSuites.revision, seedSuite.revision)))
    .limit(1);

  const suite =
    existing ??
    (
      await db
        .insert(benchmarkSuites)
        .values(seedSuite)
        .returning()
    )[0];

  for (const seedCase of seedCases) {
    const [existingCase] = await db
      .select()
      .from(benchmarkCases)
      .where(and(eq(benchmarkCases.suiteId, suite.id), eq(benchmarkCases.externalId, seedCase.externalId)))
      .limit(1);
    if (!existingCase) {
      await db.insert(benchmarkCases).values({
        suiteId: suite.id,
        ...seedCase,
        lineageJson: {
          source: "local-seed",
          purpose: "benchmark-substrate-smoke",
        },
      });
    }
  }

  return suite;
}

function readDefaultMaxCases(policy: Record<string, unknown>) {
  const value = policy.defaultMaxCases;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function readDefaultRollouts(policy: Record<string, unknown>) {
  const value = policy.defaultRollouts;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : benchmarkSuitesByMode.fixed_evidence.caseSelectionPolicy.defaultRollouts;
}

function readCaseString(inputJson: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = inputJson[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return "";
}

async function ensureWorkflowVariant(db: Db, root: string, evalMode: BenchmarkEvalMode) {
  const workflowId = evalMode === "fixed_evidence" ? "fixed-evidence-eval" : "agentic-pastcasting-eval";
  const workflowPath = workflowPathForEvalMode(evalMode);
  const sourcePath = resolve(
    root,
    evalMode === "fixed_evidence"
      ? "packages/workflows/src/fixed-evidence-eval.workflow.tsx"
      : "packages/workflows/src/agentic-pastcasting-eval.workflow.tsx",
  );
  const source = await readFile(sourcePath, "utf8");
  const workflowSourceHash = createHash("sha256").update(source).digest("hex");
  const [existing] = await db
    .select()
    .from(workflowVariants)
    .where(and(eq(workflowVariants.workflowId, workflowId), eq(workflowVariants.workflowSourceHash, workflowSourceHash)))
    .limit(1);
  if (existing) {
    return existing;
  }

  const [variant] = await db
    .insert(workflowVariants)
    .values({
      workflowId,
      workflowSourceHash,
      promptVersions:
        evalMode === "fixed_evidence"
          ? {
              fixedEvidenceRollout: "inline-v0",
              aggregate: "static-mean-v0",
            }
          : {
              baseRate: "inline-v0",
              insideView: "inline-v0",
              skeptic: "inline-v0",
              aggregate: "static-mean-v0",
            },
      schemaVersions:
        evalMode === "fixed_evidence"
          ? {
              fixedEvidenceAttempt: "v0",
              fixedEvidenceAggregate: "v0",
            }
          : {
              binaryAttempt: "v0",
              binaryAggregate: "v0",
            },
      configJson: {
        workflowPath,
        evalMode,
        aggregation:
          evalMode === "fixed_evidence"
            ? "mean_fixed_evidence_rollouts_v0"
            : "mean_of_three_differentiated_forecasters_v0",
      },
    })
    .returning();
  return variant;
}

async function reconcileCaseResults(db: Db, input: {
  artifactsDir: string;
  root?: string;
  objectStorage?: ObjectStorageTarget;
}) {
  const runningResults = await db
    .select()
    .from(benchmarkCaseResults)
    .where(eq(benchmarkCaseResults.status, "running"));

  for (const result of runningResults) {
    if (!result.taskId) {
      continue;
    }
    const [task] = await db.select().from(tasks).where(eq(tasks.id, result.taskId)).limit(1);
    if (!task || task.status === "running" || task.status === "queued") {
      continue;
    }

    if (task.status === "failed") {
      await db
        .update(benchmarkCaseResults)
        .set({
          status: "failed",
          failureLabels: ["task_failed"],
          updatedAt: new Date(),
        })
        .where(eq(benchmarkCaseResults.id, result.id));
      continue;
    }

    if (task.status !== "completed" || !task.outputArtifactId) {
      continue;
    }

    const [row] = await db
      .select()
      .from(artifactRows)
      .where(eq(artifactRows.artifactId, task.outputArtifactId))
      .limit(1);
    const [benchmarkCase] = await db
      .select()
      .from(benchmarkCases)
      .where(eq(benchmarkCases.id, result.benchmarkCaseId))
      .limit(1);

    if (!row || !benchmarkCase) {
      continue;
    }

    const probability = readProbability(row.rowJson);
    const resolved = readResolved(benchmarkCase.hiddenResolutionJson);
    const baselineProbability = readBaselineProbability(benchmarkCase.inputJson);
    const failureLabels = [
      ...(probability === null ? ["missing_probability"] : []),
      ...(resolved === null ? ["missing_resolution"] : []),
      ...agenticAuditFailureLabels(row.rowJson, task.operationMode),
    ];
    const scoreRows = buildScoreRows({ probability, baselineProbability, resolved });
    const traceBundle = await exportTraceBundle(db, {
      taskId: task.id,
      artifactsDir: input.artifactsDir,
      root: input.root,
      objectStorage: input.objectStorage,
    });

    await db
      .update(benchmarkCaseResults)
      .set({
        status: failureLabels.length ? "needs_review" : "completed",
        forecastOutputArtifactId: task.outputArtifactId,
        scoreRows,
        traceBundleUri: traceBundle.storageUri,
        failureLabels,
        updatedAt: new Date(),
      })
      .where(eq(benchmarkCaseResults.id, result.id));
  }
}

async function backfillBenchmarkForecastScoreRows(db: Db) {
  const results = await db
    .select()
    .from(benchmarkCaseResults)
    .where(eq(benchmarkCaseResults.status, "completed"));

  for (const result of results) {
    if (!result.taskId || result.scoreRows.length === 0) {
      continue;
    }

    const [task] = await db.select().from(tasks).where(eq(tasks.id, result.taskId)).limit(1);
    const [benchmarkCase] = await db.select().from(benchmarkCases).where(eq(benchmarkCases.id, result.benchmarkCaseId)).limit(1);
    const resolved = readResolved(benchmarkCase?.hiddenResolutionJson ?? null);
    if (!task?.smithersRunId || !benchmarkCase || resolved === null) {
      continue;
    }

    const attempts = await db
      .select()
      .from(forecastAttempts)
      .where(eq(forecastAttempts.researchPassId, task.smithersRunId));
    const attemptIds = attempts.map((attempt) => attempt.id);
    if (attemptIds.length === 0) {
      continue;
    }

    const allAggregates = await db.select().from(forecastAggregates);
    const aggregates = allAggregates.filter((aggregate) =>
      aggregate.componentAttemptIds.some((attemptId) => attemptIds.includes(attemptId)),
    );
    const aggregateIds = aggregates.map((aggregate) => aggregate.id);

    const existingAttemptScores = await db
      .select({ id: forecastScores.id })
      .from(forecastScores)
      .where(inArray(forecastScores.forecastAttemptId, attemptIds));
    const existingAggregateScores = aggregateIds.length
      ? await db
          .select({ id: forecastScores.id })
          .from(forecastScores)
          .where(inArray(forecastScores.forecastAggregateId, aggregateIds))
      : [];
    if (existingAttemptScores.length || existingAggregateScores.length) {
      continue;
    }

    const [resolution] = await db
      .insert(forecastResolutions)
      .values({
        resolvedValue: {
          ...(benchmarkCase.hiddenResolutionJson ?? {}),
          resolved,
        },
        resolutionSource: `benchmark_import:${benchmarkCase.externalId}`,
        resolverTraceIds: [],
        annulled: false,
        resolvedAt: parseResolutionDate(benchmarkCase.hiddenResolutionJson),
      })
      .returning({ id: forecastResolutions.id });

    for (const aggregate of aggregates) {
      for (const scoreRow of result.scoreRows.filter((row) => row.scoreType === "brier" || row.scoreType === "log")) {
        if (typeof scoreRow.scoreValue !== "number") {
          continue;
        }
        await db.insert(forecastScores).values({
          forecastAggregateId: aggregate.id,
          resolutionId: resolution.id,
          scoreType: String(scoreRow.scoreType),
          scoreValue: scoreRow.scoreValue,
          scoreConfig: {
            source: "benchmark_case_result",
            benchmarkRunId: result.benchmarkRunId,
            benchmarkCaseId: result.benchmarkCaseId,
            benchmarkCaseResultId: result.id,
            probability: scoreRow.probability,
          },
        });
      }
    }

    for (const attempt of attempts) {
      const probability = readProbability(attempt.parsedPrediction);
      if (probability === null) {
        continue;
      }
      for (const [scoreType, scoreValue] of Object.entries(scoreBinaryForecast({ probability, resolved }))) {
        await db.insert(forecastScores).values({
          forecastAttemptId: attempt.id,
          resolutionId: resolution.id,
          scoreType,
          scoreValue,
          scoreConfig: {
            source: "benchmark_attempt_backfill",
            benchmarkRunId: result.benchmarkRunId,
            benchmarkCaseId: result.benchmarkCaseId,
            benchmarkCaseResultId: result.id,
            probability,
          },
        });
      }
    }
  }
}

async function finalizeReadyBenchmarkRuns(db: Db) {
  const activeRuns = await db
    .select()
    .from(benchmarkRuns)
    .where(eq(benchmarkRuns.status, "running"));

  for (const run of activeRuns) {
    const results = await db
      .select()
      .from(benchmarkCaseResults)
      .where(eq(benchmarkCaseResults.benchmarkRunId, run.id));
    if (results.length < run.caseCount) {
      continue;
    }
    if (results.some((result) => result.status === "running" || result.status === "queued")) {
      continue;
    }

    const meanBrier = meanScore(results, "brier");
    const meanLog = meanScore(results, "log");
    const meanBaselineBrier = meanScore(results, "baseline_brier");
    const meanBrierDelta = meanScore(results, "baseline_delta_brier");
    const completedCases = results.filter((result) => result.status === "completed").length;
    const failedCases = results.filter((result) => result.status === "failed").length;
    const reviewCases = results.filter((result) => result.status === "needs_review").length;
    const caseAnalyses = await buildBenchmarkCaseAnalyses(db, {
      benchmarkRunId: run.id,
      evalMode: run.evalMode,
      results,
    });
    const [suite] = await db.select().from(benchmarkSuites).where(eq(benchmarkSuites.id, run.suiteId)).limit(1);
    const splitFindings = benchmarkSplitSummaryForResults({
      results,
      casesById: splitRowsById(await loadBenchmarkCaseSplitRows(db, results)),
    });
    const isBtf2Suite = suite?.name.includes("BTF-2") === true;
    await persistCaseAnalysisArtifacts(db, {
      benchmarkRunId: run.id,
      caseAnalyses,
    });
    const report = {
      benchmarkRunId: run.id,
      caseCount: run.caseCount,
      completedCases,
      failedCases,
      reviewCases,
      meanBrier,
      meanLog,
      meanBaselineBrier,
      meanBrierDelta,
      splitFindings,
      generatedAt: new Date().toISOString(),
      caseAnalyses,
      caseResults: results.map((result) => ({
        benchmarkCaseResultId: result.id,
        benchmarkCaseId: result.benchmarkCaseId,
        taskId: result.taskId,
        status: result.status,
        scoreRows: result.scoreRows,
        traceBundleUri: result.traceBundleUri,
        failureLabels: result.failureLabels,
        analystNotesArtifactId: caseAnalyses.find((analysis) => analysis.benchmarkCaseResultId === result.id)?.analystNotesArtifactId ?? null,
      })),
    };

    const [scoreArtifact] = await db
      .insert(artifacts)
      .values({
        artifactType: "report",
        createdBy: "benchmark-runner",
        rowCount: 1,
        schemaJson: {
          type: "object",
          properties: {
            meanBrier: { type: ["number", "null"] },
            meanLog: { type: ["number", "null"] },
            meanBaselineBrier: { type: ["number", "null"] },
            meanBrierDelta: { type: ["number", "null"] },
          },
        },
        storageUri: `benchmarks/${run.id}/score-report.json`,
      })
      .returning({ id: artifacts.id });
    await db.insert(artifactRows).values({
      artifactId: scoreArtifact.id,
      rowIndex: 0,
      rowJson: report,
      status: "completed",
      completedAt: new Date(),
    });

    const summary = `Benchmark run completed ${completedCases}/${run.caseCount} cases. Mean Brier: ${formatMetric(meanBrier)}. Mean log score: ${formatMetric(meanLog)}.${meanBaselineBrier === null ? "" : ` Baseline Brier: ${formatMetric(meanBaselineBrier)}; delta: ${formatMetric(meanBrierDelta)}.`}`;
    const isFixedEvidence = run.evalMode === "fixed_evidence";
    const analysis = {
      summary,
      benchmarkRunId: run.id,
      generatedAt: new Date().toISOString(),
      strongestCases: strongestCaseIds(results, caseAnalyses),
      worstCases: worstCaseIds(results, caseAnalyses),
      failureClusters: clusterFailures(results, caseAnalyses),
      metricDeltas: {
        meanBrier,
        meanLog,
        meanBaselineBrier,
        meanBrierDelta,
        completedCases,
        failedCases,
        reviewCases,
      },
      traceQualityFindings: traceQualityFindingsForRun(results, caseAnalyses),
      sourceQualityFindings: sourceQualityFindingsForRun(results, caseAnalyses, isFixedEvidence),
      baselineSanityFindings: baselineSanityFindingsForRun(caseAnalyses),
      componentDisagreementFindings: componentDisagreementFindingsForRun(caseAnalyses),
      forecastErrorFindings: forecastErrorFindingsForRun(caseAnalyses),
      splitFindings,
      costLatencyFindings: {
        note: "V1 records Smithers run IDs, trace bundles, agent-call counts, and token totals parsed from durable Smithers logs.",
        runnableLoopSignal: "Use task_id, smithers_run_id, benchmark_run_id, and workflow_variant_id labels to correlate benchmark quality with runtime cost proxies.",
      },
      holdoutRiskNotes: isFixedEvidence
        ? isBtf2Suite
          ? "This is an imported BTF-2 fixed-evidence suite. Use it for local workflow iteration with the dataset contamination caveat; require larger paired subsets before promotion."
          : "This is a tiny local fixed-evidence smoke suite. It validates the judgment-only benchmark loop but is too small for promotion decisions."
        : "This seed suite is a weak live-web pastcasting smoke test. Do not use it as a quality benchmark or promotion gate.",
      caseAnalyses,
      workflowImprovementPlan: buildWorkflowImprovementPlan({
        evalMode: run.evalMode,
        caseAnalyses,
        meanBrierDelta,
      }),
    };

    const [analysisArtifact] = await db
      .insert(artifacts)
      .values({
        artifactType: "report",
        createdBy: "benchmark-runner",
        rowCount: 1,
        schemaJson: {
          type: "object",
          properties: {
            summary: { type: "string" },
          },
        },
        storageUri: `benchmarks/${run.id}/analysis-report.json`,
      })
      .returning({ id: artifacts.id });
    await db.insert(artifactRows).values({
      artifactId: analysisArtifact.id,
      rowIndex: 0,
      rowJson: analysis,
      status: "completed",
      completedAt: new Date(),
    });

    await db.insert(benchmarkAnalyses).values({
      benchmarkRunId: run.id,
      summary,
      strongestCases: analysis.strongestCases,
      worstCases: analysis.worstCases,
      failureClusters: analysis.failureClusters,
      metricDeltas: analysis.metricDeltas,
      traceQualityFindings: analysis.traceQualityFindings,
      sourceQualityFindings: analysis.sourceQualityFindings,
      costLatencyFindings: analysis.costLatencyFindings,
      holdoutRiskNotes: analysis.holdoutRiskNotes,
    });

    const proposals = workflowChangeProposalsForAnalysis({
      benchmarkRunId: run.id,
      evalMode: run.evalMode,
      results,
      caseAnalyses,
      meanBrierDelta,
    });
    if (proposals.length > 0) {
      await db.insert(workflowChangeProposals).values(proposals);
    }

    await db
      .update(benchmarkRuns)
      .set({
        status: failedCases || reviewCases ? "partial_failure" : "completed",
        scoreReportArtifactId: scoreArtifact.id,
        analysisReportArtifactId: analysisArtifact.id,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(benchmarkRuns.id, run.id));

    const validationGate = summarizeBenchmarkPromotionGateEvidence({
      runStatus: failedCases || reviewCases ? "partial_failure" : "completed",
      resultCount: results.length,
      traceMissing: results.filter((result) => !result.traceBundleUri).length,
      reviewOrFailed: failedCases + reviewCases,
      comparisonStatus: null,
      baselineSanityFindings: analysis.baselineSanityFindings,
      componentDisagreementFindings: analysis.componentDisagreementFindings,
      forecastErrorFindings: analysis.forecastErrorFindings,
      splitFindings,
      sourceQualityFindings: analysis.sourceQualityFindings,
      traceQualityFindings: analysis.traceQualityFindings,
    });
    await syncWorkflowProposalValidationEvidence(db, {
      benchmarkRunId: run.id,
      resultStatus: failedCases || reviewCases ? "needs_review" : "completed",
      resultSummary: summary,
      meanBrierDelta,
      completedCases,
      gateStatus: validationGate.status,
      gateBlockers: validationGate.blockers,
      completedAt: new Date(),
    });
  }
}

async function syncWorkflowProposalValidationEvidence(
  db: Db,
  input: {
    benchmarkRunId: string;
    resultStatus: string;
    resultSummary: string;
    meanBrierDelta: number | null;
    completedCases: number;
    gateStatus: string;
    gateBlockers: string[];
    completedAt: Date;
  },
) {
  await db
    .update(workflowChangeProposals)
    .set({
      validationResultStatus: input.resultStatus,
      validationResultSummary: input.resultSummary,
      validationMeanBrierDelta: input.meanBrierDelta,
      validationCompletedCases: input.completedCases,
      validationGateStatus: input.gateStatus,
      validationGateBlockers: input.gateBlockers,
      validationCompletedAt: input.completedAt,
      implementationStatus: input.resultStatus === "completed" ? "validated" : "in_progress",
      implementationNote:
        input.resultStatus === "completed"
          ? `Validation completed: ${input.resultSummary}`
          : `Validation needs review: ${input.resultSummary}`,
      implementationUpdatedAt: input.completedAt,
      updatedAt: new Date(),
    })
    .where(eq(workflowChangeProposals.validationBenchmarkRunId, input.benchmarkRunId));
}

type BenchmarkResultForAnalysis = {
  id: string;
  benchmarkRunId: string;
  benchmarkCaseId: string;
  taskId: string | null;
  smithersRunId: string | null;
  status: string;
  forecastOutputArtifactId: string | null;
  scoreRows: Array<Record<string, unknown>>;
  traceBundleUri: string | null;
  leakageFlags: string[];
  failureLabels: string[];
};

type BenchmarkCaseAnalysis = {
  benchmarkCaseResultId: string;
  benchmarkCaseId: string;
  externalId: string;
  taskId: string | null;
  status: string;
  question: string;
  resolutionCriteria: string;
  resolved: boolean | null;
  resolvedAt: string | null;
  probability: number | null;
  baselineProbability: number | null;
  metricSummary: Record<string, unknown>;
  failureLabels: string[];
  primaryFailureMode: string;
  diagnosis: string;
  whatOutputShouldHaveDone: string;
  workflowImplications: string[];
  nextDebugSteps: string[];
  qualityGates: Record<string, string>;
  sourceAudit: Record<string, unknown>;
  traceAudit: Record<string, unknown>;
  artifactPointers: Record<string, unknown>;
  analystNotesArtifactId: string | null;
};

async function buildBenchmarkCaseAnalyses(
  db: Db,
  input: {
    benchmarkRunId: string;
    evalMode: string;
    results: BenchmarkResultForAnalysis[];
  },
): Promise<BenchmarkCaseAnalysis[]> {
  const analyses: BenchmarkCaseAnalysis[] = [];

  for (const result of input.results) {
    const [benchmarkCase] = await db
      .select()
      .from(benchmarkCases)
      .where(eq(benchmarkCases.id, result.benchmarkCaseId))
      .limit(1);
    const [task] = result.taskId
      ? await db.select().from(tasks).where(eq(tasks.id, result.taskId)).limit(1)
      : [];
    const outputArtifactId = result.forecastOutputArtifactId ?? task?.outputArtifactId ?? null;
    const [outputRow] = outputArtifactId
      ? await db
          .select({ rowJson: artifactRows.rowJson })
          .from(artifactRows)
          .where(and(eq(artifactRows.artifactId, outputArtifactId), eq(artifactRows.rowIndex, 0)))
          .limit(1)
      : [];
    const sources = result.taskId
      ? await db
          .select({
            id: sourceBankEntries.id,
            url: sourceBankEntries.url,
            domain: sourceBankEntries.domain,
            title: sourceBankEntries.title,
            sourceType: sourceBankEntries.sourceType,
            contentSummary: sourceBankEntries.contentSummary,
            retrievedAt: sourceBankEntries.retrievedAt,
            publishedAt: sourceBankEntries.publishedAt,
            query: sourceBankEntries.query,
            usedInFinal: sourceBankEntries.usedInFinal,
            qualityScore: sourceBankEntries.qualityScore,
          })
          .from(sourceBankEntries)
          .where(eq(sourceBankEntries.taskId, result.taskId))
      : [];

    const inputJson = benchmarkCase?.inputJson ?? {};
    const output = outputRow?.rowJson ?? {};
    const cutoffDate = readString(inputJson, "cutoffDate", "cutoff_date") ?? readString(benchmarkCase?.cutoffMetadataJson ?? {}, "cutoff");
    const cutoff = parseOptionalDateForAnalysis(cutoffDate);
    const probability = readProbability(output);
    const resolved = readResolved(benchmarkCase?.hiddenResolutionJson ?? null);
    const resolvedAt = readString(benchmarkCase?.hiddenResolutionJson ?? {}, "resolvedAt", "resolved_at");
    const baselineProbability = readBaselineProbability(inputJson);
    const brier = scoreValue(result.scoreRows, "brier");
    const log = scoreValue(result.scoreRows, "log");
    const baselineBrier = scoreValue(result.scoreRows, "baseline_brier");
    const brierDelta = scoreValue(result.scoreRows, "baseline_delta_brier");
    const probabilityError =
      probability === null || resolved === null ? null : Math.abs(probability - (resolved ? 100 : 0));
    const outputAuditLabels =
      input.evalMode === "agentic_pastcasting_smoke"
        ? agenticAuditFailureLabels(output, "agentic_pastcasting_eval")
        : [];
    const failureLabels = uniqueStrings([
      ...result.failureLabels,
      ...result.leakageFlags,
      ...outputAuditLabels,
    ]);
    const sourceAudit = buildSourceAudit({
      sources,
      output,
      cutoff,
      isFixedEvidence: input.evalMode === "fixed_evidence",
      failureLabels,
    });
    const traceAudit = buildTraceAudit({
      result,
      output,
      sourceCount: sources.length,
    });
    const primaryFailureMode = classifyPrimaryFailure({
      status: result.status,
      failureLabels,
      probability,
      brier,
      brierDelta,
      sourceAudit,
      traceAudit,
    });
    const diagnosis = buildCaseDiagnosis({
      primaryFailureMode,
      status: result.status,
      probability,
      resolved,
      brier,
      brierDelta,
      sourceAudit,
      traceAudit,
    });
    const workflowImplications = workflowImplicationsForFailure(primaryFailureMode, input.evalMode);

    analyses.push({
      benchmarkCaseResultId: result.id,
      benchmarkCaseId: result.benchmarkCaseId,
      externalId: benchmarkCase?.externalId ?? result.benchmarkCaseId,
      taskId: result.taskId,
      status: result.status,
      question: readString(inputJson, "question", "prompt") ?? "",
      resolutionCriteria: readString(inputJson, "resolutionCriteria", "resolution_criteria") ?? "",
      resolved,
      resolvedAt: resolvedAt ?? null,
      probability,
      baselineProbability,
      metricSummary: {
        brier,
        log,
        baselineBrier,
        brierDelta,
        probabilityErrorPercentagePoints: probabilityError,
        scoreRows: result.scoreRows,
      },
      failureLabels,
      primaryFailureMode,
      diagnosis,
      whatOutputShouldHaveDone: expectedBetterOutput(primaryFailureMode, input.evalMode),
      workflowImplications,
      nextDebugSteps: nextDebugStepsForFailure(primaryFailureMode),
      qualityGates: qualityGatesForCase({
        result,
        output,
        probability,
        baselineProbability,
        sourceAudit,
        traceAudit,
      }),
      sourceAudit,
      traceAudit,
      artifactPointers: {
        forecastOutputArtifactId: outputArtifactId,
        traceBundleUri: result.traceBundleUri,
        smithersRunId: result.smithersRunId,
      },
      analystNotesArtifactId: null,
    });
  }

  return analyses;
}

async function persistCaseAnalysisArtifacts(
  db: Db,
  input: {
    benchmarkRunId: string;
    caseAnalyses: BenchmarkCaseAnalysis[];
  },
) {
  for (const caseAnalysis of input.caseAnalyses) {
    const parentArtifactIds = typeof caseAnalysis.artifactPointers.forecastOutputArtifactId === "string"
      ? [caseAnalysis.artifactPointers.forecastOutputArtifactId]
      : [];
    const [artifact] = await db
      .insert(artifacts)
      .values({
        taskId: caseAnalysis.taskId,
        artifactType: "report",
        createdBy: "benchmark-analyzer",
        rowCount: 1,
        parentArtifactIds,
        schemaJson: {
          type: "object",
          properties: {
            primaryFailureMode: { type: "string" },
            diagnosis: { type: "string" },
            whatOutputShouldHaveDone: { type: "string" },
          },
        },
        storageUri: `benchmarks/${input.benchmarkRunId}/cases/${caseAnalysis.benchmarkCaseResultId}/analysis.json`,
      })
      .returning({ id: artifacts.id });

    caseAnalysis.analystNotesArtifactId = artifact.id;
    await db.insert(artifactRows).values({
      artifactId: artifact.id,
      rowIndex: 0,
      rowJson: caseAnalysis,
      status: "completed",
      completedAt: new Date(),
    });
    await db
      .update(benchmarkCaseResults)
      .set({
        analystNotesArtifactId: artifact.id,
        updatedAt: new Date(),
      })
      .where(eq(benchmarkCaseResults.id, caseAnalysis.benchmarkCaseResultId));
  }
}

function buildSourceAudit(input: {
  sources: Array<{
    url: string | null;
    domain: string | null;
    title: string | null;
    sourceType: string;
    contentSummary: string;
    publishedAt: Date | null;
    usedInFinal: boolean;
  }>;
  output: Record<string, unknown>;
  cutoff: Date | null;
  isFixedEvidence: boolean;
  failureLabels: string[];
}) {
  const postCutoffSources = input.cutoff
    ? input.sources.filter((source) => source.publishedAt && source.publishedAt.getTime() > input.cutoff!.getTime())
    : [];
  const humanForecastSources = input.sources.filter((source) =>
    looksLikeHumanForecastSource(`${source.domain ?? ""} ${source.title ?? ""} ${source.sourceType} ${source.contentSummary}`),
  );
  const searchQueries = readStringArray(input.output, "searchQueries", "search_queries");
  const explicitProbabilityQuotes = readStringArray(input.output, "explicitProbabilityQuotes", "explicit_probability_quotes");
  const outputLeakageFlags = readStringArray(input.output, "leakageFlags", "leakage_flags");
  return {
    sourceCount: input.sources.length,
    usedInFinalCount: input.sources.filter((source) => source.usedInFinal).length,
    missingPublishedAtCount: input.sources.filter((source) => !source.publishedAt).length,
    postCutoffSourceCount: postCutoffSources.length,
    postCutoffSources: postCutoffSources.slice(0, 5).map((source) => ({
      title: source.title,
      url: source.url,
      publishedAt: source.publishedAt?.toISOString() ?? null,
    })),
    humanForecastSourceCount: humanForecastSources.length,
    humanForecastSources: humanForecastSources.slice(0, 5).map((source) => ({
      title: source.title,
      url: source.url,
      sourceType: source.sourceType,
    })),
    searchQueryCount: searchQueries.length,
    searchQueries,
    explicitProbabilityQuoteCount: explicitProbabilityQuotes.length,
    outputLeakageFlags,
    sourcePolicy: input.isFixedEvidence
      ? "fixed_evidence_packet_only"
      : readString(input.output, "cutoffPolicy", "cutoff_policy") ?? "agent_reported_live_web",
    sourceAuditStatus: input.isFixedEvidence
      ? "fixed_evidence_not_web"
      : input.failureLabels.includes("source_leakage") || postCutoffSources.length > 0
        ? "failed_cutoff_provenance"
        : humanForecastSources.length > 0 || explicitProbabilityQuotes.length > 0
          ? "failed_forecast_market_isolation"
          : input.sources.length === 0
            ? "weak_no_sources"
            : "pass_agent_reported",
  };
}

function buildTraceAudit(input: {
  result: BenchmarkResultForAnalysis;
  output: Record<string, unknown>;
  sourceCount: number;
}) {
  const traceCompletenessScore = readNumber(input.output, "traceCompletenessScore", "trace_completeness_score");
  const attemptCount = readNumber(input.output, "attemptCount", "attempt_count");
  const componentProbabilities = readAnyArray(input.output, "componentProbabilities", "component_probabilities");
  const componentProbabilityValues = componentProbabilities.flatMap((component) => {
    if (!component || typeof component !== "object" || Array.isArray(component)) {
      return [];
    }
    const probability = readNumber(component as Record<string, unknown>, "probability");
    return probability === null ? [] : [probability];
  });
  const componentProbabilitySpread = componentProbabilityValues.length >= 2
    ? Math.round((Math.max(...componentProbabilityValues) - Math.min(...componentProbabilityValues)) * 10) / 10
    : null;
  return {
    traceBundleWritten: Boolean(input.result.traceBundleUri),
    traceBundleUri: input.result.traceBundleUri,
    traceCompletenessScore,
    traceProvenance: readString(input.output, "traceProvenance", "trace_provenance"),
    attemptCount,
    componentProbabilityCount: componentProbabilities.length,
    componentProbabilitySpread,
    sourceCount: input.sourceCount,
    status:
      !input.result.traceBundleUri
        ? "missing_trace_bundle"
        : traceCompletenessScore !== null && traceCompletenessScore < 0.7
          ? "weak_trace_completeness"
          : "pass",
  };
}

function classifyPrimaryFailure(input: {
  status: string;
  failureLabels: string[];
  probability: number | null;
  brier: number | null;
  brierDelta: number | null;
  sourceAudit: Record<string, unknown>;
  traceAudit: Record<string, unknown>;
}) {
  if (input.status === "failed") {
    return "execution_failed";
  }
  if (input.probability === null || input.failureLabels.includes("missing_probability")) {
    return "schema_or_probability_missing";
  }
  if (input.failureLabels.includes("source_leakage") || input.sourceAudit.sourceAuditStatus === "failed_cutoff_provenance") {
    return "cutoff_leakage";
  }
  if (input.failureLabels.includes("information_advantage") || input.sourceAudit.sourceAuditStatus === "failed_forecast_market_isolation") {
    return "forecast_market_or_human_forecast_leakage";
  }
  if (input.failureLabels.includes("trace_incomplete") || input.traceAudit.status === "weak_trace_completeness") {
    return "trace_incomplete";
  }
  if (typeof input.brierDelta === "number" && input.brierDelta > 0.02) {
    return "worse_than_baseline";
  }
  if (typeof input.brier === "number" && input.brier > 0.16) {
    return "large_probability_miss";
  }
  if (input.status === "needs_review") {
    return "manual_review_required";
  }
  return "passed_smoke_gate";
}

function buildCaseDiagnosis(input: {
  primaryFailureMode: string;
  status: string;
  probability: number | null;
  resolved: boolean | null;
  brier: number | null;
  brierDelta: number | null;
  sourceAudit: Record<string, unknown>;
  traceAudit: Record<string, unknown>;
}) {
  if (input.primaryFailureMode === "execution_failed") {
    return "The workflow did not complete, so this case cannot inform forecast quality until the Smithers run and task reconciliation path are fixed.";
  }
  if (input.primaryFailureMode === "schema_or_probability_missing") {
    return "The run completed without a usable numeric probability. This is a schema adherence failure, not a forecasting miss.";
  }
  if (input.primaryFailureMode === "cutoff_leakage") {
    return `The case is not quality-scored as an ordinary forecast because source provenance indicates cutoff leakage (${String(input.sourceAudit.postCutoffSourceCount ?? 0)} post-cutoff source(s) or reported leakage flags).`;
  }
  if (input.primaryFailureMode === "forecast_market_or_human_forecast_leakage") {
    return "The agent appears to have consumed human forecast or market-style probability information. That makes the case an information-advantage audit failure rather than independent forecasting evidence.";
  }
  if (input.primaryFailureMode === "trace_incomplete") {
    return "The output was scoreable, but the trace/source metadata is too thin to explain how the forecast was produced or debug the miss.";
  }
  if (input.primaryFailureMode === "worse_than_baseline") {
    return `The forecast underperformed the local baseline on Brier score by ${formatMetric(input.brierDelta)}. Inspect whether the workflow overrode a strong base rate with weak inside-view evidence.`;
  }
  if (input.primaryFailureMode === "large_probability_miss") {
    return `The forecast was scoreable but far from the resolution (probability ${input.probability ?? "n/a"}%, resolved ${String(input.resolved)}). This points to judgment/calibration quality, not infrastructure.`;
  }
  if (input.primaryFailureMode === "manual_review_required") {
    return "The case reached a review state. Treat it as debug material until a human or stricter analyzer explains whether the failure is scoring, source quality, or judgment.";
  }
  return `The case passed the current smoke gate with Brier ${formatMetric(input.brier)}. This is infrastructure evidence only; the suite is too small for promotion.`;
}

function expectedBetterOutput(primaryFailureMode: string, evalMode: string) {
  if (primaryFailureMode === "execution_failed") {
    return "A completed forecast artifact, a trace bundle, source/citation rows when applicable, and score rows linked to the benchmark case.";
  }
  if (primaryFailureMode === "schema_or_probability_missing") {
    return "A schema-valid aggregate with forecastType=binary and probability as a finite 0-100 number, plus rationale and component probabilities.";
  }
  if (primaryFailureMode === "cutoff_leakage") {
    return "A forecast built only from evidence that would have been available at the cutoff, with every cited source carrying a publication date or a clear fixed-corpus provenance.";
  }
  if (primaryFailureMode === "forecast_market_or_human_forecast_leakage") {
    return "Primary factual evidence and independent reasoning only; no Metaculus, Manifold, prediction-market, bookmaker, analyst-probability, or quoted human forecast probabilities.";
  }
  if (primaryFailureMode === "trace_incomplete") {
    return "A replayable trace: search queries, pages read, source dates, source-use notes, component forecaster probabilities, aggregation rule, and failure/audit flags.";
  }
  if (primaryFailureMode === "worse_than_baseline" || primaryFailureMode === "large_probability_miss") {
    return evalMode === "fixed_evidence"
      ? "A forecast that explicitly starts from the evidence packet's base rate, weighs yes/no mechanisms, checks overconfidence, and compares against the provided baseline before finalizing."
      : "A forecast that separates base-rate, inside-view, and skeptical updates, then calibrates the aggregate against known track-record and baseline checks.";
  }
  return "The same durable output shape, but repeated across a larger, cleaner benchmark suite before drawing quality conclusions.";
}

function workflowImplicationsForFailure(primaryFailureMode: string, evalMode: string) {
  if (primaryFailureMode === "cutoff_leakage") {
    return [
      "Add a source-date gate before aggregation that fails or quarantines post-cutoff sources.",
      "Prefer fixed-corpus pastcasting over prompt-level live-web date bounding for quality benchmarks.",
      "Persist machine-observed source metadata, not only agent-reported cutoff compliance.",
    ];
  }
  if (primaryFailureMode === "forecast_market_or_human_forecast_leakage") {
    return [
      "Add a forbidden-domain/source-type checker for prediction markets and human forecast aggregators.",
      "Force the agent to separate primary evidence from human probability opinions.",
      "Mark information-advantage cases as audit failures, not ordinary forecast wins.",
    ];
  }
  if (primaryFailureMode === "trace_incomplete") {
    return [
      "Make trace completeness a hard benchmark gate.",
      "Require search query, page-read, source-date, and evidence-use fields in every attempt schema.",
      "Surface missing trace fields in the UI before accepting benchmark results.",
    ];
  }
  if (primaryFailureMode === "worse_than_baseline" || primaryFailureMode === "large_probability_miss") {
    return [
      "Add a baseline sanity-check reviewer before final aggregation.",
      "Track calibration buckets once enough resolved cases exist.",
      "Compare base-rate and inside-view deltas so workflow changes can be debugged.",
    ];
  }
  if (primaryFailureMode === "schema_or_probability_missing") {
    return [
      "Tighten Zod schema prompts and retry malformed aggregate outputs.",
      "Add a schema-conformance gate before scoring.",
    ];
  }
  if (primaryFailureMode === "execution_failed") {
    return [
      "Improve task reconciliation, Smithers status polling, and failure capture before judging forecast quality.",
    ];
  }
  return evalMode === "fixed_evidence"
    ? ["Expand fixed-evidence cases and add bootstrap intervals before workflow promotion."]
    : ["Keep live-web smoke as plumbing only; use fixed corpora for real quality comparison."];
}

function nextDebugStepsForFailure(primaryFailureMode: string) {
  if (primaryFailureMode === "cutoff_leakage") {
    return ["Open the trace bundle", "Inspect cited source dates", "Classify whether leakage changed the probability", "Re-run with a fixed corpus"];
  }
  if (primaryFailureMode === "forecast_market_or_human_forecast_leakage") {
    return ["Inspect source domains", "Remove market/human forecast evidence", "Re-run as independent factual research"];
  }
  if (primaryFailureMode === "trace_incomplete") {
    return ["Check aggregate output fields", "Check attempt outputs", "Patch the workflow schema/prompts to require missing trace fields"];
  }
  if (primaryFailureMode === "worse_than_baseline" || primaryFailureMode === "large_probability_miss") {
    return ["Compare component probabilities", "Review base-rate reasoning", "Write a better forecast postmortem", "Patch aggregation or calibration rules"];
  }
  if (primaryFailureMode === "schema_or_probability_missing") {
    return ["Inspect aggregate artifact row", "Patch schema prompt", "Add malformed-output retry"];
  }
  if (primaryFailureMode === "execution_failed") {
    return ["Inspect Smithers run log", "Inspect task error", "Re-run the case after fixing launch/reconciliation"];
  }
  return ["Add more cases", "Compare against a baseline run", "Avoid promotion until confidence intervals exist"];
}

function qualityGatesForCase(input: {
  result: BenchmarkResultForAnalysis;
  output: Record<string, unknown>;
  probability: number | null;
  baselineProbability: number | null;
  sourceAudit: Record<string, unknown>;
  traceAudit: Record<string, unknown>;
}) {
  return {
    schemaOutput: input.probability === null ? "fail_missing_probability" : "pass",
    scoring: input.result.scoreRows.length === 0 ? "fail_missing_score_rows" : "pass",
    traceBundle: input.traceAudit.traceBundleWritten ? "pass" : "fail_missing_trace_bundle",
    sourceProvenance: String(input.sourceAudit.sourceAuditStatus ?? "unknown"),
    baselineComparison: input.baselineProbability === null ? "warn_no_baseline" : "pass",
    baselineSanity: baselineSanityGate(input.output, input.baselineProbability),
    componentAgreement: componentAgreementGate(input.output, input.traceAudit),
    aggregateRationale: readString(input.output, "rationale") ? "pass" : "warn_missing_rationale",
  };
}

function baselineSanityGate(output: Record<string, unknown>, baselineProbability: number | null) {
  if (baselineProbability === null) {
    return "warn_no_baseline";
  }
  const baselineSanityCheck = readString(output, "baselineSanityCheck", "baseline_sanity_check");
  const baselineDelta = readNumber(output, "baselineDelta", "baseline_delta");
  const aggregationRule = readString(output, "aggregationRule", "aggregation_rule");
  const baseRateAnchor = readString(output, "baseRateAnchor", "base_rate_anchor");
  if (!baselineSanityCheck || baselineDelta === null || !aggregationRule || !baseRateAnchor) {
    return "warn_missing_baseline_sanity";
  }
  return "pass";
}

function componentAgreementGate(output: Record<string, unknown>, traceAudit: Record<string, unknown>) {
  const spread = typeof traceAudit.componentProbabilitySpread === "number" ? traceAudit.componentProbabilitySpread : null;
  if (spread === null) {
    return "warn_missing_components";
  }
  if (spread <= 25) {
    return "pass";
  }
  const unresolvedDisagreement = readString(output, "unresolvedDisagreement", "unresolved_disagreement");
  const rationale = readString(output, "rationale");
  if (!unresolvedDisagreement && !rationale?.toLowerCase().includes("disagree")) {
    return "warn_unexplained_component_disagreement";
  }
  return "pass_high_disagreement_explained";
}

function traceQualityFindingsForRun(
  results: Array<{ traceBundleUri: string | null }>,
  caseAnalyses: BenchmarkCaseAnalysis[],
) {
  const missingScoreRowsCases = caseAnalyses
    .filter((analysis) => analysis.qualityGates.scoring === "fail_missing_score_rows")
    .map((analysis) => analysis.benchmarkCaseId);
  const missingAggregateRationaleCases = caseAnalyses
    .filter((analysis) => analysis.qualityGates.aggregateRationale === "warn_missing_rationale")
    .map((analysis) => analysis.benchmarkCaseId);
  return {
    traceBundlesWritten: results.filter((result) => Boolean(result.traceBundleUri)).length,
    missingTraceBundles: results.filter((result) => !result.traceBundleUri).length,
    weakTraceCompletenessCases: caseAnalyses.filter((analysis) => analysis.primaryFailureMode === "trace_incomplete").length,
    missingProbabilityCases: caseAnalyses.filter((analysis) => analysis.primaryFailureMode === "schema_or_probability_missing").length,
    missingScoreRowsCases: missingScoreRowsCases.length,
    missingScoreRowsCaseIds: missingScoreRowsCases.slice(0, 10),
    missingAggregateRationaleCases: missingAggregateRationaleCases.length,
    missingAggregateRationaleCaseIds: missingAggregateRationaleCases.slice(0, 10),
    note: "Trace quality is evaluated from persisted task output, source-bank rows, benchmark score rows, and trace-bundle presence.",
  };
}

function sourceQualityFindingsForRun(
  results: Array<{ failureLabels: string[] }>,
  caseAnalyses: BenchmarkCaseAnalysis[],
  isFixedEvidence: boolean,
) {
  if (isFixedEvidence) {
    return {
      note: "Fixed-evidence eval intentionally removes live search. Source quality is represented by the frozen evidence packet, not cited web sources.",
      sourceLeakageCases: 0,
      informationAdvantageCases: 0,
      postCutoffSourceCases: 0,
    };
  }
  return {
    sourceLeakageCases: countLabel(results, "source_leakage"),
    informationAdvantageCases: countLabel(results, "information_advantage"),
    traceIncompleteCases: countLabel(results, "trace_incomplete"),
    postCutoffSourceCases: caseAnalyses.filter((analysis) => Number(analysis.sourceAudit.postCutoffSourceCount ?? 0) > 0).length,
    humanForecastSourceCases: caseAnalyses.filter((analysis) => Number(analysis.sourceAudit.humanForecastSourceCount ?? 0) > 0).length,
    noSourceCases: caseAnalyses.filter((analysis) => Number(analysis.sourceAudit.sourceCount ?? 0) === 0).length,
    note: "Agentic pastcasting v1 uses agent-reported source, cutoff, and trace metadata. Live-web date bounding is a weak eval condition and should not be compared to frozen-corpus scores.",
  };
}

function baselineSanityFindingsForRun(caseAnalyses: BenchmarkCaseAnalysis[]) {
  const baselineGateCounts = countBy(caseAnalyses.map((analysis) => analysis.qualityGates.baselineSanity ?? "unknown"));
  const missingCases = caseAnalyses
    .filter((analysis) => analysis.qualityGates.baselineSanity === "warn_missing_baseline_sanity")
    .map((analysis) => analysis.benchmarkCaseId);
  return {
    casesWithBaseline: caseAnalyses.filter((analysis) => analysis.baselineProbability !== null).length,
    missingBaselineSanityCases: missingCases.length,
    missingBaselineSanityCaseIds: missingCases.slice(0, 10),
    gateCounts: baselineGateCounts,
    note: "Fixed-evidence benchmark outputs should explain the provided baseline anchor, final delta, and aggregation rule so worse-than-baseline cases can be debugged from artifacts.",
  };
}

function componentDisagreementFindingsForRun(caseAnalyses: BenchmarkCaseAnalysis[]) {
  const highDisagreementCases = caseAnalyses.filter((analysis) => {
    const spread = analysis.traceAudit.componentProbabilitySpread;
    return typeof spread === "number" && spread > 25;
  });
  const unexplainedCases = caseAnalyses
    .filter((analysis) => analysis.qualityGates.componentAgreement === "warn_unexplained_component_disagreement")
    .map((analysis) => analysis.benchmarkCaseId);
  const spreads = caseAnalyses
    .map((analysis) => analysis.traceAudit.componentProbabilitySpread)
    .filter((spread): spread is number => typeof spread === "number" && Number.isFinite(spread));
  return {
    casesWithComponentSpread: spreads.length,
    highDisagreementCases: highDisagreementCases.length,
    unexplainedHighDisagreementCases: unexplainedCases.length,
    unexplainedHighDisagreementCaseIds: unexplainedCases.slice(0, 10),
    maxComponentProbabilitySpread: spreads.length ? Math.max(...spreads) : null,
    gateCounts: countBy(caseAnalyses.map((analysis) => analysis.qualityGates.componentAgreement ?? "unknown")),
    note: "Large component probability spread should be explicitly reconciled before treating an aggregate as stable forecast evidence.",
  };
}

function forecastErrorFindingsForRun(caseAnalyses: BenchmarkCaseAnalysis[]) {
  const probabilityErrors = caseAnalyses
    .map((analysis) => analysis.metricSummary.probabilityErrorPercentagePoints)
    .filter((error): error is number => typeof error === "number" && Number.isFinite(error));
  const largeMissCases = caseAnalyses
    .filter((analysis) => analysis.primaryFailureMode === "large_probability_miss")
    .map((analysis) => analysis.benchmarkCaseId);
  const worseThanBaselineCases = caseAnalyses
    .filter((analysis) => analysis.primaryFailureMode === "worse_than_baseline")
    .map((analysis) => analysis.benchmarkCaseId);
  const maxProbabilityError = probabilityErrors.length ? Math.max(...probabilityErrors) : null;
  const meanProbabilityError = probabilityErrors.length
    ? Math.round((probabilityErrors.reduce((sum, error) => sum + error, 0) / probabilityErrors.length) * 10) / 10
    : null;
  return {
    scoredCases: probabilityErrors.length,
    largeProbabilityMissCases: largeMissCases.length,
    largeProbabilityMissCaseIds: largeMissCases.slice(0, 10),
    worseThanBaselineCases: worseThanBaselineCases.length,
    worseThanBaselineCaseIds: worseThanBaselineCases.slice(0, 10),
    meanProbabilityError,
    maxProbabilityError,
    note: "Large probability misses and worse-than-baseline cases are judgment-quality signals; inspect base-rate movement, component disagreement, and calibration notes before changing defaults.",
  };
}

function buildWorkflowImprovementPlan(input: {
  evalMode: string;
  caseAnalyses: BenchmarkCaseAnalysis[];
  meanBrierDelta: number | null;
}) {
  const failureCounts = input.caseAnalyses.reduce<Record<string, number>>((counts, analysis) => {
    counts[analysis.primaryFailureMode] = (counts[analysis.primaryFailureMode] ?? 0) + 1;
    return counts;
  }, {});
  const priorities = workflowChangeProposalsForAnalysis({
    benchmarkRunId: "preview",
    evalMode: input.evalMode,
    results: [],
    caseAnalyses: input.caseAnalyses,
    meanBrierDelta: input.meanBrierDelta,
  }).map((proposal) => ({
    targetWorkflowId: proposal.targetWorkflowId,
    problemStatement: proposal.problemStatement,
    proposedChange: proposal.proposedChange,
    validationPlan: proposal.validationPlan,
  }));
  return {
    failureCounts,
    priorities,
    nextLoop: [
      "Run benchmark suite",
      "Inspect case analyses and trace bundles",
      "Patch workflow prompts/schemas/gates",
      "Rerun the same suite plus at least one holdout case",
      "Promote only if metrics improve without new source or trace failures",
    ],
    promotionGate:
      input.evalMode === "fixed_evidence"
        ? "Do not promote from this smoke suite alone; expand case count and add confidence intervals."
        : "Do not promote from live-web pastcasting smoke; use it only to debug end-to-end plumbing and audit metadata.",
  };
}

function workflowChangeProposalsForAnalysis(input: {
  benchmarkRunId: string;
  evalMode: string;
  results: Array<{ benchmarkCaseId: string }>;
  caseAnalyses: BenchmarkCaseAnalysis[];
  meanBrierDelta: number | null;
}) {
  const targetWorkflowId = input.evalMode === "fixed_evidence" ? "fixed-evidence-eval" : "agentic-pastcasting-eval";
  const allCaseIds = input.caseAnalyses.length
    ? input.caseAnalyses.map((analysis) => analysis.benchmarkCaseId)
    : input.results.map((result) => result.benchmarkCaseId);
  const proposals: Array<{
    sourceBenchmarkRunId: string;
    targetWorkflowId: string;
    problemStatement: string;
    evidenceCaseIds: string[];
    proposedChange: string;
    expectedMetricEffect: string;
    expectedCostLatencyEffect: string;
    overfitRisk: string;
    validationPlan: string;
  }> = [];
  const byMode = (mode: string) => input.caseAnalyses.filter((analysis) => analysis.primaryFailureMode === mode);

  const cutoffCases = [...byMode("cutoff_leakage"), ...byMode("forecast_market_or_human_forecast_leakage")];
  if (cutoffCases.length > 0) {
    proposals.push({
      sourceBenchmarkRunId: input.benchmarkRunId,
      targetWorkflowId,
      problemStatement: "Pastcasting cases can look accurate because the workflow sees post-cutoff facts or human forecast probabilities.",
      evidenceCaseIds: cutoffCases.map((analysis) => analysis.benchmarkCaseId),
      proposedChange: "Add a source-provenance gate before aggregation: reject post-cutoff sources, forbidden forecast-market domains, and quoted human probability forecasts; quarantine affected cases as audit failures.",
      expectedMetricEffect: "Reduces false benchmark wins and makes forecast scores represent independent judgment instead of information leakage.",
      expectedCostLatencyEffect: "Small extra deterministic validation cost; may require more re-runs when sources are rejected.",
      overfitRisk: "Low for provenance gates; medium if forbidden-domain rules are tuned only to the seed cases.",
      validationPlan: "Rerun live-web smoke and verify leaked cases become needs_review with explicit labels, then rerun fixed-corpus cases to compare forecast quality without leakage.",
    });
  }

  const traceCases = byMode("trace_incomplete");
  if (traceCases.length > 0) {
    proposals.push({
      sourceBenchmarkRunId: input.benchmarkRunId,
      targetWorkflowId,
      problemStatement: "Some benchmark outputs are scoreable but not replayable enough to explain why the forecast was made.",
      evidenceCaseIds: traceCases.map((analysis) => analysis.benchmarkCaseId),
      proposedChange: "Make trace completeness a benchmark gate requiring search queries, pages read, source dates, component probabilities, rationale, aggregation rule, and explicit audit flags.",
      expectedMetricEffect: "Improves debuggability and prevents optimizing blind score numbers without understanding failure causes.",
      expectedCostLatencyEffect: "Minimal runtime impact; modestly larger artifacts and UI payloads.",
      overfitRisk: "Low, because trace completeness is an infrastructure invariant.",
      validationPlan: "Rerun the benchmark and assert every case analysis reports pass for traceBundle, schemaOutput, scoring, and aggregateRationale.",
    });
  }

  const judgmentCases = [...byMode("worse_than_baseline"), ...byMode("large_probability_miss")];
  if (judgmentCases.length > 0 || (typeof input.meanBrierDelta === "number" && input.meanBrierDelta > 0)) {
    proposals.push({
      sourceBenchmarkRunId: input.benchmarkRunId,
      targetWorkflowId,
      problemStatement: "The workflow underperformed a simple baseline or made a large probability miss on scoreable cases.",
      evidenceCaseIds: judgmentCases.length ? judgmentCases.map((analysis) => analysis.benchmarkCaseId) : allCaseIds,
      proposedChange: "Add a baseline sanity reviewer and calibration notes before aggregation; require the final probability to explain base-rate, inside-view, skeptical, and baseline deltas.",
      expectedMetricEffect: "Should reduce avoidable overconfidence and make Brier deltas easier to attribute.",
      expectedCostLatencyEffect: "Adds one cheap review step per benchmark case or a deterministic aggregation check.",
      overfitRisk: "Medium until the suite has more cases and holdouts.",
      validationPlan: "Rerun fixed-evidence cases, compare Brier/log and baseline deltas, then test on holdout cases before changing defaults.",
    });
  }

  if (proposals.length === 0) {
    proposals.push({
      sourceBenchmarkRunId: input.benchmarkRunId,
      targetWorkflowId,
      problemStatement: "The smoke run did not reveal a specific workflow defect, but the suite is too small for quality claims.",
      evidenceCaseIds: allCaseIds,
      proposedChange: "Expand benchmark case coverage, add paired bootstrap intervals, calibration/refinement buckets, and holdout splits before workflow promotion.",
      expectedMetricEffect: "Turns the current infrastructure smoke into an iteration loop that can detect real quality changes.",
      expectedCostLatencyEffect: "Runtime grows roughly linearly with case count; fixed-evidence cases remain cheaper than live-web agentic pastcasting.",
      overfitRisk: "High until the benchmark has enough hidden/holdout diversity.",
      validationPlan: "Add at least several dozen fixed-corpus binary cases, run baseline and candidate workflows, and promote only with stable paired improvement and no source/trace gate regressions.",
    });
  }

  return proposals.slice(0, 4);
}

function readProbability(rowJson: Record<string, unknown>) {
  const value = rowJson.probability;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readResolved(hiddenResolution: Record<string, unknown> | null) {
  const value = hiddenResolution?.resolved;
  return typeof value === "boolean" ? value : null;
}

function readBaselineProbability(inputJson: Record<string, unknown>) {
  const value = inputJson.baselineProbability;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseResolutionDate(hiddenResolution: Record<string, unknown> | null) {
  const raw = hiddenResolution?.resolvedAt;
  if (typeof raw === "string") {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return new Date();
}

function buildScoreRows(input: {
  probability: number | null;
  baselineProbability: number | null;
  resolved: boolean | null;
}) {
  if (input.probability === null || input.resolved === null) {
    return [];
  }

  const scoreRows: Array<Record<string, unknown>> = Object.entries(scoreBinaryForecast({ probability: input.probability, resolved: input.resolved })).map(
    ([scoreType, scoreValue]) => ({
      scoreType,
      scoreValue,
      probability: input.probability,
      resolved: input.resolved,
      source: "open_superforecaster",
    }),
  );

  if (input.baselineProbability !== null) {
    const ownBrierRaw = scoreRows.find((row) => row.scoreType === "brier")?.scoreValue;
    const ownBrier = typeof ownBrierRaw === "number" ? ownBrierRaw : 0;
    const baselineScores = scoreBinaryForecast({
      probability: input.baselineProbability,
      resolved: input.resolved,
    });
    scoreRows.push(
      {
        scoreType: "baseline_brier",
        scoreValue: baselineScores.brier,
        probability: input.probability,
        baselineProbability: input.baselineProbability,
        resolved: input.resolved,
        source: "baseline",
      },
      {
        scoreType: "baseline_log",
        scoreValue: baselineScores.log,
        probability: input.probability,
        baselineProbability: input.baselineProbability,
        resolved: input.resolved,
        source: "baseline",
      },
      {
        scoreType: "baseline_delta_brier",
        scoreValue: ownBrier - baselineScores.brier,
        probability: input.probability,
        baselineProbability: input.baselineProbability,
        resolved: input.resolved,
        source: "comparison",
      },
    );
  }

  return scoreRows;
}

function meanScore(results: Array<{ scoreRows: Array<Record<string, unknown>> }>, scoreType: string) {
  const values = results
    .flatMap((result) => result.scoreRows)
    .filter((row) => row.scoreType === scoreType && typeof row.scoreValue === "number")
    .map((row) => row.scoreValue as number);
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMetric(value: number | null) {
  return value === null ? "n/a" : value.toFixed(4);
}

function strongestCaseIds(
  results: Array<{ benchmarkCaseId: string; scoreRows: Array<Record<string, unknown>> }>,
  caseAnalyses: BenchmarkCaseAnalysis[] = [],
) {
  const externalIdsByCaseId = new Map(caseAnalyses.map((analysis) => [analysis.benchmarkCaseId, analysis.externalId]));
  return [...results]
    .sort((left, right) => (caseBrier(left) ?? Number.POSITIVE_INFINITY) - (caseBrier(right) ?? Number.POSITIVE_INFINITY))
    .slice(0, 3)
    .map((result) => externalIdsByCaseId.get(result.benchmarkCaseId) ?? result.benchmarkCaseId);
}

function worstCaseIds(
  results: Array<{ benchmarkCaseId: string; scoreRows: Array<Record<string, unknown>> }>,
  caseAnalyses: BenchmarkCaseAnalysis[] = [],
) {
  const externalIdsByCaseId = new Map(caseAnalyses.map((analysis) => [analysis.benchmarkCaseId, analysis.externalId]));
  return [...results]
    .sort((left, right) => (caseBrier(right) ?? Number.NEGATIVE_INFINITY) - (caseBrier(left) ?? Number.NEGATIVE_INFINITY))
    .slice(0, 3)
    .map((result) => externalIdsByCaseId.get(result.benchmarkCaseId) ?? result.benchmarkCaseId);
}

function caseBrier(result: { scoreRows: Array<Record<string, unknown>> }) {
  const row = result.scoreRows.find((scoreRow) => scoreRow.scoreType === "brier");
  return typeof row?.scoreValue === "number" ? row.scoreValue : null;
}

function agenticAuditFailureLabels(rowJson: Record<string, unknown>, operationMode: string) {
  if (operationMode !== "agentic_pastcasting_eval") {
    return [];
  }
  const candidateLabels = readStringArray(rowJson, "failureModeCandidates", "failure_mode_candidates")
    .filter((label) => label !== "weak_live_web_cutoff");
  const leakageFlags = readStringArray(rowJson, "leakageFlags", "leakage_flags");
  const informationAdvantage = readString(rowJson, "informationAdvantage", "information_advantage");
  const traceCompletenessScore = readNumber(rowJson, "traceCompletenessScore", "trace_completeness_score");
  return uniqueStrings([
    ...candidateLabels,
    ...(leakageFlags.length ? ["source_leakage"] : []),
    ...(informationAdvantage === "market_used" || informationAdvantage === "market_visible" ? ["information_advantage"] : []),
    ...(traceCompletenessScore !== null && traceCompletenessScore < 0.7 ? ["trace_incomplete"] : []),
  ]);
}

function countLabel(results: Array<{ failureLabels: string[] }>, label: string) {
  return results.filter((result) => result.failureLabels.includes(label)).length;
}

function clusterFailures(
  results: Array<{ id: string; status: string; failureLabels: string[] }>,
  caseAnalyses: BenchmarkCaseAnalysis[] = [],
) {
  const analysesByResultId = new Map(caseAnalyses.map((analysis) => [analysis.benchmarkCaseResultId, analysis]));
  const clusters = new Map<string, { count: number; evidenceCaseIds: string[]; workflowImplications: string[] }>();
  for (const result of results) {
    const analysis = analysesByResultId.get(result.id);
    const labels = uniqueStrings([
      ...(result.status === "completed" ? [] : result.failureLabels),
      ...(analysis && analysis.primaryFailureMode !== "passed_smoke_gate" ? [analysis.primaryFailureMode] : []),
    ]);
    for (const label of labels) {
      const existing = clusters.get(label) ?? { count: 0, evidenceCaseIds: [], workflowImplications: [] };
      existing.count += 1;
      if (analysis) {
        existing.evidenceCaseIds.push(analysis.benchmarkCaseId);
        existing.workflowImplications.push(...analysis.workflowImplications);
      }
      clusters.set(label, existing);
    }
  }
  return [...clusters.entries()].map(([label, cluster]) => ({
    label,
    count: cluster.count,
    evidenceCaseIds: uniqueStrings(cluster.evidenceCaseIds),
    workflowImplications: uniqueStrings(cluster.workflowImplications).slice(0, 5),
  }));
}

function scoreValue(scoreRows: Array<Record<string, unknown>>, scoreType: string) {
  const row = scoreRows.find((scoreRow) => scoreRow.scoreType === scoreType);
  return typeof row?.scoreValue === "number" ? row.scoreValue : null;
}

async function readArtifactReportRow(db: Db, artifactId: string | null) {
  if (!artifactId) {
    return null;
  }
  const [row] = await db
    .select({ rowJson: artifactRows.rowJson })
    .from(artifactRows)
    .where(and(eq(artifactRows.artifactId, artifactId), eq(artifactRows.rowIndex, 0)))
    .limit(1);
  return row?.rowJson ?? null;
}

function summarizeHiddenResolution(hiddenResolution: Record<string, unknown> | null) {
  if (!hiddenResolution) {
    return null;
  }
  return {
    resolved: typeof hiddenResolution.resolved === "boolean" ? hiddenResolution.resolved : null,
    resolvedAt: typeof hiddenResolution.resolvedAt === "string" ? hiddenResolution.resolvedAt : null,
    note: typeof hiddenResolution.note === "string" ? hiddenResolution.note : null,
  };
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    if (value) {
      counts[value] = (counts[value] ?? 0) + 1;
    }
    return counts;
  }, {});
}

function benchmarkPromotionGateSummary(input: {
  run: BenchmarkRunRow;
  metrics: ReturnType<typeof benchmarkRunMetrics>;
  results: BenchmarkCaseResultRow[];
  comparison: Record<string, unknown> | null;
  analysisReport: Record<string, unknown> | null;
  splitFindings?: Record<string, unknown> | null;
}) {
  const traceMissing = input.results.filter((result) => !result.traceBundleUri).length;
  const reviewOrFailed = input.metrics.failedCases + input.metrics.reviewCases;
  return summarizeBenchmarkPromotionGateEvidence({
    runStatus: input.run.status,
    resultCount: input.results.length,
    traceMissing,
    reviewOrFailed,
    comparisonStatus: readComparisonRecommendationStatus(input.comparison),
    baselineSanityFindings: readRecord(input.analysisReport, "baselineSanityFindings", "baseline_sanity_findings"),
    componentDisagreementFindings: readRecord(input.analysisReport, "componentDisagreementFindings", "component_disagreement_findings"),
    forecastErrorFindings: readRecord(input.analysisReport, "forecastErrorFindings", "forecast_error_findings"),
    splitFindings: input.splitFindings ?? readRecord(input.analysisReport, "splitFindings", "split_findings"),
    sourceQualityFindings: readRecord(input.analysisReport, "sourceQualityFindings", "source_quality_findings"),
    traceQualityFindings: readRecord(input.analysisReport, "traceQualityFindings", "trace_quality_findings"),
  });
}

async function benchmarkPromotionGateForRun(db: Db, run: BenchmarkRunRow) {
  const results = await db
    .select()
    .from(benchmarkCaseResults)
    .where(eq(benchmarkCaseResults.benchmarkRunId, run.id));
  const [comparisonReport, analysisReport] = await Promise.all([
    readArtifactReportRow(db, run.comparisonReportArtifactId),
    readArtifactReportRow(db, run.analysisReportArtifactId),
  ]);
  return benchmarkPromotionGateSummary({
    run,
    metrics: benchmarkRunMetrics(results),
    results,
    comparison: comparisonReport,
    analysisReport,
    splitFindings: benchmarkSplitSummaryForResults({
      results,
      casesById: splitRowsById(await loadBenchmarkCaseSplitRows(db, results)),
    }),
  });
}

function readComparisonRecommendationStatus(comparison: Record<string, unknown> | null) {
  if (!comparison || typeof comparison !== "object" || Array.isArray(comparison)) {
    return null;
  }
  const recommendation = comparison.recommendation;
  if (!recommendation || typeof recommendation !== "object" || Array.isArray(recommendation)) {
    return null;
  }
  const recommendationRecord = recommendation as Record<string, unknown>;
  return typeof recommendationRecord.status === "string" ? recommendationRecord.status : null;
}

function parseOptionalDateForAnalysis(raw: string | null) {
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function looksLikeHumanForecastSource(value: string) {
  return /\b(metaculus|manifold|polymarket|kalshi|predictit|bookmaker|betting|prediction market|forecast market|probability forecast)\b/i.test(value);
}

function readAnyArray(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (Array.isArray(raw)) {
      return raw;
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
  }
  return [];
}

function readRecord(value: Record<string, unknown> | null, ...keys: string[]) {
  if (!value) {
    return null;
  }
  for (const key of keys) {
    const raw = value[key];
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
  }
  return null;
}

function readString(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "string") {
      return raw;
    }
  }
  return null;
}

function readNumber(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return null;
}

function readStringArray(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (Array.isArray(raw)) {
      return raw.filter((item): item is string => typeof item === "string");
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === "string");
        }
      } catch {
        continue;
      }
    }
  }
  return [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
