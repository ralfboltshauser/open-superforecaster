"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { Activity, AlertTriangle, BarChart3, Database, FlaskConical, Play, Server, ShieldCheck, TrendingUp, Wrench } from "lucide-react"

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
import { formatModeLabel, isRecord, readArray, readNumber, readString, runTitle, statusTone, type JsonRecord } from "@/lib/records"

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

export function DiagnosticsCard({ diagnosticCounts, diagnostics }: { diagnosticCounts: DiagnosticCounts; diagnostics: JsonRecord | null }) {
  const localState = isRecord(diagnostics?.localState) ? diagnostics.localState : {}
  const sourceDomains = readArray(localState, "sourceDomains").filter(isRecord)
  const sourceDomainCount = readNumber(localState, "sourceDomainCount") ?? sourceDomains.length
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
        {sourceDomains.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">Source domains ({formatCount(sourceDomainCount)})</p>
            {sourceDomains.slice(0, 4).map((row) => (
              <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs" key={String(row.domain ?? "domain")}>
                <span className="min-w-0 truncate font-medium">{String(row.domain ?? "unknown")}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatCount(readNumber(row, "entries") ?? 0)} sources · {formatCount(readNumber(row, "usedInFinalEntries") ?? 0)} final
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function ForecastBatchHealthCard({ forecastBatchHealth }: { forecastBatchHealth: JsonRecord | null }) {
  const summary = isRecord(forecastBatchHealth?.summary) ? forecastBatchHealth.summary : {}
  const issues = readArray(forecastBatchHealth, "issues").filter(isRecord)
  const attentionByKind = readArray(forecastBatchHealth, "attentionByKind").filter(isRecord)
  const attentionBySeverity = readArray(forecastBatchHealth, "attentionBySeverity").filter(isRecord)
  const attentionByForecastType = readArray(forecastBatchHealth, "attentionByForecastType").filter(isRecord)
  const attentionItems = readArray(forecastBatchHealth, "attentionItems").filter(isRecord)
  const candidateRules = readArray(forecastBatchHealth, "candidateCalibrationGuardRules").filter(isRecord)
  const missingPhases = readArray(forecastBatchHealth, "missingPhases").filter((phase): phase is string => typeof phase === "string")
  const batchId = readString(forecastBatchHealth, "batchId") ?? "latest batch"
  const status = readString(forecastBatchHealth, "status") ?? "missing"
  const exists = forecastBatchHealth?.exists === true
  const unresolvedAttention = readNumber(summary, "unresolvedAttentionItems") ?? 0
  const openAttention = readNumber(summary, "openAttentionItems") ?? 0
  const deferredAttention = readNumber(summary, "deferredAttentionItems") ?? 0
  const unresolvedCandidateRules = readNumber(summary, "unresolvedCandidateCalibrationGuardRules") ?? 0
  const scoreRegressions = readNumber(summary, "scoreRegressionItems") ?? 0
  const guardRegressions = readNumber(summary, "calibrationGuardRegressionItems") ?? 0
  return (
    <Card id="forecast-batch-health">
      <CardHeader>
        <CardTitle>Forecast batch health</CardTitle>
        <CardDescription>{exists ? batchId : "No local batch health report found"}</CardDescription>
        <CardAction>
          <AlertTriangle className={status === "healthy" ? "text-muted-foreground" : "text-destructive"} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status === "healthy" ? "outline" : "destructive"}>{status}</Badge>
          <Badge variant="secondary">{unresolvedAttention} unresolved attention</Badge>
          <Badge variant="secondary">{unresolvedCandidateRules} candidate guards</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <BatchHealthMetric label="open" value={formatCount(openAttention)} />
          <BatchHealthMetric label="deferred" value={formatCount(deferredAttention)} />
          <BatchHealthMetric label="score regressions" value={formatCount(scoreRegressions)} />
          <BatchHealthMetric label="guard regressions" value={formatCount(guardRegressions)} />
        </div>
        {missingPhases.length ? (
          <div className="flex flex-wrap gap-1">
            {missingPhases.map((phase) => (
              <Badge variant="secondary" className="max-w-full truncate" key={phase}>
                missing {phase}
              </Badge>
            ))}
          </div>
        ) : null}
        {attentionByKind.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">Top attention categories</p>
            {attentionByKind.slice(0, 3).map((row) => {
              const open = readNumber(row, "open") ?? 0
              const deferred = readNumber(row, "deferred") ?? 0
              const high = readNumber(row, "high") ?? 0
              return (
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs" key={String(row.kind ?? "kind")}>
                  <span className="min-w-0 truncate font-medium">{String(row.kind ?? "attention")}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatCount(open + deferred)} unresolved · {formatCount(high)} high
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}
        {attentionBySeverity.length ? (
          <div className="flex flex-wrap gap-1">
            {attentionBySeverity.map((row) => (
              <Badge variant={row.severity === "high" ? "destructive" : "secondary"} key={String(row.severity ?? "severity")}>
                {String(row.severity ?? "unknown")} {formatCount((readNumber(row, "open") ?? 0) + (readNumber(row, "deferred") ?? 0))}
              </Badge>
            ))}
          </div>
        ) : null}
        {attentionByForecastType.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">Attention by forecast type</p>
            {attentionByForecastType.slice(0, 4).map((row) => {
              const open = readNumber(row, "open") ?? 0
              const deferred = readNumber(row, "deferred") ?? 0
              const high = readNumber(row, "high") ?? 0
              return (
                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs" key={String(row.forecastType ?? "forecast-type")}>
                  <span className="min-w-0 truncate font-medium">{String(row.forecastType ?? "unknown")}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatCount(open + deferred)} unresolved · {formatCount(high)} high
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}
        {attentionItems.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">Top attention items</p>
            {attentionItems.slice(0, 3).map((item) => (
              <div className="rounded-md border px-3 py-2 text-xs" key={String(item.id ?? item.reason ?? "attention")}>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate font-medium">{String(item.taskLabel ?? item.taskId ?? item.kind ?? "attention")}</span>
                  <Badge variant={item.severity === "high" ? "destructive" : "secondary"}>{String(item.reviewStatus ?? "open")}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-muted-foreground">{String(item.reason ?? "")}</p>
                {item.recommendedAction ? <p className="mt-1 line-clamp-1 text-muted-foreground">{String(item.recommendedAction)}</p> : null}
                {item.reviewNote ? (
                  <p className="mt-1 line-clamp-1 text-muted-foreground">
                    note: {String(item.reviewNote)}
                    {item.reviewer ? ` · ${String(item.reviewer)}` : ""}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {candidateRules.length ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase text-muted-foreground">Candidate guard rules</p>
            {candidateRules.slice(0, 2).map((rule) => (
              <div className="rounded-md border px-3 py-2 text-xs" key={String(rule.id ?? rule.bucketLabel ?? "candidate-rule")}>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate font-medium">{String(rule.bucketLabel ?? "bucket")} · {String(rule.direction ?? "drift")}</span>
                  <Badge variant={rule.reviewStatus === "open" ? "destructive" : "secondary"}>{String(rule.reviewStatus ?? "open")}</Badge>
                </div>
                <p className="mt-1 truncate text-muted-foreground">
                  adjustment {formatSignedCount(readNumber(rule, "suggestedAdjustment"))} pts · n={formatCount(readNumber(rule, "sampleSize") ?? 0)}
                </p>
                {rule.reviewNote ? (
                  <p className="mt-1 line-clamp-1 text-muted-foreground">
                    note: {String(rule.reviewNote)}
                    {rule.reviewer ? ` · ${String(rule.reviewer)}` : ""}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {issues.length ? (
          <div className="flex flex-col gap-2">
            {issues.slice(0, 3).map((issue) => (
              <div className="rounded-md border px-3 py-2 text-xs" key={`${String(issue.kind)}:${String(issue.message)}`}>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate font-medium">{String(issue.kind ?? "issue")}</span>
                  <Badge variant={issue.severity === "high" ? "destructive" : "secondary"}>{String(issue.severity ?? "unknown")}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-muted-foreground">{String(issue.message ?? "")}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No batch health issues reported.</p>
        )}
      </CardContent>
    </Card>
  )
}

function BatchHealthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <span className="mt-1 block truncate font-medium">{value}</span>
    </div>
  )
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)
}

function formatSignedCount(value: number | null) {
  if (value === null) {
    return "n/a"
  }
  return `${value >= 0 ? "+" : ""}${formatCount(value)}`
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
  const costLatency = isRecord(run.costLatencyFindings) ? run.costLatencyFindings : null
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
  const measuredCostCases = typeof costLatency?.measuredCases === "number" ? costLatency.measuredCases : null
  const totalAgentCalls = typeof costLatency?.totalAgentCalls === "number" ? costLatency.totalAgentCalls : null
  const totalTokens = typeof costLatency?.totalTokens === "number" ? costLatency.totalTokens : null
  const meanDurationSeconds = typeof costLatency?.meanDurationSeconds === "number" ? costLatency.meanDurationSeconds : null
  const heaviestCostCases = readArray(costLatency, "heaviestCases").filter(isRecord)
  const slowestCostCases = readArray(costLatency, "slowestCases").filter(isRecord)
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
      {costLatency ? (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          cost {formatCount(measuredCostCases ?? 0)} measured · {formatCount(totalAgentCalls ?? 0)} calls · {formatCount(totalTokens ?? 0)} tokens{meanDurationSeconds === null ? "" : ` · ${formatMetric(meanDurationSeconds)}s avg`}
        </p>
      ) : null}
      {heaviestCostCases.length || slowestCostCases.length ? (
        <BenchmarkCostOutlierSummary heaviestCases={heaviestCostCases} slowestCases={slowestCostCases} />
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

function BenchmarkCostOutlierSummary({
  heaviestCases,
  slowestCases,
}: {
  heaviestCases: JsonRecord[]
  slowestCases: JsonRecord[]
}) {
  return (
    <div className="mt-2 grid gap-2 md:grid-cols-2">
      <BenchmarkCostOutlierList cases={heaviestCases} label="Heaviest cost cases" metric="tokens" />
      <BenchmarkCostOutlierList cases={slowestCases} label="Slowest cost cases" metric="duration" />
    </div>
  )
}

function BenchmarkCostOutlierList({
  cases,
  label,
  metric,
}: {
  cases: JsonRecord[]
  label: string
  metric: "duration" | "tokens"
}) {
  if (!cases.length) {
    return null
  }
  return (
    <div className="min-w-0 rounded-sm bg-muted/40 px-2 py-1.5 text-xs">
      <p className="mb-1 font-medium uppercase text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-1">
        {cases.slice(0, 3).map((row, index) => {
          const taskId = typeof row.taskId === "string" ? row.taskId : null
          const caseId = typeof row.benchmarkCaseId === "string" ? row.benchmarkCaseId : null
          const caseResultId = typeof row.benchmarkCaseResultId === "string" ? row.benchmarkCaseResultId : null
          const status = typeof row.status === "string" ? row.status : "unknown"
          const agentCalls = readNumber(row, "agentCalls") ?? 0
          const totalTokens = readNumber(row, "totalTokens")
          const durationSeconds = readNumber(row, "durationSeconds")
          const title = taskId ?? caseId ?? caseResultId ?? `case ${index + 1}`
          const metricText = formatBenchmarkCostOutlierMetric(metric, { durationSeconds, totalTokens })
          return (
            <div className="min-w-0" key={`${label}:${caseResultId ?? taskId ?? caseId ?? index}`}>
              <p className="truncate font-medium">
                {taskId ? (
                  <Link className="hover:underline" href={`/runs/${taskId}`}>
                    {title}
                  </Link>
                ) : (
                  title
                )}
              </p>
              <p className="truncate text-muted-foreground">
                {metricText} · {formatCount(agentCalls)} calls · {status}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatBenchmarkCostOutlierMetric(
  metric: "duration" | "tokens",
  values: { durationSeconds: number | null; totalTokens: number | null },
) {
  if (metric === "tokens") {
    return `${formatCount(values.totalTokens ?? 0)} tokens`
  }
  return values.durationSeconds === null ? "duration n/a" : `${formatMetric(values.durationSeconds)}s`
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
  const validationCostTotalTokensDelta = typeof proposal.validationCostTotalTokensDelta === "number" ? proposal.validationCostTotalTokensDelta : null
  const validationCostAgentCallsDelta = typeof proposal.validationCostAgentCallsDelta === "number" ? proposal.validationCostAgentCallsDelta : null
  const validationCostMeanDurationSecondsDelta =
    typeof proposal.validationCostMeanDurationSecondsDelta === "number" ? proposal.validationCostMeanDurationSecondsDelta : null
  const validationCostSummary = typeof proposal.validationCostSummary === "string" ? proposal.validationCostSummary : null
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
          {validationCostSummary ? <p className="mt-1 line-clamp-2">{validationCostSummary}</p> : null}
          {validationCostTotalTokensDelta !== null || validationCostAgentCallsDelta !== null || validationCostMeanDurationSecondsDelta !== null ? (
            <p className="mt-1 truncate">
              cost delta
              {validationCostTotalTokensDelta === null ? "" : ` · ${formatSignedMetric(validationCostTotalTokensDelta)} tokens`}
              {validationCostAgentCallsDelta === null ? "" : ` · ${formatSignedMetric(validationCostAgentCallsDelta)} calls`}
              {validationCostMeanDurationSecondsDelta === null ? "" : ` · ${formatSignedMetric(validationCostMeanDurationSecondsDelta)}s mean`}
            </p>
          ) : null}
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
  const byForecastAttemptCount = readArray(groups, "byForecastAttemptCount").filter(isRecord)
  const byCalibrationGuard = readArray(groups, "byCalibrationGuard").filter(isRecord)
  const byBinaryConfidence = readArray(groups, "byBinaryConfidence").filter(isRecord)
  const byBinaryForecastSide = readArray(groups, "byBinaryForecastSide").filter(isRecord)
  const byBaselineSanity = readArray(groups, "byBaselineSanity").filter(isRecord)
  const byMarketAnchor = readArray(groups, "byMarketAnchor").filter(isRecord)
  const byResolutionBoundary = readArray(groups, "byResolutionBoundary").filter(isRecord)
  const byUncertaintyRange = readArray(groups, "byUncertaintyRange").filter(isRecord)
  const byComponentWeighting = readArray(groups, "byComponentWeighting").filter(isRecord)
  const byAggregateQuality = readArray(groups, "byAggregateQuality").filter(isRecord)
  const byAggregateQualityRounds = readArray(groups, "byAggregateQualityRounds").filter(isRecord)
  const byAggregateQualityIssues = readArray(groups, "byAggregateQualityIssues").filter(isRecord)
  const byAggregateDisagreement = readArray(groups, "byAggregateDisagreement").filter(isRecord)
  const byAggregateFinalComponentPosition = readArray(groups, "byAggregateFinalComponentPosition").filter(isRecord)
  const byAggregateSideAgreement = readArray(groups, "byAggregateSideAgreement").filter(isRecord)
  const byAggregateMeanConfidenceDistance = readArray(groups, "byAggregateMeanConfidenceDistance").filter(isRecord)
  const byAggregateFinalConfidenceShift = readArray(groups, "byAggregateFinalConfidenceShift").filter(isRecord)
  const byAggregateMedianAdjustment = readArray(groups, "byAggregateMedianAdjustment").filter(isRecord)
  const byAggregateInsideViewShift = readArray(groups, "byAggregateInsideViewShift").filter(isRecord)
  const byAggregateFinalInsideViewAdjustment = readArray(groups, "byAggregateFinalInsideViewAdjustment").filter(isRecord)
  const byAggregateFinalAdjustmentDirection = readArray(groups, "byAggregateFinalAdjustmentDirection").filter(isRecord)
  const byAggregateAttemptCount = readArray(groups, "byAggregateAttemptCount").filter(isRecord)
  const byAggregationAnchor = readArray(groups, "byAggregationAnchor").filter(isRecord)
  const byResearchDepth = readArray(groups, "byResearchDepth").filter(isRecord)
  const byForecasterPanelSize = readArray(groups, "byForecasterPanelSize").filter(isRecord)
  const byComplexityScore = readArray(groups, "byComplexityScore").filter(isRecord)
  const byConditionalBranch = readArray(groups, "byConditionalBranch").filter(isRecord)
  const byConditionalEffect = readArray(groups, "byConditionalEffect").filter(isRecord)
  const byConditionalBranchDisagreement = readArray(groups, "byConditionalBranchDisagreement").filter(isRecord)
  const byConditionalResolvedBranch = readArray(groups, "byConditionalResolvedBranch").filter(isRecord)
  const byThresholdedDirection = readArray(groups, "byThresholdedDirection").filter(isRecord)
  const byThresholdedSource = readArray(groups, "byThresholdedSource").filter(isRecord)
  const byThresholdedRepair = readArray(groups, "byThresholdedRepair").filter(isRecord)
  const byThresholdedCurveSpread = readArray(groups, "byThresholdedCurveSpread").filter(isRecord)
  const byThresholdedComponentDisagreement = readArray(groups, "byThresholdedComponentDisagreement").filter(isRecord)
  const byThresholdedResolvedBand = readArray(groups, "byThresholdedResolvedBand").filter(isRecord)
  const byNumericInterval = readArray(groups, "byNumericInterval").filter(isRecord)
  const byNumericUnit = readArray(groups, "byNumericUnit").filter(isRecord)
  const byNumericP50Disagreement = readArray(groups, "byNumericP50Disagreement").filter(isRecord)
  const byNumericP50Error = readArray(groups, "byNumericP50Error").filter(isRecord)
  const byNumericResolvedPosition = readArray(groups, "byNumericResolvedPosition").filter(isRecord)
  const byDateInterval = readArray(groups, "byDateInterval").filter(isRecord)
  const byDateNeverProbability = readArray(groups, "byDateNeverProbability").filter(isRecord)
  const byDateP50Disagreement = readArray(groups, "byDateP50Disagreement").filter(isRecord)
  const byDateP50Error = readArray(groups, "byDateP50Error").filter(isRecord)
  const byDateResolvedPosition = readArray(groups, "byDateResolvedPosition").filter(isRecord)
  const byCategoricalConfidence = readArray(groups, "byCategoricalConfidence").filter(isRecord)
  const byCategoricalEntropy = readArray(groups, "byCategoricalEntropy").filter(isRecord)
  const byCategoricalSource = readArray(groups, "byCategoricalSource").filter(isRecord)
  const byCategoricalCoverage = readArray(groups, "byCategoricalCoverage").filter(isRecord)
  const byCategoricalTopAgreement = readArray(groups, "byCategoricalTopAgreement").filter(isRecord)
  const byCategoricalResolvedCategory = readArray(groups, "byCategoricalResolvedCategory").filter(isRecord)
  const byEvidenceSourceCount = readArray(groups, "byEvidenceSourceCount").filter(isRecord)
  const byEvidenceSourceDiversity = readArray(groups, "byEvidenceSourceDiversity").filter(isRecord)
  const byEvidenceSourceConcentration = readArray(groups, "byEvidenceSourceConcentration").filter(isRecord)
  const byEvidenceSourceDateCoverage = readArray(groups, "byEvidenceSourceDateCoverage").filter(isRecord)
  const byEvidenceSourceFreshness = readArray(groups, "byEvidenceSourceFreshness").filter(isRecord)
  const byEvidenceSourceTiming = readArray(groups, "byEvidenceSourceTiming").filter(isRecord)
  const byEvidenceUncertaintyCount = readArray(groups, "byEvidenceUncertaintyCount").filter(isRecord)
  const byEvidenceRationaleLength = readArray(groups, "byEvidenceRationaleLength").filter(isRecord)
  const byInputRequestedForecastType = readArray(groups, "byInputRequestedForecastType").filter(isRecord)
  const byInputRoutedForecastType = readArray(groups, "byInputRoutedForecastType").filter(isRecord)
  const byInputTypeAlignment = readArray(groups, "byInputTypeAlignment").filter(isRecord)
  const byInputRoutingConfidence = readArray(groups, "byInputRoutingConfidence").filter(isRecord)
  const byInputSource = readArray(groups, "byInputSource").filter(isRecord)
  const byInputContextCompleteness = readArray(groups, "byInputContextCompleteness").filter(isRecord)
  const byInputEvidenceAsOfDate = readArray(groups, "byInputEvidenceAsOfDate").filter(isRecord)
  const byInputResolutionCriteriaDepth = readArray(groups, "byInputResolutionCriteriaDepth").filter(isRecord)
  const byInputResolutionHorizon = readArray(groups, "byInputResolutionHorizon").filter(isRecord)
  const byInputBackgroundDepth = readArray(groups, "byInputBackgroundDepth").filter(isRecord)
  const byInputMarketContext = readArray(groups, "byInputMarketContext").filter(isRecord)
  const byInputMarketRecency = readArray(groups, "byInputMarketRecency").filter(isRecord)
  const byInputMarketMetadata = readArray(groups, "byInputMarketMetadata").filter(isRecord)
  const byInputMarketCreationAge = readArray(groups, "byInputMarketCreationAge").filter(isRecord)
  const byInputQuestionLength = readArray(groups, "byInputQuestionLength").filter(isRecord)
  const byInputCategoryCount = readArray(groups, "byInputCategoryCount").filter(isRecord)
  const byInputCategoryCoverage = readArray(groups, "byInputCategoryCoverage").filter(isRecord)
  const byInputThresholdCount = readArray(groups, "byInputThresholdCount").filter(isRecord)
  const byInputThresholdValueCoverage = readArray(groups, "byInputThresholdValueCoverage").filter(isRecord)
  const byInputThresholdDirection = readArray(groups, "byInputThresholdDirection").filter(isRecord)
  const byInputConditionDepth = readArray(groups, "byInputConditionDepth").filter(isRecord)
  const byInputConditionCriteriaDepth = readArray(groups, "byInputConditionCriteriaDepth").filter(isRecord)
  const byInputConditionCriteria = readArray(groups, "byInputConditionCriteria").filter(isRecord)
  const byInputUnitSpecificity = readArray(groups, "byInputUnitSpecificity").filter(isRecord)
  const byRunDuration = readArray(groups, "byRunDuration").filter(isRecord)
  const byRunWorkflowVersion = readArray(groups, "byRunWorkflowVersion").filter(isRecord)
  const byRunWorkflowVariant = readArray(groups, "byRunWorkflowVariant").filter(isRecord)
  const byRunExperiment = readArray(groups, "byRunExperiment").filter(isRecord)
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
        {byForecastAttemptCount.length ? <PerformancePlanShapeGroupList groups={byForecastAttemptCount} title="Forecast attempt-count outcomes" skipKey="forecast_attempts:unknown:unknown" fallback="attempt count" /> : null}
        {byCalibrationGuard.length ? <PerformanceGuardGroupList groups={byCalibrationGuard} /> : null}
        {byBinaryConfidence.length ? <PerformancePlanShapeGroupList groups={byBinaryConfidence} title="Binary confidence outcomes" skipKey="binary_confidence:not_binary" fallback="binary confidence" /> : null}
        {byBinaryForecastSide.length ? <PerformancePlanShapeGroupList groups={byBinaryForecastSide} title="Binary side outcomes" skipKey="binary_side:not_binary" fallback="binary side" /> : null}
        {byBaselineSanity.length ? <PerformanceBaselineSanityGroupList groups={byBaselineSanity} /> : null}
        {byMarketAnchor.length ? <PerformancePlanShapeGroupList groups={byMarketAnchor} title="Market-anchor outcomes" skipKey="market_anchor:unrecorded" fallback="market anchor" /> : null}
        {byResolutionBoundary.length ? <PerformancePlanShapeGroupList groups={byResolutionBoundary} title="Resolution-boundary outcomes" skipKey="resolution_boundary:unrecorded" fallback="resolution boundary" /> : null}
        {byUncertaintyRange.length ? <PerformancePlanShapeGroupList groups={byUncertaintyRange} title="Uncertainty-range outcomes" skipKey="uncertainty_range:unrecorded" fallback="uncertainty range" /> : null}
        {byComponentWeighting.length ? <PerformancePlanShapeGroupList groups={byComponentWeighting} title="Component-weighting outcomes" skipKey="component_weighting:unrecorded" fallback="component weighting" /> : null}
        {byAggregateQuality.length ? <PerformanceAggregateQualityGroupList groups={byAggregateQuality} /> : null}
        {byAggregateQualityRounds.length ? <PerformancePlanShapeGroupList groups={byAggregateQualityRounds} title="Aggregate review-round outcomes" skipKey="aggregate_quality_rounds:unrecorded" fallback="review rounds" /> : null}
        {byAggregateQualityIssues.length ? <PerformancePlanShapeGroupList groups={byAggregateQualityIssues} title="Aggregate quality-issue outcomes" skipKey="aggregate_quality_issues:unrecorded" fallback="quality issues" /> : null}
        {byAggregateDisagreement.length ? <PerformanceComponentDisagreementGroupList groups={byAggregateDisagreement} /> : null}
        {byAggregateFinalComponentPosition.length ? <PerformancePlanShapeGroupList groups={byAggregateFinalComponentPosition} title="Component envelope outcomes" skipKey="component_envelope:unrecorded" fallback="component envelope" /> : null}
        {byAggregateSideAgreement.length ? <PerformancePlanShapeGroupList groups={byAggregateSideAgreement} title="Aggregate side-agreement outcomes" skipKey="aggregate_side:unrecorded" fallback="side agreement" /> : null}
        {byAggregateMeanConfidenceDistance.length ? <PerformancePlanShapeGroupList groups={byAggregateMeanConfidenceDistance} title="Aggregate panel-confidence outcomes" skipKey="aggregate_panel_confidence:unrecorded" fallback="panel confidence" /> : null}
        {byAggregateFinalConfidenceShift.length ? <PerformancePlanShapeGroupList groups={byAggregateFinalConfidenceShift} title="Final confidence shift outcomes" skipKey="aggregate_confidence:unrecorded" fallback="confidence shift" /> : null}
        {byAggregateMedianAdjustment.length ? <PerformancePlanShapeGroupList groups={byAggregateMedianAdjustment} title="Median adjustment outcomes" skipKey="median_adjustment:unrecorded" fallback="median adjustment" /> : null}
        {byAggregateInsideViewShift.length ? <PerformancePlanShapeGroupList groups={byAggregateInsideViewShift} title="Inside-view shift outcomes" skipKey="inside_view_shift:unrecorded" fallback="inside-view shift" /> : null}
        {byAggregateFinalInsideViewAdjustment.length ? <PerformancePlanShapeGroupList groups={byAggregateFinalInsideViewAdjustment} title="Final aggregation adjustment outcomes" skipKey="aggregate_adjustment:unrecorded" fallback="aggregate adjustment" /> : null}
        {byAggregateFinalAdjustmentDirection.length ? <PerformancePlanShapeGroupList groups={byAggregateFinalAdjustmentDirection} title="Final aggregation direction outcomes" skipKey="aggregate_direction:unrecorded" fallback="aggregate direction" /> : null}
        {byAggregateAttemptCount.length ? <PerformancePlanShapeGroupList groups={byAggregateAttemptCount} title="Aggregate attempt-count outcomes" skipKey="aggregate_attempts:unrecorded" fallback="aggregate attempts" /> : null}
        {byAggregationAnchor.length ? <PerformanceAggregationAnchorGroupList groups={byAggregationAnchor} /> : null}
        {byResearchDepth.length ? <PerformancePlanShapeGroupList groups={byResearchDepth} title="Research depth outcomes" skipKey="research_depth:unrecorded" fallback="research depth" /> : null}
        {byForecasterPanelSize.length ? <PerformancePlanShapeGroupList groups={byForecasterPanelSize} title="Panel size outcomes" skipKey="forecaster_panel:unrecorded" fallback="panel size" /> : null}
        {byComplexityScore.length ? <PerformancePlanShapeGroupList groups={byComplexityScore} title="Complexity score outcomes" skipKey="complexity:unrecorded" fallback="complexity" /> : null}
        {byConditionalBranch.length ? <PerformancePlanShapeGroupList groups={byConditionalBranch} title="Conditional branch outcomes" skipKey="conditional_branch:not_conditional" fallback="conditional branch" /> : null}
        {byConditionalEffect.length ? <PerformancePlanShapeGroupList groups={byConditionalEffect} title="Conditional effect outcomes" skipKey="conditional_effect:not_conditional" fallback="conditional effect" /> : null}
        {byConditionalBranchDisagreement.length ? <PerformancePlanShapeGroupList groups={byConditionalBranchDisagreement} title="Conditional branch-disagreement outcomes" skipKey="conditional_branch_disagreement:not_conditional" fallback="conditional branch disagreement" /> : null}
        {byConditionalResolvedBranch.length ? <PerformancePlanShapeGroupList groups={byConditionalResolvedBranch} title="Conditional resolved-branch outcomes" skipKey="conditional_resolved_branch:not_conditional" fallback="conditional resolved branch" /> : null}
        {byThresholdedDirection.length ? <PerformancePlanShapeGroupList groups={byThresholdedDirection} title="Threshold direction outcomes" skipKey="thresholded_direction:not_thresholded" fallback="threshold direction" /> : null}
        {byThresholdedSource.length ? <PerformancePlanShapeGroupList groups={byThresholdedSource} title="Threshold source outcomes" skipKey="thresholded_source:not_thresholded" fallback="threshold source" /> : null}
        {byThresholdedRepair.length ? <PerformancePlanShapeGroupList groups={byThresholdedRepair} title="Threshold monotonicity outcomes" skipKey="thresholded_repair:not_thresholded" fallback="threshold repair" /> : null}
        {byThresholdedCurveSpread.length ? <PerformancePlanShapeGroupList groups={byThresholdedCurveSpread} title="Threshold curve-spread outcomes" skipKey="thresholded_curve_spread:not_thresholded" fallback="threshold curve spread" /> : null}
        {byThresholdedComponentDisagreement.length ? <PerformancePlanShapeGroupList groups={byThresholdedComponentDisagreement} title="Threshold component-disagreement outcomes" skipKey="thresholded_component_disagreement:not_thresholded" fallback="threshold component disagreement" /> : null}
        {byThresholdedResolvedBand.length ? <PerformancePlanShapeGroupList groups={byThresholdedResolvedBand} title="Threshold resolved-band outcomes" skipKey="thresholded_resolved_band:not_thresholded" fallback="threshold resolved band" /> : null}
        {byNumericInterval.length ? <PerformancePlanShapeGroupList groups={byNumericInterval} title="Numeric interval outcomes" skipKey="numeric_interval:not_numeric" fallback="numeric interval" /> : null}
        {byNumericUnit.length ? <PerformancePlanShapeGroupList groups={byNumericUnit} title="Numeric unit outcomes" skipKey="numeric_unit:not_numeric" fallback="numeric unit" /> : null}
        {byNumericP50Disagreement.length ? <PerformancePlanShapeGroupList groups={byNumericP50Disagreement} title="Numeric component-value outcomes" skipKey="numeric_p50_disagreement:not_numeric" fallback="numeric component value" /> : null}
        {byNumericP50Error.length ? <PerformancePlanShapeGroupList groups={byNumericP50Error} title="Numeric median-error outcomes" skipKey="numeric_p50_error:not_numeric" fallback="numeric median error" /> : null}
        {byNumericResolvedPosition.length ? <PerformancePlanShapeGroupList groups={byNumericResolvedPosition} title="Numeric resolved-position outcomes" skipKey="numeric_resolved_position:not_numeric" fallback="numeric resolved position" /> : null}
        {byDateInterval.length ? <PerformancePlanShapeGroupList groups={byDateInterval} title="Date interval outcomes" skipKey="date_interval:not_date" fallback="date interval" /> : null}
        {byDateNeverProbability.length ? <PerformancePlanShapeGroupList groups={byDateNeverProbability} title="Date never-probability outcomes" skipKey="date_never_probability:not_date" fallback="date never probability" /> : null}
        {byDateP50Disagreement.length ? <PerformancePlanShapeGroupList groups={byDateP50Disagreement} title="Date component-timing outcomes" skipKey="date_p50_disagreement:not_date" fallback="date component timing" /> : null}
        {byDateP50Error.length ? <PerformancePlanShapeGroupList groups={byDateP50Error} title="Date median-error outcomes" skipKey="date_p50_error:not_date" fallback="date median error" /> : null}
        {byDateResolvedPosition.length ? <PerformancePlanShapeGroupList groups={byDateResolvedPosition} title="Date resolved-position outcomes" skipKey="date_resolved_position:not_date" fallback="date resolved position" /> : null}
        {byCategoricalConfidence.length ? <PerformancePlanShapeGroupList groups={byCategoricalConfidence} title="Categorical confidence outcomes" skipKey="categorical_confidence:not_categorical" fallback="categorical confidence" /> : null}
        {byCategoricalEntropy.length ? <PerformancePlanShapeGroupList groups={byCategoricalEntropy} title="Categorical entropy outcomes" skipKey="categorical_entropy:not_categorical" fallback="categorical entropy" /> : null}
        {byCategoricalSource.length ? <PerformancePlanShapeGroupList groups={byCategoricalSource} title="Categorical source outcomes" skipKey="categorical_source:not_categorical" fallback="categorical source" /> : null}
        {byCategoricalCoverage.length ? <PerformancePlanShapeGroupList groups={byCategoricalCoverage} title="Categorical coverage outcomes" skipKey="categorical_coverage:not_categorical" fallback="categorical coverage" /> : null}
        {byCategoricalTopAgreement.length ? <PerformancePlanShapeGroupList groups={byCategoricalTopAgreement} title="Categorical top-agreement outcomes" skipKey="categorical_top_agreement:not_categorical" fallback="categorical top agreement" /> : null}
        {byCategoricalResolvedCategory.length ? <PerformancePlanShapeGroupList groups={byCategoricalResolvedCategory} title="Categorical resolved-category outcomes" skipKey="categorical_resolved_category:not_categorical" fallback="categorical resolved category" /> : null}
        {byEvidenceSourceCount.length ? <PerformancePlanShapeGroupList groups={byEvidenceSourceCount} title="Evidence source outcomes" skipKey="evidence_sources:unrecorded" fallback="evidence sources" /> : null}
        {byEvidenceSourceDiversity.length ? <PerformancePlanShapeGroupList groups={byEvidenceSourceDiversity} title="Evidence source-diversity outcomes" skipKey="evidence_source_diversity:unrecorded" fallback="evidence source diversity" /> : null}
        {byEvidenceSourceConcentration.length ? <PerformancePlanShapeGroupList groups={byEvidenceSourceConcentration} title="Evidence source-concentration outcomes" skipKey="evidence_source_concentration:unrecorded" fallback="evidence source concentration" /> : null}
        {byEvidenceSourceDateCoverage.length ? <PerformancePlanShapeGroupList groups={byEvidenceSourceDateCoverage} title="Evidence source-date outcomes" skipKey="evidence_source_dates:unrecorded" fallback="evidence source dates" /> : null}
        {byEvidenceSourceFreshness.length ? <PerformancePlanShapeGroupList groups={byEvidenceSourceFreshness} title="Evidence freshness outcomes" skipKey="evidence_source_freshness:unrecorded" fallback="evidence freshness" /> : null}
        {byEvidenceSourceTiming.length ? <PerformancePlanShapeGroupList groups={byEvidenceSourceTiming} title="Evidence timing outcomes" skipKey="evidence_source_timing:unrecorded" fallback="evidence timing" /> : null}
        {byEvidenceUncertaintyCount.length ? <PerformancePlanShapeGroupList groups={byEvidenceUncertaintyCount} title="Evidence uncertainty outcomes" skipKey="evidence_uncertainties:unrecorded" fallback="evidence uncertainties" /> : null}
        {byEvidenceRationaleLength.length ? <PerformancePlanShapeGroupList groups={byEvidenceRationaleLength} title="Evidence rationale outcomes" skipKey="evidence_rationale:unrecorded" fallback="evidence rationale" /> : null}
        {byInputRequestedForecastType.length ? <PerformancePlanShapeGroupList groups={byInputRequestedForecastType} title="Input requested-type outcomes" skipKey="input_requested_type:unrecorded" fallback="input requested type" /> : null}
        {byInputRoutedForecastType.length ? <PerformancePlanShapeGroupList groups={byInputRoutedForecastType} title="Input routed-type outcomes" skipKey="input_routed_type:unrecorded" fallback="input routed type" /> : null}
        {byInputTypeAlignment.length ? <PerformancePlanShapeGroupList groups={byInputTypeAlignment} title="Input type-alignment outcomes" skipKey="input_type_alignment:unrecorded" fallback="input type alignment" /> : null}
        {byInputRoutingConfidence.length ? <PerformancePlanShapeGroupList groups={byInputRoutingConfidence} title="Input routing-confidence outcomes" skipKey="input_routing_confidence:unrecorded" fallback="input routing confidence" /> : null}
        {byInputSource.length ? <PerformancePlanShapeGroupList groups={byInputSource} title="Input source outcomes" skipKey="input_source:unrecorded" fallback="input source" /> : null}
        {byInputContextCompleteness.length ? <PerformancePlanShapeGroupList groups={byInputContextCompleteness} title="Input context outcomes" skipKey="input_context:unrecorded" fallback="input context" /> : null}
        {byInputEvidenceAsOfDate.length ? <PerformancePlanShapeGroupList groups={byInputEvidenceAsOfDate} title="Input evidence-as-of outcomes" skipKey="input_evidence_as_of:unrecorded" fallback="input evidence as of" /> : null}
        {byInputResolutionCriteriaDepth.length ? <PerformancePlanShapeGroupList groups={byInputResolutionCriteriaDepth} title="Input resolution-criteria outcomes" skipKey="input_resolution_criteria:unrecorded" fallback="input resolution criteria" /> : null}
        {byInputResolutionHorizon.length ? <PerformancePlanShapeGroupList groups={byInputResolutionHorizon} title="Input horizon outcomes" skipKey="input_resolution_horizon:unrecorded" fallback="input resolution horizon" /> : null}
        {byInputBackgroundDepth.length ? <PerformancePlanShapeGroupList groups={byInputBackgroundDepth} title="Input background outcomes" skipKey="input_background:unrecorded" fallback="input background" /> : null}
        {byInputMarketContext.length ? <PerformancePlanShapeGroupList groups={byInputMarketContext} title="Input market outcomes" skipKey="input_market:unrecorded" fallback="input market" /> : null}
        {byInputMarketRecency.length ? <PerformancePlanShapeGroupList groups={byInputMarketRecency} title="Input market-recency outcomes" skipKey="input_market_recency:unrecorded" fallback="input market recency" /> : null}
        {byInputMarketMetadata.length ? <PerformancePlanShapeGroupList groups={byInputMarketMetadata} title="Input market-metadata outcomes" skipKey="input_market_metadata:unrecorded" fallback="input market metadata" /> : null}
        {byInputMarketCreationAge.length ? <PerformancePlanShapeGroupList groups={byInputMarketCreationAge} title="Input market-creation outcomes" skipKey="input_market_creation_age:unrecorded" fallback="input market creation" /> : null}
        {byInputQuestionLength.length ? <PerformancePlanShapeGroupList groups={byInputQuestionLength} title="Input question outcomes" skipKey="input_question:unrecorded" fallback="input question" /> : null}
        {byInputCategoryCount.length ? <PerformancePlanShapeGroupList groups={byInputCategoryCount} title="Input category outcomes" skipKey="input_categories:unrecorded" fallback="input categories" /> : null}
        {byInputCategoryCoverage.length ? <PerformancePlanShapeGroupList groups={byInputCategoryCoverage} title="Input category-coverage outcomes" skipKey="input_category_coverage:unrecorded" fallback="input category coverage" /> : null}
        {byInputThresholdCount.length ? <PerformancePlanShapeGroupList groups={byInputThresholdCount} title="Input threshold outcomes" skipKey="input_thresholds:unrecorded" fallback="input thresholds" /> : null}
        {byInputThresholdValueCoverage.length ? <PerformancePlanShapeGroupList groups={byInputThresholdValueCoverage} title="Input threshold-value outcomes" skipKey="input_threshold_values:unrecorded" fallback="input threshold values" /> : null}
        {byInputThresholdDirection.length ? <PerformancePlanShapeGroupList groups={byInputThresholdDirection} title="Input threshold-direction outcomes" skipKey="input_threshold_direction:unrecorded" fallback="input threshold direction" /> : null}
        {byInputConditionCriteria.length ? <PerformancePlanShapeGroupList groups={byInputConditionCriteria} title="Input condition-criteria outcomes" skipKey="input_condition_criteria:unrecorded" fallback="input condition criteria" /> : null}
        {byInputConditionDepth.length ? <PerformancePlanShapeGroupList groups={byInputConditionDepth} title="Input condition-depth outcomes" skipKey="input_condition_depth:unrecorded" fallback="input condition depth" /> : null}
        {byInputConditionCriteriaDepth.length ? <PerformancePlanShapeGroupList groups={byInputConditionCriteriaDepth} title="Input condition-criteria-depth outcomes" skipKey="input_condition_criteria_depth:unrecorded" fallback="input condition criteria depth" /> : null}
        {byInputUnitSpecificity.length ? <PerformancePlanShapeGroupList groups={byInputUnitSpecificity} title="Input unit outcomes" skipKey="input_unit:unrecorded" fallback="input unit" /> : null}
        {byRunDuration.length ? <PerformancePlanShapeGroupList groups={byRunDuration} title="Run duration outcomes" skipKey="run_duration:unrecorded" fallback="run duration" /> : null}
        {byRunWorkflowVersion.length ? <PerformancePlanShapeGroupList groups={byRunWorkflowVersion} title="Run workflow-version outcomes" skipKey="run_workflow_version:unrecorded" fallback="workflow version" /> : null}
        {byRunWorkflowVariant.length ? <PerformancePlanShapeGroupList groups={byRunWorkflowVariant} title="Run workflow-variant outcomes" skipKey="run_workflow_variant:unrecorded" fallback="workflow variant" /> : null}
        {byRunExperiment.length ? <PerformancePlanShapeGroupList groups={byRunExperiment} title="Run experiment outcomes" skipKey="run_experiment:unrecorded" fallback="run experiment" /> : null}
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
  const ruleImpacts = readArray(impact, "byRule").filter(isRecord).slice(0, 4)
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
      {ruleImpacts.length > 0 ? (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {ruleImpacts.map((rule) => (
            <div className="rounded-md border px-3 py-2 text-sm" key={String(rule.ruleId ?? "rule")}>
              <span className="block truncate font-medium">{String(rule.ruleId ?? "rule")} · {String(rule.status ?? "unknown")}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                delta {formatSignedMetric(rule.brierDelta) || "unknown"} · {String(rule.guardedResolvedTasks ?? 0)} guarded tasks
              </span>
            </div>
          ))}
        </div>
      ) : null}
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

function PerformanceBaselineSanityGroupList({ groups }: { groups: JsonRecord[] }) {
  const visibleGroups = groups.filter((group) => String(group.key ?? "") !== "baseline:unrecorded").slice(0, 4)
  if (visibleGroups.length === 0) {
    return null
  }
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Baseline sanity outcomes</p>
      <div className="grid gap-2 md:grid-cols-2">
        {visibleGroups.map((group) => (
          <div className="rounded-md border px-3 py-2 text-sm" key={String(group.key ?? group.label)}>
            <span className="block truncate font-medium">{String(group.label ?? group.key ?? "baseline sanity")}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {String(group.resolvedTasks ?? 0)} tasks · {String(group.primaryMetric ?? "metric")} {formatMetric(group.primaryMean)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformanceAggregateQualityGroupList({ groups }: { groups: JsonRecord[] }) {
  const visibleGroups = groups.filter((group) => String(group.key ?? "") !== "aggregate_quality:unrecorded").slice(0, 4)
  if (visibleGroups.length === 0) {
    return null
  }
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Aggregate quality outcomes</p>
      <div className="grid gap-2 md:grid-cols-2">
        {visibleGroups.map((group) => (
          <div className="rounded-md border px-3 py-2 text-sm" key={String(group.key ?? group.label)}>
            <span className="block truncate font-medium">{String(group.label ?? group.key ?? "aggregate quality")}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {String(group.resolvedTasks ?? 0)} tasks · {String(group.primaryMetric ?? "metric")} {formatMetric(group.primaryMean)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformanceComponentDisagreementGroupList({ groups }: { groups: JsonRecord[] }) {
  const visibleGroups = groups.filter((group) => String(group.key ?? "") !== "component_disagreement:unrecorded").slice(0, 4)
  if (visibleGroups.length === 0) {
    return null
  }
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Component disagreement outcomes</p>
      <div className="grid gap-2 md:grid-cols-2">
        {visibleGroups.map((group) => (
          <div className="rounded-md border px-3 py-2 text-sm" key={String(group.key ?? group.label)}>
            <span className="block truncate font-medium">{String(group.label ?? group.key ?? "component disagreement")}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {String(group.resolvedTasks ?? 0)} tasks · {String(group.primaryMetric ?? "metric")} {formatMetric(group.primaryMean)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformanceAggregationAnchorGroupList({ groups }: { groups: JsonRecord[] }) {
  const visibleGroups = groups.filter((group) => String(group.key ?? "") !== "aggregation_anchor:unrecorded").slice(0, 4)
  if (visibleGroups.length === 0) {
    return null
  }
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Aggregation anchor outcomes</p>
      <div className="grid gap-2 md:grid-cols-2">
        {visibleGroups.map((group) => (
          <div className="rounded-md border px-3 py-2 text-sm" key={String(group.key ?? group.label)}>
            <span className="block truncate font-medium">{String(group.label ?? group.key ?? "aggregation anchor")}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {String(group.resolvedTasks ?? 0)} tasks · {String(group.primaryMetric ?? "metric")} {formatMetric(group.primaryMean)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PerformancePlanShapeGroupList({
  groups,
  title,
  skipKey,
  fallback,
}: {
  groups: JsonRecord[]
  title: string
  skipKey: string
  fallback: string
}) {
  const visibleGroups = groups.filter((group) => String(group.key ?? "") !== skipKey).slice(0, 4)
  if (visibleGroups.length === 0) {
    return null
  }
  return (
    <div className="border-t pt-3">
      <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">{title}</p>
      <div className="grid gap-2 md:grid-cols-2">
        {visibleGroups.map((group) => (
          <div className="rounded-md border px-3 py-2 text-sm" key={String(group.key ?? group.label)}>
            <span className="block truncate font-medium">{String(group.label ?? group.key ?? fallback)}</span>
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
          const reason = typeof item.reason === "string" ? item.reason : null
          const content = (
            <>
              <span className="block truncate font-medium">{String(item.taskLabel ?? item.kind ?? "attention item")}</span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {String(item.severity ?? "medium")} · {String(item.metric ?? "metric")} {formatMetric(item.score)}
              </span>
              {reason ? (
                <span className="mt-1 block truncate text-xs text-muted-foreground">{reason}</span>
              ) : null}
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
