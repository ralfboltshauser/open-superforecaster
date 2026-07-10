import { existsSync } from "node:fs";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  artifactRows,
  artifacts,
  benchmarkCases,
  benchmarkRuns,
  benchmarkSuites,
  cleanupJobs,
  forecastScores,
  sourceBankEntries,
  tasks,
  workflowChangeProposals,
  type createDb,
} from "@open-superforecaster/db";
import type { AppConfig } from "@open-superforecaster/config";
import { formatAgentRef, loadAgentPolicy } from "@open-superforecaster/config";
import { buildHealthSnapshot } from "./health";
import { benchmarkPromotionSourceRiskBlockerIds, listBenchmarkRuns, workflowProposalValidationReadiness } from "./benchmark-service";
import { listMaintenanceActions, listMaintenanceJobs } from "./maintenance-service";
import { createObjectStorageTargets, tryHeadBucket } from "./object-storage";
import { readLatestForecastBatchHealth, type ForecastBatchHealthSnapshot } from "./forecast-batch-health";
import { summarizeSourceDomains } from "./source-domain-summary";

type Db = ReturnType<typeof createDb>["db"];

type DiagnosticItem = {
  key: string;
  label: string;
  ok: boolean;
  status: string;
  detail: string;
};

type WorkflowProposalDiagnosticRow = {
  id: string;
  sourceBenchmarkRunId: string | null;
  targetWorkflowId: string;
  status: string;
  implementationStatus: string;
  validationBenchmarkRunId: string | null;
  validationComparisonReportArtifactId: string | null;
  validationResultStatus: string | null;
  validationCompletedCases: number | null;
  validationGateStatus: string | null;
  validationGateBlockers: unknown;
  createdAt: Date | null;
};

const benchmarkSourceRiskBlockerIds = new Set<string>(benchmarkPromotionSourceRiskBlockerIds);

export async function buildDiagnosticsSnapshot(db: Db, config: AppConfig, input: { root: string }) {
  const agentPolicy = loadAgentPolicy(process.env, input.root);
  const [
    health,
    suites,
    cases,
    taskRows,
    artifactRecords,
    benchmarkRunRows,
    sourceRows,
    scoreRows,
    cleanupJobRows,
    recentMaintenanceJobs,
    recentBenchmarkRuns,
    recentWorkflowChangeProposals,
  ] = await Promise.all([
    buildHealthSnapshot(config),
    db.select().from(benchmarkSuites).orderBy(desc(benchmarkSuites.createdAt)),
    db.select().from(benchmarkCases),
    db.select().from(tasks),
    db.select().from(artifacts),
    db.select().from(benchmarkRuns).orderBy(desc(benchmarkRuns.createdAt)),
    db.select().from(sourceBankEntries),
    db.select().from(forecastScores),
    db.select().from(cleanupJobs),
    listMaintenanceJobs(db, 5),
    listBenchmarkRuns(db, 8),
    db
      .select({
        id: workflowChangeProposals.id,
        sourceBenchmarkRunId: workflowChangeProposals.sourceBenchmarkRunId,
        targetWorkflowId: workflowChangeProposals.targetWorkflowId,
        status: workflowChangeProposals.status,
        implementationStatus: workflowChangeProposals.implementationStatus,
        validationBenchmarkRunId: workflowChangeProposals.validationBenchmarkRunId,
        validationComparisonReportArtifactId: benchmarkRuns.comparisonReportArtifactId,
        validationResultStatus: workflowChangeProposals.validationResultStatus,
        validationCompletedCases: workflowChangeProposals.validationCompletedCases,
        validationGateStatus: workflowChangeProposals.validationGateStatus,
        validationGateBlockers: workflowChangeProposals.validationGateBlockers,
        createdAt: workflowChangeProposals.createdAt,
      })
      .from(workflowChangeProposals)
      .leftJoin(benchmarkRuns, eq(workflowChangeProposals.validationBenchmarkRunId, benchmarkRuns.id))
      .orderBy(desc(workflowChangeProposals.createdAt))
      .limit(25),
  ]);

  const objectStorage = createObjectStorageTargets(config);
  const [artifactsBucket, evalsBucket, exportsBucket] = await Promise.all([
    tryHeadBucket(objectStorage.artifacts),
    tryHeadBucket(objectStorage.evals),
    tryHeadBucket(objectStorage.exports),
  ]);
  const forecastBatchHealth = readLatestForecastBatchHealth(input.root);
  const sourceDomains = summarizeSourceDomains(sourceRows);
  const benchmarkPromotion = benchmarkPromotionDiagnostics(recentBenchmarkRuns);
  const validationComparisonReportArtifactIds = recentWorkflowChangeProposals
    .map((proposal) => proposal.validationComparisonReportArtifactId)
    .filter((id): id is string => typeof id === "string");
  const validationComparisonRows = validationComparisonReportArtifactIds.length
    ? await db
        .select({
          artifactId: artifactRows.artifactId,
          rowJson: artifactRows.rowJson,
        })
        .from(artifactRows)
        .where(and(eq(artifactRows.rowIndex, 0), inArray(artifactRows.artifactId, validationComparisonReportArtifactIds)))
    : [];
  const validationComparisonReportsByArtifactId = new Map(validationComparisonRows.map((row) => [row.artifactId, row.rowJson]));
  const caseCountByBenchmarkRunId = new Map(benchmarkRunRows.map((run) => [run.id, run.caseCount]));
  const workflowProposalReadiness = workflowProposalReadinessDiagnostics(
    recentWorkflowChangeProposals,
    caseCountByBenchmarkRunId,
    validationComparisonReportsByArtifactId,
  );
  const items: DiagnosticItem[] = [
    {
      key: "service_health",
      label: "Service health",
      ok: health.ok,
      status: health.ok ? "healthy" : "check",
      detail: health.ok ? "Application health snapshot is healthy." : "Application health snapshot has failing checks.",
    },
    bucketDiagnostic("artifacts_bucket", "Artifacts bucket", artifactsBucket),
    bucketDiagnostic("evals_bucket", "Evals bucket", evalsBucket),
    bucketDiagnostic("exports_bucket", "Exports bucket", exportsBucket),
    forecastBatchHealthDiagnostic(forecastBatchHealth),
    benchmarkPromotionDiagnostic(benchmarkPromotion),
    workflowProposalReadinessDiagnostic(workflowProposalReadiness),
  ];

  const caseCountBySuiteId = cases.reduce((counts, row) => {
    counts.set(row.suiteId, (counts.get(row.suiteId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const suitesWithCounts = suites.map((suite) => ({
    id: suite.id,
    name: suite.name,
    revision: suite.revision,
    caseCount: caseCountBySuiteId.get(suite.id) ?? 0,
    allowedEvalModes: suite.allowedEvalModes,
    rawSnapshotUri: readString(suite.caseSelectionPolicy, "rawSnapshotUri"),
    createdAt: suite.createdAt?.toISOString?.() ?? String(suite.createdAt),
  }));

  const btf2Suites = suitesWithCounts.filter((suite) =>
    `${suite.name} ${suite.revision}`.toLowerCase().includes("btf-2"),
  );

  return {
    ok: health.ok && [artifactsBucket, evalsBucket, exportsBucket].every((bucket) => bucket.ok),
    checkedAt: new Date().toISOString(),
    service: "open-superforecaster",
    settings: {
      codexModel: config.CODEX_MODEL,
      codexAuthMode: config.CODEX_AUTH_MODE,
      codexHome: config.CODEX_HOME,
      agentAuthRoot: config.AGENT_AUTH_ROOT,
      agentPolicy: {
        default: formatAgentRef(agentPolicy.defaultRef),
        structured: agentPolicy.purposes.structured.map(formatAgentRef),
        research: agentPolicy.purposes.research.map(formatAgentRef),
        forecast: agentPolicy.purposes.forecast.map(formatAgentRef),
        critic: agentPolicy.purposes.critic.map(formatAgentRef),
        allowNativeWeb: agentPolicy.allowNativeWeb,
      },
      smithersStateDir: config.SMITHERS_STATE_DIR,
      duckdbPath: config.DUCKDB_PATH,
      artifactsDir: config.ARTIFACTS_DIR,
      evalsDir: config.EVALS_DIR,
      exportsDir: config.EXPORTS_DIR,
      minioEndpoint: config.MINIO_ENDPOINT,
      buckets: {
        artifacts: config.MINIO_BUCKET_ARTIFACTS,
        evals: config.MINIO_BUCKET_EVALS,
        exports: config.MINIO_BUCKET_EXPORTS,
      },
    },
    health,
    objectStorage: {
      artifacts: artifactsBucket,
      evals: evalsBucket,
      exports: exportsBucket,
    },
    items,
    forecastBatchHealth,
    benchmarkPromotion,
    workflowProposalReadiness,
    evalDatasets: {
      suiteCount: suites.length,
      caseCount: cases.length,
      btf2SuiteCount: btf2Suites.length,
      latestSuite: suitesWithCounts[0] ?? null,
      suites: suitesWithCounts.slice(0, 10),
    },
    localState: {
      taskCount: taskRows.length,
      artifactCount: artifactRecords.length,
      benchmarkRunCount: benchmarkRunRows.length,
      sourceBankEntryCount: sourceRows.length,
      sourceDomainCount: sourceDomains.length,
      sourceDomains: sourceDomains.slice(0, 8),
      forecastScoreCount: scoreRows.length,
      cleanupJobCount: cleanupJobRows.length,
      runningTaskCount: taskRows.filter((task) => task.status === "running").length,
      failedTaskCount: taskRows.filter((task) => task.status === "failed").length,
    },
    paths: {
      root: input.root,
      data: directoryStatus(`${input.root}/data`),
      smithers: directoryStatus(config.SMITHERS_STATE_DIR),
      artifacts: directoryStatus(config.ARTIFACTS_DIR),
      evals: directoryStatus(config.EVALS_DIR),
      exports: directoryStatus(config.EXPORTS_DIR),
    },
    commands: [
      ...listMaintenanceActions(),
      {
        label: "Preview cleanup",
        command: "bun run cleanup-local -- --task <task-id> --dry-run",
        destructive: false,
        description: "Plan dependency-aware cleanup of app projection rows without deleting anything.",
      },
    ],
    recentMaintenanceJobs,
    links: {
      app: "http://localhost:3000",
      grafana: "http://localhost:3001",
      prometheus: "http://localhost:9090",
      minio: "http://localhost:9001",
      metrics: "http://localhost:3000/metrics",
    },
  };
}

function benchmarkPromotionDiagnostics(runs: unknown[]) {
  const latestRun = runs[0] ?? null;
  const blockedRuns = runs.filter((run) => {
    const gate = readRecord(run, "promotionGate");
    return readString(gate, "status") === "needs_more_evidence";
  });
  const sourceRiskBlockedRuns = blockedRuns.filter((run) => {
    const blockers = readStringArray(readRecord(run, "promotionGate"), "blockers");
    return blockers.some((blocker) => benchmarkSourceRiskBlockerIds.has(blocker));
  });
  const latestGate = readRecord(latestRun, "promotionGate");
  const blockerCounts = Array.from(
    blockedRuns
      .flatMap((run) => readStringArray(readRecord(run, "promotionGate"), "blockers"))
      .reduce((counts, blocker) => counts.set(blocker, (counts.get(blocker) ?? 0) + 1), new Map<string, number>()),
    ([blocker, count]) => ({ blocker, count, sourceRisk: benchmarkSourceRiskBlockerIds.has(blocker) }),
  ).sort((left, right) => right.count - left.count || left.blocker.localeCompare(right.blocker));
  return {
    latestBenchmarkRunId: readString(latestRun, "id"),
    latestExperimentLabel: readString(latestRun, "experimentLabel"),
    latestEvalMode: readString(latestRun, "evalMode"),
    latestGateStatus: readString(latestGate, "status") ?? "unknown",
    latestGateBlockers: readStringArray(latestGate, "blockers"),
    gateBlockers: blockerCounts.slice(0, 8),
    recentRuns: runs.length,
    blockedRuns: blockedRuns.length,
    sourceRiskBlockedRuns: sourceRiskBlockedRuns.length,
    latestSourceQualityFindings: readRecord(latestRun, "sourceQualityFindings"),
  };
}

function benchmarkPromotionDiagnostic(promotion: ReturnType<typeof benchmarkPromotionDiagnostics>): DiagnosticItem {
  const hasLatestRun = Boolean(promotion.latestBenchmarkRunId);
  const sourceRiskDetail = promotion.sourceRiskBlockedRuns
    ? `; ${promotion.sourceRiskBlockedRuns} recent run(s) blocked by source-risk evidence`
    : "";
  return {
    key: "benchmark_promotion_gate",
    label: "Benchmark promotion gate",
    ok: hasLatestRun ? promotion.latestGateStatus === "review_for_promotion" : false,
    status: hasLatestRun ? promotion.latestGateStatus : "missing",
    detail: hasLatestRun
      ? `Latest benchmark ${promotion.latestBenchmarkRunId} gate is ${promotion.latestGateStatus} with ${promotion.latestGateBlockers.length} blocker(s)${sourceRiskDetail}.`
      : "No benchmark run has been recorded yet.",
  };
}

function workflowProposalReadinessDiagnostics(
  proposals: WorkflowProposalDiagnosticRow[],
  sourceBenchmarkCaseCounts: Map<string, number>,
  validationComparisonReportsByArtifactId: Map<string, Record<string, unknown>>,
) {
  const rows = proposals.map((proposal) => {
    const validationComparisonReport = proposal.validationComparisonReportArtifactId
      ? validationComparisonReportsByArtifactId.get(proposal.validationComparisonReportArtifactId) ?? null
      : null;
    const readiness = workflowProposalValidationReadiness({
      resultStatus: proposal.validationResultStatus,
      gateStatus: proposal.validationGateStatus,
      gateBlockers: proposal.validationGateBlockers,
      completedCases: proposal.validationCompletedCases,
      sourceBenchmarkCaseCount: proposal.sourceBenchmarkRunId ? sourceBenchmarkCaseCounts.get(proposal.sourceBenchmarkRunId) ?? null : null,
      comparisonReport: validationComparisonReport,
    });
    return {
      proposalId: proposal.id,
      sourceBenchmarkRunId: proposal.sourceBenchmarkRunId,
      targetWorkflowId: proposal.targetWorkflowId,
      status: proposal.status,
      implementationStatus: proposal.implementationStatus,
      validationBenchmarkRunId: proposal.validationBenchmarkRunId,
      validationGateStatus: proposal.validationGateStatus,
      validationCompletedCases: readiness.coverage.completedCases,
      validationRequiredCases: readiness.coverage.requiredCases,
      validationCoverageRatio: Math.round(readiness.coverage.coverageRatio * 1000) / 1000,
      primaryBaselinePairedCaseCount: readiness.primaryEvidence.pairedCaseCount,
      primaryBaselinePairedHoldoutCaseCount: readiness.primaryEvidence.pairedHoldoutCaseCount,
      passed: readiness.passed,
      blockers: readiness.blockers,
      createdAt: proposal.createdAt?.toISOString?.() ?? null,
    };
  });
  const activeRows = rows.filter((row) => row.status !== "rejected" && row.status !== "implemented");
  const blockedRows = activeRows.filter((row) => !row.passed);
  const validatedRows = rows.filter((row) => row.passed);
  const latestBlocked = blockedRows[0] ?? null;
  const blockerCounts = Array.from(
    blockedRows
      .flatMap((row) => row.blockers)
      .reduce((counts, blocker) => counts.set(blocker, (counts.get(blocker) ?? 0) + 1), new Map<string, number>()),
    ([blocker, count]) => ({ blocker, count }),
  ).sort((left, right) => right.count - left.count || left.blocker.localeCompare(right.blocker));
  return {
    recentProposals: rows.length,
    activeProposals: activeRows.length,
    validatedProposals: validatedRows.length,
    blockedActiveProposals: blockedRows.length,
    latestBlockedProposalId: latestBlocked?.proposalId ?? null,
    latestBlockedTargetWorkflowId: latestBlocked?.targetWorkflowId ?? null,
    latestBlockedReadinessBlockers: latestBlocked?.blockers ?? [],
    readinessBlockers: blockerCounts.slice(0, 8),
    proposals: rows.slice(0, 8),
  };
}

function workflowProposalReadinessDiagnostic(readiness: ReturnType<typeof workflowProposalReadinessDiagnostics>): DiagnosticItem {
  const hasProposals = readiness.recentProposals > 0;
  return {
    key: "workflow_proposal_readiness",
    label: "Workflow proposal readiness",
    ok: hasProposals ? readiness.blockedActiveProposals === 0 : true,
    status: hasProposals
      ? readiness.blockedActiveProposals === 0
        ? "ready"
        : "blocked"
      : "none",
    detail: hasProposals
      ? `${readiness.blockedActiveProposals} blocked active proposal(s), ${readiness.validatedProposals} validated proposal(s) in the latest ${readiness.recentProposals}.`
      : "No workflow change proposals have been recorded yet.",
  };
}

function bucketDiagnostic(key: string, label: string, bucket: { ok: boolean; status: number | null; error?: string | null }): DiagnosticItem {
  return {
    key,
    label,
    ok: bucket.ok,
    status: bucket.ok ? "healthy" : "check",
    detail: bucket.ok ? String(bucket.status ?? "reachable") : String(bucket.error ?? bucket.status ?? "unreachable"),
  };
}

function forecastBatchHealthDiagnostic(health: ForecastBatchHealthSnapshot): DiagnosticItem {
  if (!health.exists) {
    return {
      key: "forecast_batch_health",
      label: "Forecast batch health",
      ok: false,
      status: "missing",
      detail: "No local forecast batch health report has been generated yet.",
    };
  }
  const unresolved = health.summary.unresolvedAttentionItems ?? 0;
  const candidateRules = health.summary.unresolvedCandidateCalibrationGuardRules ?? 0;
  return {
    key: "forecast_batch_health",
    label: "Forecast batch health",
    ok: health.status === "healthy",
    status: health.status,
    detail: `${health.batchId ?? "latest batch"} has ${unresolved} unresolved attention item(s) and ${candidateRules} unresolved candidate calibration guard rule(s).`,
  };
}

function directoryStatus(path: string) {
  return {
    path,
    exists: existsSync(path),
  };
}

function readRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[key];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

function readString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : null;
}

function readStringArray(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const raw = (value as Record<string, unknown>)[key];
  return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
}
