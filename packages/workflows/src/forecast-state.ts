import { z } from "zod";
import { binaryEnsembleSchema, buildBinaryEnsemble } from "./forecast-aggregation";
import {
  buildEvidenceWorkspace,
  evidenceWorkspaceSchema,
  mergeEvidenceWorkspaces,
  type EvidenceAttempt,
  type EvidenceWorkspace,
  type EvidenceWorkspaceBudget,
  type ObservedEvidenceEvent,
} from "./forecast-evidence-workspace";
import {
  buildForecastIndependenceDiagnostics,
  forecastIndependenceDiagnosticsSchema,
} from "./forecast-independence";
import type { ResearchTreatment } from "./forecast-research-dossier";

const nullableTemporal = z.string().nullable();
export const MAX_ACTIVE_MEMORY_FACTORS = 64;
export const MAX_UNRESOLVED_INFORMATION_NEEDS = 32;
export const MAX_FORECAST_TRIGGER_CONDITIONS = 32;

export const forecastStateSchema = z.object({
  version: z.literal("forecast-state-v1"),
  stateId: z.string(),
  question: z.object({
    question: z.string().min(1),
    resolutionCriteria: z.string().min(1),
    resolutionDate: nullableTemporal,
    condition: z.string().nullable(),
    background: z.string().nullable(),
  }),
  temporal: z.object({
    forecastAsOf: nullableTemporal,
    evidenceAsOf: nullableTemporal,
    cutoffDate: nullableTemporal,
    trustState: z.enum(["complete", "partial", "inconsistent"]),
    warnings: z.array(z.string()),
  }),
  research: evidenceWorkspaceSchema,
  judgment: z.object({
    components: z.array(z.object({
      roleId: z.string(),
      forecasterLabel: z.string(),
      probability: z.number().min(0).max(100),
      baseRateProbability: z.number().min(0).max(100).nullable(),
      insideViewProbability: z.number().min(0).max(100).nullable(),
      probabilityLow: z.number().min(0).max(100).nullable(),
      probabilityHigh: z.number().min(0).max(100).nullable(),
    })).min(1),
    referenceClasses: z.array(z.string()),
    pathways: z.array(z.object({
      direction: z.enum(["yes", "no"]),
      description: z.string(),
      reportedBy: z.string(),
    })),
    ensemble: binaryEnsembleSchema,
    independence: forecastIndependenceDiagnosticsSchema,
    modelAggregateCandidate: z.object({
      probability: z.number().min(0).max(100),
      method: z.string(),
      status: z.literal("experimental_candidate"),
    }).nullable(),
  }),
  outputs: z.object({
    autonomous: z.object({
      rawProbability: z.number().min(0).max(100),
      selectedProbability: z.number().min(0).max(100),
      aggregationMethod: z.string(),
      informationIsolation: z.object({
        status: z.enum([
          "isolated",
          "possible_human_forecast_exposure",
          "possible_information_leakage",
        ]),
        forbiddenSourceIds: z.array(z.string()),
        flags: z.array(z.string()),
        redactedInputFlags: z.array(z.string()),
      }),
      calibration: z.object({
        status: z.enum(["not_applied", "applied", "rejected"]),
        modelId: z.string().nullable(),
        calibratedProbability: z.number().min(0).max(100).nullable(),
        reason: z.string(),
      }),
    }),
    crowdAssisted: z.object({
      probability: z.number().min(0).max(100),
      method: z.string(),
      marketProbability: z.number().min(0).max(100),
      marketPriceAsOf: nullableTemporal,
      status: z.literal("experimental_candidate"),
    }).nullable(),
  }),
  update: z.object({
    kind: z.enum(["initial", "scheduled", "event_triggered", "manual"]),
    reason: z.string(),
    previousStateId: z.string().nullable(),
    previousProbability: z.number().min(0).max(100).nullable(),
    probabilityDelta: z.number().min(-100).max(100).nullable(),
    newEvidenceClaimIds: z.array(z.string()),
    invalidatedEvidenceClaimIds: z.array(z.string()),
    nextScheduledUpdate: nullableTemporal,
    triggerConditions: z.array(z.string()),
  }),
  memory: z.object({
    scope: z.literal("question_local"),
    activeFactors: z.array(z.object({
      description: z.string(),
      sourceClaimIds: z.array(z.string()),
    })).max(MAX_ACTIVE_MEMORY_FACTORS),
    unresolvedInformationNeeds: z.array(z.string()).max(MAX_UNRESOLVED_INFORMATION_NEEDS),
    transcriptStored: z.literal(false),
  }),
  provenance: z.object({
    workflowVersion: z.string(),
    aggregatorVersion: z.string(),
    calibratorVersion: z.string().nullable(),
    dossierVersion: z.string(),
    schedulerVersion: z.string().nullable(),
    componentProviderIds: z.array(z.string()),
  }),
});

export type ForecastState = z.infer<typeof forecastStateSchema>;

export type ForecastStateAttempt = EvidenceAttempt & {
  roleId?: string;
  forecasterLabel?: string;
  probability: number;
  baseRateProbability?: number;
  insideViewProbability?: number;
  probabilityRange?: { low: number; high: number };
  referenceClass?: string;
  strongestYes?: string;
  strongestNo?: string;
  providerId?: string;
};

export type ValidatedCalibrationCandidate = {
  modelId: string;
  calibratedProbability: number;
  trainingWindowEnd: string;
  validatedOutOfTime: boolean;
};

export type PreviousForecastSnapshot = {
  stateId: string;
  probability: number;
  evidenceClaimIds: string[];
  research?: EvidenceWorkspace;
};

export type BuildForecastStateInput = {
  question: string;
  resolutionCriteria?: string;
  resolutionDate?: string;
  condition?: string;
  background?: string;
  forecastAsOf?: string;
  evidenceAsOf?: string;
  cutoffDate?: string;
  attempts: ForecastStateAttempt[];
  /** Research-only evidence records may be included without turning them into judges. */
  evidenceAttempts?: EvidenceAttempt[];
  reportedSearchQueries?: string[];
  researchTreatment?: ResearchTreatment;
  harnessObservedSearchPathCount?: number;
  informationAdvantageFlags?: string[];
  redactedInformationAdvantageFlags?: string[];
  modelAggregateCandidate?: { probability: number; method: string };
  market?: { probability: number; asOf?: string };
  observedEvidenceEvents?: ObservedEvidenceEvent[];
  evidenceBudget?: EvidenceWorkspaceBudget;
  effectiveForecasterCount?: number;
  priorPseudoCount?: number;
  calibration?: ValidatedCalibrationCandidate;
  previous?: PreviousForecastSnapshot;
  update?: {
    kind?: "initial" | "scheduled" | "event_triggered" | "manual";
    reason?: string;
    invalidatedEvidenceClaimIds?: string[];
    nextScheduledUpdate?: string;
    triggerConditions?: string[];
  };
  provenance?: {
    workflowVersion?: string;
    dossierVersion?: string;
    schedulerVersion?: string;
    componentProviderIds?: string[];
  };
};

/**
 * Materialize the forecasting process as a typed snapshot. This is intentionally
 * deterministic: repeated construction from the same inputs yields the same state ID.
 */
export function buildForecastState(input: BuildForecastStateInput): ForecastState {
  if (!input.question.trim()) {
    throw new Error("ForecastState requires a non-empty question.");
  }
  const components = input.attempts.map((attempt, index) => ({
    roleId: clean(attempt.roleId) ?? `component-${index + 1}`,
    forecasterLabel: clean(attempt.forecasterLabel) ?? clean(attempt.roleId) ?? `component-${index + 1}`,
    probability: assertProbability(attempt.probability),
    baseRateProbability: optionalProbability(attempt.baseRateProbability),
    insideViewProbability: optionalProbability(attempt.insideViewProbability),
    probabilityLow: optionalProbability(attempt.probabilityRange?.low),
    probabilityHigh: optionalProbability(attempt.probabilityRange?.high),
  }));
  if (components.length === 0) {
    throw new Error("ForecastState requires at least one component forecast.");
  }

  const invalidatedEvidenceClaimIds = uniqueStrings(input.update?.invalidatedEvidenceClaimIds ?? []).sort();
  const currentEvidenceWorkspace = buildEvidenceWorkspace({
    attempts: input.evidenceAttempts ?? input.attempts,
    ...(input.evidenceAsOf ? { evidenceAsOf: input.evidenceAsOf } : {}),
    ...(input.cutoffDate ? { cutoffDate: input.cutoffDate } : {}),
    ...(input.observedEvidenceEvents ? { observedEvents: input.observedEvidenceEvents } : {}),
    ...(input.reportedSearchQueries ? { reportedSearchQueries: input.reportedSearchQueries } : {}),
    ...(input.evidenceBudget ? { budget: input.evidenceBudget } : {}),
  });
  const evidenceWorkspace = mergeEvidenceWorkspaces({
    previous: input.previous?.research,
    current: currentEvidenceWorkspace,
    invalidatedClaimIds: invalidatedEvidenceClaimIds,
  });
  const baseRates = components
    .map((component) => component.baseRateProbability)
    .filter((probability): probability is number => probability !== null);
  const priorProbability = baseRates.length ? median(baseRates) : undefined;
  const ensemble = buildBinaryEnsemble(
    components.map((component) => component.probability),
    {
      ...(priorProbability === undefined ? {} : { priorProbability }),
      ...(input.effectiveForecasterCount === undefined
        ? {}
        : { effectiveForecasterCount: input.effectiveForecasterCount }),
      ...(input.priorPseudoCount === undefined ? {} : { priorPseudoCount: input.priorPseudoCount }),
      ...(input.market ? { marketProbability: input.market.probability } : {}),
    },
  );
  const independence = buildForecastIndependenceDiagnostics({
    attempts: input.attempts,
    ...(input.researchTreatment ? { researchTreatment: input.researchTreatment } : {}),
    ...(input.harnessObservedSearchPathCount === undefined
      ? {}
      : { harnessObservedSearchPathCount: input.harnessObservedSearchPathCount }),
  });
  const temporal = evaluateTemporalTrust(input);
  const calibration = selectCalibration(
    ensemble.autonomous.probability,
    input.forecastAsOf,
    input.calibration,
  );
  const selectedProbability = calibration.status === "applied"
    ? calibration.calibratedProbability as number
    : ensemble.autonomous.probability;
  const forbiddenSourceIds = evidenceWorkspace.sources
    .filter((source) => {
      const linkedClaimText = evidenceWorkspace.claims
        .filter((claim) => claim.sourceIds.includes(source.id))
        .map((claim) => claim.text)
        .join(" ");
      return isHumanForecastSource([
        source.url,
        source.title,
        source.sourceType,
        linkedClaimText,
      ].filter(Boolean).join(" "));
    })
    .map((source) => source.id)
    .sort();
  const informationAdvantageFlags = uniqueStrings([
    ...(input.informationAdvantageFlags ?? []),
    ...forbiddenSourceIds.map((sourceId) => `forbidden_human_forecast_source:${sourceId}`),
    ...evidenceWorkspace.integrityFlags.filter((flag) =>
      flag.startsWith("post_cutoff_source:") || flag.startsWith("source_after_evidence_as_of:")),
  ]);
  const currentClaimIds = new Set(evidenceWorkspace.claims.map((claim) => claim.id));
  const previousClaimIds = new Set(input.previous?.evidenceClaimIds ?? []);
  const newEvidenceClaimIds = [...currentClaimIds]
    .filter((claimId) => !previousClaimIds.has(claimId))
    .sort();
  const previousProbability = input.previous?.probability ?? null;

  const stateWithoutId = {
    version: "forecast-state-v1" as const,
    question: {
      question: input.question.trim(),
      resolutionCriteria: clean(input.resolutionCriteria) ?? "Resolve according to the plain-language question.",
      resolutionDate: clean(input.resolutionDate),
      condition: clean(input.condition),
      background: clean(input.background),
    },
    temporal,
    research: evidenceWorkspace,
    judgment: {
      components,
      referenceClasses: uniqueStrings(input.attempts.map((attempt) => attempt.referenceClass ?? "")),
      pathways: buildPathways(input.attempts),
      ensemble,
      independence,
      modelAggregateCandidate: input.modelAggregateCandidate
        ? {
          probability: assertProbability(input.modelAggregateCandidate.probability),
          method: input.modelAggregateCandidate.method,
          status: "experimental_candidate" as const,
        }
        : null,
    },
    outputs: {
      autonomous: {
        rawProbability: ensemble.autonomous.probability,
        selectedProbability,
        aggregationMethod: ensemble.autonomous.method,
        informationIsolation: {
          status: informationAdvantageFlags.length
            ? informationAdvantageFlags.some(isHumanForecastExposureFlag)
              ? "possible_human_forecast_exposure" as const
              : "possible_information_leakage" as const
            : "isolated" as const,
          forbiddenSourceIds,
          flags: informationAdvantageFlags,
          redactedInputFlags: uniqueStrings(input.redactedInformationAdvantageFlags ?? []),
        },
        calibration,
      },
      crowdAssisted: ensemble.crowdAssisted && input.market
        ? {
          probability: ensemble.crowdAssisted.probability,
          method: ensemble.crowdAssisted.method,
          marketProbability: input.market.probability,
          marketPriceAsOf: clean(input.market.asOf),
          status: "experimental_candidate" as const,
        }
        : null,
    },
    update: {
      kind: input.previous ? input.update?.kind ?? "manual" as const : "initial" as const,
      reason: clean(input.update?.reason) ?? (input.previous ? "Forecast snapshot updated." : "Initial forecast snapshot."),
      previousStateId: input.previous?.stateId ?? null,
      previousProbability,
      probabilityDelta: previousProbability === null
        ? null
        : roundProbability(selectedProbability - previousProbability),
      newEvidenceClaimIds,
      invalidatedEvidenceClaimIds,
      nextScheduledUpdate: clean(input.update?.nextScheduledUpdate),
      triggerConditions: uniqueStrings(
        input.update?.triggerConditions ?? evidenceWorkspace.remainingInformationNeeds,
      ).slice(0, MAX_FORECAST_TRIGGER_CONDITIONS),
    },
    memory: {
      scope: "question_local" as const,
      activeFactors: evidenceWorkspace.claims
        .filter((claim) => claim.stance !== "context")
        .map((claim) => ({ description: claim.text, sourceClaimIds: [claim.id] }))
        .slice(0, MAX_ACTIVE_MEMORY_FACTORS),
      unresolvedInformationNeeds: evidenceWorkspace.remainingInformationNeeds
        .slice(0, MAX_UNRESOLVED_INFORMATION_NEEDS),
      transcriptStored: false as const,
    },
    provenance: {
      workflowVersion: clean(input.provenance?.workflowVersion) ?? "binary-forecast-stateful-v1",
      aggregatorVersion: ensemble.controls.version,
      calibratorVersion: calibration.status === "applied" ? calibration.modelId : null,
      dossierVersion: clean(input.provenance?.dossierVersion) ?? evidenceWorkspace.version,
      schedulerVersion: clean(input.provenance?.schedulerVersion),
      componentProviderIds: uniqueStrings([
        ...(input.provenance?.componentProviderIds ?? []),
        ...input.attempts.map((attempt) => attempt.providerId ?? ""),
      ]),
    },
  };
  const stateId = stableStateId(stateWithoutId);
  return forecastStateSchema.parse({ ...stateWithoutId, stateId });
}

function selectCalibration(
  rawProbability: number,
  forecastAsOf?: string,
  candidate?: ValidatedCalibrationCandidate,
) {
  if (!candidate) {
    return {
      status: "not_applied" as const,
      modelId: null,
      calibratedProbability: null,
      reason: "No versioned, out-of-time validated calibration model was supplied.",
    };
  }
  const calibratedProbability = assertProbability(candidate.calibratedProbability);
  if (!candidate.validatedOutOfTime) {
    return {
      status: "rejected" as const,
      modelId: candidate.modelId,
      calibratedProbability,
      reason: "Calibration candidate was not validated out of time.",
    };
  }
  if (!forecastAsOf) {
    return {
      status: "rejected" as const,
      modelId: candidate.modelId,
      calibratedProbability,
      reason: "Calibration training chronology cannot be verified without forecastAsOf.",
    };
  }
  if (compareTemporal(candidate.trainingWindowEnd, forecastAsOf) > 0) {
    return {
      status: "rejected" as const,
      modelId: candidate.modelId,
      calibratedProbability,
      reason: "Calibration training window ends after the forecast timestamp.",
    };
  }
  return {
    status: "applied" as const,
    modelId: candidate.modelId,
    calibratedProbability,
    reason: `Applied versioned model ${candidate.modelId} trained only through ${candidate.trainingWindowEnd}. Raw probability ${roundProbability(rawProbability)} remains preserved.`,
  };
}

function evaluateTemporalTrust(input: Pick<
  BuildForecastStateInput,
  "forecastAsOf" | "evidenceAsOf" | "cutoffDate"
>) {
  const warnings: string[] = [];
  if (!input.forecastAsOf) {
    warnings.push("missing_forecast_as_of");
  }
  if (!input.evidenceAsOf) {
    warnings.push("missing_evidence_as_of");
  }
  if (!input.cutoffDate) {
    warnings.push("missing_cutoff_date");
  }
  if (input.evidenceAsOf && input.forecastAsOf && compareTemporal(input.evidenceAsOf, input.forecastAsOf) > 0) {
    warnings.push("evidence_after_forecast_as_of");
  }
  if (input.forecastAsOf && input.cutoffDate && compareTemporal(input.cutoffDate, input.forecastAsOf) > 0) {
    warnings.push("cutoff_after_forecast_as_of");
  }
  if (input.evidenceAsOf && input.cutoffDate && compareTemporal(input.evidenceAsOf, input.cutoffDate) > 0) {
    warnings.push("evidence_after_cutoff");
  }
  const inconsistent = warnings.some((warning) => warning.includes("_after_"));
  return {
    forecastAsOf: clean(input.forecastAsOf),
    evidenceAsOf: clean(input.evidenceAsOf),
    cutoffDate: clean(input.cutoffDate),
    trustState: inconsistent ? "inconsistent" as const : warnings.length ? "partial" as const : "complete" as const,
    warnings,
  };
}

function buildPathways(attempts: ForecastStateAttempt[]) {
  return attempts.flatMap((attempt, index) => {
    const reportedBy = clean(attempt.roleId) ?? clean(attempt.forecasterLabel) ?? `component-${index + 1}`;
    return [
      ...(clean(attempt.strongestYes)
        ? [{ direction: "yes" as const, description: clean(attempt.strongestYes) as string, reportedBy }]
        : []),
      ...(clean(attempt.strongestNo)
        ? [{ direction: "no" as const, description: clean(attempt.strongestNo) as string, reportedBy }]
        : []),
    ];
  });
}

function compareTemporal(left: string, right: string) {
  if ((!left.includes("T") || !right.includes("T")) && left.slice(0, 10) === right.slice(0, 10)) {
    return 0;
  }
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) {
    return left.localeCompare(right);
  }
  return Math.sign(leftMs - rightMs);
}

function assertProbability(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Invalid probability ${String(value)}. Expected a finite value from 0 to 100.`);
  }
  return value;
}

function optionalProbability(value?: number) {
  return value === undefined ? null : assertProbability(value);
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function roundProbability(value: number) {
  return Math.round(value * 10) / 10;
}

function clean(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isHumanForecastSource(value: string) {
  return /\b(metaculus|manifold|polymarket|kalshi|predictit|good[\s-]+judgment[\s-]+open|gjopen|prediction[\s-]+market|forecast[\s-]+market|bookmaker|betting[\s-]+odds|analyst[\s-]+probability|crowd[\s-]+forecast|market[\s-]+implied[\s-]+probability|consensus[\s-]+probability)\b/i.test(value);
}

function isHumanForecastExposureFlag(value: string) {
  return /human_forecast|prediction_market|crowd_forecast|bookmaker|betting|metaculus|manifold|polymarket|kalshi|predictit|component_used_disallowed_evidence/i.test(value);
}

function stableStateId(value: unknown) {
  const serialized = JSON.stringify(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `forecast_state_${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
