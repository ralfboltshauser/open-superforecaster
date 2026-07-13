import { isRecord, readArray, readNumber, readString, type JsonRecord } from "@/lib/records"

export type PerformanceBucket = {
  label: string
  count: number
  meanForecast: number | null
  observedRate: number | null
  meanBrier: number | null
  calibrationError: number | null
}

export type ForecastTypePerformance = {
  key: string
  label: string
  resolvedTasks: number
  scoreRows: number
  primaryMetric: string | null
  primaryMean: number | null
}

export type PerformanceSnapshot = {
  generatedAt: string | null
  resolvedTasks: number
  productScoreRows: number
  aggregateScoreRows: number
  meanBrier: number | null
  meanLog: number | null
  calibrationStatus: string | null
  calibrationSampleSize: number
  calibrationMinimum: number | null
  expectedCalibrationError: number | null
  maxBucketCalibrationError: number | null
  calibrationBuckets: PerformanceBucket[]
  forecastTypes: ForecastTypePerformance[]
}

export function buildPerformanceSnapshot(payload: JsonRecord | null): PerformanceSnapshot {
  const summary = isRecord(payload?.summary) ? payload.summary : {}
  const calibration = isRecord(payload?.calibrationSummary) ? payload.calibrationSummary : {}
  const aggregateMeanScores = firstRecord(summary.aggregateMeanScores, summary.meanScores)
  const groups = isRecord(payload?.groups) ? payload.groups : {}

  return {
    generatedAt: readDateString(payload, "generatedAt"),
    resolvedTasks: readNumber(summary, "resolvedTasks") ?? readNumber(summary, "productResolutions") ?? 0,
    productScoreRows: readNumber(summary, "productScoreRows") ?? 0,
    aggregateScoreRows: readNumber(summary, "aggregateScoreRows") ?? 0,
    meanBrier: readNumber(aggregateMeanScores, "brier"),
    meanLog: readNumber(aggregateMeanScores, "log"),
    calibrationStatus: readString(calibration, "status") ?? readString(summary, "calibrationStatus"),
    calibrationSampleSize: readNumber(calibration, "sampleSize") ?? readNumber(summary, "calibrationSampleSize") ?? 0,
    calibrationMinimum: readNumber(calibration, "minimumForFitting"),
    expectedCalibrationError:
      readNumber(calibration, "expectedCalibrationError") ?? readNumber(summary, "expectedCalibrationError"),
    maxBucketCalibrationError:
      readNumber(calibration, "maxBucketCalibrationError") ?? readNumber(summary, "maxBucketCalibrationError"),
    calibrationBuckets: readArray(payload, "calibrationBuckets")
      .filter(isRecord)
      .map((bucket) => ({
        label: readString(bucket, "label") ?? "Probability range",
        count: readNumber(bucket, "count") ?? 0,
        meanForecast: readNumber(bucket, "meanForecast"),
        observedRate: readNumber(bucket, "observedRate"),
        meanBrier: readNumber(bucket, "meanBrier"),
        calibrationError: readNumber(bucket, "calibrationError"),
      }))
      .filter((bucket) => bucket.count > 0),
    forecastTypes: readArray(groups, "byForecastType")
      .filter(isRecord)
      .map((group) => ({
        key: readString(group, "key") ?? readString(group, "label") ?? "unknown",
        label: readString(group, "label") ?? readString(group, "key") ?? "Unknown",
        resolvedTasks: readNumber(group, "resolvedTasks") ?? 0,
        scoreRows: readNumber(group, "scoreRows") ?? 0,
        primaryMetric: readString(group, "primaryMetric"),
        primaryMean: readNumber(group, "primaryMean"),
      })),
  }
}

function firstRecord(...values: unknown[]) {
  return values.find(isRecord) ?? null
}

function readDateString(record: unknown, key: string) {
  if (!isRecord(record)) return null
  const value = record[key]
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null
}
