export type SourceGraphVariant = "hero" | "workspace"

export type GraphNode = {
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

export type GraphSettings = {
  edgeDistance: number
  nodeBase: number
  velocity: number
  alpha: number
  centerClear: number
  maxPixelRatio: number
  speed: number
}

export type PointerState = {
  active: boolean
  x: number
  y: number
  tx: number
  ty: number
}

export type SpriteSet = {
  agent: HTMLCanvasElement
  source: HTMLCanvasElement
}
