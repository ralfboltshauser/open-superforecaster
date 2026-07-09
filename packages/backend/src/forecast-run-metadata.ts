export type ForecastRunSnapshot = {
  workflowVersion: string | null;
  workflowVariantId: string | null;
  experimentLabel: string | null;
  durationSeconds: number | null;
  durationBand: "fast" | "normal" | "slow" | "very_slow" | "unknown";
};

export function readForecastRunSnapshot(value: unknown): ForecastRunSnapshot | null {
  const record = asRecord(value);
  const run = asRecord(record?.runMetadata) ?? record;
  if (!run) {
    return null;
  }
  const workflowVersion = readString(run, "workflowVersion", "workflow_version");
  const workflowVariantId = readString(run, "workflowVariantId", "workflow_variant_id");
  const experimentLabel = readString(run, "experimentLabel", "experiment_label");
  const durationSeconds =
    readNumber(run, "durationSeconds", "duration_seconds") ??
    durationFromDates(readDate(run, "startedAt", "started_at"), readDate(run, "completedAt", "completed_at"));
  if (workflowVersion === null && workflowVariantId === null && experimentLabel === null && durationSeconds === null) {
    return null;
  }
  return {
    workflowVersion,
    workflowVariantId,
    experimentLabel,
    durationSeconds,
    durationBand: durationBand(durationSeconds),
  };
}

export function durationBand(seconds: number | null): ForecastRunSnapshot["durationBand"] {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "unknown";
  }
  if (seconds < 60) {
    return "fast";
  }
  if (seconds < 600) {
    return "normal";
  }
  if (seconds < 1_800) {
    return "slow";
  }
  return "very_slow";
}

function durationFromDates(startedAt: Date | null, completedAt: Date | null) {
  if (!startedAt || !completedAt) {
    return null;
  }
  const seconds = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);
  return seconds >= 0 ? seconds : null;
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

function readDate(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const raw = record[key];
    if (raw instanceof Date && Number.isFinite(raw.getTime())) {
      return raw;
    }
    if (typeof raw === "string") {
      const date = new Date(raw);
      if (Number.isFinite(date.getTime())) {
        return date;
      }
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
