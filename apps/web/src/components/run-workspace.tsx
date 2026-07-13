"use client"

import Link from "next/link"
import { ArrowLeft, FileText, RefreshCw, Settings2 } from "lucide-react"

import { DecisionBriefPanel } from "@/components/run-workspace/decision-brief"
import {
  EvidenceTrustGuide,
  ForecastLifecyclePanel,
  ForecastReadingGuide,
  ForecastReasoningGuide,
  QuestionContractPanel,
  UserPriorPanel,
} from "@/components/run-workspace/forecast-learning"
import {
  EvidenceStrip,
  ForecastLedger,
  ForecastResultPanel,
  LoadingRunState,
  LiveRunActivityPanel,
  MetricGrid,
  ResearchNarrativePanel,
  ResearchTeamPanel,
  RunStreamPanel,
  SourceList,
  SourceMap,
  TaskRows,
  TraceEvents,
} from "@/components/run-workspace/panels"
import { useRunWorkspace } from "@/components/run-workspace/use-run-workspace"
import { SourceGraphBackground } from "@/components/source-graph-background"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatModeLabel, statusTone } from "@/lib/records"
import { cn } from "@/lib/utils"

export function RunWorkspace({ taskId }: { taskId: string }) {
  const { detail, error, loading, refreshWorkspace, retryingRowId, retryTaskRow, runs, streamState } = useRunWorkspace(taskId)

  return (
    <main className="relative min-h-svh overflow-hidden px-4 py-4 md:px-8">
      <SourceGraphBackground runs={runs} variant="workspace" className="opacity-80" />
      <div className="relative z-10">
        <RunHeader detail={detail} streamState={streamState} taskId={taskId} />

        {error ? (
          <Card className="mt-6 border-destructive/40">
            <CardContent className="grid gap-4 py-1">
              <div>
                <p className="text-sm font-medium text-destructive">This forecast could not be loaded.</p>
                <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">{error}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void refreshWorkspace()}>
                  <RefreshCw data-icon="inline-start" />
                  Try again
                </Button>
                <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/setup" />}>
                  <Settings2 data-icon="inline-start" />
                  Check system setup
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {loading && !detail.task ? <LoadingRunState /> : null}

        {detail.task ? (
          <Tabs defaultValue="summary" className="mt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
                <TabsList className="min-w-max">
                  <TabsTrigger value="summary">summary</TabsTrigger>
                  <TabsTrigger value="reasoning">reasoning</TabsTrigger>
                  <TabsTrigger value="forecasts">forecasts</TabsTrigger>
                  <TabsTrigger value="evidence">evidence</TabsTrigger>
                  <TabsTrigger value="lifecycle">updates & score</TabsTrigger>
                  <TabsTrigger value="audit">audit</TabsTrigger>
                </TabsList>
              </div>
              <RunStreamPanel streamState={streamState} />
            </div>

            <TabsContent value="summary" className="mt-6">
              <div className="grid gap-6">
                <QuestionContractPanel task={detail.task} />
                <DecisionBriefPanel
                  task={detail.task}
                  output={detail.forecastOutput}
                  sources={detail.sources}
                  attempts={detail.attempts}
                  aggregates={detail.aggregates}
                  scores={detail.scores}
                  taskRows={detail.taskRows}
                  traceEvents={detail.traceEvents}
                  streamState={streamState}
                />
                <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.65fr)]">
                  <ForecastResultPanel output={detail.forecastOutput} task={detail.task} />
                  <ForecastReadingGuide />
                </div>
                <LiveRunActivityPanel task={detail.task} streamState={streamState} />
              </div>
            </TabsContent>

            <TabsContent value="reasoning" className="mt-6">
              <div className="grid gap-6">
                <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.62fr)_minmax(0,1fr)]">
                  <ForecastReasoningGuide />
                  <ResearchNarrativePanel task={detail.task} sources={detail.sources} streamState={streamState} traceEvents={detail.traceEvents} />
                </div>
                <ResearchTeamPanel attempts={detail.attempts} traceEvents={detail.traceEvents} streamState={streamState} expanded />
              </div>
            </TabsContent>

            <TabsContent value="forecasts" className="mt-6">
              <div className="grid gap-6">
                <UserPriorPanel taskId={taskId} />
                <ForecastResultPanel output={detail.forecastOutput} task={detail.task} expanded />
                <ForecastLedger attempts={detail.attempts} aggregates={detail.aggregates} scores={detail.scores} />
              </div>
            </TabsContent>

            <TabsContent value="evidence" className="mt-6">
              <div className="grid gap-6">
                <EvidenceTrustGuide sources={detail.sources} task={detail.task} />
                <EvidenceStrip sources={detail.sources} />
                <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.7fr)_minmax(0,1fr)]">
                  <SourceMap sources={detail.sources} />
                  <SourceList sources={detail.sources} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="lifecycle" className="mt-6">
              <div className="grid gap-6">
                <ForecastLifecyclePanel output={detail.forecastOutput} scores={detail.scores} task={detail.task} />
                <LiveRunActivityPanel task={detail.task} streamState={streamState} />
              </div>
            </TabsContent>

            <TabsContent value="audit" className="mt-6">
              <div className="grid gap-6">
                <ResearchTeamPanel attempts={detail.attempts} traceEvents={detail.traceEvents} streamState={streamState} expanded />
                <MetricGrid
                  task={detail.task}
                  artifacts={detail.artifacts}
                  sources={detail.sources}
                  taskId={taskId}
                  tokenUsage={streamState.activity?.tokenUsage ?? null}
                />
                <TaskRows rows={detail.taskRows} retryingRowId={retryingRowId} onRetry={(rowId) => void retryTaskRow(rowId)} />
                <TraceEvents events={detail.traceEvents} streamState={streamState} />
              </div>
            </TabsContent>
          </Tabs>
        ) : null}
      </div>
    </main>
  )
}

function RunHeader({
  detail,
  streamState,
  taskId,
}: {
  detail: ReturnType<typeof useRunWorkspace>["detail"]
  streamState: ReturnType<typeof useRunWorkspace>["streamState"]
  taskId: string
}) {
  const productComplete = detail.task?.status === "completed"
  return (
    <header className="flex flex-col gap-5 border-b border-border/70 pb-6 md:flex-row md:items-start md:justify-between">
      <div className="max-w-4xl">
        <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/" />}>
          <ArrowLeft data-icon="inline-start" />
          New forecast
        </Button>
        <p className="fs-eyebrow mt-5 text-primary/80">Forecast workspace</p>
        <h1 className="mt-3 max-w-5xl text-xl font-medium leading-tight text-foreground md:text-3xl">{detail.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {detail.task ? `${formatModeLabel(detail.task.operationSubmode ?? detail.task.operationMode)} · ${String(detail.task.status ?? "unknown")}` : "Loading run"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {detail.task ? (
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/runs/${taskId}/report`} />}>
            <FileText data-icon="inline-start" />
            Report
          </Button>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={cn(streamState.connected && "border-primary text-primary")}>
            {streamState.connected ? "Live feed" : productComplete ? "Feed complete" : "Disconnected"}
          </Badge>
          {streamState.activity?.progress.running ? (
            <Badge variant="outline" className="border-success/50 text-success">
              {streamState.activity.progress.running} working
            </Badge>
          ) : null}
          <Badge variant="secondary" className={statusTone(detail.task?.status)}>
            {String(detail.task?.status ?? streamState.status)}
          </Badge>
          {detail.forecastReady && !productComplete ? (
            <Badge variant="outline" className="border-success/40 text-success">Forecast ready · finalizing run</Badge>
          ) : null}
        </div>
      </div>
    </header>
  )
}
