export type CalibrationGuardSnapshot = {
  adjustment: number | null;
  appliedRules: Array<{
    id: string;
    adjustment: number | null;
    note: string;
  }>;
};

export function readCalibrationGuardSnapshot(value: unknown): CalibrationGuardSnapshot | null {
  const guard = asRecord(asRecord(value)?.calibrationGuard);
  if (!guard) {
    return null;
  }
  const appliedRules = readRecordArray(guard, "appliedRules", "applied_rules")
    .flatMap((rule) => {
      const id = readString(rule, "id");
      if (!id) {
        return [];
      }
      return [{
        id,
        adjustment: readNumber(rule, "adjustment"),
        note: readString(rule, "note") ?? "",
      }];
    });
  return {
    adjustment: readNumber(guard, "adjustment"),
    appliedRules,
  };
}

function readRecordArray(value: unknown, ...keys: string[]) {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  for (const key of keys) {
    const raw = record[key];
    if (Array.isArray(raw)) {
      return raw.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)));
    }
  }
  return [];
}

function readString(value: unknown, key: string) {
  const record = asRecord(value);
  const raw = record?.[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function readNumber(value: unknown, key: string) {
  const record = asRecord(value);
  const raw = record?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
