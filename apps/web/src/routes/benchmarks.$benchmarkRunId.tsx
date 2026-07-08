import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Database, ExternalLink, FileJson, GitBranch, Gauge, SearchCode } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AppSidebar } from "../components/app-sidebar";

export const Route = createFileRoute("/benchmarks/$benchmarkRunId")({
  component: BenchmarkRunPage,
});

function BenchmarkRunPage() {
  const { benchmarkRunId } = Route.useParams();
  const [caseFilter, setCaseFilter] = useState("all");
  const detailQuery = useQuery({
    queryKey: ["benchmark-run", benchmarkRunId],
    queryFn: async () => {
      const response = await fetch(`/api/benchmarks/${benchmarkRunId}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return (await response.json()) as { benchmarkRun: BenchmarkRunDetail };
    },
    refetchInterval: 10_000,
  });

  const detail = detailQuery.data?.benchmarkRun;
  const run = isRecord(detail?.run) ? detail.run : {};
  const scorecard = isRecord(detail?.scorecard) ? detail.scorecard : {};
  const cases = Array.isArray(detail?.cases) ? detail.cases.filter(isRecord) : [];
  const filteredCases = caseFilter === "all" ? cases : cases.filter((item) => String(item.status ?? "") === caseFilter);
  const analysis = isRecord(detail?.analysis) ? detail.analysis : null;
  const proposals = Array.isArray(detail?.workflowChangeProposals) ? detail.workflowChangeProposals.filter(isRecord) : [];
  const reports = isRecord(detail?.reports) ? detail.reports : {};
  const workflowVariant = isRecord(detail?.workflowVariant) ? detail.workflowVariant : {};

  return (
    <main className="app-shell">
      <AppSidebar active="benchmark-lab" />
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Benchmark Lab</p>
            <h1>{String(run.suiteName ?? "Benchmark run")}</h1>
          </div>
          <a className="variant-chip" href="/#benchmark-lab">
            <Gauge size={16} />
            Back to lab
          </a>
        </header>

        {detailQuery.isLoading ? <p className="muted">Loading benchmark evidence...</p> : null}
        {detailQuery.error ? <p className="status bad">Benchmark run could not be loaded.</p> : null}

        {detail ? (
          <>
            <section className="metrics-grid" aria-label="Benchmark scorecard">
              <Metric label="Status" value={String(run.status ?? "unknown")} />
              <Metric label="Mean Brier" value={formatMetric(scorecard.meanBrier)} />
              <Metric label="Mean log" value={formatMetric(scorecard.meanLog)} />
              <Metric label="Cases" value={`${formatWhole(scorecard.completedCases)} / ${formatWhole(scorecard.caseCount)} done`} />
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Scorecard</p>
                  <h2>Promotion evidence</h2>
                </div>
                <span className={readRecord(scorecard, "promotionGate")?.status === "review_for_promotion" ? "status good" : "status warn"}>
                  {String(readRecord(scorecard, "promotionGate")?.status ?? "needs_more_evidence")}
                </span>
              </div>
              <div className="detail-grid">
                <EvidenceBlock
                  icon={<BarChart3 size={18} />}
                  title="Metrics"
                  rows={[
                    ["Completed", formatWhole(scorecard.completedCases)],
                    ["Failed", formatWhole(scorecard.failedCases)],
                    ["Needs review", formatWhole(scorecard.reviewCases)],
                    ["Baseline delta", formatMetric(scorecard.meanBrierDelta)],
                  ]}
                />
                <EvidenceBlock
                  icon={<SearchCode size={18} />}
                  title="Trace health"
                  rows={[
                    ["Trace bundles", `${formatWhole(scorecard.traceBundlesWritten)} / ${formatWhole(scorecard.caseCount)}`],
                    ["Analyst notes", formatWhole(scorecard.casesWithAnalystNotes)],
                    ["Source bundles", formatWhole(scorecard.sourceBundlesWritten)],
                    ["Failure labels", summarizeCounts(readRecord(scorecard, "failureLabelCounts")) || "none"],
                  ]}
                />
                <EvidenceBlock
                  icon={<GitBranch size={18} />}
                  title="Workflow variant"
                  rows={[
                    ["Workflow", String(run.workflowId ?? "unknown")],
                    ["Variant", shortHash(String(run.workflowSourceHash ?? ""))],
                    ["Promotion", String(run.workflowPromotionState ?? "candidate")],
                    ["Revision", String(run.suiteRevision ?? "unknown")],
                  ]}
                />
                <EvidenceBlock
                  icon={<Database size={18} />}
                  title="Gate blockers"
                  rows={[
                    ["Gate", String(readRecord(scorecard, "promotionGate")?.summary ?? "")],
                    ["Blockers", readArray(readRecord(scorecard, "promotionGate"), "blockers").join(", ") || "none"],
                    ["Comparison", String(readRecord(scorecard, "promotionGate")?.recommendationStatus ?? "none")],
                  ]}
                />
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Cases</p>
                  <h2>Replay and inspect</h2>
                </div>
                <div className="segmented-control" aria-label="Case filter">
                  {["all", "completed", "needs_review", "failed", "running"].map((filter) => (
                    <button
                      className={caseFilter === filter ? "selected compact" : "compact secondary"}
                      type="button"
                      key={filter}
                      onClick={() => setCaseFilter(filter)}
                    >
                      {filter.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="benchmark-case-list">
                {filteredCases.length === 0 ? (
                  <p className="muted">No cases match this filter.</p>
                ) : (
                  filteredCases.map((item) => <BenchmarkCaseRow key={String(item.id)} item={item} />)
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Analysis</p>
                  <h2>Failure clusters and workflow changes</h2>
                </div>
                <span className="status warn">{proposals.length} proposal{proposals.length === 1 ? "" : "s"}</span>
              </div>
              <BenchmarkAnalysis analysis={analysis} proposals={proposals} />
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Artifacts</p>
                  <h2>Reports and variant metadata</h2>
                </div>
                <FileJson size={18} />
              </div>
              <ReportGrid reports={reports} workflowVariant={workflowVariant} />
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}

type BenchmarkRunDetail = Record<string, unknown> & {
  run?: Record<string, unknown>;
  scorecard?: Record<string, unknown>;
  cases?: Array<Record<string, unknown>>;
  analysis?: Record<string, unknown> | null;
  workflowChangeProposals?: Array<Record<string, unknown>>;
  reports?: Record<string, unknown>;
  workflowVariant?: Record<string, unknown>;
};

function BenchmarkCaseRow({ item }: { item: Record<string, unknown> }) {
  const metrics = isRecord(item.metrics) ? item.metrics : {};
  const links = isRecord(item.links) ? item.links : {};
  const hiddenResolutionSummary = isRecord(item.hiddenResolutionSummary) ? item.hiddenResolutionSummary : null;
  return (
    <div className="benchmark-case-row">
      <div>
        <strong>{String(item.externalId ?? item.benchmarkCaseId ?? "Benchmark case")}</strong>
        <span>{String(item.question ?? "")}</span>
        <small>{String(item.resolutionCriteria ?? "")}</small>
        <div className="case-chip-row">
          <span className="status warn">{String(item.status ?? "unknown")}</span>
          {readArray(item, "failureLabels").map((label) => <span className="status bad" key={label}>{label}</span>)}
          {hiddenResolutionSummary ? (
            <span className="status good">
              resolved {hiddenResolutionSummary.resolved === true ? "yes" : hiddenResolutionSummary.resolved === false ? "no" : "unknown"}
            </span>
          ) : null}
        </div>
      </div>
      <div className="case-metrics">
        <MetricInline label="Brier" value={formatMetric(metrics.brier)} />
        <MetricInline label="Log" value={formatMetric(metrics.log)} />
        <MetricInline label="Delta" value={formatMetric(metrics.baselineDeltaBrier)} />
      </div>
      <div className="case-actions">
        {readString(links, "runDetail") ? <a className="text-link" href={String(links.runDetail)}>Run detail</a> : null}
        {readString(links, "traceBundle") ? <a className="text-link" href={String(links.traceBundle)}>Trace bundle</a> : null}
        {readString(links, "artifactCsv") ? <a className="text-link" href={String(links.artifactCsv)}>CSV</a> : null}
      </div>
    </div>
  );
}

function BenchmarkAnalysis({ analysis, proposals }: { analysis: Record<string, unknown> | null; proposals: Array<Record<string, unknown>> }) {
  const clusters = readArray(analysis, "failureClusters").filter(isRecord);
  return (
    <div className="analysis-grid">
      <div className="analysis-section">
        <h3>Run analysis</h3>
        <p>{String(analysis?.summary ?? "No benchmark analysis artifact has been written yet.")}</p>
        {clusters.length ? (
          <div className="failure-cluster-list">
            {clusters.map((cluster) => (
              <div className="failure-cluster" key={String(cluster.label)}>
                <strong>{String(cluster.label ?? "cluster")}</strong>
                <span>{String(cluster.count ?? 0)} case(s)</span>
                <small>{readArray(cluster, "workflowImplications").join(" ")}</small>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="analysis-section">
        <h3>Workflow proposals</h3>
        {proposals.length === 0 ? (
          <p className="muted">No workflow change proposals for this run.</p>
        ) : (
          proposals.map((proposal) => (
            <div className="proposal-row" key={String(proposal.id)}>
              <strong>{String(proposal.targetWorkflowId ?? "workflow")}</strong>
              <span>{String(proposal.problemStatement ?? "")}</span>
              <p>{String(proposal.proposedChange ?? "")}</p>
              <small>Validation: {String(proposal.validationPlan ?? "")}</small>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ReportGrid({ reports, workflowVariant }: { reports: Record<string, unknown>; workflowVariant: Record<string, unknown> }) {
  const reportRows = ["score", "analysis", "comparison"].map((key) => [key, readRecord(reports, key)] as const);
  return (
    <div className="report-grid">
      {reportRows.map(([key, report]) => (
        <div className="report-row" key={key}>
          <strong>{key}</strong>
          <span>{String(report?.artifactId ?? "not written")}</span>
        </div>
      ))}
      <div className="report-row">
        <strong>Prompt versions</strong>
        <code>{JSON.stringify(workflowVariant.promptVersions ?? {})}</code>
      </div>
      <div className="report-row">
        <strong>Schema versions</strong>
        <code>{JSON.stringify(workflowVariant.schemaVersions ?? {})}</code>
      </div>
    </div>
  );
}

function EvidenceBlock({ icon, title, rows }: { icon: ReactNode; title: string; rows: Array<[string, string]> }) {
  return (
    <div className="evidence-block">
      <div className="evidence-title">
        {icon}
        <h3>{title}</h3>
      </div>
      {rows.map(([label, value]) => (
        <div className="evidence-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatMetric(value: unknown) {
  return typeof value === "number" ? value.toFixed(4) : "n/a";
}

function formatWhole(value: unknown) {
  return typeof value === "number" ? String(value) : "0";
}

function shortHash(value: string) {
  return value ? value.slice(0, 12) : "unknown";
}

function summarizeCounts(value: Record<string, unknown> | null) {
  if (!value) {
    return "";
  }
  return Object.entries(value)
    .map(([key, count]) => `${key} x${String(count)}`)
    .join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRecord(value: Record<string, unknown> | null | undefined, key: string) {
  const raw = value?.[key];
  return isRecord(raw) ? raw : null;
}

function readArray(value: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const raw = value?.[key];
    if (Array.isArray(raw)) {
      return raw;
    }
  }
  return [];
}

function readString(value: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const raw = value?.[key];
    if (typeof raw === "string") {
      return raw;
    }
  }
  return null;
}
