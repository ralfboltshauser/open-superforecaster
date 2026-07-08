import { FileText, User } from "lucide-react"

import type { JsonRecord } from "@/lib/records"

type GraphNode = {
  index: number
  x: number
  y: number
  kind: "agent" | "source"
  label: string
}

// Deterministic pseudo-random so server and client render identically.
function scatter(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}

function fixed(value: number) {
  return Number(value.toFixed(4))
}

export function SourceGraphBackground({ runs = [] }: { runs?: JsonRecord[] }) {
  const nodes: GraphNode[] = Array.from({ length: 64 }, (_, index) => {
    const x = fixed(3 + scatter(index + 1) * 94)
    const y = fixed(4 + scatter(index * 2.3 + 5) * 92)
    const kind: GraphNode["kind"] = index % 7 === 0 ? "agent" : "source"
    const label = index % 9 === 4 ? domainFromRun(runs[index % Math.max(runs.length, 1)] ?? {}) : ""
    return { index, x, y, kind, label }
  })

  // Connect each node to its two nearest neighbours for an organic mesh.
  const edges: Array<{ a: GraphNode; b: GraphNode }> = []
  for (const node of nodes) {
    const neighbours = nodes
      .filter((other) => other.index !== node.index)
      .map((other) => ({ other, dist: (other.x - node.x) ** 2 + (other.y - node.y) ** 2 }))
      .sort((left, right) => left.dist - right.dist)
      .slice(0, 2)
    for (const { other } of neighbours) {
      if (node.index < other.index) {
        edges.push({ a: node, b: other })
      }
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg className="absolute inset-0 size-full opacity-[0.35]" viewBox="0 0 100 100" preserveAspectRatio="none">
        {edges.map(({ a, b }, index) => (
          <line
            key={`${a.index}-${b.index}-${index}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className="stroke-border"
            strokeWidth="0.09"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {nodes.map((node) => (
        <span
          className={node.kind === "agent" ? "fs-node-agent absolute -translate-x-1/2 -translate-y-1/2" : "fs-node absolute -translate-x-1/2 -translate-y-1/2"}
          key={node.index}
          style={{ left: `${node.x}%`, top: `${node.y}%` }}
        >
          {node.kind === "agent" ? (
            <span className="flex size-6 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
              <User className="size-3.5" />
            </span>
          ) : (
            <FileText className="size-4" />
          )}
        </span>
      ))}
      <div className="fs-vignette absolute inset-0" />
    </div>
  )
}

function domainFromRun(run: JsonRecord) {
  const preview = String(run.outputPreview ?? "")
  const match = preview.match(/\b([a-z0-9-]+\.(?:ai|com|org|net|dev|gov))\b/i)
  return match?.[1] ?? ""
}
