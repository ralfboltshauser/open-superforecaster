import { describe, expect, test } from "bun:test";
import { buildBinaryEnsemble } from "../src/forecast-aggregation";
import { buildDisagreementAgenda } from "../src/forecast-disagreement";
import { buildEvidenceWorkspace } from "../src/forecast-evidence-workspace";
import { buildForecastIndependenceDiagnostics } from "../src/forecast-independence";
import {
  researchDossierAsEvidenceAttempt,
  researchDossierSchema,
  sanitizeResearchDossierForJudgment,
} from "../src/forecast-research-dossier";
import { buildForecastState } from "../src/forecast-state";

describe("binary ensemble controls", () => {
  test("keeps mean and median immutable and isolates the assisted track", () => {
    const withoutMarket = buildBinaryEnsemble([20, 40, 90]);
    const withMarket = buildBinaryEnsemble([20, 40, 90], { marketProbability: 80 });

    expect(withoutMarket.controls.arithmeticMean).toBe(50);
    expect(withoutMarket.controls.median).toBe(40);
    expect(withMarket.autonomous).toEqual(withoutMarket.autonomous);
    expect(withMarket.crowdAssisted).toMatchObject({
      probability: 65,
      marketProbability: 80,
      status: "experimental_candidate",
    });
  });

  test("labels unvalidated pooling and prior shrinkage as candidates", () => {
    const ensemble = buildBinaryEnsemble([20, 80], {
      priorProbability: 30,
      effectiveForecasterCount: 1,
      priorPseudoCount: 1,
    });

    expect(ensemble.autonomous).toMatchObject({
      probability: 50,
      method: "unweighted_arithmetic_mean_v1",
      status: "production_control",
    });
    expect(ensemble.candidates.logitPool.probability).toBe(50);
    expect(ensemble.candidates.priorShrinkage).toMatchObject({
      probability: 40,
      status: "experimental_candidate",
    });
  });

  test("rejects invalid component probabilities", () => {
    expect(() => buildBinaryEnsemble([])).toThrow("at least one");
    expect(() => buildBinaryEnsemble([101])).toThrow("Invalid binary probability");
  });
});

describe("forecast evidence workspace", () => {
  test("rejects reported dossier searches that exceed or disagree with the declared budget", () => {
    const base = {
      version: "research-dossier-v1" as const,
      treatment: "shared_plus_followup" as const,
      summary: "summary",
      queryHistory: [{ query: "one", purpose: "test" }],
      sources: [],
      claimChecks: [],
      openQuestions: [],
      invalidatedPreviousClaimIds: [],
      searchesUsed: 1,
      pagesInspected: 0,
      searchBudget: 1,
      stopReason: "budget_exhausted" as const,
      cutoffComplianceNotes: "none",
      possibleLeakage: [],
      provenance: "agent_reported" as const,
    };
    expect(() => researchDossierSchema.parse(base)).not.toThrow();
    expect(() => researchDossierSchema.parse({
      ...base,
      queryHistory: [...base.queryHistory, { query: "two", purpose: "test" }],
      searchesUsed: 2,
    })).toThrow("searchBudget");
    expect(() => researchDossierSchema.parse({ ...base, searchesUsed: 0 }))
      .toThrow("queryHistory length");
  });

  test("quarantines forbidden dossier sources before judgment and derives a clean summary", () => {
    const raw = researchDossierSchema.parse({
      version: "research-dossier-v1",
      treatment: "shared_frozen_dossier",
      summary: "Polymarket was 87%, and a later report confirmed the launch.",
      queryHistory: [
        { query: "official launch registry", purpose: "Find primary evidence" },
        { query: "launch outcome", purpose: "Check later reporting" },
        { query: "Polymarket launch odds", purpose: "Find a crowd probability" },
      ],
      sources: [
        {
          title: "Official launch registry",
          url: "https://agency.example/registry",
          publishedAt: "2026-01-10",
          sourceType: "primary",
          query: "official launch registry",
          claim: "The agency issued a launch permit.",
          stance: "supports_yes",
          diagnosticity: "high",
          qualityScore: 0.9,
          independenceGroup: "agency",
          cutoffStatus: "before_or_on_cutoff",
        },
        {
          title: "Later launch report",
          url: "https://news.example/later",
          publishedAt: "2026-02-10",
          sourceType: "news",
          query: "launch outcome",
          claim: "The launch occurred after the forecast cutoff.",
          stance: "supports_yes",
          diagnosticity: "high",
          qualityScore: 0.8,
          independenceGroup: "later-report",
          // Deliberately incorrect model label: the deterministic cutoff check
          // must still quarantine it from a January snapshot.
          cutoffStatus: "before_or_on_cutoff",
        },
        {
          title: "Polymarket launch market",
          url: "https://polymarket.com/event/launch",
          publishedAt: "2026-01-15",
          sourceType: "prediction market",
          query: "Polymarket launch odds",
          claim: "The crowd probability was 87%.",
          stance: "supports_yes",
          diagnosticity: "medium",
          qualityScore: null,
          independenceGroup: "polymarket",
          cutoffStatus: "before_or_on_cutoff",
        },
      ],
      claimChecks: [{
        claim: "The crowd probability was 87%.",
        status: "supported",
        supportingSourceUrls: ["https://polymarket.com/event/launch"],
        dependenceWarning: "",
      }],
      openQuestions: ["Will the 87% market forecast be correct?"],
      invalidatedPreviousClaimIds: [],
      searchesUsed: 3,
      pagesInspected: 3,
      searchBudget: 4,
      stopReason: "sufficient_evidence",
      cutoffComplianceNotes: "Model claimed compliance.",
      possibleLeakage: ["Saw Polymarket at 87%."],
      provenance: "agent_reported",
    });

    const { admissibleDossier, audit } = sanitizeResearchDossierForJudgment(raw, {
      cutoffDate: "2026-01-31",
    });
    const evidence = researchDossierAsEvidenceAttempt(admissibleDossier);

    expect(raw.summary).toContain("87%");
    expect(admissibleDossier.sources.map((source) => source.title)).toEqual(["Official launch registry"]);
    expect(admissibleDossier.summary).toContain("The agency issued a launch permit.");
    expect(admissibleDossier.summary).not.toContain("87%");
    expect(admissibleDossier.summary).not.toContain("later report confirmed");
    expect(admissibleDossier.claimChecks).toEqual([]);
    expect(admissibleDossier.openQuestions).toEqual([]);
    expect(evidence.citedSources?.map((source) => source.url)).toEqual(["https://agency.example/registry"]);
    expect(audit).toMatchObject({
      status: "contaminated",
      rawSourceCount: 3,
      admissibleSourceCount: 1,
      quarantinedSourceCount: 2,
    });
    expect(audit.quarantinedSources.map((source) => source.reasons)).toEqual([
      ["post_cutoff"],
      ["explicit_human_forecast"],
    ]);
    expect(audit.contaminationFlags).toContain("research_dossier_source_1:post_cutoff");
    expect(audit.contaminationFlags).toContain("research_dossier_source_2:explicit_human_forecast");
  });

  test("separates hard-cutoff violations from evidence-recency warnings", () => {
    const workspace = buildEvidenceWorkspace({
      evidenceAsOf: "2025-01-01T00:00:00Z",
      cutoffDate: "2025-12-31",
      observedEvents: [{
        kind: "page_inspected",
        observedAt: "2025-01-01T00:00:00Z",
        query: "example output report",
        url: "https://example.com/report?utm_source=test",
        publishedAt: "2025-02-01",
        title: "Output report",
        qualityScore: 0.8,
        archiveUri: "object://evidence/report",
      }],
      attempts: [
        {
          roleId: "inside-view",
          evidenceFor: ["Output grew 10%"],
          citedSources: [{
            url: "https://example.com/report",
            title: "Output report",
            publishedAt: "2025-02-01",
            claim: "Output grew 10%",
          }],
        },
        {
          roleId: "skeptic",
          evidenceAgainst: ["Output grew 10%", "Regulation blocks release"],
          keyUncertainties: ["Will the regulator issue a waiver?"],
        },
      ],
    });

    expect(workspace.provenanceMode).toBe("harness_observed");
    expect(workspace.diagnostics).toMatchObject({
      sourceCount: 1,
      postCutoffSourceCount: 0,
      postEvidenceAsOfSourceCount: 1,
      unsupportedClaimCount: 1,
      contestedClaimCount: 1,
      queriesUsed: 1,
      pagesInspected: 1,
    });
    expect(workspace.claims.find((claim) => claim.text === "Output grew 10%")).toMatchObject({
      stance: "contested",
      verificationStatus: "contradicted",
    });
    expect(workspace.integrityFlags.some((flag) => flag.startsWith("post_cutoff_source:"))).toBe(false);
    expect(workspace.integrityFlags.some((flag) => flag.startsWith("source_after_evidence_as_of:"))).toBe(true);
    expect(workspace.remainingInformationNeeds).toEqual(["Will the regulator issue a waiver?"]);
  });

  test("treats a date-only hard cutoff as inclusive through that UTC day", () => {
    const workspace = buildEvidenceWorkspace({
      cutoffDate: "2026-07-08",
      attempts: [{
        roleId: "inside-view",
        citedSources: [{
          url: "https://example.com/same-day",
          publishedAt: "2026-07-08T12:00:00Z",
          claim: "The source was published on the cutoff day.",
        }],
      }],
    });

    expect(workspace.sources[0]?.cutoffStatus).toBe("before_or_on_cutoff");
    expect(workspace.diagnostics.postCutoffSourceCount).toBe(0);
  });

  test("keeps model-reported research queries visibly unobserved", () => {
    const dossier = researchDossierSchema.parse({
      version: "research-dossier-v1",
      treatment: "shared_plus_followup",
      summary: "One source was inspected.",
      queryHistory: [{ query: "official launch schedule", purpose: "Check the timeline" }],
      sources: [{
        title: "Official schedule",
        url: "https://example.com/schedule",
        publishedAt: "2026-01-01",
        sourceType: "primary",
        query: "official launch schedule",
        rank: 1,
        claim: "The launch is scheduled for June.",
        stance: "supports_yes",
        diagnosticity: "high",
        qualityScore: 0.9,
        independenceGroup: "official-schedule",
        cutoffStatus: "before_or_on_cutoff",
      }],
      claimChecks: [],
      openQuestions: [],
      invalidatedPreviousClaimIds: [],
      searchesUsed: 1,
      pagesInspected: 1,
      searchBudget: 4,
      stopReason: "sufficient_evidence",
      cutoffComplianceNotes: "No later sources used.",
      possibleLeakage: [],
      provenance: "agent_reported",
    });
    const workspace = buildEvidenceWorkspace({
      attempts: [researchDossierAsEvidenceAttempt(dossier)],
      reportedSearchQueries: dossier.queryHistory.map((query) => query.query),
      evidenceAsOf: "2026-02-01",
    });

    expect(workspace.searchHistory[0]).toMatchObject({
      query: "official launch schedule",
      observedAt: null,
      provenance: "agent_reported",
    });
    expect(workspace.sources[0]).toMatchObject({
      query: "official launch schedule",
      qualityScore: 0.9,
      reportedIndependenceGroup: "official-schedule",
      provenance: "agent_reported",
    });
    expect(workspace.integrityFlags.some((flag) => flag.startsWith("query_not_harness_observed:"))).toBe(true);
  });

  test("does not promote a search result into inspected-source provenance", () => {
    const workspace = buildEvidenceWorkspace({
      cutoffDate: "2026-12-31",
      observedEvents: [{
        kind: "search_result",
        observedAt: "2026-01-01T00:00:00Z",
        query: "official launch schedule",
        url: "https://example.com/schedule",
        title: "Official schedule",
        publishedAt: "2026-01-01",
      }],
      attempts: [{
        roleId: "inside-view",
        evidenceFor: ["The launch is scheduled for June."],
        citedSources: [{
          url: "https://example.com/schedule",
          title: "Official schedule",
          publishedAt: "2026-01-01",
          claim: "The launch is scheduled for June.",
        }],
      }],
    });

    expect(workspace.diagnostics.pagesInspected).toBe(0);
    expect(workspace.sources[0]?.provenance).toBe("agent_reported");
    expect(workspace.claims[0]?.verificationStatus).toBe("agent_reported_source");
    expect(workspace.searchHistory[0]?.provenance).toBe("harness_observed");
  });
});

describe("disagreement reconciliation", () => {
  test("commissions a bounded agenda without assigning a probability", () => {
    const agenda = buildDisagreementAgenda([
      {
        roleId: "base-rate",
        probability: 20,
        baseRateProbability: 25,
        resolutionBoundary: "Official launch before December 31",
        strongestNo: "Similar launches are usually delayed.",
      },
      {
        roleId: "inside-view",
        probability: 75,
        baseRateProbability: 50,
        resolutionBoundary: "Public beta before December 31",
        strongestYes: "The release candidate is already deployed.",
      },
    ], 20);

    expect(agenda.status).toBe("targeted_reconciliation_needed");
    expect(agenda.spread).toBe(55);
    expect(agenda.reforecastRequired).toBe(true);
    expect(agenda.researchQuestions.length).toBeGreaterThan(1);
    expect(agenda.supervisorConstraint).toContain("may not directly choose");
    expect("probability" in agenda).toBe(false);
  });
});

describe("forecast independence diagnostics", () => {
  test("measures evidence overlap without using the proxy as an ensemble weight", () => {
    const diagnostics = buildForecastIndependenceDiagnostics({
      researchTreatment: "shared_plus_followup",
      attempts: [
        {
          roleId: "base-rate",
          providerId: "provider-a",
          evidenceFor: ["Shared claim", "Base-rate claim"],
          citedSources: [{ url: "https://example.com/shared", claim: "Shared claim" }],
        },
        {
          roleId: "inside-view",
          providerId: "provider-b",
          evidenceFor: ["Shared claim", "Mechanism claim"],
          citedSources: [{ url: "https://example.com/shared", claim: "Shared claim" }],
        },
      ],
    });

    expect(diagnostics.distinctProviderCount).toBe(2);
    expect(diagnostics.meanPairwiseClaimJaccard).toBeGreaterThan(0);
    expect(diagnostics.meanPairwiseSourceJaccard).toBe(1);
    expect(diagnostics.evidenceOverlapEffectiveSizeProxy).toBe(1);
    expect(diagnostics.eligibleForAggregationWeighting).toBe(false);
  });
});

describe("ForecastState", () => {
  const input = {
    question: "Will the system launch by year end?",
    resolutionCriteria: "YES if a generally available release is announced by December 31.",
    forecastAsOf: "2026-01-01T12:00:00Z",
    evidenceAsOf: "2025-12-31T23:59:59Z",
    cutoffDate: "2026-01-01T12:00:00Z",
    attempts: [
      {
        roleId: "base-rate",
        probability: 30,
        baseRateProbability: 25,
        insideViewProbability: 35,
        probabilityRange: { low: 20, high: 45 },
        referenceClass: "Comparable product launches",
        strongestYes: "A release candidate exists.",
        strongestNo: "Prior launches slipped.",
        evidenceFor: ["A release candidate exists."],
        keyUncertainties: ["Will testing expose a blocker?"],
      },
      {
        roleId: "inside-view",
        probability: 50,
        baseRateProbability: 35,
        insideViewProbability: 55,
        probabilityRange: { low: 35, high: 65 },
        referenceClass: "Late-stage software releases",
        strongestYes: "Deployment work is funded.",
        strongestNo: "The regulator has not approved it.",
        evidenceAgainst: ["The regulator has not approved it."],
      },
    ],
    modelAggregateCandidate: { probability: 90, method: "llm_supervisor_candidate" },
    market: { probability: 70, asOf: "2025-12-31T22:00:00Z" },
  };

  test("uses a deterministic mean by default and preserves the model candidate", () => {
    const first = buildForecastState(input);
    const second = buildForecastState(input);

    expect(first.stateId).toBe(second.stateId);
    expect(first.temporal.trustState).toBe("complete");
    expect(first.outputs.autonomous).toMatchObject({
      rawProbability: 40,
      selectedProbability: 40,
      aggregationMethod: "unweighted_arithmetic_mean_v1",
    });
    expect(first.judgment.modelAggregateCandidate?.probability).toBe(90);
    expect(first.outputs.crowdAssisted).toMatchObject({ probability: 55, marketProbability: 70 });
    expect(first.outputs.autonomous.informationIsolation.status).toBe("isolated");
    expect(first.memory.transcriptStored).toBe(false);
  });

  test("makes post-cutoff judge evidence ineligible for isolated autonomous scoring", () => {
    const state = buildForecastState({
      ...input,
      attempts: [{
        roleId: "inside-view",
        probability: 60,
        citedSources: [{
          title: "Future report",
          url: "https://example.com/future",
          publishedAt: "2026-01-02T00:00:00Z",
          claim: "A decisive event occurred after the forecast cutoff.",
        }],
      }],
    });

    expect(state.research.diagnostics.postCutoffSourceCount).toBe(1);
    expect(state.outputs.autonomous.informationIsolation.status).toBe("possible_information_leakage");
    expect(state.outputs.autonomous.informationIsolation.flags)
      .toContain(`post_cutoff_source:${state.research.sources[0]!.id}`);
  });

  test("records deterministically redacted input without treating it as consumed evidence", () => {
    const state = buildForecastState({
      ...input,
      redactedInformationAdvantageFlags: [
        "background_human_forecast_redacted_before_autonomous_prompt",
      ],
    });

    expect(state.outputs.autonomous.informationIsolation.status).toBe("isolated");
    expect(state.outputs.autonomous.informationIsolation.redactedInputFlags)
      .toEqual(["background_human_forecast_redacted_before_autonomous_prompt"]);
  });

  test("recognizes the full explicit human-forecast source denylist", () => {
    const state = buildForecastState({
      ...input,
      attempts: [{
        roleId: "base-rate",
        probability: 70,
        citedSources: [{
          title: "PredictIt",
          url: "https://www.predictit.org/markets/example",
          claim: "YES traded at 70%.",
        }],
      }],
    });

    expect(state.outputs.autonomous.informationIsolation.status)
      .toBe("possible_human_forecast_exposure");
    expect(state.outputs.autonomous.informationIsolation.forbiddenSourceIds).toHaveLength(1);
  });

  test("carries prior evidence across updates until its claim ID is explicitly invalidated", () => {
    const first = buildForecastState({
      ...input,
      attempts: [{
        roleId: "base-rate",
        probability: 30,
        evidenceFor: ["The signed launch permit remains valid."],
        citedSources: [{
          title: "Launch permit",
          url: "https://example.com/permit",
          publishedAt: "2025-12-20",
          claim: "The signed launch permit remains valid.",
        }],
      }],
    });
    const priorClaimId = first.research.claims[0]!.id;
    const previous = {
      stateId: first.stateId,
      probability: first.outputs.autonomous.selectedProbability,
      evidenceClaimIds: first.research.claims.map((claim) => claim.id),
      research: first.research,
    };
    const carried = buildForecastState({
      ...input,
      forecastAsOf: "2026-01-02T12:00:00Z",
      cutoffDate: "2026-01-02T12:00:00Z",
      attempts: [{
        roleId: "inside-view",
        probability: 45,
        evidenceAgainst: ["A new integration test failed."],
      }],
      previous,
    });

    expect(carried.research.claims.map((claim) => claim.id)).toContain(priorClaimId);
    expect(carried.update.newEvidenceClaimIds).not.toContain(priorClaimId);
    expect(carried.memory.activeFactors.some((factor) => factor.sourceClaimIds.includes(priorClaimId))).toBeTrue();

    const invalidated = buildForecastState({
      ...input,
      forecastAsOf: "2026-01-02T12:00:00Z",
      cutoffDate: "2026-01-02T12:00:00Z",
      attempts: [{ roleId: "inside-view", probability: 45 }],
      previous,
      update: { invalidatedEvidenceClaimIds: [priorClaimId] },
    });
    expect(invalidated.research.claims.map((claim) => claim.id)).not.toContain(priorClaimId);
    expect(invalidated.update.invalidatedEvidenceClaimIds).toEqual([priorClaimId]);
  });

  test("rejects leaky calibration and applies an earlier validated model", () => {
    const rejected = buildForecastState({
      ...input,
      calibration: {
        modelId: "calibrator-leaky",
        calibratedProbability: 80,
        trainingWindowEnd: "2026-02-01",
        validatedOutOfTime: true,
      },
    });
    expect(rejected.outputs.autonomous.calibration.status).toBe("rejected");
    expect(rejected.outputs.autonomous.selectedProbability).toBe(40);

    const applied = buildForecastState({
      ...input,
      calibration: {
        modelId: "calibrator-2025q4",
        calibratedProbability: 42,
        trainingWindowEnd: "2025-12-30",
        validatedOutOfTime: true,
      },
    });
    expect(applied.outputs.autonomous.calibration.status).toBe("applied");
    expect(applied.outputs.autonomous.selectedProbability).toBe(42);
    expect(applied.outputs.autonomous.rawProbability).toBe(40);
  });

  test("makes missing temporal boundaries visible", () => {
    const state = buildForecastState({
      question: input.question,
      attempts: input.attempts,
    });
    expect(state.temporal.trustState).toBe("partial");
    expect(state.temporal.warnings).toEqual([
      "missing_forecast_as_of",
      "missing_evidence_as_of",
      "missing_cutoff_date",
    ]);
  });

  test("allows a forecast after its evidence cutoff and rejects a future cutoff", () => {
    const bounded = buildForecastState({
      ...input,
      forecastAsOf: "2026-01-02T12:00:00Z",
      evidenceAsOf: "2025-12-31T23:59:59Z",
      cutoffDate: "2026-01-01T23:59:59Z",
    });
    expect(bounded.temporal).toMatchObject({ trustState: "complete", warnings: [] });

    const futureCutoff = buildForecastState({
      ...input,
      cutoffDate: "2026-01-02T00:00:00Z",
    });
    expect(futureCutoff.temporal).toMatchObject({
      trustState: "inconsistent",
      warnings: ["cutoff_after_forecast_as_of"],
    });
  });
});
