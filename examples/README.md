# Open Superforecaster Examples

Small seed inputs for local smoke runs. They are intentionally compact so a new
user can verify each workflow family without preparing their own dataset.

Plan or execute the bundled samples through the live app API:

```bash
bun run workflow:samples
bun run workflow:samples -- --probe
bun run workflow:samples -- --execute --suite quick
bun run workflow:samples -- --execute --suite all
```

The default is a plan-only run. `--execute` launches real Smithers/CodexAgent
work, waits for terminal status, and verifies persisted artifacts, forecast
ledgers, table row ledgers, benchmark scorecards, and replay links.
Benchmark promotion gates treat indistinguishable candidate-vs-baseline scores
as iteration evidence only. A run becomes ready for promotion review only after
the paired comparison shows candidate improvement on enough held-out cases and
the trace/review blockers are clear.
When several baseline runs are available, the comparison recommendation selects
the primary baseline by strongest held-out overlap, then paired overlap, then
baseline promotion state, so promotion does not depend on incidental run order.
Local DuckDB exports the same selection as `primary_baseline_benchmark_run_id`.
Fixed-evidence benchmark aggregates also persist baseline-sanity fields: the
provided baseline probability, final delta, base-rate anchor, inside-view
movement, skeptical adjustment, and aggregation rule. Those fields make
worse-than-baseline cases easier to debug from the saved artifact alone. New
analysis reports summarize missing baseline-sanity metadata, and the lab
benchmark list shows that summary when it is available.
Benchmark analysis also summarizes component probability spread and flags high
unexplained disagreement, so aggregates with internally conflicting rollouts
are easier to review before promotion.
It also summarizes large probability misses and worse-than-baseline cases, so
judgment-quality failures are visible separately from trace or infrastructure
failures.
Promotion gates treat those analysis findings as blockers: missing baseline
sanity, unexplained component disagreement, large misses, and worse-than-baseline
cases must be cleared before a run is ready for promotion review. Smoke cases
remain useful for debugging, but promotion also requires enough cases labeled as
held-out split evidence.
Agentic pastcasting runs also block promotion when source audits find cutoff
leakage, prediction-market style information advantage, or human forecast
sources. Those failures are audit failures, not forecast-skill wins.
Runs also block promotion when trace/schema analysis finds weak replayability,
missing probabilities or score rows, or missing aggregate rationale; promotion
evidence has to be scoreable and explainable, not just numerically favorable.
The promotion decision API enforces the same gate for promoted states; use
`needs_more_cases`, `candidate`, or `rejected` when recording non-promoting
review outcomes with blockers still present.
The metrics endpoint exports promotion-gate status and blocker series for
recent benchmark runs, so blocked promotion reasons can be monitored outside the
lab dashboard. It also exports binary aggregate calibration status, bucket
errors, diagnostics, and candidate calibration guard rule counts.
Calibration guard validation outcomes are exported as Prometheus metrics too,
including validation report count, recommendation counts, matched rows, and
Brier/calibration-error deltas.
It also exports workflow proposal lifecycle counts and recent proposal metadata,
including implementation status, experiment label, and validation comparison
recommendations, so accepted, rejected, and implemented changes remain
monitorable after review. When validation is launched from a proposal, the
resulting benchmark run id is exported with the same proposal metadata. After
that benchmark finalizes, the proposal records the validation status, gate
status, blockers, summary, completed case count, and mean Brier delta.
`scripts/sync-duckdb.ts` also exports those gate statuses, blocker strings,
holdout evidence counts, source-quality counts, trace/schema counts, and
analysis-finding counts into `osf_benchmark_runs` for local analytics.
Product forecast score rows are exported to `osf_forecast_scores`, including
probability, resolved outcome, score, and calibration-guard metadata. Binary
aggregate calibration buckets are exported to `osf_binary_calibration_buckets`
with bucket error, diagnostic direction, and candidate guard adjustment fields.
Calibration guard validation reports are exported to
`osf_calibration_guard_validations` with before/after Brier, bucket calibration
error deltas, and recommendation status.
Held-out default calibration guard plans are exported to
`osf_calibration_guard_default_plan_candidates`, and `bun run export-local`
includes `data/reports` so local review artifacts survive archive handoff.
Benchmark-derived workflow change proposals are exported to
`osf_workflow_change_proposals`, including source benchmark run, evidence case
ids, proposed change, expected metric and cost/latency effects, overfit risk,
validation plan, status, reviewer note, reviewer, and review timestamp.
The lab benchmark list also shows the latest proposals beside promotion
blockers, so review can connect observed failures to concrete workflow changes
and mark each proposal accepted, rejected, implemented, or reopened. Accepted
proposals get a planned implementation task title and deterministic experiment
label, and the lab can move that implementation into patching before launching a
validation benchmark under that label. Validation uses the same benchmark suite
as the proposal's source run and automatically compares against that source run.
Completed validation runs write their evidence summary and gate blockers back
onto the proposal for review, and the lab shows the validation recommendation
and paired Brier delta beside the proposal. A proposal cannot be marked
implemented until validation has completed.

## Forecast And Research Prompts

`questions.jsonl` contains one JSON object per sample prompt:

- binary forecast
- date forecast
- numeric forecast
- categorical forecast
- thresholded forecast
- conditional forecast
- deep research

Run one by copying the `body` field into:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d @examples/request-binary-forecast.json
```

The run API is split into start/status/result calls so automation does not need
to hold a long request open:

```bash
TASK_ID=<task-id-from-create-response>
curl http://localhost:3000/api/runs/$TASK_ID/status
curl http://localhost:3000/api/runs/$TASK_ID/result
curl -X POST http://localhost:3000/api/runs/$TASK_ID/report-artifact
```

The report artifact is written back into the artifact ledger. It includes a
versioned decision report payload plus a Markdown snapshot for review, export,
or downstream automation.

## Forecast Ops Runner

Use the forecast ops runner for cron-style batches. It uses the public run API,
not internal database calls:

```bash
bun run forecast:ops
bun run forecast:ops -- --execute --case binary-foldable-iphone
bun run forecast:ops -- --batch-id july-smoke --execute --case binary-foldable-iphone
bun run forecast:ops -- --execute --input examples/questions.jsonl --out-dir data/forecast-ops/manual-smoke
```

Plan mode writes `manifest.json` only. Execute mode writes one folder per case
with `result.json`, `report.json`, and `report.md`.

## Resolution Runner

Use `examples/resolutions.sample.jsonl` as the batch format for resolved
outcomes. Replace the placeholder task ids with completed forecast task ids:

```bash
bun run forecast:resolve -- --input examples/resolutions.sample.jsonl
bun run forecast:resolve -- --batch-id july-smoke --execute --input data/resolutions/manual.jsonl
```

Execute mode calls `/api/resolutions`, writes each response, and snapshots the
resolution dashboard so score and calibration changes are auditable.

After resolutions have created score rows, snapshot grouped performance metrics:

```bash
bun run forecast:performance -- --batch-id july-smoke
bun run forecast:performance -- --batch-id july-smoke --out-dir data/reports/forecast-performance/manual
```

The report groups existing score rows by forecast type, target, and forecaster
label, includes best and worst resolved aggregate forecasts, tracks recent
score deltas against older baselines, adds a needs-attention queue with
recommended actions for poor scores or worsening trends, adds binary aggregate
calibration buckets with expected calibration error, turns large calibration
bucket gaps into attention items, emits candidate calibration guard rules for
review, and writes JSON plus Markdown snapshots.

Use the same `--batch-id` across forecast ops, resolution, and performance
commands to keep their manifests tied to the same operational batch.
Binary forecasts also run through a deterministic final calibration guard for
known threshold, timing, and production-ramp failure modes. Contract checks pin
those adjustments and final aggregates include structured `calibrationGuard`
metadata visible in run reports, so future calibration changes are deliberate
and auditable. Future binary score rows keep the same guard metadata for
performance review, including guarded-vs-unguarded score groups.

To generate a local batch audit from those manifests:

```bash
bun run forecast:batches -- --batch-id july-smoke
bun run forecast:batches
```

The batch index scans `data/forecast-ops`, `data/resolutions`, and
`data/reports/forecast-performance`, then writes JSON and Markdown summaries
under `data/reports/forecast-batches`.

To mark attention items or candidate calibration guard rules reviewed or
deferred without changing the scoring ledger, add local review records to
`data/reports/forecast-attention-reviews.json`:

```json
{
  "reviews": [
    {
      "attentionItemId": "poor:task-id:brier",
      "status": "reviewed",
      "note": "Resolution criteria were ambiguous.",
      "reviewer": "local-user",
      "updatedAt": "2026-07-09T00:00:00.000Z"
    }
  ]
}
```

Pass `--reviews-file path/to/reviews.json` to use a different local review file.
Use the helper command to avoid hand-editing the JSON:

```bash
bun run forecast:review -- --id poor:task-id:brier --status reviewed --note "Resolution criteria were ambiguous."
bun run forecast:batches -- --batch-id july-smoke
```

To review outstanding attention work and candidate calibration guard reviews
across generated batch indexes:

```bash
bun run forecast:attention
bun run forecast:attention -- --batch-id july-smoke --status deferred
```

By default, the backlog includes `open` and `deferred` items from both lanes and writes
`attention-backlog.json` plus `attention-backlog.md` under
`data/reports/forecast-attention-backlog`. It also reads calibration guard
validation reports and adds open follow-up items for candidates that need held-out
validation or more resolved evidence. Pass `--reviews-file path/to/reviews.json`
to apply local review statuses to validation follow-ups as well as batch-indexed
attention items.

To summarize the latest indexed batch health in the terminal:

```bash
bun run forecast:health
bun run forecast:health -- --batch-id july-smoke
```

The health report is generated from batch indexes, so it should be run after
`forecast:batches`. It highlights missing phases, failed run or resolution
steps, unresolved attention items, open candidate calibration guard reviews, and
score-regression attention signals.

To turn reviewed, ready candidate calibration guard rules into implementation
proposal drafts:

```bash
bun run forecast:calibration-proposals
bun run forecast:calibration-proposals -- --batch-id july-smoke
```

This reads the latest `batch-index.json`, skips deferred rules and rules that
still need more resolved forecasts, then writes JSON and Markdown proposal
drafts under `data/reports/forecast-calibration-guard-proposals`.

To replay those proposal drafts against resolved aggregate binary score rows:

```bash
bun run forecast:calibration-validate
bun run forecast:calibration-validate -- --performance-report data/reports/forecast-performance/july-smoke/forecast-performance.json
```

The validation report compares before/after Brier score and bucket calibration
error, then marks each proposal as `promote_for_holdout`, `needs_more_evidence`,
or `reject`. Pass `--holdout-performance-report path/to/forecast-performance.json`
to replay against held-out resolved forecasts; improving holdout replays are
marked `promote_for_default`.

To turn held-out default promotions into a concrete implementation review plan:

```bash
bun run forecast:calibration-default-plan
bun run forecast:calibration-default-plan -- --validation-report data/reports/forecast-calibration-guard-validation/calibration-guard-validation.json
```

This does not modify runtime forecast behavior. It writes JSON and Markdown under
`data/reports/forecast-calibration-guard-default-plan`, skips every non-holdout
or non-promoted validation row, and records the exact target workflow file plus
manual acceptance criteria for each default calibration guard candidate.

Run the script contract checks before changing these tools:

```bash
bun run forecast:scripts:check
```

## Table Workflows

Use the CSV files in the web composer by selecting the relevant mode and
uploading or pasting the CSV:

- `companies.csv`: classify/rank/agent-map seed rows.
- `merge-left.csv` and `merge-right.csv`: small merge seed rows.
- `dedupe-companies.csv`: small dedupe seed rows.

Equivalent JSON API requests are in:

- `request-classify-companies.json`
- `request-agent-map-companies.json`
- `request-rank-companies.json`
- `request-merge-companies.json`
- `request-dedupe-companies.json`

Run them with:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d @examples/request-classify-companies.json
```

After a run finishes, inspect `/runs/<task-id>` and export artifact rows with
`/api/artifacts/<artifact-id>/csv`.
