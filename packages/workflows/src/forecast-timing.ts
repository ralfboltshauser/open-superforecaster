import {
  formatForecastTemporalContextForPrompt,
  normalizeForecastTemporalContext,
  type ForecastTemporalContext,
} from "@open-superforecaster/workflow-contracts";

export type ForecastTiming = {
  forecastAsOf: string | undefined;
  evidenceAsOf: string | undefined;
  evidenceAsOfDate: string | undefined;
  cutoffDate: string | undefined;
  promptBlock: string;
};

export function readForecastTiming(input: unknown): ForecastTiming {
  const temporalContext = normalizeForecastTemporalContext(asRecord(input) ?? {});
  return {
    forecastAsOf: temporalContext.forecastAsOf,
    evidenceAsOf: temporalContext.evidenceAsOf,
    cutoffDate: temporalContext.cutoffDate,
    // Compatibility field for existing day-granularity evidence analytics.
    // It derives only from evidenceAsOf; a cutoff is not evidence recency.
    evidenceAsOfDate: isoCalendarDate(temporalContext.evidenceAsOf),
    promptBlock: formatForecastTemporalContextForPrompt(temporalContext),
  };
}

export function forecastTimingArtifactFields(timing: ForecastTiming): ForecastTemporalContext & {
  evidenceAsOfDate?: string;
} {
  return {
    ...(timing.forecastAsOf ? { forecastAsOf: timing.forecastAsOf } : {}),
    ...(timing.evidenceAsOf ? { evidenceAsOf: timing.evidenceAsOf } : {}),
    ...(timing.cutoffDate ? { cutoffDate: timing.cutoffDate } : {}),
    ...(timing.evidenceAsOfDate ? { evidenceAsOfDate: timing.evidenceAsOfDate } : {}),
  };
}

function isoCalendarDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  return value.includes("T") ? value.slice(0, 10) : value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
