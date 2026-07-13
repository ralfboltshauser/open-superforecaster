import {
  isRecord,
  questionTitle,
  readArray,
  readString,
  truncate,
  type JsonRecord,
} from "@/lib/records"

export type RunDetail = ReturnType<typeof buildRunDetail>

export function buildRunDetail(run: JsonRecord | null) {
  const task = isRecord(run?.task) ? run.task : null
  const taskRows = readArray(run, "taskRows").filter(isRecord)
  const artifacts = readArray(run, "artifacts").filter(isRecord)
  const sources = dedupeSourceRecords(readArray(run, "sources").filter(isRecord))
  const attempts = dedupeRecords(readArray(run, "forecastAttempts").filter(isRecord), forecastAttemptKey)
  const aggregates = dedupeRecords(readArray(run, "forecastAggregates").filter(isRecord), forecastAggregateKey)
  const scores = readArray(run, "forecastScores").filter(isRecord)
  const traceEvents = dedupeRecords(readArray(run, "traceEvents").filter(isRecord), traceEventKey)
  const forecastOutput = firstAggregateOutput(aggregates) ?? firstArtifactOutput(artifacts)

  return {
    task,
    taskRows,
    artifacts,
    sources,
    attempts,
    aggregates,
    scores,
    traceEvents,
    forecastOutput,
    forecastReady: Boolean(forecastOutput),
    title: task ? questionTitle(task) : "Loading run",
  }
}

export function firstAggregateOutput(aggregates: JsonRecord[]) {
  for (const aggregate of aggregates) {
    const output = aggregate.rawAggregate ?? aggregate.outputJson ?? aggregate.output
    if (isRecord(output)) {
      return output
    }
  }
  return null
}

export function firstArtifactOutput(artifacts: JsonRecord[]) {
  for (const artifact of artifacts) {
    const content = artifact.contentJson ?? artifact.outputJson ?? artifact.content
    if (isRecord(content)) {
      return content
    }
  }
  return null
}

export function parseRecord(value: unknown) {
  if (isRecord(value)) {
    return value
  }
  if (typeof value !== "string") {
    return null
  }
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function sourceDomain(source: JsonRecord) {
  const url = readString(source, "url") ?? readString(source, "sourceUrl") ?? readString(source, "domain") ?? "source"
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return truncate(url, 28)
  }
}

function dedupeSourceRecords(sources: JsonRecord[]) {
  return dedupeRecords(sources, sourceKey)
}

function dedupeRecords(records: JsonRecord[], keyForRecord: (record: JsonRecord) => string) {
  const seen = new Set<string>()
  const deduped: JsonRecord[] = []
  for (const record of records) {
    const key = keyForRecord(record)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(record)
  }
  return deduped
}

function sourceKey(source: JsonRecord) {
  const url = readString(source, "url") ?? readString(source, "sourceUrl")
  if (url) {
    try {
      const parsed = new URL(url)
      parsed.hash = ""
      parsed.searchParams.sort()
      return `url:${parsed.toString().replace(/\/$/, "")}`
    } catch {
      return `url:${url.trim().replace(/\/$/, "").toLowerCase()}`
    }
  }
  return `fallback:${String(readString(source, "title") ?? sourceDomain(source)).trim().toLowerCase()}`
}

function forecastAttemptKey(attempt: JsonRecord) {
  return stableRecordKey({
    forecasterLabel: readString(attempt, "forecasterLabel"),
    forecastType: readString(attempt, "forecastType"),
    rawPrediction: attempt.rawPrediction,
  })
}

function forecastAggregateKey(aggregate: JsonRecord) {
  return stableRecordKey({
    forecastType: readString(aggregate, "forecastType"),
    method: readString(aggregate, "method"),
    rawAggregate: aggregate.rawAggregate,
  })
}

function traceEventKey(event: JsonRecord) {
  return stableRecordKey({
    eventType: readString(event, "eventType"),
    phase: readString(event, "phase"),
    agentLabel: readString(event, "agentLabel"),
    payloadJson: event.payloadJson,
  })
}

function stableRecordKey(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableRecordKey).join(",")}]`
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableRecordKey(entry)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
