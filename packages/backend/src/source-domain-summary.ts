export type SourceDomainInput = {
  domain?: unknown;
  taskId?: unknown;
  task_id?: unknown;
  sourceType?: unknown;
  source_type?: unknown;
  usedInFinal?: unknown;
  used_in_final?: unknown;
  qualityScore?: unknown;
  quality_score?: unknown;
};

export type SourceDomainSummary = {
  domain: string;
  entries: number;
  usedInFinalEntries: number;
  taskCount: number;
  sourceTypes: string[];
  meanQualityScore: number | null;
};

export function summarizeSourceDomains(rows: SourceDomainInput[]): SourceDomainSummary[] {
  const grouped = new Map<string, SourceDomainInput[]>();
  for (const row of rows) {
    const domain = readString(row.domain) || "unknown";
    const group = grouped.get(domain);
    if (group) {
      group.push(row);
    } else {
      grouped.set(domain, [row]);
    }
  }
  return [...grouped.entries()]
    .map(([domain, domainRows]) => {
      const qualityScores = domainRows
        .map((row) => readFiniteNumber(row.qualityScore ?? row.quality_score))
        .filter((score): score is number => score !== null);
      return {
        domain,
        entries: domainRows.length,
        usedInFinalEntries: domainRows.filter((row) => readBoolean(row.usedInFinal ?? row.used_in_final)).length,
        taskCount: new Set(domainRows.map((row) => readString(row.taskId ?? row.task_id)).filter(Boolean)).size,
        sourceTypes: [...new Set(domainRows.map((row) => readString(row.sourceType ?? row.source_type)).filter(isString))].sort(),
        meanQualityScore: qualityScores.length ? average(qualityScores) : null,
      };
    })
    .sort((left, right) =>
      right.entries - left.entries
      || right.usedInFinalEntries - left.usedInFinalEntries
      || left.domain.localeCompare(right.domain)
    );
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function isString(value: string | null): value is string {
  return value !== null;
}

function readBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return false;
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
