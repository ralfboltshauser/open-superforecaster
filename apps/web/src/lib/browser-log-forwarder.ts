import type { BrowserLogEntry, BrowserLogLevel, BrowserLogSource } from "./browser-log-schema"

const ENDPOINT = "/api/browser-logs"
const FLUSH_DELAY_MS = 200
const MAX_QUEUE_ENTRIES = 200
const MAX_BATCH_ENTRIES = 20
const MAX_SERIALIZED_ARG_LENGTH = 8_000
const MAX_DEPTH = 5
const MAX_COLLECTION_ITEMS = 40
const INSTALL_KEY = "__openSuperforecasterBrowserLogForwarderInstalled"
const sensitiveKeyPattern = /authorization|cookie|credential|password|secret|token|api[-_]?key/i

type ConsoleMethod = "debug" | "info" | "log" | "warn" | "error" | "trace"

const consoleMethods: ConsoleMethod[] = ["debug", "info", "log", "warn", "error", "trace"]

export function installBrowserLogForwarder() {
  const globalState = globalThis as typeof globalThis & Record<string, unknown>
  if (globalState[INSTALL_KEY]) return
  globalState[INSTALL_KEY] = true

  const originals = Object.fromEntries(
    consoleMethods.map((method) => [method, console[method].bind(console)]),
  ) as Record<ConsoleMethod, (...args: unknown[]) => void>
  const queue: BrowserLogEntry[] = []
  let flushTimer: ReturnType<typeof setTimeout> | undefined

  const scheduleFlush = () => {
    if (flushTimer !== undefined) return
    flushTimer = setTimeout(flush, FLUSH_DELAY_MS)
  }

  const enqueue = (level: BrowserLogLevel, source: BrowserLogSource, args: unknown[]) => {
    try {
      const serialized = args.length > 0 ? args.map(serializeBrowserLogValue) : ["(no arguments)"]
      queue.push({
        level,
        source,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent,
        args: serialized,
      })
      if (queue.length > MAX_QUEUE_ENTRIES) queue.splice(0, queue.length - MAX_QUEUE_ENTRIES)
      scheduleFlush()
    } catch {
      // Observability must never break the application it observes.
    }
  }

  const takeBatch = (limit = MAX_BATCH_ENTRIES) => queue.splice(0, limit)

  function flush() {
    flushTimer = undefined
    const entries = takeBatch()
    if (entries.length === 0) return

    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries }),
      keepalive: true,
    }).catch(() => {
      // Do not log forwarding failures through the patched console: that would loop.
    })

    if (queue.length > 0) scheduleFlush()
  }

  try {
    for (const method of consoleMethods) {
      const level: BrowserLogLevel = method
      console[method] = (...args: unknown[]) => {
        originals[method](...args)
        enqueue(level, "console", args)
      }
    }

    window.addEventListener("error", (event) => {
      enqueue("error", "window.error", [event.error ?? event.message, {
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      }])
    })

    window.addEventListener("unhandledrejection", (event) => {
      enqueue("error", "unhandledrejection", [event.reason])
    })

    window.addEventListener("pagehide", () => {
      if (flushTimer !== undefined) clearTimeout(flushTimer)
      flushTimer = undefined
      const entries = takeBatch(50)
      if (entries.length === 0 || typeof navigator.sendBeacon !== "function") return
      navigator.sendBeacon(ENDPOINT, JSON.stringify({ entries }))
    })
  } catch (error) {
    for (const method of consoleMethods) console[method] = originals[method]
    globalState[INSTALL_KEY] = false
    originals.error("Browser log forwarding failed to initialize", error)
  }
}

export function serializeBrowserLogValue(value: unknown): string {
  try {
    if (typeof value === "string") return truncate(redactString(value))
    const normalized = normalizeValue(value, new WeakSet<object>(), 0)
    const serialized = typeof normalized === "string" ? normalized : JSON.stringify(normalized)
    return truncate(serialized ?? String(normalized))
  } catch (error) {
    return `[Unserializable: ${error instanceof Error ? error.message : String(error)}]`
  }
}

function normalizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") return redactString(value)
  if (typeof value === "undefined") return "[undefined]"
  if (typeof value === "bigint") return `${value}n`
  if (typeof value === "symbol") return value.toString()
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`
  if (depth >= MAX_DEPTH) return "[Max depth]"

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
      cause: value.cause === undefined ? undefined : normalizeValue(value.cause, seen, depth + 1),
    }
  }
  if (value instanceof Date) return value.toISOString()
  if (value instanceof URL) return value.toString()
  if (typeof Element !== "undefined" && value instanceof Element) return describeElement(value)

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)

    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_COLLECTION_ITEMS).map((item) => normalizeValue(item, seen, depth + 1))
      if (value.length > MAX_COLLECTION_ITEMS) items.push(`[${value.length - MAX_COLLECTION_ITEMS} more items]`)
      return items
    }
    if (value instanceof Map) {
      return Array.from(value.entries()).slice(0, MAX_COLLECTION_ITEMS).map(([key, item]) => [
        normalizeValue(key, seen, depth + 1),
        normalizeValue(item, seen, depth + 1),
      ])
    }
    if (value instanceof Set) {
      return Array.from(value.values()).slice(0, MAX_COLLECTION_ITEMS).map((item) => normalizeValue(item, seen, depth + 1))
    }

    const output: Record<string, unknown> = {}
    for (const key of Object.keys(value).slice(0, MAX_COLLECTION_ITEMS)) {
      if (sensitiveKeyPattern.test(key)) {
        output[key] = "[REDACTED]"
        continue
      }
      try {
        output[key] = normalizeValue((value as Record<string, unknown>)[key], seen, depth + 1)
      } catch {
        output[key] = "[Unreadable property]"
      }
    }
    return output
  }

  return String(value)
}

function describeElement(element: Element) {
  const id = element.id ? `#${element.id}` : ""
  const classes = Array.from(element.classList).slice(0, 4).map((name) => `.${name}`).join("")
  return `<${element.tagName.toLowerCase()}${id}${classes}>`
}

function redactString(value: string) {
  return value
    .replace(/(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, "[REDACTED_API_KEY]")
}

function truncate(value: string) {
  if (value.length <= MAX_SERIALIZED_ARG_LENGTH) return value
  return `${value.slice(0, MAX_SERIALIZED_ARG_LENGTH)}…[truncated ${value.length - MAX_SERIALIZED_ARG_LENGTH} chars]`
}
