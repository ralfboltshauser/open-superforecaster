export type EvidenceCoverageSnapshot = {
  sourceCount: number | null;
  sourceCountBand: "none" | "sparse" | "sourced" | "deep" | "unknown";
  sourceDomainCount: number | null;
  datedSourceCount: number | null;
  undatedSourceCount: number | null;
  sourceDateCoverageBand: "none" | "partial" | "complete" | "unknown";
  newestPublishedAt: string | null;
  oldestPublishedAt: string | null;
  uncertaintyCount: number | null;
  uncertaintyCountBand: "none" | "limited" | "many" | "unknown";
  rationaleLength: number | null;
  rationaleLengthBand: "absent" | "short" | "substantial" | "long" | "unknown";
  method: string | null;
};

export function readEvidenceCoverageSnapshot(value: unknown): EvidenceCoverageSnapshot | null {
  const record = asRecord(value);
  const evidence = asRecord(record?.evidenceCoverage) ?? record;
  if (!evidence) {
    return null;
  }
  const sourceCount = readNumber(evidence, "sourceCount", "source_count") ?? readSources(evidence).length;
  const sources = readSources(evidence);
  const sourceDomainCount = readNumber(evidence, "sourceDomainCount", "source_domain_count") ?? sourceDomains(sources).length;
  const publishedDates = sourcePublishedDates(sources);
  const datedSourceCount = readNumber(evidence, "datedSourceCount", "dated_source_count") ?? publishedDates.length;
  const undatedSourceCount = readNumber(evidence, "undatedSourceCount", "undated_source_count") ?? Math.max(0, sourceCount - datedSourceCount);
  const newestPublishedAt = readString(evidence, "newestPublishedAt", "newest_published_at") ?? newestDate(publishedDates);
  const oldestPublishedAt = readString(evidence, "oldestPublishedAt", "oldest_published_at") ?? oldestDate(publishedDates);
  const uncertaintyCount = readNumber(evidence, "uncertaintyCount", "uncertainty_count") ?? readUncertainties(evidence).length;
  const rationaleLength = readNumber(evidence, "rationaleLength", "rationale_length") ?? rationaleWordCount(evidence);
  const method = readString(evidence, "method");
  if (sourceCount === 0 && sourceDomainCount === 0 && uncertaintyCount === 0 && rationaleLength === 0 && method === null) {
    return null;
  }
  return {
    sourceCount,
    sourceCountBand: sourceCountBand(sourceCount),
    sourceDomainCount,
    datedSourceCount,
    undatedSourceCount,
    sourceDateCoverageBand: sourceDateCoverageBand({ sourceCount, datedSourceCount }),
    newestPublishedAt,
    oldestPublishedAt,
    uncertaintyCount,
    uncertaintyCountBand: uncertaintyCountBand(uncertaintyCount),
    rationaleLength,
    rationaleLengthBand: rationaleLengthBand(rationaleLength),
    method,
  };
}

export function sourceDateCoverageBand(input: {
  sourceCount: number | null;
  datedSourceCount: number | null;
}): EvidenceCoverageSnapshot["sourceDateCoverageBand"] {
  if (
    input.sourceCount === null ||
    input.datedSourceCount === null ||
    !Number.isFinite(input.sourceCount) ||
    !Number.isFinite(input.datedSourceCount)
  ) {
    return "unknown";
  }
  if (input.sourceCount <= 0) {
    return "none";
  }
  if (input.datedSourceCount <= 0) {
    return "none";
  }
  if (input.datedSourceCount >= input.sourceCount) {
    return "complete";
  }
  return "partial";
}

export function sourceCountBand(count: number | null): EvidenceCoverageSnapshot["sourceCountBand"] {
  if (count === null || !Number.isFinite(count)) {
    return "unknown";
  }
  if (count <= 0) {
    return "none";
  }
  if (count <= 2) {
    return "sparse";
  }
  if (count <= 5) {
    return "sourced";
  }
  return "deep";
}

export function uncertaintyCountBand(count: number | null): EvidenceCoverageSnapshot["uncertaintyCountBand"] {
  if (count === null || !Number.isFinite(count)) {
    return "unknown";
  }
  if (count <= 0) {
    return "none";
  }
  if (count <= 2) {
    return "limited";
  }
  return "many";
}

export function rationaleLengthBand(count: number | null): EvidenceCoverageSnapshot["rationaleLengthBand"] {
  if (count === null || !Number.isFinite(count)) {
    return "unknown";
  }
  if (count <= 0) {
    return "absent";
  }
  if (count < 40) {
    return "short";
  }
  if (count < 160) {
    return "substantial";
  }
  return "long";
}

function readSources(value: Record<string, unknown>) {
  return readRecordArray(value, "citedSources", "cited_sources", "sources");
}

function readUncertainties(value: Record<string, unknown>) {
  return readStringArray(value, "keyUncertainties", "key_uncertainties", "uncertainties", "uncertaintyFlags");
}

function rationaleWordCount(value: Record<string, unknown>) {
  const parts = [
    readString(value, "rationale", "summary", "answer"),
    readString(value, "branchRationale", "branch_rationale", "dependenceNotes", "dependence_notes"),
    readString(value, "rationaleGivenCondition", "rationale_given_condition"),
    readString(value, "rationaleGivenNotCondition", "rationale_given_not_condition"),
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) {
    return 0;
  }
  return parts.join(" ").trim().split(/\s+/).filter(Boolean).length;
}

function sourceDomains(sources: Record<string, unknown>[]) {
  return [...new Set(sources.flatMap((source) => {
    const rawUrl = readString(source, "url");
    if (!rawUrl) {
      return [];
    }
    try {
      return [new URL(rawUrl).hostname.replace(/^www\./, "")];
    } catch {
      return [];
    }
  }))];
}

function sourcePublishedDates(sources: Record<string, unknown>[]) {
  return sources.flatMap((source) => {
    const publishedAt = readString(source, "publishedAt", "published_at");
    if (!publishedAt) {
      return [];
    }
    const timestamp = Date.parse(publishedAt);
    if (!Number.isFinite(timestamp)) {
      return [];
    }
    return [new Date(timestamp).toISOString().slice(0, 10)];
  });
}

function newestDate(dates: string[]) {
  return dates.length ? [...dates].sort().at(-1) ?? null : null;
}

function oldestDate(dates: string[]) {
  return dates.length ? [...dates].sort()[0] ?? null : null;
}

function readRecordArray(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (Array.isArray(raw)) {
      const records = raw.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
      if (records.length > 0) {
        return records;
      }
    }
  }
  return [];
}

function readStringArray(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
    if (Array.isArray(raw)) {
      const strings = raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (strings.length > 0) {
        return strings;
      }
    }
  }
  return [];
}

function readString(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

function readNumber(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
