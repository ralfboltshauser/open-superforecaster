export type NumericForecastSnapshot = {
  unit: string | null;
  p10: number | null;
  p50: number | null;
  p90: number | null;
  intervalWidth: number | null;
  intervalWidthBand: "narrow" | "moderate" | "wide" | "unknown";
  attemptCount: number | null;
  componentValueCount: number | null;
  p50Disagreement: number | null;
  p50DisagreementBand: "tight" | "moderate" | "wide" | "unknown";
  unitDisagreementCount: number | null;
};

export function readNumericForecastSnapshot(value: unknown): NumericForecastSnapshot | null {
  const record = asRecord(value);
  const numeric = asRecord(record?.numericForecast) ?? record;
  if (!numeric) {
    return null;
  }
  const distribution = asRecord(numeric.distribution);
  const p10 = readNumber(distribution, "p10", "low") ?? readNumber(numeric, "p10");
  const p50 = readNumber(distribution, "p50", "median") ?? readNumber(numeric, "value", "p50");
  const p90 = readNumber(distribution, "p90", "high") ?? readNumber(numeric, "p90");
  const unit = readString(numeric, "unit") ?? readString(distribution, "unit");
  const attemptCount = readNumber(numeric, "attemptCount", "attempt_count");
  const componentStats = readComponentValueStats(numeric, unit, p50);
  if (
    unit === null &&
    p10 === null &&
    p50 === null &&
    p90 === null &&
    attemptCount === null &&
    componentStats.componentValueCount === null
  ) {
    return null;
  }
  const intervalWidth = p10 === null || p90 === null ? null : roundMetric(Math.abs(p90 - p10));
  return {
    unit,
    p10,
    p50,
    p90,
    intervalWidth,
    intervalWidthBand: numericIntervalWidthBand(intervalWidth, p50),
    attemptCount,
    ...componentStats,
  };
}

export function numericIntervalWidthBand(width: number | null, center: number | null): NumericForecastSnapshot["intervalWidthBand"] {
  if (width === null || !Number.isFinite(width)) {
    return "unknown";
  }
  const scale = center === null || center === 0 ? Math.abs(width) : Math.abs(width / center);
  if (scale >= 0.75) {
    return "wide";
  }
  if (scale >= 0.25) {
    return "moderate";
  }
  return "narrow";
}

function readComponentValueStats(
  value: Record<string, unknown>,
  aggregateUnit: string | null,
  aggregateP50: number | null,
): Pick<NumericForecastSnapshot, "componentValueCount" | "p50Disagreement" | "p50DisagreementBand" | "unitDisagreementCount"> {
  const explicitComponentValueCount = readNumber(value, "componentValueCount", "component_value_count");
  const explicitP50Disagreement = readNumber(value, "p50Disagreement", "p50_disagreement");
  const explicitUnitDisagreementCount = readNumber(value, "unitDisagreementCount", "unit_disagreement_count");
  const explicitBand = readP50DisagreementBand(value);
  const components = readRecordArray(value, "componentValues", "component_values");
  if (components.length === 0) {
    return {
      componentValueCount: explicitComponentValueCount,
      p50Disagreement: explicitP50Disagreement,
      p50DisagreementBand: explicitBand ?? numericP50DisagreementBand(explicitP50Disagreement, aggregateP50),
      unitDisagreementCount: explicitUnitDisagreementCount,
    };
  }
  const componentP50s = components.flatMap((component) => {
    const quantiles = asRecord(component.quantiles) ?? asRecord(component.distribution);
    const p50 = readNumber(quantiles, "p50", "median") ?? readNumber(component, "value", "p50");
    return p50 === null ? [] : [p50];
  });
  const normalizedAggregateUnit = normalizeUnit(aggregateUnit);
  const unitDisagreementCount = normalizedAggregateUnit === null
    ? null
    : components.filter((component) => {
        const componentUnit = normalizeUnit(readString(component, "unit"));
        return componentUnit !== null && componentUnit !== normalizedAggregateUnit;
      }).length;
  const p50Disagreement = numericSpread(componentP50s);
  return {
    componentValueCount: components.length,
    p50Disagreement,
    p50DisagreementBand: numericP50DisagreementBand(p50Disagreement, aggregateP50),
    unitDisagreementCount,
  };
}

export function numericP50DisagreementBand(disagreement: number | null, center: number | null): NumericForecastSnapshot["p50DisagreementBand"] {
  if (disagreement === null || !Number.isFinite(disagreement)) {
    return "unknown";
  }
  const scale = center === null || center === 0 ? Math.abs(disagreement) : Math.abs(disagreement / center);
  if (scale >= 0.75) {
    return "wide";
  }
  if (scale >= 0.25) {
    return "moderate";
  }
  return "tight";
}

function numericSpread(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return roundMetric(Math.max(...values) - Math.min(...values));
}

function normalizeUnit(value: string | null) {
  return value?.trim().toLowerCase() || null;
}

function readRecordArray(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const raw = value[key];
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

function readP50DisagreementBand(value: unknown): NumericForecastSnapshot["p50DisagreementBand"] | null {
  const raw = readString(value, "p50DisagreementBand", "p50_disagreement_band");
  return raw === "tight" || raw === "moderate" || raw === "wide" || raw === "unknown" ? raw : null;
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
