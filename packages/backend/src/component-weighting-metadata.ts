export type ComponentWeightingSnapshot = {
  status: "missing_component_audits" | "all_normal" | "has_downweight" | "has_upweight" | "mixed_weights";
  auditedComponentCount: number;
  downweightCount: number;
  upweightCount: number;
  normalWeightCount: number;
  calibrationRiskCount: number;
};

type ComponentWeight = "downweight" | "normal" | "upweight";

export function readComponentWeightingSnapshot(value: unknown): ComponentWeightingSnapshot | null {
  const record = asRecord(value);
  const componentWeighting = asRecord(record?.componentWeighting);
  if (componentWeighting) {
    const status = readStatus(componentWeighting);
    if (!status) {
      return null;
    }
    return {
      status,
      auditedComponentCount: readNumber(componentWeighting, "auditedComponentCount", "audited_component_count") ?? 0,
      downweightCount: readNumber(componentWeighting, "downweightCount", "downweight_count") ?? 0,
      upweightCount: readNumber(componentWeighting, "upweightCount", "upweight_count") ?? 0,
      normalWeightCount: readNumber(componentWeighting, "normalWeightCount", "normal_weight_count") ?? 0,
      calibrationRiskCount: readNumber(componentWeighting, "calibrationRiskCount", "calibration_risk_count") ?? 0,
    };
  }
  const audits = readRecordArray(record, "componentAudits", "component_audits");
  if (audits.length === 0) {
    return null;
  }
  return buildComponentWeightingSnapshot(audits);
}

export function buildComponentWeightingSnapshot(audits: Record<string, unknown>[]): ComponentWeightingSnapshot {
  const weights = audits.map((audit) => readWeight(audit)).filter((weight): weight is ComponentWeight => Boolean(weight));
  const downweightCount = weights.filter((weight) => weight === "downweight").length;
  const upweightCount = weights.filter((weight) => weight === "upweight").length;
  const normalWeightCount = weights.filter((weight) => weight === "normal").length;
  const calibrationRiskCount = audits.filter((audit) => Boolean(readString(audit, "calibrationRisk", "calibration_risk"))).length;
  return {
    status: componentWeightingStatus({ auditedComponentCount: weights.length, downweightCount, upweightCount }),
    auditedComponentCount: weights.length,
    downweightCount,
    upweightCount,
    normalWeightCount,
    calibrationRiskCount,
  };
}

function componentWeightingStatus(input: {
  auditedComponentCount: number;
  downweightCount: number;
  upweightCount: number;
}): ComponentWeightingSnapshot["status"] {
  if (input.auditedComponentCount === 0) {
    return "missing_component_audits";
  }
  if (input.downweightCount > 0 && input.upweightCount > 0) {
    return "mixed_weights";
  }
  if (input.downweightCount > 0) {
    return "has_downweight";
  }
  if (input.upweightCount > 0) {
    return "has_upweight";
  }
  return "all_normal";
}

const componentWeightingStatuses = new Set(["missing_component_audits", "all_normal", "has_downweight", "has_upweight", "mixed_weights"]);

function readStatus(value: unknown): ComponentWeightingSnapshot["status"] | null {
  const status = readString(value, "status");
  return status && componentWeightingStatuses.has(status)
    ? status as ComponentWeightingSnapshot["status"]
    : null;
}

function readWeight(value: unknown): ComponentWeight | null {
  const weight = readString(value, "weight");
  return weight === "downweight" || weight === "normal" || weight === "upweight" ? weight : null;
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
