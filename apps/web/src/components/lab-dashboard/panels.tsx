"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { Activity, BarChart3, Database, FlaskConical, Play, Server, ShieldCheck, TrendingUp, Wrench } from "lucide-react"

import type {
  BenchmarkMode,
  WorkflowChangeProposalImplementationStatus,
  WorkflowChangeProposalStatus,
} from "@/components/lab-dashboard/use-lab-dashboard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { formatModeLabel, isRecord, readArray, runTitle, statusTone, type JsonRecord } from "@/lib/records"

type DiagnosticCounts = {
  rows: Array<{ name: string; ok: boolean }>
  total: number
  ok: number
}

export function LabMetricGrid({
  benchmarkCount,
  diagnosticCounts,
  healthStatus,
  pendingForecastCount,
}: {
  benchmarkCount: number
  diagnosticCounts: DiagnosticCounts
  healthStatus: unknown
  pendingForecastCount: unknown
}) {
  return (
    <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon={Server} label="System" value={String(healthStatus ?? "unknown")} />
      <MetricCard icon={Activity} label="Diagnostics" value={`${diagnosticCounts.ok}/${diagnosticCounts.total} ok`} />
      <MetricCard icon={BarChart3} label="Benchmarks" value={String(benchmarkCount)} />
      <MetricCard icon={ShieldCheck} label="Pending resolutions" value={String(pendingForecastCount ?? 0)} />
    </section>
  )
}

export function WorkflowLauncher({
  busy,
  importBtf2,
  launchBenchmark,
}: {
  busy: string | null
  importBtf2: () => Promise<void>
  launchBenchmark: (mode: BenchmarkMode) => Promise<void>
}) {
  return (
    <Card id="workflows">
      <CardHeader>
        <CardTitle>Workflow launcher</CardTitle>
        <CardDescription>Start smoke checks without leaving the dashboard.</CardDescription>
        <CardAction>
          <FlaskConical className="text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <Button type="button" variant="outline" onClick={() => void launchBenchmark("fixed_evidence")} disabled={busy !== null}>
          <Play data-icon="inline-start" />
          Fixed evidence
        </Button>
        <Button type="button" variant="outline" onClick={() => void launchBenchmark("agentic_pastcasting_smoke")} disabled={busy !== null}>
          <Play data-icon="inline-start" />
          Live web smoke
        </Button>
        <Button type="button" variant="secondary" onClick={() => void importBtf2()} disabled={busy !== null}>
          <Database data-icon="inline-start" />
          Import BTF-2
        </Button>
      </CardContent>
    </Card>
  )
}

export function RecentRunsCard({ runs }: { runs: JsonRecord[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent runs</CardTitle>
        <CardDescription>{runs.length} runs in the local ledger</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {runs.slice(0, 8).map((run) => (
          <Link
            className="grid gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50 md:grid-cols-[1fr_auto]"
            href={`/runs/${String(run.id ?? "")}`}
            key={String(run.id ?? runTitle(run))}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{runTitle(run)}</span>
              <span className="block truncate text-xs text-muted-foreground">{formatModeLabel(run.operationSubmode ?? run.operationMode)}</span>
            </span>
            <Badge variant="secondary" className={statusTone(run.status)}>
              {String(run.status ?? "queued")}
            </Badge>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

export function DiagnosticsCard({ diagnosticCounts }: { diagnosticCounts: DiagnosticCounts }) {
  return (
    <Card id="diagnostics">
      <CardHeader>
        <CardTitle>Diagnostics</CardTitle>
        <CardDescription>Backend dependencies and local workflow prerequisites.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress value={diagnosticCounts.total ? Math.round((diagnosticCounts.ok / diagnosticCounts.total) * 100) : 0} />
        <div className="flex flex-col gap-2">
          {diagnosticCounts.rows.slice(0, 8).map((row) => (
            <div className="flex items-center justify-between gap-3 text-sm" key={row.name}>
              <span className="truncate">{row.name}</span>
              <Badge variant={row.ok ? "outline" : "destructive"}>{row.ok ? "ok" : "check"}</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function BenchmarksCard({
  benchmarks,
  busy,
  launchWorkflowProposalValidation,
  updateWorkflowChangeProposal,
}: {
  benchmarks: { benchmarkRuns: JsonRecord[]; benchmarkSuites: JsonRecord[] }
  busy: string | null
  launchWorkflowProposalValidation: (benchmarkRunId: string, proposalId: string) => Promise<void>
  updateWorkflowChangeProposal: (
    benchmarkRunId: string,
    proposalId: string,
    status: WorkflowChangeProposalStatus,
    implementationStatus?: WorkflowChangeProposalImplementationStatus,
  ) => Promise<void>
}) {
  return (
    <Card id="benchmarks">
      <CardHeader>
        <CardTitle>Benchmarks</CardTitle>
        <CardDescription>{benchmarks.benchmarkSuites.length} suites · {benchmarks.benchmarkRuns.length} runs</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {benchmarks.benchmarkRuns.slice(0, 6).map((run) => (
          <BenchmarkRunSummary
            busy={busy}
            launchWorkflowProposalValidation={launchWorkflowProposalValidation}
            run={run}
            updateWorkflowChangeProposal={updateWorkflowChangeProposal}
            key={String(run.id ?? run.label)}
          />
        ))}
      </CardContent>
    </Card>
  )
}

function BenchmarkRunSummary({
  busy,
  launchWorkflowProposalValidation,
  run,
  updateWorkflowChangeProposal,
}: {
  busy: string | null
  launchWorkflowProposalValidation: (benchmarkRunId: string, proposalId: string) => Promise<void>
  run: JsonRecord
  updateWorkflowChangeProposal: (
    benchmarkRunId: string,
    proposalId: string,
    status: WorkflowChangeProposalStatus,
    implementationStatus?: WorkflowChangeProposalImplementationStatus,
  ) => Promise<void>
}) {
  const promotionGate = isRecord(run.promotionGate) ? run.promotionGate : null
  const baselineSanity = isRecord(run.baselineSanityFindings) ? run.baselineSanityFindings : null
  const componentDisagreement = isRecord(run.componentDisagreementFindings) ? run.componentDisagreementFindings : null
  const forecastError = isRecord(run.forecastErrorFindings) ? run.forecastErrorFindings : null
  const splitFindings = isRecord(run.splitFindings) ? run.splitFindings : null
  const sourceQuality = isRecord(run.sourceQualityFindings) ? run.sourceQualityFindings : null
  const traceQuality = isRecord(run.traceQualityFindings) ? run.traceQualityFindings : null
  const comparison = isRecord(run.comparison) ? run.comparison : null
  const recommendation = isRecord(comparison?.recommendation) ? comparison.recommendation : null
  const workflowChangeProposals = readArray(run, "workflowChangeProposals").filter(isRecord)
  const blockers = readArray(promotionGate, "blockers").filter((blocker): blocker is string => typeof blocker === "string")
  const recommendationStatus = typeof promotionGate?.recommendationStatus === "string" ? promotionGate.recommendationStatus : null
  const primaryBaselineBenchmarkRunId = typeof recommendation?.primaryBaselineBenchmarkRunId === "string" ? recommendation.primaryBaselineBenchmarkRunId : null
  const missingBaselineSanity = typeof baselineSanity?.missingBaselineSanityCases === "number" ? baselineSanity.missingBaselineSanityCases : null
  const casesWithBaseline = typeof baselineSanity?.casesWithBaseline === "number" ? baselineSanity.casesWithBaseline : null
  const highDisagreementCases = typeof componentDisagreement?.highDisagreementCases === "number" ? componentDisagreement.highDisagreementCases : null
  const unexplainedHighDisagreement = typeof componentDisagreement?.unexplainedHighDisagreementCases === "number" ? componentDisagreement.unexplainedHighDisagreementCases : null
  const largeMissCases = typeof forecastError?.largeProbabilityMissCases === "number" ? forecastError.largeProbabilityMissCases : null
  const worseThanBaselineCases = typeof forecastError?.worseThanBaselineCases === "number" ? forecastError.worseThanBaselineCases : null
  const holdoutCaseResults = typeof splitFindings?.holdoutCaseResults === "number" ? splitFindings.holdoutCaseResults : null
  const requiredHoldoutCaseResults = typeof splitFindings?.requiredHoldoutCaseResults === "number" ? splitFindings.requiredHoldoutCaseResults : null
  const sourceLeakageCases = typeof sourceQuality?.sourceLeakageCases === "number" ? sourceQuality.sourceLeakageCases : null
  const informationAdvantageCases = typeof sourceQuality?.informationAdvantageCases === "number" ? sourceQuality.informationAdvantageCases : null
  const humanForecastSourceCases = typeof sourceQuality?.humanForecastSourceCases === "number" ? sourceQuality.humanForecastSourceCases : null
  const weakTraceCompletenessCases = typeof traceQuality?.weakTraceCompletenessCases === "number" ? traceQuality.weakTraceCompletenessCases : null
  const missingProbabilityCases = typeof traceQuality?.missingProbabilityCases === "number" ? traceQuality.missingProbabilityCases : null
  const missingScoreRowsCases = typeof traceQuality?.missingScoreRowsCases === "number" ? traceQuality.missingScoreRowsCases : null
  const missingAggregateRationaleCases = typeof traceQuality?.missingAggregateRationaleCases === "number" ? traceQuality.missingAggregateRationaleCases : null
  const benchmarkRunId = typeof run.id === "string" ? run.id : null
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate font-medium">{String(run.experimentLabel ?? run.evalMode ?? "benchmark")}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {String(run.status ?? "unknown")} · {String(run.completedCases ?? 0)} completed · {String(run.reviewCases ?? 0)} review
          </span>
        </span>
        <Badge variant={promotionGate?.status === "review_for_promotion" ? "outline" : "secondary"} className="shrink-0">
          {String(promotionGate?.status ?? "no gate")}
        </Badge>
      </div>
      {recommendationStatus ? (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          comparison {recommendationStatus}{primaryBaselineBenchmarkRunId ? ` · primary ${primaryBaselineBenchmarkRunId}` : ""}
        </p>
      ) : null}
      {baselineSanity ? (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          baseline sanity {String(casesWithBaseline ?? 0)} cases · {String(missingBaselineSanity ?? 0)} missing
        </p>
      ) : null}
      {componentDisagreement ? (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          component spread {String(highDisagreementCases ?? 0)} high · {String(unexplainedHighDisagreement ?? 0)} unexplained
        </p>
      ) : null}
      {forecastError ? (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          forecast error {String(largeMissCases ?? 0)} large miss · {String(worseThanBaselineCases ?? 0)} worse baseline
        </p>
      ) : null}
      {splitFindings ? (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          holdout evidence {String(holdoutCaseResults ?? 0)}/{String(requiredHoldoutCaseResults ?? 0)} cases
        </p>
      ) : null}
      {sourceQuality ? (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          source quality {String(sourceLeakageCases ?? 0)} cutoff leak · {String(informationAdvantageCases ?? 0)} info advantage · {String(humanForecastSourceCases ?? 0)} human forecast
        </p>
      ) : null}
      {traceQuality ? (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          trace quality {String(weakTraceCompletenessCases ?? 0)} weak · {String(missingProbabilityCases ?? 0)} missing probability · {String(missingScoreRowsCases ?? 0)} missing score · {String(missingAggregateRationaleCases ?? 0)} missing rationale
        </p>
      ) : null}
      {blockers.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {blockers.slice(0, 3).map((blocker) => (
            <Badge variant="secondary" className="max-w-full truncate" key={blocker}>
              {blocker}
            </Badge>
          ))}
        </div>
      ) : null}
      {workflowChangeProposals.length ? (
        <div className="mt-3 border-t pt-3">
          <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Workflow proposals</p>
          <div className="flex flex-col gap-2">
            {workflowChangeProposals.slice(0, 2).map((proposal) => (
              <WorkflowProposalSummary
                benchmarkRunId={benchmarkRunId}
                busy={busy}
                launchWorkflowProposalValidation={launchWorkflowProposalValidation}
                proposal={proposal}
                updateWorkflowChangeProposal={updateWorkflowChangeProposal}
                key={String(proposal.id ?? proposal.proposedChange)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function WorkflowProposalSummary({
  benchmarkRunId,
  busy,
  launchWorkflowProposalValidation,
  proposal,
  updateWorkflowChangeProposal,
}: {
  benchmarkRunId: string | null
  busy: string | null
  launchWorkflowProposalValidation: (benchmarkRunId: string, proposalId: string) => Promise<void>
  proposal: JsonRecord
  updateWorkflowChangeProposal: (
    benchmarkRunId: string,
    proposalId: string,
    status: WorkflowChangeProposalStatus,
    implementationStatus?: WorkflowChangeProposalImplementationStatus,
  ) => Promise<void>
}) {
  const proposalId = typeof proposal.id === "string" ? proposal.id : null
  const status = normalizeProposalStatus(proposal.status)
  const implementationStatus = normalizeProposalImplementationStatus(proposal.implementationStatus)
  const implementationTaskTitle = typeof proposal.implementationTaskTitle === "string" ? proposal.implementationTaskTitle : null
  const implementationExperimentLabel = typeof proposal.implementationExperimentLabel === "string" ? proposal.implementationExperimentLabel : null
  const validationBenchmarkRunId = typeof proposal.validationBenchmarkRunId === "string" ? proposal.validationBenchmarkRunId : null
  const validationResultStatus = typeof proposal.validationResultStatus === "string" ? proposal.validationResultStatus : null
  const validationResultSummary = typeof proposal.validationResultSummary === "string" ? proposal.validationResultSummary : null
  const validationMeanBrierDelta = typeof proposal.validationMeanBrierDelta === "number" ? proposal.validationMeanBrierDelta : null
  const validationGateStatus = typeof proposal.validationGateStatus === "string" ? proposal.validationGateStatus : null
  const validationGateBlockers = readArray(proposal, "validationGateBlockers").filter((blocker): blocker is string => typeof blocker === "string")
  const validationComparisonReport = isRecord(proposal.validationComparisonReport) ? proposal.validationComparisonReport : null
  const validationRecommendation = isRecord(validationComparisonReport?.recommendation) ? validationComparisonReport.recommendation : null
  const validationRecommendationStatus = typeof validationRecommendation?.status === "string" ? validationRecommendation.status : null
  const validationPrimaryBaselineId =
    typeof validationRecommendation?.primaryBaselineBenchmarkRunId === "string" ? validationRecommendation.primaryBaselineBenchmarkRunId : null
  const validationBaselines = readArray(validationComparisonReport, "baselines").filter(isRecord)
  const validationPrimaryBaseline =
    validationBaselines.find((baseline) => baseline.baselineBenchmarkRunId === validationPrimaryBaselineId) ?? validationBaselines[0] ?? null
  const validationPairedMeanBrierDelta =
    typeof validationPrimaryBaseline?.pairedMeanBrierDelta === "number" ? validationPrimaryBaseline.pairedMeanBrierDelta : null
  const reviewedBy = typeof proposal.reviewedBy === "string" ? proposal.reviewedBy : null
  const reviewedAt = typeof proposal.reviewedAt === "string" ? proposal.reviewedAt : null
  const canUpdate = Boolean(benchmarkRunId && proposalId)
  const canMarkImplemented = validationResultStatus === "completed"
  const updateStatus = (
    nextStatus: WorkflowChangeProposalStatus,
    nextImplementationStatus?: WorkflowChangeProposalImplementationStatus,
  ) => {
    if (!benchmarkRunId || !proposalId) {
      return
    }
    void updateWorkflowChangeProposal(benchmarkRunId, proposalId, nextStatus, nextImplementationStatus)
  }
  const launchValidation = () => {
    if (!benchmarkRunId || !proposalId) {
      return
    }
    void launchWorkflowProposalValidation(benchmarkRunId, proposalId)
  }
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-xs font-medium">
          {String(proposal.targetWorkflowId ?? "workflow")}
        </span>
        <Badge variant="secondary">{status}</Badge>
        <Badge variant="outline">risk {String(proposal.overfitRisk ?? "unknown")}</Badge>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {String(proposal.proposedChange ?? proposal.problemStatement ?? "No proposed change recorded.")}
      </p>
      {proposal.validationPlan ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          validation {String(proposal.validationPlan)}
        </p>
      ) : null}
      {reviewedBy || reviewedAt ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          reviewed {reviewedBy ?? "local-user"}{reviewedAt ? ` · ${reviewedAt}` : ""}
        </p>
      ) : null}
      {implementationStatus !== "not_started" ? (
        <div className="mt-2 rounded-sm bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
          <p className="truncate">
            implementation {implementationStatus}{implementationExperimentLabel ? ` · ${implementationExperimentLabel}` : ""}
          </p>
          {implementationTaskTitle ? <p className="mt-1 line-clamp-1">{implementationTaskTitle}</p> : null}
          {validationBenchmarkRunId ? (
            <p className="mt-1 truncate">
              validation run {validationBenchmarkRunId}{validationResultStatus ? ` · ${validationResultStatus}` : ""}
              {validationMeanBrierDelta === null ? "" : ` · delta ${formatMetric(validationMeanBrierDelta)}`}
            </p>
          ) : null}
          {validationResultSummary ? <p className="mt-1 line-clamp-2">{validationResultSummary}</p> : null}
          {validationRecommendationStatus ? (
            <p className="mt-1 truncate">
              comparison {validationRecommendationStatus}
              {validationPairedMeanBrierDelta === null ? "" : ` · paired delta ${formatMetric(validationPairedMeanBrierDelta)}`}
            </p>
          ) : null}
          {validationGateStatus ? (
            <p className="mt-1 truncate">
              gate {validationGateStatus}{validationGateBlockers.length ? ` · ${validationGateBlockers.slice(0, 2).join(", ")}` : ""}
            </p>
          ) : null}
        </div>
      ) : null}
      {canUpdate ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {(["accepted", "rejected", "implemented"] as const).map((nextStatus) => (
            <Button
              disabled={busy !== null || status === nextStatus || (nextStatus === "implemented" && !canMarkImplemented)}
              key={nextStatus}
              onClick={() => updateStatus(nextStatus, implementationStatusForAction(nextStatus))}
              size="xs"
              type="button"
              variant={nextStatus === "rejected" ? "destructive" : "outline"}
            >
              {nextStatus}
            </Button>
          ))}
          {status === "accepted" && implementationStatus === "planned" ? (
            <Button
              disabled={busy !== null}
              onClick={() => updateStatus("accepted", "in_progress")}
              size="xs"
              type="button"
              variant="outline"
            >
              start patch
            </Button>
          ) : null}
          {status === "accepted" && implementationStatus !== "not_started" && !validationBenchmarkRunId ? (
            <Button
              disabled={busy !== null}
              onClick={launchValidation}
              size="xs"
              type="button"
              variant="outline"
            >
              run validation
            </Button>
          ) : null}
          {status !== "candidate" ? (
            <Button
              disabled={busy !== null}
              onClick={() => updateStatus("candidate", "not_started")}
              size="xs"
              type="button"
              variant="ghost"
            >
              reopen
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function normalizeProposalStatus(value: unknown): WorkflowChangeProposalStatus {
  return value === "accepted" || value === "rejected" || value === "implemented" ? value : "candidate"
}

function normalizeProposalImplementationStatus(value: unknown): WorkflowChangeProposalImplementationStatus {
  return value === "planned" || value === "in_progress" || value === "validated" ? value : "not_started"
}

function implementationStatusForAction(status: WorkflowChangeProposalStatus): WorkflowChangeProposalImplementationStatus | undefined {
  if (status === "accepted") {
    return "planned"
  }
  if (status === "implemented") {
    return "validated"
  }
  return undefined
}

export function PerformanceCard({ performance }: { performance: JsonRecord | null }) {
  const summary = isRecord(performance?.summary) ? performance.summary : {}
  const groups = isRecord(performance?.groups) ? performance.groups : {}
  const byForecastType = readArray(groups, "byForecastType").filter(isRecord)
  const byCalibrationGuard = readArray(groups, "byCalibrationGuard").filter(isRecord)
  const bestForecasts = readArray(performance, "bestResolvedForecasts").filter(isRecord)
  const worstForecasts = readArray(performance, "worstResolvedForecasts").filter(isRecord)
  const scoreTrends = readArray(performance, "scoreTrends").filter(isRecord)
  const needsAttention = readArray(performance, "needsAttention").filter(isRecord)
  const calibrationBuckets = readArray(performance, "calibrationBuckets").filter(isRecord)
  const candidateCalibrationGuardRules = readArray(performance, "candidateCalibrationGuardRules").filter(isRecord)
  const calibrationSummary = isRecord(performance?.calibrationSummary) ? performance.calibrationSummary : null
  const calibrationGuardImpact = isRecord(performance?.calibrationGuardImpact) ? performance.calibrationGuardImpact : null
  return (
    <Card id="performance">
      <CardHeader>
        <CardTitle>Forecast performance</CardTitle>
        <CardDescription>
          {String(summary.resolvedTasks ?? 0)} resolved tasks · {String(summary.productScoreRows ?? 0)} score rows
        </CardDescription>
        <CardAction>
          <TrendingUp className="text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {byForecastType.length ? (
          byForecastType.slice(0, 6).map((group) => (
            <div className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-[1fr_auto]" key={String(group.key ?? group.label)}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{String(group.label ?? group.key ?? "forecast type")}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {String(group.resolvedTasks ?? 0)} tasks · {String(group.scoreRows ?? 0)} rows
                </span>
              </span>
              <Badge variant="secondary">
                {String(group.primaryMetric ?? "metric")} {formatMetric(group.primaryMean)}
              </Badge>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No resolved score rows yet.</p>
        )}
        {bestForecasts.length || worstForecasts.length ? (
          <div className="grid gap-3 border-t pt-3 md:grid-cols-2">
            <PerformanceCaseList title="Best" cases={bestForecasts} />
            <PerformanceCaseList title="Worst" cases={worstForecasts} />
          </div>
        ) : null}
        {scoreTrends.length ? <PerformanceTrendList trends={scoreTrends} /> : null}
        {calibrationGuardImpact ? <PerformanceGuardImpact impact={calibrationGuardImpact} /> : null}
        {byCalibrationGuard.length ? <PerformanceGuardGroupList groups={byCalibrationGuard} /> : null}
        {calibrationBuckets.length ? <PerformanceCalibrationList buckets={calibrationBuckets} summary={calibrationSummary} /> : null}
        {candidateCalibrationGuardRules.length ? <PerformanceCandidateGuardList rules={candidateCalibrationGuardRules} /> : null}
        {needsAttention.length ? <PerformanceAttentionList items={needsAttention} /> : null}
      </CardContent>
    </Card>
  )
}

export function MaintenanceCard({
  actions,
  busy,
  runMaintenance,
}: {
  actions: string[]
  busy: string | null
  runMaintenance: (action: string) => Promise<void>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Maintenance</CardTitle>
        <CardDescription>Run local cleanup and repair jobs.</CardDescription>
        <CardAction>
          <Wrench className="text-primary" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {actions.slice(0, 6).map((action) => (
          <Button className="w-full justify-start" disabled={busy !== null} key={action} onClick={() => void runMaintenance(action)} type="button" variant="outline">
            <Wrench data-icon="inline-start" />
            {action}
          </Button>
        ))}
        <Separator />
        <p className="text-xs text-muted-foreground">Jobs are written to the local maintenance ledger.</p>
      </CardContent>
    </Card>
  )
}

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-medium">{value}</p>
        </div>
        <Icon className="text-primary" />
      </CardContent>
    </Card>
  )
}

function formatMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : ""
}

function formatSignedMetric(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return ""
  }
  const rounded = Math.round(value * 10000) / 10000
  return `${rounded >= 0 ? "+" : ""}${rounded}`
}

function PerformanceCaseList({ title, cases }: { title: string; cases: JsonRecord[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">{title}</p>
      <div className="flex flex-col gap-2">
        {cases.slice(0, 3).map((item) => {
          const guard = isRecord(item.calibrationGuard) ? item.calibrationGuard : null
          const guardRules = readArray(guard, "appliedRules").filter(isRecord)
          const guardAdjustment = typeof guard?.adjustment === "number" ? guard.adjustment : null
          return (
            <Link className="rounded-md border px-3 py-2 text-sm hover:bg-muted/50" href={`/runs/${String(item.taskId ?? "")}`} key={String(item.taskId ?? item.taskLabel)}>
              <span className="block truncate font-medium">{String(item.taskLabel ?? item.taskId ?? "forecast")}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {String(item.primaryMetric ?? "score")} {formatMetric(item.primaryScore)}
              </span>
              {guardRules.length || guardAdjustment !== null ? (
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  guard {guardAdjustment === null ? "0" : `${guardAdjustment >= 0 ? "+" : ""}${formatMetric(guardAdjustment)}`} · {guardRules.length} rule{guardRules.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function PerformanceTrendList({ trends }: { trends: JsonRecord[] }) {
  const visibleTrends = trends
    .filter((trend) => trend.direction !== "insufficient_data")
    .slice(0, 4)
  if (visibleTrends.length === 0) {
    return null
  }
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Trends</p>
      <div className="grid gap-2 md:grid-cols-2">
        {visibleTrends.map((trend) => (
          <div className="rounded-md border px-3 py-2 text-sm" key={String(trend.key ?? `${trend.label}-${trend.metric}`)}>
            <span className="block truncate font-medium">{String(trend.label ?? "window")} · {String(trend.metric ?? "metric")}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {String(trend.direction ?? "trend")} · delta {formatMetric(trend.delta)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformanceGuardImpact({ impact }: { impact: JsonRecord }) {
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Calibration guard impact</p>
      <div className="grid gap-2 md:grid-cols-3">
        <div className="rounded-md border px-3 py-2 text-sm">
          <span className="block truncate font-medium">{String(impact.status ?? "unknown")}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {String(impact.guardedResolvedTasks ?? 0)} guarded tasks · {String(impact.unguardedResolvedTasks ?? 0)} unguarded
          </span>
        </div>
        <div className="rounded-md border px-3 py-2 text-sm">
          <span className="block truncate font-medium">guarded {formatMetric(impact.guardedMeanBrier) || "unknown"}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            mean Brier · {String(impact.guardedRows ?? 0)} rows
          </span>
        </div>
        <div className="rounded-md border px-3 py-2 text-sm">
          <span className="block truncate font-medium">delta {formatSignedMetric(impact.brierDelta) || "unknown"}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            versus unguarded {formatMetric(impact.unguardedMeanBrier) || "unknown"}
          </span>
        </div>
      </div>
    </div>
  )
}

function PerformanceGuardGroupList({ groups }: { groups: JsonRecord[] }) {
  const visibleGroups = groups.filter((group) => String(group.key ?? "") !== "unguarded").slice(0, 4)
  if (visibleGroups.length === 0) {
    return null
  }
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Calibration guard outcomes</p>
      <div className="grid gap-2 md:grid-cols-2">
        {visibleGroups.map((group) => (
          <div className="rounded-md border px-3 py-2 text-sm" key={String(group.key ?? group.label)}>
            <span className="block truncate font-medium">{String(group.label ?? group.key ?? "guard")}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {String(group.resolvedTasks ?? 0)} tasks · {String(group.primaryMetric ?? "metric")} {formatMetric(group.primaryMean)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformanceCalibrationList({ buckets, summary }: { buckets: JsonRecord[]; summary: JsonRecord | null }) {
  const populatedBuckets = buckets.filter((bucket) => typeof bucket.count === "number" && bucket.count > 0)
  if (populatedBuckets.length === 0) {
    return null
  }
  return (
    <div className="border-t pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase text-muted-foreground">Calibration</p>
        <Badge variant="secondary">
          ECE {formatMetric(summary?.expectedCalibrationError)}
        </Badge>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {populatedBuckets.slice(0, 6).map((bucket) => (
          <div className="rounded-md border px-3 py-2 text-sm" key={String(bucket.label ?? bucket.minProbability)}>
            <span className="block truncate font-medium">{String(bucket.label ?? "bucket")}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {String(bucket.count ?? 0)} cases · forecast {formatMetric(bucket.meanForecast)} · observed {formatMetric(bucket.observedRate)}
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              error {formatMetric(bucket.calibrationError)} · Brier {formatMetric(bucket.meanBrier)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformanceCandidateGuardList({ rules }: { rules: JsonRecord[] }) {
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Candidate calibration guards</p>
      <div className="grid gap-2 md:grid-cols-2">
        {rules.slice(0, 4).map((rule) => {
          const adjustment = typeof rule.suggestedAdjustment === "number" ? rule.suggestedAdjustment : null
          return (
            <div className="rounded-md border px-3 py-2 text-sm" key={String(rule.id ?? rule.bucketLabel)}>
              <span className="block truncate font-medium">
                {String(rule.bucketLabel ?? "bucket")} · {adjustment === null ? "review" : `${adjustment >= 0 ? "+" : ""}${formatMetric(adjustment)} pts`}
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {String(rule.activationStatus ?? "review")} · {String(rule.direction ?? "drift")} · {String(rule.sampleSize ?? 0)} cases
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                forecast {formatMetric(rule.meanForecast)} · observed {formatMetric(rule.observedRate)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PerformanceAttentionList({ items }: { items: JsonRecord[] }) {
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Needs attention</p>
      <div className="flex flex-col gap-2">
        {items.slice(0, 4).map((item) => {
          const taskId = typeof item.taskId === "string" ? item.taskId : null
          const recommendedActions = readArray(item, "recommendedActions").filter((value): value is string => typeof value === "string")
          const content = (
            <>
              <span className="block truncate font-medium">{String(item.taskLabel ?? item.kind ?? "attention item")}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {String(item.severity ?? "medium")} · {String(item.metric ?? "metric")} {formatMetric(item.score)}
              </span>
              {recommendedActions[0] ? (
                <span className="mt-1 block truncate text-xs text-muted-foreground">{recommendedActions[0]}</span>
              ) : null}
            </>
          )
          return taskId ? (
            <Link className="rounded-md border px-3 py-2 text-sm hover:bg-muted/50" href={`/runs/${taskId}`} key={String(item.id ?? taskId)}>
              {content}
            </Link>
          ) : (
            <div className="rounded-md border px-3 py-2 text-sm" key={String(item.id ?? item.reason)}>
              {content}
            </div>
          )
        })}
      </div>
    </div>
  )
}
