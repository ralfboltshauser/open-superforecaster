import { describe, expect, test } from "bun:test";
import { createRunPlan } from "../src/app/api/runs/run-request";

describe("forecast run input extraction", () => {
  test("keeps resolution dates out of threshold curves", () => {
    const plan = createRunPlan({
      mode: "auto",
      prompt: "What are the probabilities that Bitcoin will close above $100000, $120000, and $150000 on July 31, 2026? Return probabilities for each threshold.",
    }, { now: "2026-07-12T00:00:00.000Z" });

    expect(plan.smithersInput).toMatchObject({
      thresholds: ["$100000", "$120000", "$150000"],
      thresholdDirection: "at_least",
    });
  });

  test("freezes explicitly enumerated categorical options", () => {
    const plan = createRunPlan({
      mode: "auto",
      prompt: "Which company will lead: Nvidia, Microsoft, Apple, Alphabet, or another company? Return a categorical probability distribution.",
    }, { now: "2026-07-12T00:00:00.000Z" });

    expect(plan.smithersInput).toMatchObject({
      categories: ["Nvidia", "Microsoft", "Apple", "Alphabet", "Other"],
    });
  });
});
