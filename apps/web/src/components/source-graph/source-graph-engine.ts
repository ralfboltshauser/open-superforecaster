import type { GraphNode, GraphSettings, PointerState, SourceGraphVariant, SpriteSet } from "@/components/source-graph/types"

type SourceGraphEngineOptions = {
  domains: string[]
  variant: SourceGraphVariant
}

const NODE_COLORS = {
  source: "rgba(170, 180, 204, ",
  agent: "rgba(114, 196, 255, ",
  accent: "rgba(106, 239, 198, ",
}

const MAX_DELTA_MS = 34

export class SourceGraphEngine {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly domains: string[]
  private readonly nodes: GraphNode[] = []
  private readonly pointer: PointerState = { active: false, x: 0, y: 0, tx: 0, ty: 0 }
  private readonly reducedMotion: boolean
  private readonly resizeObserver: ResizeObserver
  private readonly settings: GraphSettings
  private readonly sprites: SpriteSet
  private readonly variant: SourceGraphVariant
  private animationFrame = 0
  private bounds: DOMRect
  private elapsed = 0
  private height = 0
  private intersectionObserver: IntersectionObserver | null = null
  private lastTime = 0
  private visible = true
  private width = 0

  constructor(canvas: HTMLCanvasElement, options: SourceGraphEngineOptions) {
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true })
    if (!context) {
      throw new Error("Could not initialize source graph canvas context.")
    }

    this.canvas = canvas
    this.ctx = context
    this.domains = options.domains
    this.variant = options.variant
    this.settings = settingsForVariant(options.variant)
    this.sprites = createSprites(this.settings)
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    this.bounds = canvas.getBoundingClientRect()
    this.resizeObserver = new ResizeObserver(this.resize)
  }

  start() {
    this.resizeObserver.observe(this.canvas)
    window.addEventListener("mousemove", this.onMouseMove)
    window.addEventListener("mouseout", this.onMouseOut)
    document.addEventListener("visibilitychange", this.onVisibilityChange)
    this.observeVisibility()
    this.resize()

    if (!this.reducedMotion) {
      this.animationFrame = window.requestAnimationFrame(this.animate)
    }
  }

  destroy() {
    this.resizeObserver.disconnect()
    this.intersectionObserver?.disconnect()
    window.removeEventListener("mousemove", this.onMouseMove)
    window.removeEventListener("mouseout", this.onMouseOut)
    document.removeEventListener("visibilitychange", this.onVisibilityChange)
    window.cancelAnimationFrame(this.animationFrame)
  }

  private readonly resize = () => {
    this.bounds = this.canvas.getBoundingClientRect()
    this.width = Math.max(1, this.bounds.width)
    this.height = Math.max(1, this.bounds.height)

    const pixelRatio = Math.min(window.devicePixelRatio || 1, this.settings.maxPixelRatio)
    this.canvas.width = Math.round(this.width * pixelRatio)
    this.canvas.height = Math.round(this.height * pixelRatio)
    this.ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    this.initializeNodes()
    this.draw()
  }

  private observeVisibility() {
    if (!("IntersectionObserver" in window)) {
      return
    }

    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = Boolean(entry?.isIntersecting)
    })
    this.intersectionObserver.observe(this.canvas)
  }

  private readonly onVisibilityChange = () => {
    if (!document.hidden) {
      this.lastTime = 0
    }
  }

  private readonly onMouseMove = (event: MouseEvent) => {
    this.bounds = this.canvas.getBoundingClientRect()
    this.pointer.active = true
    this.pointer.tx = event.clientX - this.bounds.left
    this.pointer.ty = event.clientY - this.bounds.top
    if (this.pointer.x === 0 && this.pointer.y === 0) {
      this.pointer.x = this.pointer.tx
      this.pointer.y = this.pointer.ty
    }
  }

  private readonly onMouseOut = (event: MouseEvent) => {
    if (!event.relatedTarget) {
      this.pointer.active = false
    }
  }

  private readonly animate = (time: number) => {
    if (document.hidden || !this.visible) {
      this.lastTime = time
      this.animationFrame = window.requestAnimationFrame(this.animate)
      return
    }

    const deltaMs = Math.min(MAX_DELTA_MS, this.lastTime ? time - this.lastTime : 16.67)
    this.lastTime = time
    this.elapsed += deltaMs
    this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.16
    this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.16
    this.updateNodes(deltaMs)
    this.draw()
    this.animationFrame = window.requestAnimationFrame(this.animate)
  }

  private initializeNodes() {
    this.nodes.length = 0
    const areaCount = Math.round((this.width * this.height) / 24000)
    const count = Math.max(28, Math.min(this.settings.nodeBase, areaCount))

    for (let index = 0; index < count; index += 1) {
      const isAgent = index % 8 === 0 || index % 17 === 3
      const edgeBand = scatter(index + 15) < this.settings.centerClear
      const side = Math.floor(scatter(index + 44) * 4)
      let x = scatter(index + 1) * this.width
      let y = scatter(index + 8) * this.height

      if (edgeBand) {
        const insetX = this.width * (0.03 + scatter(index + 18) * 0.2)
        const insetY = this.height * (0.03 + scatter(index + 27) * 0.22)
        if (side === 0) x = insetX
        if (side === 1) x = this.width - insetX
        if (side === 2) y = insetY
        if (side === 3) y = this.height - insetY
      }

      this.nodes.push({
        x,
        y,
        vx: (scatter(index + 31) - 0.5) * this.settings.velocity,
        vy: (scatter(index + 39) - 0.5) * this.settings.velocity,
        radius: isAgent ? 14 + scatter(index + 5) * 4 : 11 + scatter(index + 6) * 4,
        kind: isAgent ? "agent" : "source",
        label: index % 7 === 4 ? this.domains[index % this.domains.length] ?? "" : "",
        seed: scatter(index + 70) * Math.PI * 2,
        drift: 0.0012 + scatter(index + 81) * 0.0024,
      })
    }
  }

  private updateNodes(deltaMs: number) {
    const centerX = this.width * 0.5
    const centerY = this.height * 0.47
    const clearRadius = Math.min(this.width, this.height) * (this.variant === "hero" ? 0.22 : 0.12)
    const step = (deltaMs / 16.67) * this.settings.speed
    const damping = Math.pow(0.986, step)

    for (const node of this.nodes) {
      node.vx += Math.cos(this.elapsed * node.drift + node.seed) * 0.006 * step
      node.vy += Math.sin(this.elapsed * node.drift + node.seed) * 0.006 * step

      if (this.pointer.active) {
        this.applyPointerForce(node, step)
      }

      const centerDx = node.x - centerX
      const centerDy = node.y - centerY
      const centerDist = Math.hypot(centerDx, centerDy) || 1
      if (centerDist < clearRadius) {
        const force = (1 - centerDist / clearRadius) * 0.08
        node.vx += (centerDx / centerDist) * force * step
        node.vy += (centerDy / centerDist) * force * step
      }

      node.vx *= damping
      node.vy *= damping
      node.x += node.vx * step
      node.y += node.vy * step
      this.wrapNode(node)
    }
  }

  private applyPointerForce(node: GraphNode, step: number) {
    const dx = node.x - this.pointer.x
    const dy = node.y - this.pointer.y
    const dist = Math.hypot(dx, dy) || 1
    const force = Math.max(0, 1 - dist / 230)
    const direction = node.kind === "agent" ? -0.09 : 0.16
    node.vx += (dx / dist) * force * direction * step
    node.vy += (dy / dist) * force * direction * step
  }

  private wrapNode(node: GraphNode) {
    const padding = 28
    if (node.x < -padding) node.x = this.width + padding
    if (node.x > this.width + padding) node.x = -padding
    if (node.y < -padding) node.y = this.height + padding
    if (node.y > this.height + padding) node.y = -padding
  }

  private draw() {
    this.ctx.clearRect(0, 0, this.width, this.height)
    this.drawEdges()
    this.drawPointerGlow()
    for (const node of this.nodes) {
      const pulse = 0.78 + Math.sin(this.elapsed * 0.0048 + node.seed) * 0.22
      this.drawNodeSprite(node, pulse)
    }
    this.drawLabels()
  }

  private drawEdges() {
    this.ctx.lineWidth = 1
    const cellSize = this.settings.edgeDistance
    const grid = new Map<string, GraphNode[]>()

    for (const node of this.nodes) {
      const key = gridKey(node.x, node.y, cellSize)
      const cell = grid.get(key)
      if (cell) {
        cell.push(node)
      } else {
        grid.set(key, [node])
      }
    }

    for (const a of this.nodes) {
      const cellX = Math.floor(a.x / cellSize)
      const cellY = Math.floor(a.y / cellSize)
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const cell = grid.get(`${cellX + ox}:${cellY + oy}`)
          if (!cell) continue
          for (const b of cell) {
            if (a === b || a.seed > b.seed) continue
            this.drawEdge(a, b)
          }
        }
      }
    }

    if (this.pointer.active) {
      this.drawPointerEdges()
    }
  }

  private drawEdge(a: GraphNode, b: GraphNode) {
    const dx = a.x - b.x
    const dy = a.y - b.y
    const distSquared = dx * dx + dy * dy
    const max = this.settings.edgeDistance * this.settings.edgeDistance
    if (distSquared > max) {
      return
    }

    const dist = Math.sqrt(distSquared)
    const strength = (1 - dist / this.settings.edgeDistance) * this.settings.alpha
    const mixed = a.kind === "agent" || b.kind === "agent"
    this.ctx.strokeStyle = mixed ? `${NODE_COLORS.agent}${0.32 * strength})` : `rgba(132, 141, 164, ${0.22 * strength})`
    this.ctx.beginPath()
    this.ctx.moveTo(a.x, a.y)
    this.ctx.lineTo(b.x, b.y)
    this.ctx.stroke()
  }

  private drawPointerEdges() {
    this.ctx.strokeStyle = `${NODE_COLORS.accent}${0.2 * this.settings.alpha})`
    for (const node of this.nodes) {
      const dist = Math.hypot(node.x - this.pointer.x, node.y - this.pointer.y)
      if (dist < 190) {
        this.ctx.globalAlpha = 1 - dist / 190
        this.ctx.beginPath()
        this.ctx.moveTo(this.pointer.x, this.pointer.y)
        this.ctx.lineTo(node.x, node.y)
        this.ctx.stroke()
      }
    }
    this.ctx.globalAlpha = 1
  }

  private drawPointerGlow() {
    if (!this.pointer.active) {
      return
    }

    const gradient = this.ctx.createRadialGradient(this.pointer.x, this.pointer.y, 0, this.pointer.x, this.pointer.y, 160)
    gradient.addColorStop(0, `${NODE_COLORS.accent}${0.13 * this.settings.alpha})`)
    gradient.addColorStop(1, "rgba(106, 239, 198, 0)")
    this.ctx.fillStyle = gradient
    this.ctx.beginPath()
    this.ctx.arc(this.pointer.x, this.pointer.y, 160, 0, Math.PI * 2)
    this.ctx.fill()
  }

  private drawNodeSprite(node: GraphNode, pulse: number) {
    const sprite = node.kind === "agent" ? this.sprites.agent : this.sprites.source
    const size = node.radius * (node.kind === "agent" ? 3.9 : 3.1)
    this.ctx.save()
    this.ctx.translate(node.x, node.y)
    this.ctx.rotate(Math.sin(this.elapsed * 0.0024 + node.seed) * 0.05)
    this.ctx.globalAlpha = 0.78 + pulse * 0.22
    this.ctx.drawImage(sprite, -size * 0.5, -size * 0.5, size, size)
    this.ctx.restore()
  }

  private drawLabels() {
    this.ctx.font = "12px var(--font-geist-mono), monospace"
    this.ctx.textAlign = "center"
    this.ctx.textBaseline = "top"
    for (const node of this.nodes) {
      if (!node.label) continue
      this.ctx.fillStyle = `rgba(204, 212, 232, ${0.36 * this.settings.alpha})`
      this.ctx.fillText(node.label, node.x, node.y + node.radius + 8)
    }
  }
}

function settingsForVariant(variant: SourceGraphVariant): GraphSettings {
  return variant === "hero"
    ? { edgeDistance: 150, nodeBase: 66, velocity: 0.54, alpha: 0.92, centerClear: 0.72, maxPixelRatio: 1.35, speed: 1.65 }
    : { edgeDistance: 120, nodeBase: 44, velocity: 0.38, alpha: 0.5, centerClear: 0.4, maxPixelRatio: 1.2, speed: 1.35 }
}

function createSprites(settings: GraphSettings): SpriteSet {
  return {
    agent: createAgentSprite(settings),
    source: createSourceSprite(settings),
  }
}

function createSourceSprite(settings: GraphSettings) {
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  const size = 72
  canvas.width = size
  canvas.height = size
  if (!ctx) return canvas

  ctx.translate(size / 2, size / 2)
  ctx.strokeStyle = `${NODE_COLORS.source}${0.58 * settings.alpha})`
  ctx.fillStyle = `rgba(17, 20, 27, ${0.58 * settings.alpha})`
  ctx.lineWidth = 1.8
  ctx.shadowColor = `rgba(142, 164, 205, ${0.18 * settings.alpha})`
  ctx.shadowBlur = 10
  roundRect(ctx, -13, -18, 26, 36, 3)
  ctx.fill()
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(4, -18)
  ctx.lineTo(13, -9)
  ctx.lineTo(4, -9)
  ctx.closePath()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.strokeStyle = `${NODE_COLORS.source}${0.24 * settings.alpha})`
  ctx.lineWidth = 1
  for (let line = 0; line < 3; line += 1) {
    ctx.beginPath()
    ctx.moveTo(-7, -2 + line * 7)
    ctx.lineTo(4 + line * 2, -2 + line * 7)
    ctx.stroke()
  }
  return canvas
}

function createAgentSprite(settings: GraphSettings) {
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  const size = 88
  const radius = 18
  canvas.width = size
  canvas.height = size
  if (!ctx) return canvas

  ctx.translate(size / 2, size / 2)
  const halo = ctx.createRadialGradient(0, 0, 1, 0, 0, radius * 2.1)
  halo.addColorStop(0, `${NODE_COLORS.agent}${0.34 * settings.alpha})`)
  halo.addColorStop(1, "rgba(114, 196, 255, 0)")
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(0, 0, radius * 2.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = `${NODE_COLORS.agent}${0.82 * settings.alpha})`
  ctx.lineWidth = 2
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
  return canvas
}

function gridKey(x: number, y: number, cellSize: number) {
  return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`
}

function scatter(seed: number) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
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
