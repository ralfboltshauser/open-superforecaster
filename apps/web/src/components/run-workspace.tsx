"use client"

import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { AppShell } from "@/components/app-shell"
import {
  EvidenceStrip,
  ForecastLedger,
  ForecastResultPanel,
  LoadingRunState,
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
  const { detail, error, loading, retryingRowId, retryTaskRow, runs, streamState } = useRunWorkspace(taskId)

  return (
    <AppShell runs={runs}>
      <main className="relative min-h-svh overflow-hidden px-4 py-4 md:px-8">
        <SourceGraphBackground runs={runs} variant="workspace" className="opacity-80" />
        <div className="relative z-10">
          <RunHeader detail={detail} streamState={streamState} />

          {error ? (
            <Card className="mt-6 border-destructive/40">
              <CardContent className="text-sm text-destructive">{error}</CardContent>
            </Card>
          ) : null}

          {loading && !detail.task ? <LoadingRunState /> : null}

          {detail.task ? (
            <Tabs defaultValue="overview" className="mt-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <TabsList>
                  <TabsTrigger value="overview">overview</TabsTrigger>
                  <TabsTrigger value="results">results</TabsTrigger>
                  <TabsTrigger value="researchers">researchers</TabsTrigger>
                  <TabsTrigger value="sources">sources</TabsTrigger>
                  <TabsTrigger value="debug">debug</TabsTrigger>
                </TabsList>
                <RunStreamPanel streamState={streamState} />
              </div>

              <TabsContent value="overview" className="mt-6">
                <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.52fr)_minmax(0,0.48fr)]">
                  <div className="grid gap-6">
                    <ResearchNarrativePanel task={detail.task} sources={detail.sources} streamState={streamState} traceEvents={detail.traceEvents} />
                    <ResearchTeamPanel attempts={detail.attempts} traceEvents={detail.traceEvents} streamState={streamState} />
                    <SourceMap sources={detail.sources} />
                  </div>
                  <ForecastResultPanel output={detail.forecastOutput} task={detail.task} />
                </div>
              </TabsContent>

              <TabsContent value="results" className="mt-6">
                <div className="grid gap-6">
                  <ForecastResultPanel output={detail.forecastOutput} task={detail.task} expanded />
                  <EvidenceStrip sources={detail.sources} />
                </div>
              </TabsContent>

              <TabsContent value="researchers" className="mt-6">
                <div className="grid gap-6">
                  <ResearchTeamPanel attempts={detail.attempts} traceEvents={detail.traceEvents} streamState={streamState} expanded />
                  <ForecastLedger attempts={detail.attempts} aggregates={detail.aggregates} scores={detail.scores} />
                </div>
              </TabsContent>

              <TabsContent value="sources" className="mt-6">
                <SourceList sources={detail.sources} />
              </TabsContent>

              <TabsContent value="debug" className="mt-6">
                <div className="grid gap-6">
                  <MetricGrid task={detail.task} artifacts={detail.artifacts} sources={detail.sources} taskId={taskId} />
                  <TaskRows rows={detail.taskRows} retryingRowId={retryingRowId} onRetry={(rowId) => void retryTaskRow(rowId)} />
                  <TraceEvents events={detail.traceEvents} />
                </div>
              </TabsContent>
            </Tabs>
          ) : null}
        </div>
      </main>
    </AppShell>
  )
}

function RunHeader({
  detail,
  streamState,
}: {
  detail: ReturnType<typeof useRunWorkspace>["detail"]
  streamState: ReturnType<typeof useRunWorkspace>["streamState"]
}) {
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
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className={cn(streamState.connected && "border-primary text-primary")}>
          {streamState.connected ? "Live" : "Idle"}
        </Badge>
        <Badge variant="secondary" className={statusTone(detail.task?.status)}>
          {String(detail.task?.status ?? streamState.status)}
        </Badge>
      </div>
    </header>
  )
}
