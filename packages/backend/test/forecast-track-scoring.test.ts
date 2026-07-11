import { describe, expect, test } from "bun:test";
import { buildForecastTrackScoreRows } from "../src/benchmark-service";

describe("autonomous and crowd-assisted benchmark tracks", () => {
  test("scores each frozen track and its incremental Brier value separately", () => {
    const rows = buildForecastTrackScoreRows({
      forecastState: {
        outputs: {
          autonomous: {
            selectedProbability: 40,
            informationIsolation: { status: "isolated" },
          },
          crowdAssisted: { probability: 60, marketProbability: 80 },
        },
      },
    }, true);
    const scores = Object.fromEntries(rows.map((row) => [row.scoreType, row.scoreValue]));

    expect(scores.autonomous_brier).toBeCloseTo(0.36);
    expect(scores.crowd_assisted_brier).toBeCloseTo(0.16);
    expect(scores.market_brier).toBeCloseTo(0.04);
    expect(scores.crowd_assisted_delta_brier_vs_autonomous).toBeCloseTo(-0.2);
    expect(scores.autonomous_delta_brier_vs_market).toBeCloseTo(0.32);
  });

  test("does not fabricate track scores when state or resolution is missing", () => {
    expect(buildForecastTrackScoreRows({}, true)).toEqual([]);
    expect(buildForecastTrackScoreRows({
      forecastState: { outputs: { autonomous: { selectedProbability: 50 } } },
    }, null)).toEqual([]);
    expect(buildForecastTrackScoreRows({
      forecastState: {
        outputs: {
          autonomous: { selectedProbability: 50 },
          crowdAssisted: { probability: 60, marketProbability: 70 },
        },
      },
    }, true).map((row) => row.scoreType)).toEqual(["market_brier", "market_log"]);
  });

  test("does not score autonomous or assisted tracks after possible human-forecast exposure", () => {
    const rows = buildForecastTrackScoreRows({
      forecastState: {
        outputs: {
          autonomous: {
            selectedProbability: 40,
            informationIsolation: { status: "possible_human_forecast_exposure" },
          },
          crowdAssisted: { probability: 60, marketProbability: 80 },
        },
      },
    }, true);

    expect(rows.map((row) => row.scoreType)).toEqual(["market_brier", "market_log"]);
  });

  test("excludes autonomous and assisted tracks for every non-isolated status", () => {
    for (const status of ["possible_information_leakage", "unknown_future_failure_status"]) {
      const rows = buildForecastTrackScoreRows({
        forecastState: {
          outputs: {
            autonomous: {
              selectedProbability: 40,
              informationIsolation: { status },
            },
            crowdAssisted: { probability: 60, marketProbability: 80 },
          },
        },
      }, true);

      expect(rows.map((row) => row.scoreType)).toEqual(["market_brier", "market_log"]);
    }
  });

  test("scores autonomous and assisted tracks when isolation is explicitly verified", () => {
    const rows = buildForecastTrackScoreRows({
      forecastState: {
        outputs: {
          autonomous: {
            selectedProbability: 40,
            informationIsolation: { status: "isolated" },
          },
          crowdAssisted: { probability: 60, marketProbability: 80 },
        },
      },
    }, true);

    expect(rows.map((row) => row.scoreType)).toContain("autonomous_brier");
    expect(rows.map((row) => row.scoreType)).toContain("crowd_assisted_brier");
  });
});
