export const browserLogLevels = ["debug", "info", "log", "warn", "error", "trace"] as const
export const browserLogSources = ["console", "window.error", "unhandledrejection"] as const

export type BrowserLogLevel = (typeof browserLogLevels)[number]
export type BrowserLogSource = (typeof browserLogSources)[number]

export type BrowserLogEntry = {
  level: BrowserLogLevel
  source: BrowserLogSource
  timestamp: string
  url: string
  userAgent: string
  args: string[]
}

export type BrowserLogBatch = {
  entries: BrowserLogEntry[]
}

const MAX_BATCH_ENTRIES = 50
const MAX_ARGS = 20
const MAX_ARG_LENGTH = 8_000

export function parseBrowserLogBatch(value: unknown): BrowserLogBatch | null {
  if (!isRecord(value) || !Array.isArray(value.entries) || value.entries.length === 0 || value.entries.length > MAX_BATCH_ENTRIES) {
    return null
  }

  const entries: BrowserLogEntry[] = []
  for (const candidate of value.entries) {
    if (!isRecord(candidate)) return null
    if (!isOneOf(candidate.level, browserLogLevels)) return null
    if (!isOneOf(candidate.source, browserLogSources)) return null
    if (!isBoundedString(candidate.timestamp, 64)) return null
    if (!isBoundedString(candidate.url, 2_048)) return null
    if (!isBoundedString(candidate.userAgent, 1_024)) return null
    if (!Array.isArray(candidate.args) || candidate.args.length === 0 || candidate.args.length > MAX_ARGS) return null
    if (!candidate.args.every((arg) => isBoundedString(arg, MAX_ARG_LENGTH))) return null

    entries.push({
      level: candidate.level,
      source: candidate.source,
      timestamp: candidate.timestamp,
      url: candidate.url,
      userAgent: candidate.userAgent,
      args: candidate.args,
    })
  }

  return { entries }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isOneOf<const T extends readonly string[]>(value: unknown, choices: T): value is T[number] {
  return typeof value === "string" && choices.includes(value)
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength
}
