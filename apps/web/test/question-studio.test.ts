import { describe, expect, test } from "bun:test"

import {
  emptyQuestionDraft,
  inferForecastType,
  prepareQuestionDraft,
  toRunPayload,
} from "../src/lib/question-studio"

describe("question studio preparation", () => {
  test("keeps an approved question unchanged in the launch payload", () => {
    const question = "Will the ECB deposit facility rate be below 2.0% on December 18, 2026?"
    const draft = {
      ...emptyQuestionDraft(),
      prompt: question,
      forecastType: "binary" as const,
      resolutionDate: "2026-12-18",
      resolutionCriteria:
        "Resolve YES if the official European Central Bank page lists a deposit facility rate below 2.0% for December 18, 2026; otherwise NO.",
    }

    expect(prepareQuestionDraft(draft, new Date("2026-07-12T00:00:00.000Z")).ready).toBe(true)
    expect(toRunPayload(draft)).toMatchObject({
      prompt: question,
      mode: "forecast",
      forecastType: "binary",
      resolutionDate: "2026-12-18",
    })
  })

  test("flags missing resolution details without changing the draft", () => {
    const result = prepareQuestionDraft(
      {
        ...emptyQuestionDraft(),
        prompt: "Will a crewed spacecraft land on Mars before 2035?",
      },
      new Date("2026-07-12T00:00:00.000Z"),
    )

    expect(result.ready).toBe(false)
    expect(result.originalPrompt).toBe("Will a crewed spacecraft land on Mars before 2035?")
    expect(result.checks.filter((check) => check.level === "required" && check.status !== "pass").map((check) => check.id)).toEqual([
      "deadline",
      "resolution",
    ])
  })

  test("creates a launch payload when optional resolution details are skipped", () => {
    const question = "Will a crewed spacecraft land on Mars before 2035?"
    const payload = toRunPayload({
      ...emptyQuestionDraft(),
      prompt: question,
    })

    expect(payload).toMatchObject({
      prompt: question,
      mode: "forecast",
      forecastType: "binary",
    })
    expect(payload.resolutionDate).toBeUndefined()
    expect(payload.resolutionCriteria).toBeUndefined()
  })

  test("requires type-specific fields", () => {
    const result = prepareQuestionDraft(
      {
        ...emptyQuestionDraft(),
        prompt: "What will the annual average US unemployment rate be in 2027?",
        forecastType: "numeric",
        resolutionDate: "2028-02-15",
        resolutionCriteria: "Use the official annual average published by the Bureau of Labor Statistics.",
      },
      new Date("2026-07-12T00:00:00.000Z"),
    )

    expect(result.ready).toBe(false)
    expect(result.checks.find((check) => check.id === "unit")?.status).toBe("missing")
  })

  test("uses conservative deterministic type inference", () => {
    expect(inferForecastType("Will inflation be below 2% in December 2027?")).toBe("binary")
    expect(inferForecastType("What are the probabilities of exceeding 100, 120, and 150 units?")).toBe("thresholded")
    expect(inferForecastType("When will the first crewed Mars landing occur?")).toBe("date")
  })

  test("never includes a private estimate field in the autonomous payload", () => {
    const payload = toRunPayload({
      ...emptyQuestionDraft(),
      prompt: "Will a crewed spacecraft land on Mars before 2035?",
      forecastType: "binary",
      resolutionDate: "2035-12-31",
      resolutionCriteria: "Resolve from an official NASA or mission operator announcement.",
    })

    expect("privateEstimate" in payload).toBe(false)
    expect("privateRationale" in payload).toBe(false)
    expect("userProbability" in payload).toBe(false)
  })
})
