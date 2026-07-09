/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import { codexStructuredAgent } from "./agents";

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  claim: z.string(),
});

const fixedEvidenceAttempt = z.object({
  forecasterLabel: z.string(),
  probability: z.number().min(0).max(100),
  rationale: z.string(),
  baseRateInference: z.string(),
  evidenceFor: z.array(z.string()).default([]),
  evidenceAgainst: z.array(z.string()).default([]),
  uncertainty: z.string(),
  strongestYes: z.string(),
  strongestNo: z.string(),
  keyUncertainties: z.array(z.string()).default([]),
  premortem: z.string().default(""),
  wildcards: z.array(z.string()).default([]),
  evidenceUsageNotes: z.string(),
  overconfidenceFlags: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const fixedEvidenceAggregate = z.object({
  forecastType: z.literal("binary"),
  probability: z.number().min(0).max(100),
  baselineProbability: z.number().min(0).max(100).nullable(),
  baselineDelta: z.number().nullable(),
  baselineSanityCheck: z.string(),
  baseRateAnchor: z.string(),
  insideViewDelta: z.string(),
  skepticalAdjustment: z.string(),
  aggregationRule: z.string(),
  method: z.string(),
  attemptCount: z.number().int(),
  rationale: z.string(),
  evidenceUsageNotes: z.string(),
  overconfidenceFlags: z.array(z.string()).default([]),
  componentProbabilities: z.array(z.object({
    forecasterLabel: z.string(),
    probability: z.number(),
  })),
  citedSources: z.array(citedSource).default([]),
});

const { Workflow, smithers, outputs } = createSmithers({
  fixedEvidenceAttempt,
  fixedEvidenceAggregate,
});

export default smithers((ctx) => {
  const input = (ctx.input ?? {}) as {
    question?: unknown;
    resolutionCriteria?: unknown;
    background?: unknown;
    fixedEvidence?: unknown;
    baselineProbability?: unknown;
    presentDate?: unknown;
    cutoffDate?: unknown;
    rollouts?: unknown;
  };
  const question = String(input.question ?? "");
  const resolutionCriteria = String(input.resolutionCriteria ?? "Resolve according to the plain-language question.");
  const background = String(input.background ?? "");
  const fixedEvidence = String(input.fixedEvidence ?? "");
  const baselineProbability = readProbability(input.baselineProbability);
  const presentDate = String(input.presentDate ?? "unspecified");
  const cutoffDate = String(input.cutoffDate ?? "unspecified");
  const rolloutCount = clampRollouts(input.rollouts);
  const rolloutIds = Array.from({ length: rolloutCount }, (_, index) => `rollout-${index + 1}`);
  const rolloutNeeds = Object.fromEntries(rolloutIds.map((id) => [id, id]));
  const attempts = ctx.outputs.fixedEvidenceAttempt ?? [];
  const componentProbabilities = attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    probability: attempt.probability,
  }));
  const probability = attempts.length
    ? Math.round(mean(attempts.map((attempt) => attempt.probability)) * 10) / 10
    : 50;
  const baselineDelta = baselineProbability === null ? null : Math.round((probability - baselineProbability) * 10) / 10;
  const citedSources = attempts.flatMap((attempt) => attempt.citedSources ?? []);
  const overconfidenceFlags = uniqueStrings(attempts.flatMap((attempt) => attempt.overconfidenceFlags ?? []));

  return (
    <Workflow name="fixed-evidence-eval">
      <Sequence>
        <Parallel maxConcurrency={Math.min(rolloutCount, 5)}>
          {rolloutIds.map((rolloutId, index) => (
            <Task
              key={rolloutId}
              id={rolloutId}
              output={outputs.fixedEvidenceAttempt}
              agent={codexStructuredAgent}
            >
              {`You are fixed-evidence rollout ${index + 1} for Open Superforecaster.

This is a benchmark judgment task. You must use only the fixed evidence packet below.
Do not use web search, file reads, shell commands, browser tools, memory, or any external information.
Assume the present date is ${presentDate} and no information after the cutoff date ${cutoffDate} is available.
The resolution is intentionally hidden. Do not infer from benchmark metadata.

Question:
${question}

Resolution criteria:
${resolutionCriteria}

Background:
${background || "No extra background provided."}

Baseline probability:
${baselineProbability === null ? "No numeric baseline was provided." : `${baselineProbability}%`}

Fixed evidence packet:
${fixedEvidence || "No fixed evidence provided. State this as a major limitation."}

Return a binary probability from 0 to 100. Explain how the fixed evidence moves you from a base rate to the final probability. If a baseline probability is provided, explicitly explain whether and why your final answer should move above, below, or stay near that baseline. Set forecasterLabel to "${rolloutId}".`}
            </Task>
          ))}
        </Parallel>

        <Task id="aggregate" output={outputs.fixedEvidenceAggregate} needs={rolloutNeeds}>
          {{
            forecastType: "binary",
            probability,
            baselineProbability,
            baselineDelta,
            baselineSanityCheck:
              baselineProbability === null
                ? "No baseline probability was provided with this benchmark case."
                : `Aggregate is ${formatSigned(baselineDelta ?? 0)} points from the provided baseline; inspect rollout rationales before treating that movement as forecast skill.`,
            baseRateAnchor: summarizeAttemptField(attempts, "baseRateInference", "No rollout base-rate inference was available."),
            insideViewDelta:
              baselineProbability === null
                ? "No baseline delta can be computed without a provided baseline probability."
                : `Mean rollout probability moved ${formatSigned(baselineDelta ?? 0)} points from the provided baseline.`,
            skepticalAdjustment: summarizeFlags(overconfidenceFlags),
            aggregationRule: "Unweighted mean of fixed-evidence rollout probabilities; no rollout is allowed to use information outside the fixed evidence packet.",
            method: "mean_fixed_evidence_rollouts_v0",
            attemptCount: attempts.length,
            componentProbabilities,
            citedSources,
            overconfidenceFlags,
            evidenceUsageNotes:
              attempts.length === 0
                ? "No rollout attempts were available; this fallback should only appear in graph rendering."
                : `Averaged ${attempts.length} fixed-evidence rollout probabilities. Evidence packet was fixed and resolution-hidden.`,
            rationale:
              attempts.length === 0
                ? "No attempts were available; this fallback should only appear in graph rendering."
                : `Judgment-only fixed-evidence aggregate using ${attempts.length} independent rollouts. Mean probability is ${probability}%.`,
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});

function clampRollouts(raw: unknown) {
  const numeric = Number(raw ?? 5);
  if (!Number.isFinite(numeric)) {
    return 5;
  }
  return Math.max(1, Math.min(8, Math.round(numeric)));
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function readProbability(raw: unknown) {
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${Math.round(value * 10) / 10}`;
}

function summarizeAttemptField<T extends { [key: string]: unknown }>(attempts: T[], key: keyof T, fallback: string) {
  const values = uniqueStrings(attempts.map((attempt) => String(attempt[key] ?? "").trim()));
  if (values.length === 0) {
    return fallback;
  }
  return values.slice(0, 3).join(" | ");
}

function summarizeFlags(flags: string[]) {
  return flags.length
    ? `Rollouts reported overconfidence flags: ${flags.slice(0, 5).join("; ")}.`
    : "No rollout overconfidence flags were reported.";
}
