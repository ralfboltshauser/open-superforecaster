import { describe, expect, test } from "bun:test";
import { classifyRunRequest } from "../src/mode-classifier";

const cases = [
  {
    type: "binary",
    prompt: "Will the United States record at least one magnitude 6.0 or larger earthquake between July 13 and July 31, 2026? Resolve Yes if USGS lists a qualifying event by August 2, 2026; otherwise No.",
  },
  {
    type: "numeric",
    prompt: "What will the closing value of the S&P 500 index be on July 31, 2026? Return a continuous numerical distribution in index points.",
  },
  {
    type: "date",
    prompt: "On what calendar date will the next SpaceX Starship integrated flight test occur after July 12, 2026? Return a date probability distribution.",
  },
  {
    type: "categorical",
    prompt: "Which company will have the world's largest market capitalization at the close on July 31, 2026: Nvidia, Microsoft, Apple, Alphabet, or another company? Return a categorical probability distribution.",
  },
  {
    type: "thresholded",
    prompt: "What are the probabilities that Bitcoin will close above $100000, $120000, and $150000 on July 31, 2026? Return probabilities for each threshold.",
  },
  {
    type: "conditional",
    prompt: "If the Federal Reserve cuts its target rate at its July 2026 meeting, will the S&P 500 close above 6500 on July 31, 2026?",
  },
] as const;

describe("automatic forecast type classification", () => {
  for (const { type, prompt } of cases) {
    test(`routes ${type} prompts to the ${type} workflow`, () => {
      expect(classifyRunRequest({ prompt, requestedMode: "auto" })).toMatchObject({
        mode: "forecast",
        forecastType: type,
        workflow: `${type}-forecast`,
      });
    });
  }

  test("does not interpret a binary resolution rule as a condition", () => {
    const result = classifyRunRequest({
      prompt: "Will it rain tomorrow? Resolve Yes if the airport records precipitation; otherwise No.",
      requestedMode: "auto",
    });

    expect(result.forecastType).toBe("binary");
  });
});
