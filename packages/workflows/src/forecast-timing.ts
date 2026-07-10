export type ForecastTiming = {
  evidenceAsOfDate: string | undefined;
  cutoffDate: string | undefined;
  promptBlock: string;
};

export function readForecastTiming(input: unknown): ForecastTiming {
  const record = asRecord(input);
  const evidenceAsOfDate = readIsoDate(record, "presentDate", "present_date", "evidenceAsOfDate", "evidence_as_of_date", "asOfDate", "as_of_date");
  const cutoffDate = readIsoDate(record, "cutoffDate", "cutoff_date", "cutoff");
  const lines = [
    evidenceAsOfDate ? `Present date: ${evidenceAsOfDate}` : null,
    cutoffDate ? `Cutoff date: ${cutoffDate}` : null,
  ].filter((line): line is string => Boolean(line));
  return {
    evidenceAsOfDate: evidenceAsOfDate ?? cutoffDate ?? undefined,
    cutoffDate: cutoffDate ?? undefined,
    promptBlock: lines.length ? `Timing context:\n${lines.join("\n")}` : "",
  };
}

function readIsoDate(value: Record<string, unknown> | null, ...keys: string[]) {
  if (!value) {
    return null;
  }
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw !== "string" || !raw.trim()) {
      continue;
    }
    const timestamp = Date.parse(raw);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString().slice(0, 10);
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
