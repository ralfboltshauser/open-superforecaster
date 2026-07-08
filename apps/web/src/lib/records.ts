export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readString(record: unknown, key: string): string | null {
  if (!isRecord(record)) {
    return null
  }
  const value = record[key]
  return typeof value === "string" ? value : null
}

export function readNumber(record: unknown, key: string): number | null {
  if (!isRecord(record)) {
    return null
  }
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function readArray(record: unknown, key: string): unknown[] {
  if (!isRecord(record)) {
    return []
  }
  const value = record[key]
  return Array.isArray(value) ? value : []
}

export function truncate(value: string, max = 80) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value
}

export function formatModeLabel(value: unknown) {
  return String(value ?? "run")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function statusTone(status: unknown) {
  const value = String(status ?? "queued")
  if (value === "completed") {
    return "text-emerald-400"
  }
  if (value === "failed") {
    return "text-destructive"
  }
  if (value === "running") {
    return "text-primary"
  }
  return "text-muted-foreground"
}

export function runTitle(run: JsonRecord) {
  const label = String(run.label ?? "").trim()
  const preview = String(run.outputPreview ?? "").trim()
  const fallback = String(run.operationSubmode ?? run.operationMode ?? "Forecast").trim()
  return truncate(label && label !== "Forecast" ? label : preview || fallback, 72)
}

export function questionTitle(task: JsonRecord) {
  const input = isRecord(task.input) ? task.input : {}
  const config = isRecord(task.configJson) ? task.configJson : {}
  const question =
    readString(input, "question") ??
    readString(input, "prompt") ??
    readString(input, "topic") ??
    readString(config, "prompt") ??
    String(task.label ?? "")
  return truncate(question || "Forecast run", 180)
}

export function parseEventData(event: MessageEvent) {
  try {
    const parsed = JSON.parse(event.data)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}
