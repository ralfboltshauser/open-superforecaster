<p align="center">
  <img src="apps/web/public/logo.png" alt="Open Superforecaster logo" width="96" height="96">
</p>

# Open Superforecaster

Open Superforecaster is an open-source, self-runnable forecasting and research
appliance. It turns a question about the future into parallel agent research,
source-backed probability estimates, forecast artifacts, trace bundles, and
benchmark evidence that you can inspect locally.

![Open Superforecaster home screen](data/screenshots/composer-home.png)

## Why This Exists

AI forecasting is becoming a real product surface, not just a leaderboard
curiosity. Dynamic benchmarks such as
[ForecastBench](https://arxiv.org/abs/2409.19839) show both the promise and the
limits of current LLM forecasters. Newer scaffolded systems such as
[AIA Forecaster](https://arxiv.org/html/2511.07678v1) report results that are
competitive with expert superforecasters on some benchmarks, while liquid
prediction markets remain a hard baseline and ensembles can add value.
[FutureSearch Evals](https://evals.futuresearch.ai/) shows how quickly this
space is moving across pastcasting benchmarks, live tournaments, and markets.

The point of this project is not to claim that this repo is already a
benchmark-grade oracle. The point is to keep the capability open, inspectable,
and runnable: a Docker Compose stack you can spin up on your own machine if you
have a Codex subscription, with Smithers orchestrating durable agent work under
the hood.

If you build on it or find a useful decision workflow, share it with
[ralf@boltshauser.com](mailto:ralf@boltshauser.com). I want to see where people
take open forecasting infrastructure.

## What You Can Do

- Ask binary, date, numeric, categorical, thresholded, and conditional forecast
  questions from the web UI.
- Fan out multiple CodexAgent researchers, then inspect their component
  forecasts, aggregate answer, rationale, and citations.
- Run local benchmark and pastcasting loops before trusting workflow changes.
- Export artifacts, trace bundles, CSV, Parquet, and local analytics tables for
  deeper review.
- Keep the full trust chain local: questions, sources, traces, scores,
  benchmark cases, and maintenance jobs are persisted as inspectable records.

## Architecture

![Open Superforecaster architecture](data/screenshots/open-superforecaster-architecture.png)

Open Superforecaster uses a Next.js App Router UI for the local cockpit,
Postgres as the product ledger, MinIO-compatible object storage for artifacts
and trace bundles, DuckDB for local analytics, and Smithers to run durable
CodexAgent workflows.

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000), ask a forecast, and inspect
the generated run from the sidebar. More detailed host-development, benchmark,
export, and verification commands are below.

## Trust Model

Forecasting systems fail when their assumptions, sources, or evaluation setup
are hidden. This project tries to make those parts boringly visible. Every
forecast should answer:

- What was the exact question and resolution criterion?
- What evidence did the agents use?
- How did individual researchers disagree?
- What probability or distribution was emitted?
- Which artifacts, traces, and benchmarks support the result?
- What should be re-run before using this in a real decision?

## Development Log

- Phase 0 complete: repo/runtime skeleton, local web shell, Bun worker,
  Docker Compose, Codex auth mount contract, persistent Smithers/Postgres/MinIO
  data mounts, OTEL stack configuration, role-aware Codex health checks, and
  Docker image installation of the scoped `@openai/codex` CLI for Smithers
  workers.
- Phase 1 bootstrap complete: Postgres schema/migration, Smithers smoke launch
  API, task ledger, structured artifact row persistence, and JSON trace-bundle
  export.
- Run detail inspection complete for v1: each task has a local detail route and
  API response that surfaces persisted artifact rows, source-bank entries,
  forecast attempts, aggregates, scores, benchmark case results, recent trace
  events, and trace-bundle export links. Artifact rows render through the Next
  app workspace with stable metadata/output summaries and raw artifact access
  for deeper inspection.
- Typed forecast-output rendering complete for v1: binary, date, numeric,
  categorical, thresholded, and conditional forecast runs render dedicated
  summary cards on the run detail page, including probability bars, percentile
  or range summaries, conditional deltas, method labels, and rationale text
  parsed from the persisted artifact rows.
- Dashboard navigation complete for v1: the sidebar is shared across dashboard
  and run-detail pages and links to real local surfaces for Runs, Workflows,
  Benchmark Lab, Artifacts, and Diagnostics rather than inert placeholder links.
- Phase 2 complete: server-side mode classifier, binary/date/numeric/categorical,
  thresholded, and binary conditional forecast Smithers workflows, three parallel
  Codex forecasters per forecast, aggregate output persistence,
  source-bank/citation extraction, forecast attempt and aggregate ledgers, and
  run-list output previews.
- Classification preview complete for v1: `/api/classify` exposes the same
  deterministic mode/workflow classifier used by `/api/runs`, and the composer
  shows inferred workflow, mode, forecast type, table requirement, confidence,
  suggested effort, and rationale before queueing a run.
- Deep research path complete: open-ended prompts and manual `multi_agent`
  mode route to a real Smithers workflow with three parallel Codex researchers,
  a synthesis output, trace-bundle export, and source/citation persistence.
- Row-wise AgentMap path complete for v1: manual `agent_map`, `rank`, and
  `classify` modes route to a real Smithers fan-out workflow, produce row-level
  results, and expand result rows into artifact rows for table-style display.
- Row-level table retry complete for v1 independent table modes: `agent_map`,
  `classify`, and `rank` runs seed durable `task_rows`, completed legacy table
  runs are backfilled from artifact rows, run detail pages show row status and
  retry counts, and `/api/runs/<task-id>/rows/<row-id>/retry` launches a derived
  one-row Smithers retry run without mutating the original artifact.
- CSV table input path complete for v1: the composer accepts local CSV file
  input or pasted CSV, parses rows client-side, caps table workflows at 50 rows,
  and sends row objects to `agent_map`, `rank`, `classify`, and `dedupe`
  workflows while preserving useful row fields in the agent input.
- Artifact CSV/Parquet export complete for v1: persisted artifact rows can be
  downloaded from each run detail page or
  `/api/artifacts/<artifact-id>/{csv,parquet}`, with row metadata and JSON
  output fields flattened into deterministic columns. Parquet export is backed
  by DuckDB and loaded through server-only code so native DuckDB bindings stay
  out of the browser graph.
- Merge and dedupe paths complete for v1: JSON table inputs route to Smithers
  workflows with deterministic candidate generation, CodexAgent pair/edge
  judgment, merge breakdowns, dedupe equivalence classes, synthetic combined
  rows, and artifact-row expansion.
- Benchmark substrate complete for smoke iteration: local seed suite,
  workflow-variant freezing, benchmark run/case-result rows, real child
  Smithers forecast execution, Brier/log scoring, trace-bundle export, score
  report artifact, analysis artifact, and Benchmark Lab UI.
- BTF-2 import path complete for v1 iteration: the app can import BTF-2
  fixed-evidence rows from the Hugging Face dataset rows API into the normal
  benchmark suite/case registry, persist raw JSONL snapshots under
  `data/evals`, preserve dataset SHA/license/provenance, and run imported cases
  through the existing fixed-evidence Smithers workflow.
- Benchmark analysis loop complete for v1 smoke iteration: completed benchmark
  runs now write per-case analyst-note artifacts, richer benchmark analysis
  rows, source/trace quality findings, failure clusters, and durable workflow
  change proposals that are surfaced in the Benchmark Lab.
- Workflow promotion gate complete for v1 iteration: benchmark runs can now
  record explicit workflow-variant promotion decisions (`candidate`,
  `promoted_for_eval_only`, `promoted_for_local_default`, `needs_more_cases`,
  or `rejected`) from the Benchmark Lab UI or API, preserving the reviewed
  benchmark run, note, decider, and updated workflow variant state.
- Benchmark comparison reports complete for v1 iteration: Benchmark Lab can
  generate comparison report artifacts for a candidate run against prior
  same-suite baselines, including aggregate metric deltas, paired case deltas,
  paired bootstrap confidence intervals, trace-bundle pointers, and a
  promotion-gate recommendation.
- Benchmark run detail surface complete for v1 iteration:
  `/api/benchmarks/<benchmark-run-id>` and
  `/benchmarks/<benchmark-run-id>` expose per-run scorecards, promotion
  blockers, trace-bundle/source/report health, case filters, per-case replay
  links, benchmark analysis, failure clusters, workflow proposals, report
  metadata, and frozen workflow-variant metadata.
- Fixed-evidence eval path complete for v1: resolution-hidden evidence packets,
  CodexAgent structured rollout workflow, baseline comparison rows, benchmark
  score deltas, workflow-variant freezing, and trace bundles with artifact rows,
  source bank rows, citations, forecast attempts, aggregates, forecast score
  rows, and benchmark scores.
- Agentic pastcasting eval path complete for v1 smoke use: live-web historical
  benchmark cases run through a dedicated Smithers workflow that records
  prompt-level cutoff policy, source leakage flags, market/information-advantage
  flags, search queries, source counts, trace-completeness heuristics, and
  review labels while keeping the weak live-web condition clearly labeled.
- Product resolution/scoring loop complete for binary v1: completed product
  binary forecasts can be manually resolved from the dashboard or API, benchmark
  tasks are blocked from manual product resolution, Brier/log scores are written
  for both aggregate and attempt rows, track-record metrics render in the UI, and
  trace bundles include forecast resolution rows alongside score rows.
- Calibration visibility complete for v1: the resolution dashboard now returns
  aggregate reliability buckets, expected calibration error, maximum bucket
  calibration error, and an explicit sample-count gate before any future
  calibration model fitting.
- Observability correlation complete for v1: `/metrics` exposes Prometheus text
  metrics for tasks, Smithers run IDs, benchmark runs, benchmark case results,
  trace bundle URIs, workflow variants, Smithers token usage, source-bank
  entries, forecast scores, resolutions, workflow promotion state, promotion
  decision counts, and comparison report artifact links; Prometheus scrapes the
  app and Grafana ships an overview dashboard for local benchmark iteration.
- Local smoke test suite complete for v1: `bun run smoke:local` checks the live
  app health endpoint, classifier preview endpoint, a 12-prompt classifier
  routing matrix, run ledger, run detail, artifact CSV/Parquet export, Benchmark
  Lab read model, benchmark run detail surface, benchmark comparison surface,
  per-run SSE event streaming, maintenance actions, diagnostics, and required
  Prometheus metrics; `--require-data` fails if local run/benchmark evidence is
  absent.
- Per-run progress streaming complete for v1: `/api/runs/<task-id>/events`
  exposes a Server-Sent Events stream with task status, persisted trace events,
  and terminal `done` events; the run detail page subscribes with `EventSource`
  and shows stream state, progress counters, and the latest trace event.
- Workflow coverage verifier complete for v1: `bun run workflow:coverage`
  checks local Postgres evidence for every workflow family, requiring completed
  tasks, output artifacts, persisted artifact rows, forecast attempts for
  forecast/eval modes, and benchmark case linkage for benchmark eval modes.
- Sample workflow run-through harness complete for v1: `bun run
  workflow:samples` plans representative forecast, research, table, and
  benchmark cases from `examples/`; `--execute` launches them through the live
  app API, waits for terminal status, and verifies persisted artifacts,
  forecast ledgers, task-row ledgers, benchmark scorecards, and replay links.
- Seed examples complete for v1: `examples/` contains small JSON and CSV inputs
  for binary forecast, non-binary forecast prompts, deep research, agent-map,
  classify, rank, merge, and dedupe so a new local user can exercise each
  workflow family without inventing data first.
- Ranked-table workflow complete for v1: `rank` now routes to a dedicated
  Smithers workflow with parallel structured row scoring, deterministic
  tie-broken sorting, original row value preservation, artifact-row persistence,
  and CSV export.
- DuckDB local analytics mart complete for v1: `bun run duckdb:sync` rebuilds
  file-backed tables under `DUCKDB_PATH` from Postgres for tasks, artifact rows,
  benchmark runs, benchmark case results, source-bank entries, promotion
  decisions, and comparison-report uncertainty fields.
- Docker Codex runtime complete for v1: the shared app/worker image installs
  Node, Git, ripgrep, and `@openai/codex` so the Smithers worker can execute
  CodexAgent runs with mounted subscription auth inside `docker compose`.
- Local runtime hygiene complete for v1: the Smithers launcher defaults
  `SMITHERS_STATE_DIR` to the project-local `data/smithers` directory when the
  shell environment does not provide it, and root `smithers.db*` files are
  ignored/excluded from Docker context so local durable state is not accidentally
  treated as source.
- Onboarding configuration hardening complete for v1: Docker Compose is the
  documented first-run path, direct host development has a separate
  `.env.host.example`, published Compose ports bind to `127.0.0.1` by default,
  Codex auth mount defaults to `${HOME}/.codex`, and
  `bun run onboarding:check` verifies these clone-and-run assumptions.
- Object storage path complete for v1 replay artifacts: Compose includes MinIO
  plus a one-shot `minio-init` service that creates deterministic buckets for
  artifacts, eval snapshots, and export bundles before app/worker startup. The
  app now writes trace bundles, BTF-2 import snapshots, derived artifact
  CSV/Parquet exports, and local export archive mirrors to MinIO when available,
  while keeping local file mirrors for direct host development. `bun run
  object-storage:smoke` verifies all configured buckets through the same SigV4
  client used by the app.
- Fresh database bootstrap complete for v1: Compose includes a one-shot
  `migrate` service that runs `bun run db:migrate` after Postgres is healthy and
  before the app/Smithers worker start; the direct host-development path
  documents the same migration step explicitly.
- Non-binary product scoring complete for v1 smoke use: manual resolutions now
  score numeric, date, categorical, thresholded, and binary conditional forecast
  aggregate/attempt rows with type-appropriate metrics while preserving the
  binary calibration track record separately.
- Local cleanup controls complete for v1 app projections: `bun run
  cleanup-local` dry-runs and then, only with an exact confirmation token,
  deletes task/run, artifact, or benchmark-run projection rows in dependency
  order. It explicitly avoids deleting Smithers SQLite state; benchmark task
  projections are preserved unless `--include-benchmark-tasks` is supplied.
- Local diagnostics/settings surface complete for v1: `/api/diagnostics` and
  the dashboard diagnostics panel expose Codex model/auth settings,
  Smithers/DuckDB/artifact/eval/export paths, signed MinIO bucket reachability,
  eval suite/case status, local projection counts, service links, maintenance
  commands, and the role-aware health checks in one read model.
- Local maintenance job surface complete for v1: `cleanup_jobs` stores
  allowlisted local maintenance runs, `/api/maintenance` lists and executes
  non-destructive actions, and the Diagnostics panel can run export, object
  storage verification, DuckDB sync, and reset dry-run actions while preserving
  stdout/stderr, status, timestamps, and errors for later inspection.

This is still not a full benchmark-quality forecasting system. The built-in
smoke suites are tiny infrastructure checks. Imported BTF-2 subsets are useful
for workflow iteration, but promotion decisions still need larger paired runs
and careful contamination caveats for models with late-2025/2026 cutoffs.

## Local Start

Recommended first run, using the full Docker stack:

```bash
cp .env.example .env
docker compose up --build
```

The web app runs on [http://localhost:3000](http://localhost:3000). Published
Compose ports bind to `127.0.0.1` by default because v1 has no user auth.
Compose runs `bun run db:migrate` in a one-shot `migrate` service before the
app and Smithers worker start. It also runs a one-shot `minio-init` service that
creates the local `open-superforecaster-artifacts`,
`open-superforecaster-evals`, and `open-superforecaster-exports` buckets.

For direct host development, keep the backing services in Docker and run the web
app with Bun on the host:

```bash
cp .env.host.example .env
docker compose up -d postgres redis minio minio-init otel-collector prometheus tempo grafana
bun install
bun run db:migrate
bun run object-storage:smoke
bun run dev
```

Docker Compose mounts `CODEX_HOST_HOME` only into the `smithers` service. If it
is unset or empty, Compose defaults it to `${HOME}/.codex`; set it to another
absolute host path only when your Codex login lives elsewhere. This directory
contains Codex subscription credentials. The web app health endpoint shows Codex
auth/CLI visibility as optional, while the worker `/health` and `/codex-auth`
endpoints require both the mounted auth directory and the `codex` CLI. Do not
expose the app publicly without adding auth.

## Runtime Notes

```text
Next.js App Router UI
  -> Next route handlers
  -> Postgres product ledger
  -> MinIO object storage
  -> DuckDB local analytics files
  -> Smithers worker/runtime
  -> CodexAgent through mounted CODEX_HOME
```

Smithers SQLite/state is persisted under `data/smithers`. Product-visible state
is stored in Postgres. Large artifacts and trace bundles go to MinIO/object
storage-compatible paths.

## Verification Commands

```bash
bun run typecheck
bun run onboarding:check
bun run object-storage:smoke
bun run smoke:local
bun run workflow:coverage
bun run workflow:samples
bun run duckdb:sync
bun run build
docker compose config --quiet
```

Use the stricter local-data smoke gate after sample runs/benchmarks exist:

```bash
bun run smoke:local -- --require-data
bun run workflow:coverage
```

`bun run smoke:local -- --write-checks` may create a new benchmark comparison
report if no comparison report exists, so the default suite stays read-only.

Plan or execute representative end-to-end sample runs through the live app API:

```bash
bun run workflow:samples
bun run workflow:samples -- --probe
bun run workflow:samples -- --execute --suite quick
bun run workflow:samples -- --execute --suite all
```

The default command is a no-spend plan. `--probe` additionally checks the live
server and classifier preview without launching Smithers work. `--execute`
starts real CodexAgent-backed runs and waits for completion. Supported suites
are `quick`, `forecast`, `research`, `table`, `benchmark`, `all`, or a concrete
sample id such as `binary-foldable-iphone` or `rank-companies`. Add
`--include-live-web-benchmark` when intentionally exercising the weak live-web
pastcasting eval path.

Inspect the local settings/diagnostics read model:

```bash
curl http://localhost:3000/api/diagnostics
```

The dashboard `Diagnostics` section renders the same data: configured Codex
model/home, Smithers state path, DuckDB path, MinIO buckets with signed
reachability checks, eval dataset counts, local task/artifact/benchmark counts,
service links, the non-destructive maintenance actions, and recent persisted
maintenance jobs.

Inspect or run local maintenance actions through the app:

```bash
curl http://localhost:3000/api/maintenance
curl -X POST http://localhost:3000/api/maintenance \
  -H 'content-type: application/json' \
  -d '{"action":"object_storage_smoke"}'
```

The API is allowlisted; it is not an arbitrary shell runner. Supported actions
are `export_local`, `object_storage_smoke`, `duckdb_sync`, and `reset_preview`.

Create a local export bundle:

```bash
bun run export-local
```

The export archive is written to `data/exports/` and mirrored to the configured
MinIO exports bucket when object storage is reachable. It includes repo
metadata, artifact/eval/Smithers/DuckDB local data when present, a manifest, and
a Postgres dump when `pg_dump` is available. Use `--skip-object-storage` for an
offline-only local tarball.

Refresh the local DuckDB analytics mart:

```bash
bun run duckdb:sync
```

The sync rebuilds these file-backed tables in `DUCKDB_PATH`:
`osf_tasks`, `osf_artifact_rows`, `osf_benchmark_runs`,
`osf_benchmark_case_results`, `osf_source_bank_entries`, and
`osf_sync_metadata`. JSON payloads are stored as text columns so local DuckDB
queries can cast them with `row_json::JSON` or `score_rows_json::JSON` when
needed.

Preview local data reset:

```bash
bun run reset-local -- --dry-run
```

Delete ordinary local data directories only with an exact confirmation token:

```bash
bun run reset-local -- --confirm open-superforecaster-reset-local
```

Smithers and Postgres state are protected from ordinary reset. Add
`--include-smithers` and/or `--include-postgres` only when intentionally clearing
those persisted stores.

Preview dependency-aware deletion of app projection rows:

```bash
bun run cleanup-local -- --task <task-id> --dry-run
bun run cleanup-local -- --artifact <artifact-id> --dry-run
bun run cleanup-local -- --benchmark-run <benchmark-run-id> --dry-run
```

Confirmed cleanup requires an exact token:

```bash
bun run cleanup-local -- --task <task-id> --confirm open-superforecaster-cleanup-local
```

`cleanup-local` deletes Postgres projection rows for the selected target only.
It never removes Smithers SQLite state. Benchmark-run cleanup preserves linked
task projections by default; add `--include-benchmark-tasks` only when you want
those child task projections removed too.

Launch a real auto-classified binary forecast:

```bash
curl -X POST http://localhost:3000/api/classify \
  -H 'content-type: application/json' \
  -d '{"mode":"auto","prompt":"Will Apple release a foldable iPhone before January 1, 2027?"}'

curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"auto","prompt":"Will Apple release a foldable iPhone before January 1, 2027?"}'
```

## Screenshot Evidence

Current local UI evidence for the run-detail output renderers is stored under
`data/screenshots/`:

- `forecast-renderer-binary.png`
- `forecast-renderer-date.png`
- `forecast-renderer-numeric.png`
- `forecast-renderer-categorical.png`
- `forecast-renderer-thresholded.png`
- `forecast-renderer-conditional.png`
- `diagnostics-dashboard.png`
- `benchmark-detail.png`

Seed requests and CSVs live under `examples/`. For example:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d @examples/request-binary-forecast.json
```

Launch non-binary forecast types:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"auto","prompt":"When will Apple release its first foldable iPhone?"}'

curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"auto","prompt":"How many orbital launches will SpaceX conduct in calendar year 2027?"}'

curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"auto","prompt":"Which company will ship the first widely available consumer AR glasses?"}'

curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"forecast","forecastType":"thresholded","prompt":"What are the probabilities that SpaceX completes at least each launch threshold in calendar year 2027?","thresholds":["120 launches","140 launches","160 launches"],"thresholdDirection":"at_least","units":"orbital launches"}'

curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"forecast","forecastType":"conditional","prompt":"Conditional on Starship reaching operational weekly launch cadence by December 31, 2026, will SpaceX complete at least 160 orbital launches in calendar year 2027?","condition":"Starship reaches operational weekly launch cadence by December 31, 2026","conditionResolutionCriteria":"Resolve true if Starship/Super Heavy achieves an operational cadence averaging at least one orbital launch per week during December 2026.","resolutionCriteria":"Resolve true if SpaceX completes at least 160 orbital launches between 2027-01-01 and 2027-12-31 UTC."}'
```

Launch a one-case fixed-evidence benchmark smoke run:

```bash
curl -X POST http://localhost:3000/api/benchmarks \
  -H 'content-type: application/json' \
  -d '{"evalMode":"fixed_evidence","maxCases":1,"rollouts":3,"experimentLabel":"readme-fixed-evidence"}'
```

Import a small BTF-2 fixed-evidence subset:

```bash
curl -X POST http://localhost:3000/api/benchmarks/import-btf2 \
  -H 'content-type: application/json' \
  -d '{"maxRows":10}'
```

Run an imported BTF-2 suite:

```bash
curl -X POST http://localhost:3000/api/benchmarks \
  -H 'content-type: application/json' \
  -d '{"evalMode":"fixed_evidence","suiteId":"<btf2-suite-id>","maxCases":1,"rollouts":1,"experimentLabel":"btf2-import-smoke"}'
```

Launch a one-case live-web plumbing smoke run:

```bash
curl -X POST http://localhost:3000/api/benchmarks \
  -H 'content-type: application/json' \
  -d '{"evalMode":"agentic_pastcasting_smoke","maxCases":1,"experimentLabel":"readme-live-web-smoke"}'
```

The live-web pastcasting smoke runner is intentionally weak as a scientific
benchmark because current web search can leak post-cutoff information. Its value
in v1 is plumbing and audit coverage: it records leakage, information advantage,
source counts, search-query counts, and trace completeness so bad cases can be
analyzed instead of silently treated as ordinary forecast misses.

Then list/reconcile runs and benchmark runs:

```bash
curl http://localhost:3000/api/runs
curl http://localhost:3000/api/runs/<task-id>
curl http://localhost:3000/api/benchmarks
curl http://localhost:3000/api/benchmarks/<benchmark-run-id>
```

Export persisted artifact rows as CSV:

```bash
curl http://localhost:3000/api/artifacts/<artifact-id>/csv -o artifact.csv
```

`/api/benchmarks` returns both recent benchmark runs and registered benchmark
suites, including imported BTF-2 suite revision, case count, source SHA, license,
and raw snapshot URI. It also returns workflow variant promotion state and the
latest promotion decision for each benchmark run.

Record a benchmark-backed workflow promotion decision:

```bash
curl -X POST http://localhost:3000/api/benchmarks/<benchmark-run-id>/promotion \
  -H 'content-type: application/json' \
  -d '{"state":"needs_more_cases","decisionNote":"Useful trace evidence, but the subset is too small for promotion.","decidedBy":"local-review"}'
```

The allowed states are `candidate`, `promoted_for_eval_only`,
`promoted_for_local_default`, `needs_more_cases`, and `rejected`. Promotion
decisions update both `workflow_promotion_decisions` and the corresponding
`workflow_variants.promotion_state`; the linked `benchmark_runs` row stores the
latest `promotion_decision_id`.

Generate a benchmark comparison report for a run:

```bash
curl -X POST http://localhost:3000/api/benchmarks/<benchmark-run-id>/comparison \
  -H 'content-type: application/json' \
  -d '{}'
```

With no explicit `baselineBenchmarkRunIds`, the comparator selects recent
non-running baseline runs from the same suite and eval mode. The report is
stored as a normal artifact, linked from `benchmark_runs.comparison_report_artifact_id`,
and surfaced in `/api/benchmarks` with paired case deltas when case IDs overlap.
Each paired baseline comparison also includes deterministic 95% paired-case
bootstrap intervals for Brier/log deltas. Promotion recommendations still return
`needs_more_cases` below 10 paired cases, then require the Brier interval to stay
fully below or above zero before calling a candidate better or worse.

List product forecast resolution state:

```bash
curl http://localhost:3000/api/resolutions
```

Manually resolve a completed product binary forecast:

```bash
curl -X POST http://localhost:3000/api/resolutions \
  -H 'content-type: application/json' \
  -d '{"taskId":"<task-id>","resolved":true,"resolutionSource":"manual","resolutionExplanation":"Short source-backed explanation."}'
```

Resolve non-binary product forecasts:

```bash
# numeric or thresholded
curl -X POST http://localhost:3000/api/resolutions \
  -H 'content-type: application/json' \
  -d '{"taskId":"<task-id>","value":160,"resolutionSource":"manual"}'

# date
curl -X POST http://localhost:3000/api/resolutions \
  -H 'content-type: application/json' \
  -d '{"taskId":"<task-id>","date":"2026-11-15","resolutionSource":"manual"}'

# categorical
curl -X POST http://localhost:3000/api/resolutions \
  -H 'content-type: application/json' \
  -d '{"taskId":"<task-id>","category":"Meta","resolutionSource":"manual"}'

# binary conditional
curl -X POST http://localhost:3000/api/resolutions \
  -H 'content-type: application/json' \
  -d '{"taskId":"<task-id>","conditionResolved":false,"outcomeResolved":true,"resolutionSource":"manual"}'
```

Manual resolution intentionally rejects benchmark tasks. Benchmark cases use
their hidden/imported resolution path so product track records and benchmark
scores stay separate.

Launch a real deep-research run:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"multi_agent","prompt":"What makes local AI research agents reliable enough for benchmark-driven workflow iteration?"}'
```

Launch a two-row classify run:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"classify","prompt":"Classify each row as infra or ui concept","rows":[{"rowId":"row-1","input":"trace bundle"},{"rowId":"row-2","input":"benchmark lab"}]}'
```

Launch a CSV-shaped classify run through the JSON API:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"classify","prompt":"Classify each company as AI lab or collaboration software.","rows":[{"rowId":"row-1","name":"OpenAI","domain":"openai.com"},{"rowId":"row-2","name":"Notion","domain":"notion.so"}]}'
```

Launch a small merge run:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"merge","prompt":"Match CRM companies to vendor records by company identity","leftRows":[{"rowId":"l1","name":"OpenAI","domain":"openai.com"}],"rightRows":[{"rowId":"r1","name":"OpenAI Inc.","website":"https://openai.com"}],"leftKey":"name","rightKey":"name"}'
```

Launch a small dedupe run:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d '{"mode":"dedupe","prompt":"Deduplicate companies by same real-world company","strategy":"combine","rows":[{"rowId":"a","name":"OpenAI","domain":"openai.com"},{"rowId":"b","name":"OpenAI Inc","website":"https://openai.com"}]}'
```

And export a trace bundle:

```bash
curl http://localhost:3000/api/runs/<task-id>/trace-bundle
```

Trace bundles include product state from Postgres plus Smithers runtime token
usage parsed from `.smithers/executions/<smithers-run-id>/logs/stream.ndjson`.
The detailed token rows stay in the bundle; Prometheus exposes bounded recent
per-task totals.

Inspect local Prometheus metrics:

```bash
curl http://localhost:3000/metrics
```

The metrics endpoint includes correlation labels such as `task_id`,
`smithers_run_id`, `benchmark_run_id`, `benchmark_case_id`,
`workflow_variant_id`, `failure_labels`, and `trace_bundle_uri`. It also exposes
`open_superforecaster_smithers_agent_calls_total` and
`open_superforecaster_smithers_token_total` for recent runs, labeled by task,
Smithers run, benchmark run, operation mode, workflow variant, and token type.

Verified locally in this workspace:

- binary forecast task `2a843d66-05ed-46c5-8fd7-cedbae18f297` completed with
  probability `86.3` and persisted source rows;
- benchmark run `9746deac-2a1d-4202-82e0-1b225596a19d` completed one smoke case
  with Brier score `0.000001` and trace bundle
  `runs/2b8c0cea-5c15-4af2-ad1c-ed729aeba649/trace-bundle.json`;
- fixed-evidence benchmark run `e2f8a9ba-0455-4462-8443-1dc50779af3c`
  completed one resolution-hidden evidence case with Brier score `0.0016`,
  baseline Brier `0.0324`, three persisted rollout attempts, one aggregate, and
  forecast/benchmark score rows in trace bundle
  `runs/9c74a8d1-af96-471e-88e5-8227c1b09df7/trace-bundle.json`;
- agentic pastcasting benchmark run `94cad435-dfc9-4f9c-a98b-4130c1cbb58e`
  launched dedicated workflow `agentic-pastcasting-eval`, scored the foldable
  iPhone smoke case with Brier `0.000484`, and correctly marked the case
  `needs_review` with `source_leakage` and `information_advantage` labels. Its
  trace bundle contains two benchmark score rows, three forecast attempts, one
  aggregate, and `31` source-bank rows at
  `runs/bf05264e-c3e4-43da-9e83-56f83c69a66f/trace-bundle.json`.
- source/forecast ledgers backfilled completed binary runs into
  `source_bank_entries`, `citations`, `forecast_attempts`, and
  `forecast_aggregates`.
- deep-research task `b40ba4a2-decc-4c67-99ce-88ff72b5cf85` completed with
  `25` persisted source rows/citations and trace bundle
  `runs/b40ba4a2-decc-4c67-99ce-88ff72b5cf85/trace-bundle.json`.
- classify/AgentMap task `e264194b-8c40-4415-8ab3-89a9623b4373` completed with
  two row results expanded to artifact rows `1` and `2`.
- CSV-shaped classify task `9563126c-55eb-4a8d-a771-35efc58a4481` completed
  through the real `agent-map` Smithers workflow with two object rows, wrote a
  summary plus two row artifact rows, persisted three source-bank entries, and
  exported trace bundle `runs/9563126c-55eb-4a8d-a771-35efc58a4481/trace-bundle.json`
  with Smithers token summary `44309` total tokens.
- Local hardening scripts verified: `bun run reset-local -- --dry-run` lists
  ordinary data directories while skipping protected Smithers/Postgres state,
  and `bun run export-local` produced
  `data/exports/open-superforecaster-export-2026-07-08T05-12-31-256Z.tar.gz`
  plus
  `s3://open-superforecaster-exports/exports/open-superforecaster-export-2026-07-08T05-12-31-256Z.tar.gz`
  with manifest and local artifact/eval/Smithers/DuckDB paths. `pg_dump` was not
  available on this host, so the export recorded a skipped Postgres dump note.
  `bun run cleanup-local` was verified against real dry-runs for task, artifact,
  and benchmark-run targets, plus a confirmed deletion of a synthetic task with
  artifact row, trace event, source row, and citation.
- merge task `64ce10e3-dced-4a14-b417-710cb39dd442` completed with three
  matched rows and four artifact rows including the summary row.
- dedupe task `7e32126d-168d-4bed-85ea-4787880cdc0b` completed with three
  equivalence classes, combined synthetic rows, and eight artifact rows
  including the summary row.
- date forecast task `0241247f-ddb8-424e-bdc5-b515e4f99c7a`, numeric forecast
  task `9cc2c463-4463-4d4d-ae85-005aad05c64f`, and categorical forecast task
  `76fd8f17-2b89-4610-8d6c-328832f5cbf8` completed, wrote forecast attempts,
  aggregate rows, source rows, and trace bundles.
- thresholded forecast task `9d1ece43-855e-44fd-8e74-f39f78091dc4` completed
  with an `at_least` monotone curve of `91%`, `69%`, and `38%` for `120`,
  `140`, and `160` SpaceX 2027 launch thresholds, wrote three thresholded
  attempt rows, one thresholded aggregate row, `14` source rows, and trace bundle
  `runs/9d1ece43-855e-44fd-8e74-f39f78091dc4/trace-bundle.json`.
- conditional forecast task `67b6d7bd-957f-4e47-b799-090411019c2d` completed
  with `P(outcome | condition) = 74%`, `P(outcome | not condition) = 47%`,
  condition probability `15%`, three conditional attempt rows, one conditional
  aggregate row, `16` source rows, and trace bundle
  `runs/67b6d7bd-957f-4e47-b799-090411019c2d/trace-bundle.json`.
- resolution smoke task `ea5d5c1c-5ae4-4a03-8652-1be6e4c5282f` was manually
  resolved through `/api/resolutions`, wrote one `forecast_resolutions` row and
  eight `forecast_scores` rows, produced mean aggregate Brier `0.0100`, and its
  trace bundle contains one resolution, eight scores, three attempts, and one
  aggregate at `runs/ea5d5c1c-5ae4-4a03-8652-1be6e4c5282f/trace-bundle.json`.
  `/api/resolutions` now reports one aggregate calibration sample in the
  `80-100%` bucket, mean forecast `90%`, observed rate `100%`, ECE `10.0pp`,
  and `collecting_resolved_forecasts` status until `25` resolved product
  forecasts exist.
- benchmark-analysis fixed-evidence smoke run
  `06caf90f-5059-4a24-a049-df4ceea9b9b5` completed one case with mean Brier
  `0.0009`, wrote score report artifact
  `ec353c2e-3f43-42d0-8d9d-4eccdf89cb80`, analysis artifact
  `5745aef7-b952-4d1a-9370-3daa60bab12a`, per-case analyst artifact
  `2d0dadb9-db96-4093-8b03-a853faeb74a6`, and a workflow proposal to expand
  fixed-corpus benchmark coverage before promotion.
- benchmark-analysis live-web smoke run
  `299b35ab-f6d5-4cd9-acdc-641a25a7941e` finished as `partial_failure` with
  one review case, `source_leakage` and `information_advantage` clusters, score
  report artifact `7eebeb37-f14e-4b16-855a-c9c05666dced`, analysis artifact
  `0ddbb7d2-4441-44c3-bfc2-1b7f440bef7e`, per-case analyst artifact
  `86089417-b581-4b78-a416-e0b78d406572`, and a workflow proposal targeting
  `agentic-pastcasting-eval` source-provenance gates.
- `/metrics` verified locally with `open_superforecaster_benchmark_case_info`
  labels linking benchmark run `299b35ab-f6d5-4cd9-acdc-641a25a7941e`, task
  `5b51377e-2c11-43d8-b36b-8b5d13910ee8`, Smithers run
  `osf-5b51377e-2c11-43d8-b36b-8b5d13910ee8`, trace bundle
  `runs/5b51377e-2c11-43d8-b36b-8b5d13910ee8/trace-bundle.json`, failure
  labels, and workflow variant `8830dafd-83b2-4e63-b9f1-5bc80cb60d22`.
- Smithers token extraction verified locally for task
  `5b51377e-2c11-43d8-b36b-8b5d13910ee8`: trace bundle `tokenUsage.summary`
  reports `3` agent calls, `125386` input tokens, `10372` output tokens, and
  `135758` total tokens; `/metrics` exposes the same run through
  `open_superforecaster_smithers_agent_calls_total` and
  `open_superforecaster_smithers_token_total`.
- BTF-2 import smoke imported `3` rows from Hugging Face dataset
  `BTF-2/BTF-2` at SHA `4940eec8721a1b0651cce6ea44254d3e6c71e8f4` into suite
  `b4de3870-e9f3-4e76-8417-768917b143e4`, wrote raw snapshot
  `data/evals/btf2/hf-4940eec8721a-offset-0-rows-3/rows.jsonl`, then completed
  benchmark run `008740f0-0ec3-4782-85b4-2c6b88bfdab8` with task
  `b675dac8-9227-4966-902d-a5dce208c54b`, mean Brier `0.0484`, mean log
  `0.2485`, baseline Brier `0.0064`, trace bundle
  `runs/b675dac8-9227-4966-902d-a5dce208c54b/trace-bundle.json`, one forecast
  attempt, one aggregate, five benchmark score rows, four forecast score rows,
  and Smithers token summary `23607` total tokens.
- workflow promotion gate smoke recorded decision
  `163b5163-8d73-4e60-810c-e72f1b758681` for BTF-2 benchmark run
  `008740f0-0ec3-4782-85b4-2c6b88bfdab8`, setting workflow variant
  `ba0249cd-4104-48bf-be03-d5dcdfccfb45` (`fixed-evidence-eval`) to
  `needs_more_cases` because three imported BTF-2 cases are useful iteration
  evidence but insufficient for promotion.
- benchmark comparison smoke generated report artifact
  `814e2790-41a1-4bbd-8c08-0794a0d3b99d` for fixed-evidence run
  `06caf90f-5059-4a24-a049-df4ceea9b9b5` against baseline
  `e2f8a9ba-0455-4462-8443-1dc50779af3c`, found one paired case, paired mean
  Brier delta `-0.0007`, paired mean log delta `-0.0104`, and correctly
  recommended `needs_more_cases` before promotion.
- bootstrap-interval comparison smoke regenerated comparison artifact
  `a28c9588-b279-4740-a4d7-c997f839fb89` for the same paired run, confirmed
  deterministic `pairedUncertainty` fields for Brier/log deltas with 1,000
  bootstrap samples, and retained `needs_more_cases` because only one paired
  case exists.
- run-detail smoke loaded `/api/runs/b675dac8-9227-4966-902d-a5dce208c54b`
  and `/runs/b675dac8-9227-4966-902d-a5dce208c54b`, surfacing two artifacts,
  two artifact rows, six source-bank rows, one forecast attempt, one aggregate,
  four forecast scores, one benchmark case result, one trace event, and a
  trace-bundle export link for the completed BTF-2 benchmark task.
- artifact CSV/Parquet export smoke downloaded
  `/api/artifacts/8d895206-a40d-4934-a34d-c64e5e7acb2e/csv` for the completed
  BTF-2 output artifact and returned text/csv rows with metadata columns plus
  output fields such as `probability`, `method`, `rationale`, and
  `cited_sources`; the same export path now also validates
  `/api/artifacts/<artifact-id>/parquet` with `application/vnd.apache.parquet`
  and `PAR1` file magic.
- promotion observability smoke verified `/metrics` now exposes
  `open_superforecaster_workflow_variant_info`,
  `open_superforecaster_workflow_variants_total`,
  `open_superforecaster_workflow_promotion_decisions_total`, and
  `open_superforecaster_benchmark_run_info` labels for `promotion_state`,
  `promotion_decision_id`, and `comparison_report_artifact_id`.
- local smoke suite verified `bun run smoke:local -- --require-data` against
  the live app: health passed, classifier preview routed
  `forecast/binary` to `binary-forecast`, the 12-prompt classifier routing
  matrix passed across forecast/research/table modes, `20` recent runs loaded,
  run detail loaded one task-row ledger entry, and artifact CSV/Parquet export passed for
  row-retry task `45ddbab2-d1d5-4240-869e-93bbe402f3a0` and artifact
  `5466449e-3b8a-48be-b5a4-306fa6ffe0bc`, the per-run SSE endpoint emitted
  `status` and `done` events for the same task, Benchmark Lab returned
  `6` runs and `4` suites, existing comparison
  `06caf90f-5059-4a24-a049-df4ceea9b9b5` reported `needs_more_cases`, and
  required Prometheus series were present. Before the diagnostics read-model
  check was added, that suite reported `9` passed, `0` skipped, and `0` failed.
- sample workflow run-through verified `bun run workflow:samples -- --suite all`
  plans `13` representative cases across forecast, research, table, and
  fixed-evidence benchmark workflows. `bun run workflow:samples -- --probe
  --suite quick` verifies classifier routing without launching agents. Fresh
  live execution then verified every current workflow family: forecast suite
  tasks `73bd0040-6b78-42f5-a4b2-5822da5953cd`,
  `910b466d-1063-4e5b-8bd4-3f04745f1ffc`,
  `c8d700f4-d88e-4cd7-aa05-f624c80445e6`,
  `4e1af0e0-5f2b-4b87-9b62-86fe0f3986e5`,
  `b4a0757d-3abc-4ada-a422-1ae45ad38695`, and
  `2b49d672-806a-4dd9-a596-32e42974ef53` completed binary, date, numeric,
  categorical, thresholded, and conditional forecasts with artifact rows,
  three forecast attempts each, and source ledgers; deep research task
  `170ac95f-f09b-44a5-957b-08e3c505ee5e` completed with `34` sources; table
  suite tasks `80892ec6-5440-4db1-ac37-c2b58ac8bc6d`,
  `7f97b28c-a345-485b-b9ec-c59931b1f1e7`,
  `2b8f3408-021b-4c64-a48c-dcfd4358a453`,
  `2c9479d6-2f29-4498-aa3c-5756f956a55d`, and
  `e3dcdd8d-1ddc-43f0-b5af-bd33b5d00cd5` completed agent-map, classify,
  rank, merge, and dedupe with persisted artifact rows; fixed-evidence
  benchmark run `f40bfca7-0a5e-41f3-bffc-fd4c89a68e29` completed one case
  with mean Brier `0.0025`; live-web pastcasting run
  `dc8b289d-5b2a-4175-bbab-e38742cf6f60` ended `partial_failure` as expected
  for leakage-prone smoke evals while still producing one scored case and
  replay links. The runner and backend reconciliation now tolerate the short
  Smithers launch/inspect window where a newly detached run can briefly report
  `RUN_NOT_FOUND`.
- diagnostics smoke verified `/api/diagnostics` against the live app: the read
  model reports service `open-superforecaster`, Codex model `gpt-5.5`, local
  Smithers state path, `5` benchmark suites, `13` benchmark cases, signed `200`
  bucket checks for artifacts/evals/exports, and `5` maintenance commands. The
  diagnostics-inclusive `bun run smoke:local -- --require-data` suite now
  reports `10` passed, `0` skipped, and `0` failed.
- maintenance action smoke verified `/api/maintenance` against the live app:
  the API listed four allowlisted actions and executed
  `object_storage_smoke`, persisting completed job
  `e591f440-4e90-49e0-8046-6ac6c5169f2a` in `cleanup_jobs` with captured
  command output. The maintenance-inclusive `bun run smoke:local
  -- --require-data` suite now reports `11` passed, `0` skipped, and `0`
  failed.
- benchmark run detail smoke verified
  `/api/benchmarks/008740f0-0ec3-4782-85b4-2c6b88bfdab8` against the live app:
  the read model returned one BTF-2 case, scorecard metrics, promotion gate
  `needs_more_evidence`, replay links to run detail/trace bundle/CSV export,
  report metadata, workflow proposal evidence, and the expected missing
  comparison-report blocker. The maintenance and benchmark-detail-inclusive
  `bun run smoke:local -- --require-data` suite now reports `12` passed,
  `0` skipped, and `0` failed.
- row retry smoke used `/api/runs/30a928de-e018-46c0-9fbc-92069379a5d3/rows/5c22a05c-2858-4b41-b3a4-6fe54a42293b/retry`
  to launch derived Smithers run `45ddbab2-d1d5-4240-869e-93bbe402f3a0` for the
  `openai` row, completed via `.smithers/workflows/agent-map.tsx`, wrote
  artifact `5466449e-3b8a-48be-b5a4-306fa6ffe0bc`, and advanced the original
  task row retry count to `1`.
- row-retry visual smoke captured
  `data/screenshots/run-detail-row-retry-ledger.png` after waiting for
  `.task-row-list .task-row`; the run detail page shows `openai` as completed
  with `1 retry`, `notion` as completed, and retry buttons for both rows.
- run-detail visual smoke captured
  `data/screenshots/run-detail-artifact-table.png` after waiting for persisted
  artifact rows on task `30a928de-e018-46c0-9fbc-92069379a5d3`; the run
  workspace renders stable previews with nested JSON summarized and raw
  artifact access preserved.
- dashboard navigation visual smoke captured
  `data/screenshots/dashboard-artifacts-anchor.png` after waiting for recent
  artifact links under `/#artifacts`; the sidebar now targets concrete dashboard
  sections for workflows, benchmark lab, artifacts, diagnostics, and runs.
- benchmark-detail visual smoke captured
  `data/screenshots/benchmark-detail.png` after loading
  `/benchmarks/008740f0-0ec3-4782-85b4-2c6b88bfdab8`; the page renders the
  per-run scorecard, promotion evidence, trace/source/report health, case replay
  links, failure clusters, workflow proposals, and report/variant metadata
  without horizontal overflow.
- example bundle validation parsed all `6` JSON request files and all `7`
  `examples/questions.jsonl` records successfully; CSV seed files cover
  classify/agent-map/rank rows, merge left/right rows, and dedupe rows.
- agent-map workflow smoke launched `30a928de-e018-46c0-9fbc-92069379a5d3`
  through `/api/runs` with `examples/request-agent-map-companies.json`,
  completed via `.smithers/workflows/agent-map.tsx`, and wrote artifact
  `d4c9644d-5e0e-483a-bdab-96a23c4bc821` with three artifact rows.
- workflow coverage verifier ran `bun run workflow:coverage` and passed all
  `15` expected workflow families: six product forecast types, deep research,
  agent-map, classify, rank, merge, dedupe, fixed-evidence benchmark eval,
  agentic-pastcasting benchmark eval, and Codex runtime smoke. The latest
  agent-map evidence is the row-retry run
  `45ddbab2-d1d5-4240-869e-93bbe402f3a0`.
- rank workflow smoke launched `ecabe830-581d-4732-9c1f-0ad6e6ce66bf` through
  `/api/runs` with `examples/request-rank-companies.json`, completed via
  `.smithers/workflows/rank.tsx`, and wrote artifact
  `6fa0d16a-850d-433c-b1f1-30db7e37563f` with three ranked row artifacts:
  `acme-industrial` rank `1` score `91`, `northstar-legal` rank `2` score
  `73`, and `lakeview-cafe` rank `3` score `8`, preserving original structured
  row values.
- DuckDB sync smoke ran `bun run duckdb:sync` against local Postgres and wrote
  `data/duckdb/open-superforecaster.duckdb`
  with `26` tasks, `64` artifact rows, `6` benchmark runs, `6` benchmark case
  results, and `236` source-bank entries. A direct DuckDB query confirmed
  comparison uncertainty fields for benchmark run
  `06caf90f-5059-4a24-a049-df4ceea9b9b5`, including paired Brier delta
  `-0.0007` and CI bounds `[-0.0007, -0.0007]`.
- role-aware Codex health verified locally: `/api/health` returns `200` for the
  web app with optional Codex visibility, and a temporary worker on port `3012`
  returned strict `/health` plus `/codex-auth` success with mounted Codex auth
  and a visible `codex` CLI.
- Docker Codex runtime verified by rebuilding
  `open-superforecaster-app:codex-health-smoke` from `docker/app/Dockerfile` and
  running `node --version` plus `codex --version` inside the image; the container
  reports Node `v20.19.2` and `codex-cli 0.143.0`.
- non-binary scoring smoke resolved five existing product forecast tasks through
  `/api/resolutions`: numeric `9cc2c463-4463-4d4d-ae85-005aad05c64f`
  inserted `12` score rows, date `0241247f-ddb8-424e-bdc5-b515e4f99c7a`
  inserted `8`, categorical `76fd8f17-2b89-4610-8d6c-328832f5cbf8` inserted
  `8`, thresholded `9d1ece43-855e-44fd-8e74-f39f78091dc4` inserted `8`, and
  conditional `67b6d7bd-957f-4e47-b799-090411019c2d` inserted `16`.
