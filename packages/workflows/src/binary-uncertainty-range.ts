export type BinaryUncertaintyRangeAudit = {
  status: "missing_ranges" | "narrow" | "moderate" | "wide";
  componentRangeCount: number;
  medianRangeWidth: number | null;
  meanRangeWidth: number | null;
  widestRangeWidth: number | null;
  narrowRangeCount: number;
  note: string;
};

export function buildBinaryUncertaintyRangeAudit(input: {
  components: Array<{ probabilityRange?: { low?: number; high?: number } | null }>;
}): BinaryUncertaintyRangeAudit {
  const widths = input.components
    .flatMap((component) => {
      const low = component.probabilityRange?.low;
      const high = component.probabilityRange?.high;
      if (
        typeof low !== "number" ||
        typeof high !== "number" ||
        !Number.isFinite(low) ||
        !Number.isFinite(high) ||
        high < low
      ) {
        return [];
      }
      return [roundOne(high - low)];
    });

  if (widths.length === 0) {
    return {
      status: "missing_ranges",
      componentRangeCount: 0,
      medianRangeWidth: null,
      meanRangeWidth: null,
      widestRangeWidth: null,
      narrowRangeCount: 0,
      note: "No valid component probability ranges were recorded.",
    };
  }

  const medianRangeWidth = roundOne(median(widths));
  const meanRangeWidth = roundOne(mean(widths));
  const widestRangeWidth = roundOne(Math.max(...widths));
  const narrowRangeCount = widths.filter((width) => width < 15).length;
  const status: BinaryUncertaintyRangeAudit["status"] = medianRangeWidth < 15
    ? "narrow"
    : medianRangeWidth <= 35
      ? "moderate"
      : "wide";

  return {
    status,
    componentRangeCount: widths.length,
    medianRangeWidth,
    meanRangeWidth,
    widestRangeWidth,
    narrowRangeCount,
    note: `${widths.length} component range(s) recorded; median width ${medianRangeWidth} percentage points.`,
  };
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function roundOne(value: number) {
  return Math.round(value * 10) / 10;
}
