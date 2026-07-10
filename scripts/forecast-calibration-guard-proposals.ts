import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  readForecastBatchIndexArtifacts,
  type ForecastBatchIndexArtifact,
  type ForecastBatchIndexCandidateCalibrationGuardRule,
} from "../packages/backend/src/forecast-batch-index-artifacts";
import {
  normalizeForecastAttentionReviewStatus,
  summarizeForecastAttentionReviewStatuses,
  type ForecastAttentionReviewStatus,
} from "../packages/backend/src/forecast-attention-policy";
import {
  isCalibrationGuardReadyForReview,
  normalizeCalibrationGuardActivationStatus,
  type CalibrationGuardActivationStatus,
} from "../packages/backend/src/calibration-guard-activation-policy";
import {
  hasArg,
  readArgValue,
  writeJson,
} from "./lib/forecast-script-utils";

type ReviewStatus = ForecastAttentionReviewStatus;

type CandidateCalibrationGuardRule = {
  id: string;
  reviewStatus: ReviewStatus;
  reviewNote: string | null;
  reviewer: string | null;
  reviewedAt: string | null;
  bucketLabel: string;
  direction: string;
  suggestedAdjustment: number | null;
  sampleSize: number | null;
  meanForecast: number | null;
  observedRate: number | null;
  calibrationError: number | null;
  activationStatus: CalibrationGuardActivationStatus;
  rationale: string;
};

type CalibrationGuardProposal = {
  id: string;
  sourceBatchId: string;
  sourceCandidateGuardId: string;
  targetWorkflowId: "binary-calibration-guard";
  status: "draft";
  problemStatement: string;
  evidenceRuleIds: string[];
  proposedChange: string;
  expectedMetricEffect: string;
  expectedCostLatencyEffect: string;
  overfitRisk: string;
  validationPlan: string;
  reviewStatus: ReviewStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  calibrationEvidence: {
    bucketLabel: string;
    direction: string;
    suggestedAdjustment: number | null;
    sampleSize: number | null;
    meanForecast: number | null;
    observedRate: number | null;
    calibrationError: number | null;
    activationStatus: CalibrationGuardActivationStatus;
    rationale: string;
  };
};

type ProposalReport = {
  reportType: "forecast_calibration_guard_proposals";
  generatedAt: string;
  batchId: string | null;
  summary: {
    candidateCalibrationGuardRules: number;
    eligibleCandidateCalibrationGuardRules: number;
    proposalDrafts: number;
    skippedOpen: number;
    skippedDeferred: number;
    skippedNeedsMoreResolvedForecasts: number;
  };
  proposalDrafts: CalibrationGuardProposal[];
  paths: {
    json: string;
    markdown: string;
    batchIndex: string | null;
    batchIndexDir: string | null;
  };
};

const root = resolve(import.meta.dir, "..");
const args = Bun.argv.slice(2);
const requestedBatchId = readArgValue(args, "--batch-id") ?? null;
const batchIndexPathArg = readArgValue(args, "--batch-index");
const batchIndexDirArg = readArgValue(args, "--batch-index-dir") ?? "data/reports/forecast-batches";
const batchIndexDir = batchIndexPathArg ? null : resolve(root, batchIndexDirArg);
const outputDir = resolve(root, readArgValue(args, "--out-dir") ?? "data/reports/forecast-calibration-guard-proposals");
const includeOpen = hasArg(args, "--include-open");
const jsonPath = resolve(outputDir, "calibration-guard-proposals.json");
const markdownPath = resolve(outputDir, "calibration-guard-proposals.md");

const selected = batchIndexPathArg
  ? await readExplicitBatchIndex(resolve(root, batchIndexPathArg), requestedBatchId)
  : await selectBatchIndex(batchIndexDir ?? "", requestedBatchId);
const report = selected
  ? buildProposalReport(selected, batchIndexDir, jsonPath, markdownPath, includeOpen)
  : buildEmptyReport(requestedBatchId, batchIndexDir, jsonPath, markdownPath);

await mkdir(outputDir, { recursive: true });
await writeJson(jsonPath, report);
await writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(`Calibration guard proposal drafts: ${report.summary.proposalDrafts}`);
console.log(`Batch: ${report.batchId ?? "none"}`);
console.log(`Output: ${jsonPath}`);

async function readExplicitBatchIndex(path: string, batchId: string | null) {
  const artifacts = await readForecastBatchIndexArtifacts(root, { reportRoot: path });
  const artifact = artifacts[artifacts.length - 1] ?? null;
  if (!artifact || (batchId && artifact.batchId !== batchId)) {
    return null;
  }
  return artifact;
}

async function selectBatchIndex(batchRoot: string, batchId: string | null) {
  const candidates = (await readForecastBatchIndexArtifacts(root, { reportRoot: batchRoot }))
    .filter((artifact) => !batchId || artifact.batchId === batchId);
  candidates.sort((left, right) =>
    timestampValue(right.generatedAt) - timestampValue(left.generatedAt)
    || right.batchId.localeCompare(left.batchId)
    || right.reportPath.localeCompare(left.reportPath)
  );
  return candidates[0] ?? null;
}

function buildProposalReport(
  batchIndex: ForecastBatchIndexArtifact,
  sourceDir: string | null,
  jsonOutputPath: string,
  markdownOutputPath: string,
  includeOpenRules: boolean,
): ProposalReport {
  const batchId = batchIndex.batchId;
  const candidateRules = batchIndex.candidateCalibrationGuardRules.flatMap(readCandidateRule);
  const reviewCounts = summarizeForecastAttentionReviewStatuses(candidateRules);
  const eligibleRules = candidateRules.filter((rule) => isEligibleCandidateRule(rule, includeOpenRules));
  const proposalDrafts = eligibleRules.map((rule) => buildProposal(batchId, rule));
  return {
    reportType: "forecast_calibration_guard_proposals",
    generatedAt: new Date().toISOString(),
    batchId,
    summary: {
      candidateCalibrationGuardRules: candidateRules.length,
      eligibleCandidateCalibrationGuardRules: eligibleRules.length,
      proposalDrafts: proposalDrafts.length,
      skippedOpen: includeOpenRules ? 0 : reviewCounts.open,
      skippedDeferred: reviewCounts.deferred,
      skippedNeedsMoreResolvedForecasts: candidateRules.filter((rule) => !isCalibrationGuardReadyForReview(rule.activationStatus)).length,
    },
    proposalDrafts,
    paths: {
      json: jsonOutputPath,
      markdown: markdownOutputPath,
      batchIndex: batchIndex.reportPath,
      batchIndexDir: sourceDir,
    },
  };
}

function buildEmptyReport(
  batchId: string | null,
  sourceDir: string | null,
  jsonOutputPath: string,
  markdownOutputPath: string,
): ProposalReport {
  return {
    reportType: "forecast_calibration_guard_proposals",
    generatedAt: new Date().toISOString(),
    batchId,
    summary: {
      candidateCalibrationGuardRules: 0,
      eligibleCandidateCalibrationGuardRules: 0,
      proposalDrafts: 0,
      skippedOpen: 0,
      skippedDeferred: 0,
      skippedNeedsMoreResolvedForecasts: 0,
    },
    proposalDrafts: [],
    paths: {
      json: jsonOutputPath,
      markdown: markdownOutputPath,
      batchIndex: null,
      batchIndexDir: sourceDir,
    },
  };
}

function buildProposal(batchId: string, rule: CandidateCalibrationGuardRule): CalibrationGuardProposal {
  const adjustment = formatSignedNumber(rule.suggestedAdjustment);
  const forecast = formatPercent(rule.meanForecast);
  const observed = formatPercent(rule.observedRate);
  const error = formatPercent(rule.calibrationError);
  return {
    id: `calibration-guard-proposal:${batchId}:${rule.id}`,
    sourceBatchId: batchId,
    sourceCandidateGuardId: rule.id,
    targetWorkflowId: "binary-calibration-guard",
    status: "draft",
    problemStatement:
      `${rule.bucketLabel} binary forecasts show ${rule.direction} calibration drift: mean forecast ${forecast}, observed rate ${observed}, absolute calibration error ${error}.`,
    evidenceRuleIds: [rule.id],
    proposedChange:
      `Add or update a binary calibration guard for the ${rule.bucketLabel} bucket with a ${adjustment} percentage-point adjustment, gated behind this candidate's resolved-sample evidence.`,
    expectedMetricEffect:
      "Should reduce bucket-level calibration error and Brier loss when the same drift appears in future resolved binary forecasts.",
    expectedCostLatencyEffect:
      "No model-call cost and negligible latency; the change is a deterministic post-aggregation adjustment.",
    overfitRisk:
      "Medium until validated on later resolved forecasts or a holdout batch, because bucket adjustments can chase sparse or time-local drift.",
    validationPlan:
      "Replay the latest resolved binary forecast batch with and without the candidate guard, compare bucket calibration error and Brier score, then require a later holdout batch before enabling as a default guard.",
    reviewStatus: rule.reviewStatus,
    reviewNote: rule.reviewNote,
    reviewedBy: rule.reviewer,
    reviewedAt: rule.reviewedAt,
    calibrationEvidence: {
      bucketLabel: rule.bucketLabel,
      direction: rule.direction,
      suggestedAdjustment: rule.suggestedAdjustment,
      sampleSize: rule.sampleSize,
      meanForecast: rule.meanForecast,
      observedRate: rule.observedRate,
      calibrationError: rule.calibrationError,
      activationStatus: rule.activationStatus,
      rationale: rule.rationale,
    },
  };
}

function renderMarkdown(report: ProposalReport) {
  const lines = [
    "# Calibration Guard Proposal Drafts",
    "",
    `Generated: ${report.generatedAt}`,
    `Batch: ${report.batchId ?? "none"}`,
    "",
    "## Summary",
    "",
    `- Candidate calibration guard rules: ${report.summary.candidateCalibrationGuardRules}`,
    `- Eligible candidate calibration guard rules: ${report.summary.eligibleCandidateCalibrationGuardRules}`,
    `- Proposal drafts: ${report.summary.proposalDrafts}`,
    `- Skipped open: ${report.summary.skippedOpen}`,
    `- Skipped deferred: ${report.summary.skippedDeferred}`,
    `- Skipped needing more resolved forecasts: ${report.summary.skippedNeedsMoreResolvedForecasts}`,
    "",
    "## Proposal Drafts",
    "",
    ...renderProposalTable(report.proposalDrafts),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function renderProposalTable(proposals: CalibrationGuardProposal[]) {
  if (proposals.length === 0) {
    return ["No calibration guard proposal drafts found."];
  }
  return [
    "| ID | Bucket | Adjustment | Evidence | Proposed change | Validation plan |",
    "| --- | --- | ---: | --- | --- | --- |",
    ...proposals.map((proposal) =>
      `| ${escapeMarkdownCell(proposal.id)} | ${escapeMarkdownCell(proposal.calibrationEvidence.bucketLabel)} | ${
        formatSignedNumber(proposal.calibrationEvidence.suggestedAdjustment)
      } | ${escapeMarkdownCell(proposal.problemStatement)} | ${escapeMarkdownCell(proposal.proposedChange)} | ${
        escapeMarkdownCell(proposal.validationPlan)
      } |`,
    ),
  ];
}

function isEligibleCandidateRule(rule: CandidateCalibrationGuardRule, includeOpenRules: boolean) {
  if (!isCalibrationGuardReadyForReview(rule.activationStatus)) {
    return false;
  }
  if (rule.reviewStatus === "deferred") {
    return false;
  }
  return includeOpenRules ? rule.reviewStatus === "open" || rule.reviewStatus === "reviewed" : rule.reviewStatus === "reviewed";
}

function readCandidateRule(rule: ForecastBatchIndexCandidateCalibrationGuardRule): CandidateCalibrationGuardRule[] {
  const id = rule.id;
  if (!id) {
    return [];
  }
  const reviewStatus = normalizeForecastAttentionReviewStatus(rule.reviewStatus);
  return [{
    id,
    reviewStatus,
    reviewNote: rule.reviewNote,
    reviewer: rule.reviewer,
    reviewedAt: rule.reviewedAt,
    bucketLabel: rule.bucketLabel ?? "bucket",
    direction: rule.direction ?? "calibration_drift",
    suggestedAdjustment: rule.suggestedAdjustment,
    sampleSize: rule.sampleSize,
    meanForecast: rule.meanForecast,
    observedRate: rule.observedRate,
    calibrationError: rule.calibrationError,
    activationStatus: normalizeCalibrationGuardActivationStatus(rule.activationStatus),
    rationale: rule.rationale ?? "",
  }];
}

function timestampValue(value: string | null) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function formatPercent(value: number | null) {
  return value === null ? "unknown" : `${formatNumber(value)}%`;
}

function formatSignedNumber(value: number | null) {
  if (value === null) {
    return "unknown";
  }
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function formatNumber(value: number) {
  return String(Math.round(value * 10_000) / 10_000);
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
