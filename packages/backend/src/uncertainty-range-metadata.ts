export type UncertaintyRangeSnapshot = {
  status: "missing_ranges" | "narrow" | "moderate" | "wide";
  componentRangeCount: number | null;
  medianRangeWidth: number | null;
  meanRangeWidth: number | null;
  widestRangeWidth: number | null;
  narrowRangeCount: number | null;
  note: string;
};

const uncertaintyRangeStatuses = new Set(["missing_ranges", "narrow", "moderate", "wide"]);

export function readUncertaintyRangeSnapshot(value: unknown): UncertaintyRangeSnapshot | null {
  const uncertaintyRange = asRecord(asRecord(value)?.uncertaintyRange);
  if (!uncertaintyRange) {
    return null;
  }
  const status = readStatus(uncertaintyRange);
  if (!status) {
    return null;
  }
  return {
    status,
    componentRangeCount: readNumber(uncertaintyRange, "componentRangeCount", "component_range_count"),
    medianRangeWidth: readNumber(uncertaintyRange, "medianRangeWidth", "median_range_width"),
    meanRangeWidth: readNumber(uncertaintyRange, "meanRangeWidth", "mean_range_width"),
    widestRangeWidth: readNumber(uncertaintyRange, "widestRangeWidth", "widest_range_width"),
    narrowRangeCount: readNumber(uncertaintyRange, "narrowRangeCount", "narrow_range_count"),
    note: readString(uncertaintyRange, "note") ?? "",
  };
}

function readStatus(value: unknown): UncertaintyRangeSnapshot["status"] | null {
  const status = readString(value, "status");
  return status && uncertaintyRangeStatuses.has(status)
    ? status as UncertaintyRangeSnapshot["status"]
    : null;
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
