/** @jsxImportSource smithers-orchestrator */
import { createSmithers, Parallel, Sequence, Task } from "smithers-orchestrator";
import { z } from "zod";
import {
  formatForecastContextForPrompt,
  normalizeForecastInputRow,
} from "@open-superforecaster/workflow-contracts";
import { codexResearchAgent } from "./agents";
import { readForecastTiming } from "./forecast-timing";

const citedSource = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  publishedAt: z.string().optional(),
  claim: z.string(),
});

const thresholdProbability = z.object({
  threshold: z.string(),
  probability: z.number().min(0).max(100),
  rationale: z.string().default(""),
});

const thresholdedAttempt = z.object({
  forecasterLabel: z.string(),
  thresholdDirection: z.enum(["at_least", "at_most"]),
  units: z.string().optional(),
  probabilities: z.array(thresholdProbability),
  rationale: z.string(),
  monotonicityNotes: z.string(),
  keyUncertainties: z.array(z.string()).default([]),
  premortem: z.string().default(""),
  wildcards: z.array(z.string()).default([]),
  citedSources: z.array(citedSource).default([]),
});

const thresholdedAggregate = z.object({
  forecastType: z.literal("thresholded"),
  thresholdDirection: z.enum(["at_least", "at_most"]),
  thresholds: z.array(z.string()),
  thresholdSource: z.enum(["caller", "question_extracted", "invalid"]),
  validationWarnings: z.array(z.string()).default([]),
  units: z.string().optional(),
  probabilities: z.array(thresholdProbability),
  probabilityMap: z.record(z.string(), z.number()),
  method: z.string(),
  attemptCount: z.number().int(),
  monotonicityRepaired: z.boolean(),
  monotonicityNotes: z.string(),
  rationale: z.string(),
  componentCurves: z.array(z.object({
    forecasterLabel: z.string(),
    probabilities: z.array(thresholdProbability),
  })),
  citedSources: z.array(citedSource).default([]),
  evidenceAsOfDate: z.string().optional(),
});

const { Workflow, smithers, outputs } = createSmithers({
  thresholdedAttempt,
  thresholdedAggregate,
});

const forecasterBriefs = [
  {
    id: "base-rate",
    label: "base-rate forecaster",
    focus: "Build a reference class and estimate the ordered threshold curve from historical frequencies.",
  },
  {
    id: "inside-view",
    label: "inside-view forecaster",
    focus: "Estimate the threshold curve from concrete mechanisms, current evidence, capacity, incentives, and blockers.",
  },
  {
    id: "skeptic",
    label: "skeptical forecaster",
    focus: "Stress-test the curve for impossible jumps, resolution ambiguity, and overconfident thresholds.",
  },
];

export default smithers((ctx) => {
  const rawInput = (ctx.input ?? {}) as Record<string, unknown>;
  const forecastInput = normalizeForecastInputRow(rawInput);
  const question = forecastInput.question;
  const resolutionCriteria = forecastInput.resolutionCriteria ?? "Resolve according to the plain-language question.";
  const background = forecastInput.background ?? "";
  const structuredContext = formatForecastContextForPrompt(forecastInput);
  const timing = readForecastTiming(rawInput);
  const thresholdContract = normalizeThresholds(forecastInput.thresholds.map((threshold) => threshold.label), question);
  const thresholds = thresholdContract.thresholds;
  const thresholdDirection = forecastInput.thresholdDirection ?? normalizeDirection(undefined, question);
  const units = forecastInput.unit;
  const validationWarnings = thresholdContract.valid
    ? []
    : ["Thresholded forecasts require at least two explicit or clearly extractable thresholds. This run should be treated as invalid input, not a calibrated threshold curve."];
  const attemptIds = forecasterBriefs.map((brief) => `attempt-${brief.id}`);
  const attemptNeeds = Object.fromEntries(attemptIds.map((id) => [id, id]));
  const attempts = ctx.outputs.thresholdedAttempt ?? [];
  const componentCurves = attempts.map((attempt) => ({
    forecasterLabel: attempt.forecasterLabel,
    probabilities: alignCurve(attempt.probabilities ?? [], thresholds),
  }));
  const rawAggregate = thresholds.map((threshold) => ({
    threshold,
    probability: roundOne(median(componentCurves.map((curve) => probabilityForThreshold(curve.probabilities, threshold)))),
    rationale: `Median of ${componentCurves.length} forecaster estimates for ${threshold}.`,
  }));
  const repairedAggregate = repairMonotonic(rawAggregate, thresholdDirection);
  const monotonicityRepaired = rawAggregate.some((item, index) => item.probability !== repairedAggregate[index]?.probability);
  const probabilityMap = Object.fromEntries(repairedAggregate.map((item) => [item.threshold, item.probability]));
  const citedSources = attempts.flatMap((attempt) => attempt.citedSources ?? []);

  return (
    <Workflow name="thresholded-forecast">
      <Sequence>
        <Parallel maxConcurrency={3}>
          {forecasterBriefs.map((brief) => (
            <Task
              key={brief.id}
              id={`attempt-${brief.id}`}
              output={outputs.thresholdedAttempt}
              agent={codexResearchAgent}
            >
              {`You are the ${brief.label} for Open Superforecaster.

Question:
${question}

Resolution criteria:
${resolutionCriteria}

${structuredContext}

${timing.promptBlock}

Background:
${background || "No extra background provided."}

Threshold direction:
${thresholdDirection}

Units:
${units ?? "not specified"}

Thresholds, in caller-provided order. Preserve labels exactly:
${thresholds.length ? thresholds.map((threshold, index) => `${index + 1}. ${threshold}`).join("\n") : "No valid thresholds were provided or extractable."}

Focus:
${brief.focus}

Return one probability for every threshold label. If no valid thresholds are listed, return an empty probabilities array and explain the invalid input in rationale. For at_least, probabilities must be non-increasing as thresholds become stricter. For at_most, probabilities must be non-decreasing. Include a short rationale for each threshold plus overall rationale, monotonicity notes, uncertainties, premortem, wildcards, and cited sources when available. For cited sources, include publishedAt as an ISO date when the source date is known; omit it when unknown. Set forecasterLabel to "${brief.label}".`}
            </Task>
          ))}
        </Parallel>

        <Task id="aggregate" output={outputs.thresholdedAggregate} needs={attemptNeeds}>
          {{
            forecastType: "thresholded",
            thresholdDirection,
            thresholds,
            thresholdSource: thresholdContract.source,
            validationWarnings,
            units,
            probabilities: repairedAggregate,
            probabilityMap,
            method: thresholdContract.valid ? "explicit_threshold_curve_median_with_monotonic_repair_v1" : "invalid_threshold_configuration_v1",
            attemptCount: attempts.length,
            monotonicityRepaired,
            monotonicityNotes: monotonicityRepaired
              ? "Median curve violated monotonicity and was repaired by one-pass clipping in caller order."
              : "Median curve satisfied monotonicity in caller order.",
            componentCurves,
            citedSources,
            ...(timing.evidenceAsOfDate ? { evidenceAsOfDate: timing.evidenceAsOfDate } : {}),
            rationale:
              attempts.length === 0
                ? "No attempts were available; this fallback should only appear in graph rendering."
                : thresholdContract.valid
                  ? `Aggregated ${attempts.length} threshold curves by median per threshold, then enforced ${thresholdDirection} monotonicity.`
                  : "The threshold configuration was invalid, so this output is a validation artifact rather than a calibrated forecast.",
          }}
        </Task>
      </Sequence>
    </Workflow>
  );
});

function normalizeThresholds(rawThresholds: string[], question: string) {
  const callerThresholds = uniqueStrings(rawThresholds);
  if (callerThresholds.length >= 2) {
    return { thresholds: callerThresholds.slice(0, 50), source: "caller" as const, valid: true };
  }
  const numericMatches = [...question.matchAll(/(?:[$€£]\s*)?\b\d+(?:\.\d+)?\s*(?:k|m|b|bn|million|billion|trillion|%|percent|launches|users|usd|dollars)?\b/gi)]
    .map((match) => match[0].trim())
    .filter((value, index, values) => values.indexOf(value) === index);
  if (numericMatches.length >= 2) {
    return { thresholds: numericMatches.slice(0, 50), source: "question_extracted" as const, valid: true };
  }
  const years = [...question.matchAll(/\b20\d{2}\b/g)].map((match) => match[0]);
  if (years.length >= 2) {
    return { thresholds: [...new Set(years)].slice(0, 50), source: "question_extracted" as const, valid: true };
  }
  return { thresholds: callerThresholds.slice(0, 50), source: "invalid" as const, valid: false };
}

function normalizeDirection(raw: unknown, question: string): "at_least" | "at_most" {
  const value = String(raw ?? "").trim();
  if (value === "at_most") {
    return "at_most";
  }
  if (/\b(at most|no more than|under|below|before)\b/i.test(question)) {
    return "at_most";
  }
  return "at_least";
}

function alignCurve(curve: Array<z.infer<typeof thresholdProbability>>, thresholds: string[]) {
  return thresholds.map((threshold) => {
    const match = curve.find((item) => item.threshold === threshold);
    return {
      threshold,
      probability: match?.probability ?? 50,
      rationale: match?.rationale ?? "Missing threshold estimate filled with neutral fallback.",
    };
  });
}

function probabilityForThreshold(curve: Array<z.infer<typeof thresholdProbability>>, threshold: string) {
  return curve.find((item) => item.threshold === threshold)?.probability ?? 50;
}

function repairMonotonic(curve: Array<z.infer<typeof thresholdProbability>>, direction: "at_least" | "at_most") {
  const repaired = curve.map((item) => ({ ...item }));
  for (let index = 1; index < repaired.length; index += 1) {
    const previous = repaired[index - 1];
    const current = repaired[index];
    if (direction === "at_least" && current.probability > previous.probability) {
      current.probability = previous.probability;
    }
    if (direction === "at_most" && current.probability < previous.probability) {
      current.probability = previous.probability;
    }
  }
  return repaired;
}

function median(values: number[]) {
  if (values.length === 0) {
    return 50;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
