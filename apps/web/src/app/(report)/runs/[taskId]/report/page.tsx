import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ExternalLink, FileJson, GitBranch, LinkIcon } from "lucide-react"
import {
  backfillBinaryForecastLedgers,
  getTaskDetail,
  reconcileRunningTasks,
  TaskNotFoundError,
} from "@open-superforecaster/backend"

import { ReportActions } from "@/app/(report)/runs/[taskId]/report/report-actions"
import { ForecastResultPanel } from "@/components/run-workspace/panels"
import { buildRunDetail } from "@/components/run-workspace/run-detail"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getServerContext } from "@/lib/server-db"
import { formatModeLabel, readNumber, readString, type JsonRecord } from "@/lib/records"

export const dynamic = "force-dynamic"

export default async function RunReportPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params
  const { detail, run } = await loadRunReport(taskId)
  if (!detail.task) {
    notFound()
  }

  const output = detail.forecastOutput
  const title = exactQuestion(detail.task)
  const completedAt = readDateLike(detail.task, "completedAt")
  const createdAt = readDateLike(detail.task, "createdAt")
  const citationCount = Array.isArray(run.citations) ? run.citations.length : 0
  const snapshotLabel = detail.task.status === "running" ? "snapshot from in-progress run" : "snapshot report"

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 md:px-8 print:max-w-none print:px-0 print:py-0">
        <header className="report-hero rounded-xl border border-border/70 bg-card/85 p-5 md:p-8 print:border-0 print:bg-white print:p-0">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/runs/${taskId}`} />} className="mb-5 print:hidden">
                <ArrowLeft data-icon="inline-start" />
                Back to run
              </Button>
              <p className="text-xs uppercase tracking-[0.24em] text-primary print:text-slate-500">Open Superforecaster report</p>
              <h1 className="mt-4 max-w-4xl break-words text-3xl font-medium leading-tight md:text-5xl print:text-3xl print:text-slate-950">
                {title}
              </h1>
              <div className="mt-5 flex flex-wrap gap-2 text-sm text-muted-foreground print:text-slate-600">
                <span>{formatModeLabel(detail.task.operationSubmode ?? detail.task.operationMode)}</span>
                <span>·</span>
                <span>{String(detail.task.status ?? "unknown")}</span>
                <span>·</span>
                <span>{snapshotLabel}</span>
                <span>·</span>
                <span>{completedAt ? `completed ${formatDate(completedAt)}` : `created ${formatDate(createdAt)}`}</span>
              </div>
            </div>
            <ReportActions />
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-5 print:grid-cols-5">
          <ReportStat label="Sources" value={detail.sources.length} />
          <ReportStat label="Citations" value={citationCount} />
          <ReportStat label="Attempts" value={detail.attempts.length || readNumber(output, "attempt_count") || "n/a"} />
          <ReportStat label="Aggregates" value={detail.aggregates.length || "n/a"} />
          <ReportStat label="Recent events" value={detail.traceEvents.length} />
        </section>

        {output ? (
          <section className="grid gap-4 print:block">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-primary print:text-slate-500">Answer</p>
                <h2 className="mt-2 text-2xl font-medium print:text-slate-950">Forecast artifact</h2>
              </div>
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/api/runs/${taskId}/trace-bundle`} />} className="print:hidden">
                <FileJson data-icon="inline-start" />
                Trace bundle
              </Button>
            </div>
            <ForecastResultPanel output={output} task={detail.task} expanded />
          </section>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>No aggregate recorded</CardTitle>
              <CardDescription>This run does not have a persisted forecast artifact to summarize.</CardDescription>
            </CardHeader>
          </Card>
        )}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.42fr)] print:block">
          <Card className="print:break-inside-avoid">
            <CardHeader>
              <CardTitle>Recorded evidence</CardTitle>
              <CardDescription>{detail.sources.length} persisted citations. Source presence is not independent verification.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {detail.sources.slice(0, 12).map((source, index) => (
                <a
                  className="group/source rounded-lg border border-border/70 bg-muted/20 p-3 transition hover:border-primary/50 print:border-slate-200 print:bg-white"
                  href={readString(source, "url") ?? readString(source, "sourceUrl") ?? "#"}
                  key={String(source.id ?? index)}
                  rel="noreferrer"
                  target="_blank"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium print:text-slate-950">{readString(source, "title") ?? sourceDomain(source)}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground print:text-slate-600">{sourceDomain(source)}</p>
                    </div>
                    <ExternalLink className="size-4 shrink-0 text-muted-foreground group-hover/source:text-primary print:hidden" />
                  </div>
                  {readString(source, "contentSummary") ? (
                    <p className="mt-2 text-sm leading-6 text-muted-foreground print:text-slate-700">{readString(source, "contentSummary")}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted-foreground print:text-slate-500">
                    {readDateLike(source, "publishedAt") ? `Published ${formatDate(readDateLike(source, "publishedAt"))} · ` : ""}
                    {readDateLike(source, "retrievedAt") ? `Retrieved ${formatDate(readDateLike(source, "retrievedAt"))}` : "Retrieval date unavailable"}
                  </p>
                </a>
              ))}
              {detail.sources.length === 0 ? <p className="text-sm text-muted-foreground">No cited sources were persisted for this run.</p> : null}
            </CardContent>
          </Card>

          <div className="grid gap-4">
            <Card className="print:break-inside-avoid">
              <CardHeader>
                <CardTitle>How this was produced</CardTitle>
                <CardDescription>Process signals recorded by the local workflow.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                <ReportFact label="Status" value={String(detail.task.status ?? "unknown")} />
                <ReportFact label="Workflow" value={formatModeLabel(detail.task.operationSubmode ?? detail.task.operationMode)} />
                <ReportFact label="Sources" value={`${detail.sources.length} persisted`} />
                <ReportFact label="Citations" value={`${citationCount} recorded`} />
                <ReportFact label="Run id" value={String(detail.task.id)} />
                <ReportFact label="Smithers id" value={String(detail.task.smithersRunId ?? "n/a")} />
              </CardContent>
            </Card>
            <Card className="print:break-inside-avoid">
              <CardHeader>
                <CardTitle>Recent trace</CardTitle>
                <CardDescription>The API exposes the recent trace window, not a full audit log.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {detail.traceEvents.slice(0, 8).map((event, index) => (
                  <div className="rounded-md bg-muted/25 px-3 py-2 text-xs text-muted-foreground print:bg-slate-50 print:text-slate-700" key={String(event.id ?? index)}>
                    {String(event.eventType ?? "trace")} · {String(event.phase ?? "workflow")}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        <footer className="flex flex-col gap-3 border-t border-border/70 py-6 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between print:text-slate-600">
          <span>Generated by Open Superforecaster.</span>
          <div className="flex flex-wrap gap-3">
            <a className="inline-flex items-center gap-1 hover:text-primary" href="https://github.com/ralfboltshauser/open-superforecaster" rel="noreferrer" target="_blank">
              <GitBranch className="size-4" />
              ralfboltshauser/open-superforecaster
            </a>
            <Link className="inline-flex items-center gap-1 hover:text-primary print:hidden" href={`/runs/${taskId}`}>
              <LinkIcon className="size-4" />
              Live run
            </Link>
          </div>
        </footer>
      </div>
    </main>
  )
}

async function loadRunReport(taskId: string) {
  const { db, root, sql } = getServerContext()

  try {
    await reconcileRunningTasks(db, root)
    await backfillBinaryForecastLedgers(db, root)
    const run = await getTaskDetail(db, taskId)
    return { detail: buildRunDetail(run), run }
  } catch (error) {
    if (error instanceof TaskNotFoundError) {
      notFound()
    }
    throw error
  } finally {
    await sql.end()
  }
}

function ReportStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/75 p-4 print:border-slate-200 print:bg-white">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground print:text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-medium print:text-slate-950">{value}</p>
    </div>
  )
}

function ReportFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md bg-muted/25 px-3 py-2 print:bg-slate-50">
      <span className="text-muted-foreground print:text-slate-600">{label}</span>
      <span className="break-all text-right font-medium print:text-slate-950">{value}</span>
    </div>
  )
}

function exactQuestion(task: JsonRecord) {
  const input = isRecord(task.input) ? task.input : {}
  const config = isRecord(task.configJson) ? task.configJson : {}
  return readString(input, "question") ?? readString(input, "prompt") ?? readString(config, "prompt") ?? String(task.label ?? "Forecast report")
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sourceDomain(source: JsonRecord) {
  const direct = readString(source, "domain")
  if (direct) {
    return direct.replace(/^www\./, "")
  }
  const url = readString(source, "url") ?? readString(source, "sourceUrl")
  if (!url) {
    return "source"
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function readDateLike(record: unknown, key: string) {
  if (!isRecord(record)) {
    return null
  }
  const value = record[key]
  if (value instanceof Date) {
    return value.toISOString()
  }
  return typeof value === "string" ? value : null
}

function formatDate(value: string | null) {
  if (!value) {
    return "unknown date"
  }
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}
