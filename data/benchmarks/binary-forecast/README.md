# Binary Forecast Benchmark Learnings

This directory contains fixed-evidence benchmark reports for the `binary-forecast` Smithers workflow.

## Benchmark setup

- Harness: `scripts/benchmark-binary-forecast.ts`
- Workflow: `.smithers/workflows/binary-forecast.tsx`
- Cases: 10 resolved binary forecasting questions with fixed evidence packets and hidden resolutions.
- Score: Brier score and log score from `packages/evals/src/index`.
- Guardrail: benchmark inputs instruct the workflow to use only the supplied evidence packet, question, resolution criteria, and timing context.

## Run summary

| Label | Workflow shape | Mean Brier | Mean log | Completed | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| `baseline-v0c` | original mean of three role forecasters | 0.1334436 | 0.4231605 | 10/10 | clean baseline |
| `candidate-v1` | richer forecaster prompts plus LLM moderator | 0.1297400 | 0.4140390 | 10/10 | improved score but added cost and produced less reliable metadata before prompt tightening |
| `candidate-v2` | richer forecaster prompts plus deterministic median aggregate | 0.1263300 | 0.4070982 | 10/10 | best primary run |
| `candidate-v2b` | fresh repeat of accepted v2 workflow | 0.1267400 | 0.4057730 | 10/10 | repeat supports v2 improvement |
| `candidate-v3` | v2 plus explicit decomposition prompt | 0.1406200 | 0.4363774 | 10/10 | rejected; regressed below baseline |

## Accepted changes

The accepted workflow is `candidate-v2`:

- Each forecaster now explicitly states a resolution boundary, reference class, base-rate probability, inside-view probability, probability range, evidence for/against, and calibration warnings.
- The role prompts are sharper:
  - base-rate forecaster starts from reference classes and makes evidence-supported adjustments;
  - inside-view forecaster maps concrete mechanisms, timelines, incentives, blockers, and threshold distance;
  - skeptical forecaster runs a calibrated premortem without default pessimism.
- Fixed-evidence benchmark mode is supported through optional `fixedEvidence`, `presentDate`, and `cutoffDate` inputs.
- The aggregate is deterministic again, using the median of the three role forecasts. This avoids paying for a fourth LLM call and treats the role forecasts as correlated judgments from the same model/evidence rather than independent votes.
- Aggregate output now records mean, median, disagreement, calibration notes, calibration warnings, and component base-rate/inside-view probabilities for auditability.

## What worked

- Richer structured forecaster prompts improved the benchmark versus the original workflow in two independent v2 runs.
- Deterministic median aggregation beat the LLM moderator on this suite and is operationally simpler.
- The largest robust gains were on Starliner, EU AI Act, and Olympic basketball. The workflow also remained competitive on the easy low-probability foldable-iPhone case.

## What did not work

- Adding a broad decomposition/Fermi step looked theoretically reasonable but regressed the benchmark. It especially made Tesla and Starliner worse, so it was reverted.
- The LLM moderator mostly tracked the component mean/median and did not justify the added runtime/cost.
- Single-case movement is noisy. Bitcoin, SpaceX, and Starliner moved materially between v2 and v2b even with the same accepted workflow shape.

## Next improvement loop

Do not keep prompt-tuning against this 10-case suite alone. The next reliable loop should first expand or rotate the benchmark set, then test one general-purpose hypothesis at a time.

Promising next hypotheses:

- Add more fixed-evidence cases across politics, markets, product launches, sports, regulation, science, and infrastructure.
- Evaluate calibration by probability bucket, not only mean Brier.
- Add repeated runs per candidate so improvements smaller than run-to-run variance are treated as insignificant.
- Investigate whether a deterministic aggregate should use median, mean, or a predeclared median/mean hybrid on a larger benchmark.
