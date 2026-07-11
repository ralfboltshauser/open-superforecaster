## Development Log

This file records completed implementation work. For the evidence base, target
architecture, known gaps, and proposed sequence of changes, see
[`docs/agentic-superforecasting.md`](docs/agentic-superforecasting.md).

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

- Stateful agentic-superforecasting core complete for v1: binary forecasts now
  materialize deterministic `ForecastState` snapshots containing the exact
  question and temporal contract, evidence workspace, all selected component
  judgments, independence diagnostics, immutable ensemble controls, explicit
  autonomous and crowd-assisted tracks, update deltas, bounded local memory, and
  version provenance. The production binary selection is the unweighted mean;
  LLM aggregation, logit pooling, prior shrinkage, topical guards, and market
  blending remain named experimental candidates.
- Research-treatment and disagreement loop complete for v1: binary runs support
  no-external-research, shared frozen dossier, independent research, and shared
  dossier plus targeted follow-up conditions. The disagreement controller
  commissions bounded fact/base-rate/boundary checks without directly assigning
  the production probability. Opaque CLI search remains truthfully labelled
  agent-reported until harness-level tool interception exists.
- Live forecast lifecycle complete for v1 scheduled use: canonical unresolved
  questions, immutable snapshots, scheduled and signpost trigger records,
  question-local memory, deterministic boundary-aware review cadence, and the
  dry-run-first `forecast:update-due` runner are persisted through migrations
  `0008`–`0013`. Execute mode atomically leases one question per runner,
  recovers failed or expired leases, and rejects stale or backdated successor
  snapshots. Signpost records await external event-source adapters.
- Statistical evaluation hardening complete for v1: numeric/date quantiles receive
  distributional proper scores; BTF data is explicitly public development;
  autonomous, assisted, and market tracks are scored separately; event-family
  clustered bootstrap intervals are available; and actual promotion requires
  statistical-scale paired, holdout, and family evidence rather than the legacy
  smoke threshold.
- Inactive statistical calibration candidates complete for v1: deterministic
  L2 Platt fitting uses only earlier available labels, embargoes unresolved
  training rows, separates and equal-weights event families, and requires later
  Brier and log-loss improvement with paired intervals below zero. Converged
  candidates may be retained in `calibration_models` for audit but are always
  inactive; no workflow default or activation API was added.
- Canonical implementation recovery guide added at
  [`docs/agentic-superforecasting-implementation.md`](docs/agentic-superforecasting-implementation.md),
  including invariants, file map, operations, capability limits, validation, and
  a context-loss checklist.
- Evidence continuity and quarantine complete for v1: post-cutoff and explicit
  human-forecast dossier sources never reach judges; raw dossiers retain a
  structured isolation audit; previous valid claims carry into later snapshots
  until their stable IDs are explicitly invalidated.
- Binary trajectory scoring complete for v1: resolution writes Brier and log
  rows for every canonical ForecastState snapshot with lead time, update kind,
  probability delta, temporal eligibility, lineage, and method versions, plus a
  dedicated DuckDB mart and trace-bundle records.
- Host Codex authentication resolution corrected: workflow agents now use the
  central `CODEX_HOME` default (`${HOME}/.codex`) during direct host development,
  while Docker and copied profiles continue to work through an explicit mounted
  `CODEX_HOME`. This matches `.env.host.example` and avoids silently preferring a
  stale project-local credential copy.
- Live Codex compatibility and health corrected: Smithers invocations pin the
  API-supported `CODEX_REASONING_EFFORT` value instead of inheriting personal
  aliases, and health checks resolve the same default `CODEX_HOME` used by the
  actual agent.
- Forecast-ledger materialization hardened to exact-once semantics: a task-row
  lock and single Postgres transaction now cover attempts, aggregate,
  ForecastState, canonical pointer, triggers, local memory, sources, citations,
  and trace events. A versioned task manifest is committed last; concurrent
  reconciliation returns the same IDs and legacy partial ledgers are not
  guessed complete.
- Live binary canary completed through real Smithers/Codex agents with four
  selected roles, one aggregate, one ForecastState snapshot, raw mean 52.1,
  raw median 52.0, complete temporal provenance, scheduled/signpost triggers,
  and bounded memory. Five concurrent reconciliation calls produced exactly
  four attempts, one aggregate, and one snapshot.
- Provider research telemetry now resolves exact Codex thread IDs and records
  only search/open/find action requests as `provider_observed_activity` with
  `contentObserved=false`. Smithers timestamp-based session backfill was found
  to cross-attach unrelated searches and is explicitly excluded from evidence
  provenance.
- Autonomous information isolation no longer keyword-matches negative warnings
  such as “No prediction-market evidence was used” as contamination; only
  structured exposure admissions, quarantined sources, or non-negated supplied
  forecast context create exposure flags.
- Adversarial lifecycle review closed the remaining exact-once races: committed
  ledgers recover stale running tasks without provider inspection, every
  terminal transition is compare-and-set, forecasts cannot complete without an
  output artifact and manifest, closed questions reject successor snapshots,
  and resolution/question closure/lease cleanup/scoring share one transaction.
- Legacy ledger quarantine now reaches every consumer. Run detail, schema-v4
  trace export, manual resolution, trajectory scoring, and benchmark backfill
  use exact supported manifest IDs; unmarked or inconsistent rows are excluded
  from scores and benchmark promotion evidence instead of being inferred from a
  Smithers run ID.
- Autonomous isolation now redacts explicit human forecasts from background and
  fixed evidence before every model stage, projects prior state without assisted
  probabilities or free-form memory/update text, audits citations and content
  across all review rounds, and withholds product, benchmark, and trajectory
  scores unless isolation is explicitly `isolated`.
- Exact provider activity auditing now enumerates planner, dossier, every
  judgment retry/iteration, candidate aggregate, and quality review sessions;
  verifies the exact provider thread and Smithers execution window; rejects
  malformed or ambiguous rollouts; flags forbidden/human-forecast actions and
  shared-dossier budget overruns; and writes the resulting policy status back
  into the immutable ForecastState identity without claiming page content was
  observed.
- Question-local state now has deterministic hard caps of 64 active factors, 32
  unresolved information needs, and 32 trigger conditions. The shared dossier
  schema also requires recorded query history to agree with and stay within its
  declared search budget; per-judge tool-call enforcement still awaits a
  pre-consumption harness.
- A second live Codex canary exercised the final provider and ledger audits: all
  seven Smithers node executions were matched to exact provider threads, four
  component attempts committed to one aggregate and one snapshot, provider
  activity reported no policy violations, and the deterministic output retained
  raw mean 52.9 and median 53.1. The intentionally inconsistent temporal input
  was marked untrusted, and a comma-separated model declaration of non-use was
  found to trigger an isolation false positive; the classifier and an exact-text
  regression test now distinguish that declaration from affirmative exposure.
- Post-fix prospective canary `0aa96085-d450-4fdb-afe9-52576e280ba7` passed the
  complete acceptance path. Its temporal trust state is `complete`; an injected
  99% Metaculus forecast was redacted before autonomous prompting; information
  isolation is explicitly `isolated`; all seven provider executions were
  observed without a policy flag; and the committed ledger contains exactly
  four attempts, one aggregate, and one snapshot. Production selected the raw
  unweighted mean of 53.0 (median 53.3), while the schema-v4 trace bundle projects
  the exact manifest read set. Earlier false-positive snapshots remain immutable
  and score-ineligible rather than being rewritten after the classifier fix.
