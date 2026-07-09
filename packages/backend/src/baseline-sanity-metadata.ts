export type BaselineSanitySnapshot = {
  status: "missing_component_base_rates" | "near_baseline" | "moderate_delta" | "large_delta";
  baselineProbability: number | null;
  finalProbability: number | null;
  baselineDelta: number | null;
  componentBaseRateCount: number | null;
  componentBaseRateDisagreement: number | null;
  note: string;
};

const baselineSanityStatuses = new Set([
  "missing_component_base_rates",
  "near_baseline",
  "moderate_delta",
  "large_delta",
]);

export function readBaselineSanitySnapshot(value: unknown): BaselineSanitySnapshot | null {
  const baselineSanity = asRecord(asRecord(value)?.baselineSanity);
  if (!baselineSanity) {
    return null;
  }
  const status = readStatus(baselineSanity);
  if (!status) {
    return null;
  }
  return {
    status,
    baselineProbability: readNumber(baselineSanity, "baselineProbability", "baseline_probability"),
    finalProbability: readNumber(baselineSanity, "finalProbability", "final_probability"),
    baselineDelta: readNumber(baselineSanity, "baselineDelta", "baseline_delta"),
    componentBaseRateCount: readNumber(baselineSanity, "componentBaseRateCount", "component_base_rate_count"),
    componentBaseRateDisagreement: readNumber(baselineSanity, "componentBaseRateDisagreement", "component_base_rate_disagreement"),
    note: readString(baselineSanity, "note") ?? "",
  };
}

function readStatus(value: unknown): BaselineSanitySnapshot["status"] | null {
  const status = readString(value, "status");
  return status && baselineSanityStatuses.has(status)
    ? status as BaselineSanitySnapshot["status"]
    : null;
}

function readString(value: unknown, key: string) {
  const record = asRecord(value);
  const raw = record?.[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
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
