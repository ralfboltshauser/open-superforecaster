import React, { useEffect, useMemo, useState } from "react"
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { WorkflowCatalog, WorkflowGraph, WorkflowStep, WorkflowStepKind } from "../lib/workflow-source-parser"

type WorkflowExplorerProps = {
  catalog: WorkflowCatalog
}

type WorkflowNodeData = {
  kind: WorkflowStepKind | "join"
  label: string
  detail?: string
  sourceLine?: number
  meta?: Record<string, string | number | boolean | string[]>
}

const xGap = 300
const yGap = 148
const compactXGap = 238
const compactYGap = 144

const nodeTypes = {
  workflowStep: WorkflowNode,
}

export default function WorkflowExplorer({ catalog }: WorkflowExplorerProps) {
  const [selectedId, setSelectedId] = useState(catalog.workflows[0]?.id ?? "")
  const [isCompact, setIsCompact] = useState(false)
  const selected = catalog.workflows.find((workflow) => workflow.id === selectedId) ?? catalog.workflows[0]
  const flow = useMemo(() => materializeFlow(selected, isCompact), [isCompact, selected])

  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)")
    const update = () => setIsCompact(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  if (!selected) {
    return null
  }

  return (
    <div className="workflow-explorer">
      <aside className="workflow-sidebar" aria-label="Workflow source files">
        <div className="workflow-sidebar-heading">
          <span className="fs-eyebrow">source graph</span>
          <h2>Workflow files</h2>
        </div>
        <div className="workflow-list">
          {catalog.workflows.map((workflow) => (
            <button
              className={workflow.id === selected.id ? "workflow-list-item active" : "workflow-list-item"}
              key={workflow.id}
              onClick={() => setSelectedId(workflow.id)}
              type="button"
            >
              <span>{workflow.title}</span>
              <small>
                {workflow.stats.taskCount + workflow.stats.dynamicTaskSets} steps · {workflow.sourceHash}
              </small>
            </button>
          ))}
        </div>
      </aside>

      <section className="workflow-stage" aria-label={`${selected.title} workflow visualization`}>
        <div className="workflow-stage-header">
          <div>
            <span className="fs-eyebrow">tsx derived</span>
            <h2>{selected.title}</h2>
            <p>{selected.sourcePath}</p>
          </div>
          <div className="workflow-stat-row" aria-label="Workflow facts">
            <Fact label="tasks" value={String(selected.stats.taskCount)} />
            <Fact label="dynamic" value={String(selected.stats.dynamicTaskSets)} />
            <Fact label="loops" value={String(selected.stats.loops)} />
            <Fact label="lines" value={String(selected.sourceLines)} />
          </div>
        </div>

        <div className="workflow-canvas">
          <ReactFlow
            colorMode="dark"
            edges={flow.edges}
            fitView
            fitViewOptions={{ padding: 0.18, maxZoom: 1.18 }}
            key={`${selected.id}-${isCompact ? "compact" : "wide"}`}
            minZoom={0.28}
            maxZoom={1.35}
            nodes={flow.nodes}
            nodeTypes={nodeTypes}
            nodesConnectable={false}
            nodesDraggable={false}
            panOnScroll
            proOptions={{ hideAttribution: true }}
          >
            <Background color="oklch(0.88 0.04 244 / 0.16)" gap={28} />
            <MiniMap
              nodeBorderRadius={8}
              pannable
              zoomable
              maskColor="oklch(0.06 0.014 257 / 0.78)"
              nodeColor={(node) => colorForKind((node.data as WorkflowNodeData).kind)}
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </section>
    </div>
  )
}

export function WorkflowRouteMatrix({ catalog }: WorkflowExplorerProps) {
  return (
    <div className="classifier-matrix">
      {catalog.classifierRoutes.map((route, index) => (
        <article className="classifier-route" key={`${route.trigger}-${index}`}>
          <span className="module-index">{String(index + 1).padStart(2, "0")}</span>
          <h3>{route.trigger}</h3>
          <div className="classifier-route-grid">
            <span>mode</span>
            <strong>{route.mode}</strong>
            <span>workflow</span>
            <strong>{route.workflow}</strong>
            <span>table</span>
            <strong>{route.requiresTable ? "required" : "not required"}</strong>
            <span>confidence</span>
            <strong>{route.confidence}</strong>
          </div>
        </article>
      ))}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="workflow-fact">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function WorkflowNode({ data }: NodeProps<Node<WorkflowNodeData>>) {
  const labels = Array.isArray(data.meta?.labels) ? data.meta.labels.slice(0, 4) : []
  const metaRows = [
    data.meta?.agent ? String(data.meta.agent) : "",
    data.meta?.output ? `output ${String(data.meta.output)}` : "",
    data.meta?.maxIterations ? `max ${String(data.meta.maxIterations)}` : "",
    data.meta?.cardinality ? `${String(data.meta.cardinality)} generated` : "",
  ].filter(Boolean)

  return (
    <div className={`workflow-node workflow-node-${data.kind}`}>
      <div className="workflow-node-topline">
        <span>{kindLabel(data.kind)}</span>
        {data.sourceLine ? <small>line {data.sourceLine}</small> : null}
      </div>
      <h3>{data.label}</h3>
      {data.detail ? <p>{data.detail}</p> : null}
      {metaRows.length ? (
        <div className="workflow-node-meta">
          {metaRows.map((row) => (
            <span key={row}>{row}</span>
          ))}
        </div>
      ) : null}
      {labels.length ? (
        <div className="workflow-node-labels">
          {labels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function materializeFlow(workflow: WorkflowGraph, compact = false) {
  const nodes: Array<Node<WorkflowNodeData>> = []
  const edges: Edge[] = []
  const seenIds = new Map<string, number>()

  function nextNodeId(base: string) {
    const current = seenIds.get(base) ?? 0
    seenIds.set(base, current + 1)
    return current === 0 ? base : `${base}-${current + 1}`
  }

  function addNode(step: WorkflowStep | WorkflowNodeData, column: number, lane: number, forcedId?: string) {
    const baseId = forcedId ?? ("id" in step ? step.id : `${step.kind}-${column}-${lane}`)
    const id = nextNodeId(baseId)
    const data: WorkflowNodeData =
      "id" in step
        ? {
            kind: step.kind,
            label: step.label,
            detail: step.detail,
            sourceLine: step.sourceLine,
            meta: step.meta,
          }
        : step

    nodes.push({
      id,
      type: "workflowStep",
      position: {
        x: compact ? lane * compactXGap : column * xGap,
        y: compact ? column * compactYGap : lane * yGap,
      },
      data,
    })

    return id
  }

  function connect(sourceIds: string[], targetIds: string[], label?: string, animated = false) {
    for (const source of sourceIds) {
      for (const target of targetIds) {
        edges.push({
          id: `${source}-${target}-${edges.length}`,
          source,
          target,
          animated,
          label,
          markerEnd: { type: MarkerType.ArrowClosed },
          type: "smoothstep",
          className: animated ? "workflow-edge-loop" : "",
        })
      }
    }
  }

  function layout(step: WorkflowStep, column: number, laneStart: number): LayoutResult {
    const laneSpan = measureLanes(step)
    const centerLane = laneStart + (laneSpan - 1) / 2

    if (step.kind === "workflow") {
      const start = addNode(step, column, centerLane)
      const children = layoutSequence(step.children ?? [], column + 1, laneStart)
      connect([start], children.heads)
      return {
        heads: [start],
        tails: children.tails.length ? children.tails : [start],
        nextColumn: children.nextColumn,
        laneSpan,
      }
    }

    if (step.kind === "sequence") {
      return layoutSequence(step.children ?? [], column, laneStart)
    }

    if (step.kind === "parallel") {
      const gate = addNode(step, column, centerLane)
      let childLane = laneStart
      let joinColumn = column + 2
      const childTails: string[] = []

      for (const child of step.children ?? []) {
        const result = layout(child, column + 1, childLane)
        connect([gate], result.heads)
        childTails.push(...result.tails)
        joinColumn = Math.max(joinColumn, result.nextColumn)
        childLane += measureLanes(child)
      }

      const join = addNode(
        {
          kind: "join",
          label: "Join",
          detail: "Collects parallel outputs",
        },
        joinColumn,
        centerLane,
        `${step.id}-join`,
      )
      connect(childTails.length ? childTails : [gate], [join])

      return { heads: [gate], tails: [join], nextColumn: joinColumn + 1, laneSpan }
    }

    if (step.kind === "loop") {
      const loop = addNode(step, column, centerLane)
      const body = layoutSequence(step.children ?? [], column + 1, laneStart)
      connect([loop], body.heads.length ? body.heads : [loop])
      connect(body.tails, [loop], "repeat", true)
      return {
        heads: [loop],
        tails: body.tails.length ? body.tails : [loop],
        nextColumn: Math.max(body.nextColumn, column + 2),
        laneSpan,
      }
    }

    const node = addNode(step, column, centerLane)
    return { heads: [node], tails: [node], nextColumn: column + 1, laneSpan }
  }

  function layoutSequence(children: WorkflowStep[], column: number, laneStart: number): LayoutResult {
    let currentColumn = column
    let previousTails: string[] = []
    let heads: string[] = []
    let laneSpan = 1

    for (const child of children) {
      const result = layout(child, currentColumn, laneStart)
      if (!heads.length) {
        heads = result.heads
      }
      if (previousTails.length) {
        connect(previousTails, result.heads)
      }
      previousTails = result.tails
      currentColumn = result.nextColumn
      laneSpan = Math.max(laneSpan, result.laneSpan)
    }

    return {
      heads,
      tails: previousTails,
      nextColumn: currentColumn,
      laneSpan,
    }
  }

  layout(workflow.tree, 0, 0)

  const minY = Math.min(...nodes.map((node) => node.position.y))
  if (Number.isFinite(minY) && minY < 0) {
    for (const node of nodes) {
      node.position.y -= minY
    }
  }

  return { nodes, edges }
}

type LayoutResult = {
  heads: string[]
  tails: string[]
  nextColumn: number
  laneSpan: number
}

function measureLanes(step: WorkflowStep): number {
  if (step.kind === "parallel") {
    return Math.max(1, (step.children ?? []).reduce((total, child) => total + measureLanes(child), 0))
  }

  if (step.kind === "sequence" || step.kind === "workflow" || step.kind === "loop") {
    return Math.max(1, ...(step.children ?? []).map(measureLanes))
  }

  return 1
}

function kindLabel(kind: WorkflowNodeData["kind"]) {
  if (kind === "dynamic-task-set") {
    return "task map"
  }
  return kind.replaceAll("-", " ")
}

function colorForKind(kind: WorkflowNodeData["kind"]) {
  if (kind === "workflow") {
    return "oklch(0.76 0.12 244)"
  }
  if (kind === "parallel" || kind === "dynamic-task-set") {
    return "oklch(0.74 0.14 152)"
  }
  if (kind === "loop") {
    return "oklch(0.845 0.12 84)"
  }
  if (kind === "join") {
    return "oklch(0.66 0.018 252)"
  }
  return "oklch(0.94 0.012 252)"
}
