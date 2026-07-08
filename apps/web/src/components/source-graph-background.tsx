"use client"

import { useEffect, useMemo, useRef } from "react"

import type { JsonRecord } from "@/lib/records"
import { cn } from "@/lib/utils"

type GraphNode = {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  kind: "agent" | "source"
  label: string
  seed: number
  drift: number
}

type PointerState = {
  active: boolean
  x: number
  y: number
  tx: number
  ty: number
}

type SourceGraphBackgroundProps = {
  runs?: JsonRecord[]
  className?: string
  variant?: "hero" | "workspace"
}

const NODE_COLORS = {
  source: "rgba(170, 180, 204, ",
  agent: "rgba(114, 196, 255, ",
  accent: "rgba(106, 239, 198, ",
}

function scatter(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}

export function SourceGraphBackground({ runs = [], className, variant = "hero" }: SourceGraphBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const domains = useMemo(() => domainLabels(runs), [runs])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const element = canvas
    const maybeContext = element.getContext("2d")
    if (!maybeContext) {
      return
    }
    const ctx: CanvasRenderingContext2D = maybeContext

    const pointer: PointerState = { active: false, x: 0, y: 0, tx: 0, ty: 0 }
    const nodes: GraphNode[] = []
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const settings =
      variant === "hero"
        ? { edgeDistance: 158, nodeBase: 88, velocity: 0.34, alpha: 1, centerClear: 0.72 }
        : { edgeDistance: 126, nodeBase: 58, velocity: 0.22, alpha: 0.55, centerClear: 0.4 }

    let width = 0
    let height = 0
    let pixelRatio = 1
    let frame = 0
    let animationFrame = 0

    function initializeNodes() {
      nodes.length = 0
      const count = Math.max(34, Math.min(settings.nodeBase, Math.round((width * height) / 17000)))
      for (let index = 0; index < count; index += 1) {
        const isAgent = index % 8 === 0 || index % 17 === 3
        const edgeBand = scatter(index + 15) < settings.centerClear
        const side = Math.floor(scatter(index + 44) * 4)
        let x = scatter(index + 1) * width
        let y = scatter(index + 8) * height

        if (edgeBand) {
          const insetX = width * (0.03 + scatter(index + 18) * 0.2)
          const insetY = height * (0.03 + scatter(index + 27) * 0.22)
          if (side === 0) x = insetX
          if (side === 1) x = width - insetX
          if (side === 2) y = insetY
          if (side === 3) y = height - insetY
        }

        nodes.push({
          x,
          y,
          vx: (scatter(index + 31) - 0.5) * settings.velocity,
          vy: (scatter(index + 39) - 0.5) * settings.velocity,
          radius: isAgent ? 14 + scatter(index + 5) * 4 : 11 + scatter(index + 6) * 4,
          kind: isAgent ? "agent" : "source",
          label: index % 7 === 4 ? domains[index % domains.length] ?? "" : "",
          seed: scatter(index + 70) * Math.PI * 2,
          drift: 0.0012 + scatter(index + 81) * 0.0024,
        })
      }
    }

    function resize() {
      const rect = element.getBoundingClientRect()
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      element.width = Math.round(width * pixelRatio)
      element.height = Math.round(height * pixelRatio)
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      initializeNodes()
      draw()
    }

    function drawDocument(node: GraphNode, pulse: number) {
      const x = node.x
      const y = node.y
      const size = node.radius * 1.25
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(Math.sin(frame * 0.006 + node.seed) * 0.05)
      ctx.strokeStyle = `${NODE_COLORS.source}${0.54 * settings.alpha})`
      ctx.fillStyle = `rgba(17, 20, 27, ${0.58 * settings.alpha})`
      ctx.lineWidth = 1.2
      ctx.shadowColor = `rgba(142, 164, 205, ${0.16 * settings.alpha * pulse})`
      ctx.shadowBlur = 10
      roundRect(ctx, -size * 0.42, -size * 0.55, size * 0.84, size * 1.1, 2.5)
      ctx.fill()
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(size * 0.14, -size * 0.55)
      ctx.lineTo(size * 0.42, -size * 0.27)
      ctx.lineTo(size * 0.14, -size * 0.27)
      ctx.closePath()
      ctx.stroke()
      ctx.strokeStyle = `${NODE_COLORS.source}${0.22 * settings.alpha})`
      ctx.lineWidth = 1
      for (let line = 0; line < 3; line += 1) {
        ctx.beginPath()
        ctx.moveTo(-size * 0.22, -size * 0.06 + line * size * 0.2)
        ctx.lineTo(size * (0.1 + line * 0.05), -size * 0.06 + line * size * 0.2)
        ctx.stroke()
      }
      ctx.restore()
    }

    function drawAgent(node: GraphNode, pulse: number) {
      const x = node.x
      const y = node.y
      const radius = node.radius
      ctx.save()
      ctx.translate(x, y)
      const halo = ctx.createRadialGradient(0, 0, 1, 0, 0, radius * 1.8)
      halo.addColorStop(0, `${NODE_COLORS.agent}${0.34 * settings.alpha * pulse})`)
      halo.addColorStop(1, "rgba(114, 196, 255, 0)")
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(0, 0, radius * 1.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = `${NODE_COLORS.agent}${0.82 * settings.alpha})`
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.arc(0, -radius * 0.28, radius * 0.28, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, radius * 0.54, radius * 0.58, Math.PI * 1.08, Math.PI * 1.92)
      ctx.stroke()
      ctx.strokeStyle = `${NODE_COLORS.accent}${0.58 * settings.alpha})`
      ctx.beginPath()
      ctx.arc(0, 0, radius * 0.95, Math.PI * 1.4, Math.PI * 1.86)
      ctx.stroke()
      ctx.restore()
    }

    function updateNodes() {
      const centerX = width * 0.5
      const centerY = height * 0.47
      const clearRadius = Math.min(width, height) * (variant === "hero" ? 0.22 : 0.12)

      for (const node of nodes) {
        node.vx += Math.cos(frame * node.drift + node.seed) * 0.006
        node.vy += Math.sin(frame * node.drift + node.seed) * 0.006

        if (pointer.active) {
          const dx = node.x - pointer.x
          const dy = node.y - pointer.y
          const dist = Math.hypot(dx, dy) || 1
          const force = Math.max(0, 1 - dist / 230)
          const direction = node.kind === "agent" ? -0.06 : 0.12
          node.vx += (dx / dist) * force * direction
          node.vy += (dy / dist) * force * direction
        }

        const centerDx = node.x - centerX
        const centerDy = node.y - centerY
        const centerDist = Math.hypot(centerDx, centerDy) || 1
        if (centerDist < clearRadius) {
          const force = (1 - centerDist / clearRadius) * 0.08
          node.vx += (centerDx / centerDist) * force
          node.vy += (centerDy / centerDist) * force
        }

        node.vx *= 0.986
        node.vy *= 0.986
        node.x += node.vx
        node.y += node.vy

        const padding = 28
        if (node.x < -padding) node.x = width + padding
        if (node.x > width + padding) node.x = -padding
        if (node.y < -padding) node.y = height + padding
        if (node.y > height + padding) node.y = -padding
      }
    }

    function drawEdges() {
      ctx.lineWidth = 1
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i]
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j]
          const dx = a.x - b.x
          const dy = a.y - b.y
          const dist = Math.hypot(dx, dy)
          if (dist > settings.edgeDistance) {
            continue
          }
          const strength = (1 - dist / settings.edgeDistance) * settings.alpha
          const mixed = a.kind === "agent" || b.kind === "agent"
          ctx.strokeStyle = mixed ? `${NODE_COLORS.agent}${0.32 * strength})` : `rgba(132, 141, 164, ${0.22 * strength})`
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
      }

      if (pointer.active) {
        ctx.strokeStyle = `${NODE_COLORS.accent}${0.2 * settings.alpha})`
        for (const node of nodes) {
          const dist = Math.hypot(node.x - pointer.x, node.y - pointer.y)
          if (dist < 190) {
            ctx.globalAlpha = 1 - dist / 190
            ctx.beginPath()
            ctx.moveTo(pointer.x, pointer.y)
            ctx.lineTo(node.x, node.y)
            ctx.stroke()
          }
        }
        ctx.globalAlpha = 1
      }
    }

    function drawLabels() {
      ctx.font = "12px var(--font-geist-mono), monospace"
      ctx.textAlign = "center"
      ctx.textBaseline = "top"
      for (const node of nodes) {
        if (!node.label) {
          continue
        }
        ctx.fillStyle = `rgba(204, 212, 232, ${0.36 * settings.alpha})`
        ctx.fillText(node.label, node.x, node.y + node.radius + 8)
      }
    }

    function drawPointer() {
      if (!pointer.active) {
        return
      }
      const gradient = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 160)
      gradient.addColorStop(0, `${NODE_COLORS.accent}${0.13 * settings.alpha})`)
      gradient.addColorStop(1, "rgba(106, 239, 198, 0)")
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(pointer.x, pointer.y, 160, 0, Math.PI * 2)
      ctx.fill()
    }

    function draw() {
      ctx.clearRect(0, 0, width, height)
      drawEdges()
      drawPointer()
      for (const node of nodes) {
        const pulse = 0.78 + Math.sin(frame * 0.018 + node.seed) * 0.22
        if (node.kind === "agent") {
          drawAgent(node, pulse)
        } else {
          drawDocument(node, pulse)
        }
      }
      drawLabels()
    }

    function animate() {
      frame += 1
      pointer.x += (pointer.tx - pointer.x) * 0.16
      pointer.y += (pointer.ty - pointer.y) * 0.16
      updateNodes()
      draw()
      animationFrame = window.requestAnimationFrame(animate)
    }

    function onPointerMove(event: PointerEvent) {
      const rect = element.getBoundingClientRect()
      pointer.active = true
      pointer.tx = event.clientX - rect.left
      pointer.ty = event.clientY - rect.top
      if (pointer.x === 0 && pointer.y === 0) {
        pointer.x = pointer.tx
        pointer.y = pointer.ty
      }
    }

    function onPointerLeave() {
      pointer.active = false
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(element)
    element.addEventListener("pointermove", onPointerMove)
    element.addEventListener("pointerleave", onPointerLeave)
    resize()
    if (!reducedMotion) {
      animationFrame = window.requestAnimationFrame(animate)
    }

    return () => {
      resizeObserver.disconnect()
      element.removeEventListener("pointermove", onPointerMove)
      element.removeEventListener("pointerleave", onPointerLeave)
      window.cancelAnimationFrame(animationFrame)
    }
  }, [domains, variant])

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden="true">
      <canvas ref={canvasRef} className="pointer-events-auto absolute inset-0 size-full" />
      <div className="fs-graph-sheen absolute inset-0" />
      <div className="fs-vignette absolute inset-0" />
    </div>
  )
}

function domainLabels(runs: JsonRecord[]) {
  const labels = runs.map(domainFromRun).filter(Boolean)
  return labels.length > 0
    ? labels
    : ["benchlm.ai", "llm-stats.com", "morphllm.com", "swebench.com", "openrouter.ai", "vals.ai"]
}

function domainFromRun(run: JsonRecord) {
  const preview = String(run.outputPreview ?? run.title ?? "")
  const match = preview.match(/\b([a-z0-9-]+\.(?:ai|com|org|net|dev|gov|fr|in))\b/i)
  return match?.[1] ?? ""
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}
