import { describe, expect, test } from "bun:test"

import { buildForecastPortfolio } from "../src/components/forecast-portfolio/model"
import { buildPerformanceSnapshot } from "../src/components/performance-dashboard/model"

describe("forecast portfolio model", () => {
  test("uses the canonical question from run detail and recognizes a scored forecast", () => {
    const [item] = buildForecastPortfolio({
      runs: [{
        id: "task-1",
        label: "Binary forecast",
        operationMode: "forecast",
        operationSubmode: "binary_forecast",
        status: "completed",
        createdAt: "2026-07-01T00:00:00.000Z",
        outputPreview: { probability: 70, forecast_type: "binary" },
      }],
      detailsByTaskId: {
        "task-1": {
          task: {
            configJson: {
              prompt: "Will the test event happen by 31 July 2026?",
              forecastInput: {
                question: "Will the test event happen by 31 July 2026?",
                resolutionDate: "2026-08-01T00:00:00.000Z",
                resolutionCriteria: "Resolve YES iff the official record confirms the event by the deadline.",
              },
            },
          },
        },
      },
      performance: {
        calibrationReplayRows: [{
          taskId: "task-1",
          probability: 70,
          resolved: true,
          score: 0.09,
          createdAt: "2026-08-02T00:00:00.000Z",
        }],
      },
    })

    expect(item.question).toBe("Will the test event happen by 31 July 2026?")
    expect(item.questionAvailable).toBe(true)
    expect(item.state).toBe("resolved")
    expect(item.resultLabel).toBe("Resolved YES")
    expect(item.score).toBe(0.09)
  })

  test("keeps a completed pending binary forecast separate from an untracked ready forecast", () => {
    const items = buildForecastPortfolio({
      runs: [
        { id: "pending", operationMode: "forecast", operationSubmode: "binary_forecast", status: "completed" },
        { id: "ready", operationMode: "forecast", operationSubmode: "numeric_forecast", status: "completed" },
        { id: "not-a-forecast", operationMode: "research", operationSubmode: "deep_research", status: "completed" },
      ],
      resolutions: { pendingForecasts: [{ taskId: "pending" }] },
    })

    expect(items.map((item) => [item.id, item.state])).toEqual([
      ["pending", "awaiting_resolution"],
      ["ready", "forecast_ready"],
    ])
  })
})

describe("performance dashboard model", () => {
  test("reads current performance and calibration payloads without inventing data", () => {
    const snapshot = buildPerformanceSnapshot({
      generatedAt: "2026-07-12T10:00:00.000Z",
      summary: {
        resolvedTasks: 12,
        productScoreRows: 48,
        aggregateScoreRows: 24,
        aggregateMeanScores: { brier: 0.18, log: 0.55 },
      },
      calibrationSummary: {
        status: "collecting_resolved_forecasts",
        sampleSize: 12,
        minimumForFitting: 50,
        expectedCalibrationError: 8.5,
      },
      calibrationBuckets: [{
        label: "60-70%",
        count: 5,
        meanForecast: 65,
        observedRate: 60,
        meanBrier: 0.22,
        calibrationError: 5,
      }],
      groups: {
        byForecastType: [{
          key: "binary",
          label: "Binary",
          resolvedTasks: 12,
          scoreRows: 48,
          primaryMetric: "brier",
          primaryMean: 0.18,
        }],
      },
    })

    expect(snapshot.resolvedTasks).toBe(12)
    expect(snapshot.meanBrier).toBe(0.18)
    expect(snapshot.calibrationMinimum).toBe(50)
    expect(snapshot.calibrationBuckets).toHaveLength(1)
    expect(snapshot.forecastTypes[0]?.primaryMetric).toBe("brier")
  })

  test("returns an honest empty snapshot for sparse payloads", () => {
    const snapshot = buildPerformanceSnapshot({})
    expect(snapshot.resolvedTasks).toBe(0)
    expect(snapshot.meanBrier).toBeNull()
    expect(snapshot.calibrationBuckets).toEqual([])
    expect(snapshot.forecastTypes).toEqual([])
  })
})
