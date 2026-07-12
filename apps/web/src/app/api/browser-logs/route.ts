import { parseBrowserLogBatch, type BrowserLogEntry } from "@/lib/browser-log-schema"

const MAX_BODY_BYTES = 128_000
const encoder = new TextEncoder()

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "Browser log payload is too large." }, { status: 413 })
  }

  const text = await request.text()
  if (encoder.encode(text).byteLength > MAX_BODY_BYTES) {
    return Response.json({ ok: false, error: "Browser log payload is too large." }, { status: 413 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return Response.json({ ok: false, error: "Expected a JSON browser log batch." }, { status: 400 })
  }

  const batch = parseBrowserLogBatch(parsed)
  if (!batch) {
    return Response.json({ ok: false, error: "Invalid browser log batch." }, { status: 400 })
  }

  for (const entry of batch.entries) writeBrowserLog(entry)
  return Response.json({ ok: true, accepted: batch.entries.length })
}

function writeBrowserLog(entry: BrowserLogEntry) {
  const line = `[browser-console] ${JSON.stringify(entry)}`
  if (entry.level === "error") {
    console.error(line)
  } else if (entry.level === "warn") {
    console.warn(line)
  } else {
    console.log(line)
  }
}
