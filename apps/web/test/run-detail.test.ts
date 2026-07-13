import { describe, expect, test } from "bun:test"

import { buildRunDetail } from "../src/components/run-workspace/run-detail"

describe("buildRunDetail", () => {
  test("keeps workflow status distinct from forecast availability", () => {
    const detail = buildRunDetail({
      task: {
        id: "task-1",
        status: "running",
        configJson: { prompt: "Will the test pass?" },
      },
      forecastAggregates: [{ rawAggregate: { forecastType: "binary", probability: 61 } }],
    })

    expect(detail.task?.status).toBe("running")
    expect(detail.forecastReady).toBe(true)
  })
})
