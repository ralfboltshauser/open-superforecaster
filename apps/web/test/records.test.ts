import { describe, expect, test } from "bun:test"

import { runTitle } from "../src/lib/records"

describe("runTitle", () => {
  test("prefers the actual forecast question over a generic workflow label", () => {
    expect(runTitle({
      label: "Binary forecast",
      operationSubmode: "binary_forecast",
      configJson: {
        prompt: "Will the Swiss National Bank cut its policy rate by December 31, 2026?",
      },
    })).toBe("Will the Swiss National Bank cut its policy rate by December 31, 2026?")
  })

  test("reads a question from a persisted output preview", () => {
    expect(runTitle({
      label: "Date forecast",
      outputPreview: { question: "When will the next release ship?" },
    })).toBe("When will the next release ship?")
  })
})
