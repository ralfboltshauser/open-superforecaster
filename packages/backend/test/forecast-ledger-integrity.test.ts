import { describe, expect, test } from "bun:test";
import {
  applyProviderActivityIsolationAudit,
  binaryAttemptNodeIdsFromAggregate,
  providerActivityIsolationFlags,
  reconcileBinaryAttemptOutputs,
  readJsonRecordField,
  resolveAttemptAttribution,
  terminalTaskStatusForSmithers,
  type ForecastAttemptOutputEntry,
} from "../src/run-service";
import { parseSmithersNodeExecutionMetadata } from "../src/smithers-launcher";

describe("binary forecast ledger integrity", () => {
  test("enumerates every dynamically selected role instead of three fixed nodes", () => {
    expect(binaryAttemptNodeIdsFromAggregate({
      roleIds: [
        "base-rate",
        "inside-view",
        "reference-class",
        "incentives-timing",
        "market-consensus",
        "adversarial-tail",
      ],
    })).toEqual([
      "attempt-base-rate",
      "attempt-inside-view",
      "attempt-reference-class",
      "attempt-incentives-timing",
      "attempt-market-consensus",
      "attempt-adversarial-tail",
    ]);

    expect(binaryAttemptNodeIdsFromAggregate({
      role_ids: JSON.stringify(["base-rate", "inside-view", "resolution-boundary", "skeptic"]),
    })).toEqual([
      "attempt-base-rate",
      "attempt-inside-view",
      "attempt-resolution-boundary",
      "attempt-skeptic",
    ]);

    expect(binaryAttemptNodeIdsFromAggregate({
      componentProbabilities: [
        { forecasterLabel: "rollout-1", probability: 40 },
        { forecasterLabel: "rollout-2", probability: 60 },
      ],
    })).toEqual(["rollout-1", "rollout-2"]);
    expect(binaryAttemptNodeIdsFromAggregate({
      componentProbabilities: [
        { forecasterLabel: "base-rate forecaster", probability: 40 },
        { forecasterLabel: "skeptical forecaster", probability: 60 },
      ],
    })).toEqual(["attempt-base-rate", "attempt-skeptic"]);
  });

  test("fills an unavailable selected node from the aggregate without dropping observed roles", () => {
    const observed: ForecastAttemptOutputEntry[] = [
      observedAttempt("base-rate", 30),
      observedAttempt("inside-view", 40),
      observedAttempt("reference-class", 35),
      observedAttempt("incentives-timing", 45),
    ];
    const components = [
      component("base-rate", 30),
      component("inside-view", 40),
      component("reference-class", 35),
      component("incentives-timing", 45),
      component("market-consensus", 55),
      component("adversarial-tail", 60),
    ];

    const reconciled = reconcileBinaryAttemptOutputs(observed, components, { probability: 44 });

    expect(reconciled).toHaveLength(6);
    expect(reconciled.map((attempt) => attempt.output.roleId)).toEqual([
      "base-rate",
      "inside-view",
      "reference-class",
      "incentives-timing",
      "market-consensus",
      "adversarial-tail",
    ]);
    expect(reconciled.at(-1)?.source).toBe("aggregate_component_fallback");
  });

  test("uses observed Smithers provider and resolved model instead of current configuration", () => {
    const execution = {
      nodeId: "attempt-market-consensus",
      iteration: 1,
      attempt: 2,
      startedAtMs: 1_000,
      finishedAtMs: 2_000,
      agentId: "forecast:market-consensus:claude:forecast-prod",
      agentModel: "claude-opus-4-6",
      agentEngine: "ClaudeCodeAgent",
      agentResume: "thread-market",
    };

    expect(resolveAttemptAttribution(execution, { provider: "codex", profile: "default" })).toEqual({
      provider: "claude",
      profile: "forecast-prod",
      model: "claude:forecast-prod:claude-opus-4-6",
      resolvedModel: "claude-opus-4-6",
      agentId: "forecast:market-consensus:claude:forecast-prod",
      agentEngine: "ClaudeCodeAgent",
      agentResume: "thread-market",
      source: "smithers_attempt_metadata",
    });
  });

  test("extracts execution identity from the attempt that produced the node output", () => {
    const metadata = parseSmithersNodeExecutionMetadata({
      node: { nodeId: "attempt-skeptic", iteration: 2, lastAttempt: 2 },
      attempts: [
        {
          iteration: 2,
          attempt: 1,
          state: "failed",
          meta: { agentId: "forecast:skeptic:codex:first", agentModel: "gpt-old", agentEngine: "CodexAgent", agentResume: "thread-old" },
        },
        {
          iteration: 2,
          attempt: 2,
          state: "succeeded",
          meta: { agentId: "forecast:skeptic:gemini:second", agentModel: "gemini-3.1-pro", agentEngine: "GeminiAgent", agentResume: "thread-winning" },
        },
      ],
    }, "fallback-node");

    expect(metadata).toEqual({
      nodeId: "attempt-skeptic",
      iteration: 2,
      attempt: 2,
      startedAtMs: null,
      finishedAtMs: null,
      agentId: "forecast:skeptic:gemini:second",
      agentModel: "gemini-3.1-pro",
      agentEngine: "GeminiAgent",
      agentResume: "thread-winning",
    });
  });

  test("treats cancelled and revoked Smithers runs as terminal task states", () => {
    expect(terminalTaskStatusForSmithers("cancelled", "cancelled")).toBe("cancelled");
    expect(terminalTaskStatusForSmithers("revoked", "failed")).toBe("revoked");
    expect(terminalTaskStatusForSmithers("cancel-requested", "running")).toBeNull();
  });

  test("decodes Smithers JSON-string record fields before durable projection", () => {
    expect(readJsonRecordField({
      forecast_state: JSON.stringify({ stateId: "forecast_state_test", version: "forecast-state-v1" }),
    }, "forecastState", "forecast_state")).toEqual({
      stateId: "forecast_state_test",
      version: "forecast-state-v1",
    });
    expect(readJsonRecordField({ forecast_state: "not-json" }, "forecast_state")).toBeNull();
  });

  test("turns exact provider policy violations into immutable ForecastState isolation flags", () => {
    const observations = [{
      nodeId: "attempt-base-rate",
      execution: null,
      error: null,
      activities: [{
        version: "provider-observed-research-activity-v1" as const,
        provenanceMode: "provider_observed_activity" as const,
        provider: "codex" as const,
        threadId: "019f4dd2-4f47-76b1-8b61-d1738329d633",
        sessionFile: "sessions/rollout.jsonl",
        observedAt: "2026-07-10T12:00:00Z",
        callId: "call-1",
        activityType: "search" as const,
        query: "Polymarket probability",
        queries: ["Polymarket probability"],
        url: null,
        pattern: null,
        contentObserved: false as const,
      }],
    }];
    const flags = providerActivityIsolationFlags(observations, "no_external_research");
    expect(flags).toEqual([
      "provider_observed_human_forecast_activity:attempt-base-rate:call-1",
      "provider_observed_disallowed_external_activity:attempt-base-rate:call-1",
    ]);

    const original = persistableStateForProviderAudit();
    const audited = applyProviderActivityIsolationAudit(
      { forecastState: original, probability: 50 },
      original,
      observations,
      flags,
      ["codex:default:gpt-5.5"],
    );
    const state = audited.forecastState as unknown as {
      stateId: string;
      outputs: { autonomous: { informationIsolation: { status: string; flags: string[] } } };
    };
    expect(state.stateId).not.toBe(original.stateId);
    expect(state.outputs.autonomous.informationIsolation.status)
      .toBe("possible_human_forecast_exposure");
    expect(state.outputs.autonomous.informationIsolation.flags).toEqual(flags);
    expect((audited.forecastState as unknown as {
      provenance: { componentProviderIds: string[] };
    }).provenance.componentProviderIds).toEqual(["codex:default:gpt-5.5"]);

    expect(providerActivityIsolationFlags([{
      ...observations[0]!,
      nodeId: "research-dossier",
      activities: [
        { ...observations[0]!.activities[0]!, query: "query one", queries: ["query one"] },
        { ...observations[0]!.activities[0]!, callId: "call-2", query: "query two", queries: ["query two"] },
      ],
    }], "shared_plus_followup", { sharedResearchSearchBudget: 1 }))
      .toContain("provider_observed_research_budget_exceeded:research-dossier:2>1");
  });
});

function persistableStateForProviderAudit() {
  return {
    version: "forecast-state-v1",
    stateId: "forecast_state_original",
    question: {
      question: "Will it happen?",
      resolutionCriteria: "Resolve YES if it happens.",
      resolutionDate: null,
      condition: null,
      background: null,
    },
    temporal: { forecastAsOf: null, evidenceAsOf: null, cutoffDate: null, trustState: "partial" as const },
    outputs: {
      autonomous: {
        rawProbability: 50,
        selectedProbability: 50,
        informationIsolation: { status: "isolated", forbiddenSourceIds: [], flags: [], redactedInputFlags: [] },
        calibration: { status: "not_applied" as const, modelId: null },
      },
      crowdAssisted: null,
    },
    update: {
      kind: "initial" as const,
      reason: "Initial forecast.",
      previousStateId: null,
      probabilityDelta: null,
      newEvidenceClaimIds: [],
      invalidatedEvidenceClaimIds: [],
      nextScheduledUpdate: null,
      triggerConditions: [],
    },
    memory: {
      scope: "question_local" as const,
      activeFactors: [],
      unresolvedInformationNeeds: [],
      transcriptStored: false as const,
    },
    provenance: {
      workflowVersion: "v1",
      aggregatorVersion: "v1",
      calibratorVersion: null,
      dossierVersion: "v1",
      schedulerVersion: null,
    },
  };
}

function observedAttempt(roleId: string, probability: number): ForecastAttemptOutputEntry {
  return {
    nodeId: `attempt-${roleId}`,
    output: component(roleId, probability),
    execution: null,
    source: "smithers_node_output",
  };
}

function component(roleId: string, probability: number) {
  return {
    roleId,
    forecasterLabel: `${roleId} forecaster`,
    probability,
  };
}
