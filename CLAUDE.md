# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Open Superforecaster turns a question about the future into parallel CodexAgent
research and a source-backed forecast. It is a **Bun monorepo** (`apps/*`,
`packages/*`) where a Next.js App Router app is the local cockpit **and** the
HTTP API, Smithers orchestrates durable CodexAgent workflows, Postgres is the
product ledger, MinIO holds artifacts/trace bundles, and DuckDB is a local
analytics mart rebuilt from Postgres.

## Commands

Package manager is **Bun** (`bun@1.3.14`); do not use npm/yarn/pnpm.

```bash
bun run dev            # web app (apps/web) on :3000
bun run dev:worker     # Smithers worker (apps/worker) on :3010
bun run build          # next build
bun run typecheck      # tsc --noEmit -p tsconfig.check.json  (whole monorepo)
bun run check          # typecheck + build — run this before considering work done
bun run db:generate    # drizzle-kit generate (after editing packages/db/src/schema.ts)
bun run db:migrate     # drizzle-kit migrate
bun --cwd apps/web lint  # eslint (only configured for the web app)
```

There is **no unit-test runner** (`bun test` is not wired up). Verification is
done with smoke scripts that require a live app + Postgres/MinIO already running:

```bash
bun run smoke:local                 # end-to-end health/classifier/run/benchmark checks
bun run smoke:local -- --require-data   # stricter gate; fails without local run evidence
bun run workflow:coverage           # asserts every workflow family has Postgres evidence
bun run workflow:samples -- --execute --suite quick   # launch real CodexAgent runs
bun run onboarding:check            # verify clone-and-run env assumptions
bun run object-storage:smoke        # verify MinIO buckets via the app's SigV4 client
bun run duckdb:sync                 # rebuild the DuckDB analytics mart from Postgres
```

Destructive scripts (`reset-local`, `cleanup-local`) are dry-run by default and
require an **exact confirmation token** (`--confirm open-superforecaster-*`);
they refuse to touch Smithers/Postgres state unless explicitly flagged.

## Running the stack

First-run path is the full Docker stack; direct host dev keeps backing services
in Docker and runs the web app on the host (see README "Local Start"):

```bash
cp .env.example .env && docker compose up --build          # everything in Docker
# or, host dev:
cp .env.host.example .env
docker compose up -d postgres redis minio minio-init otel-collector prometheus tempo grafana
bun install && bun run db:migrate && bun run dev
```

Compose runs one-shot `migrate` and `minio-init` services before app/worker
start. Ports bind to `127.0.0.1` because **v1 has no auth** — do not expose it.

## Architecture

### Request lifecycle (the important part)

1. `POST /api/runs` → `createRunPlan` ([run-request.ts](apps/web/src/app/api/runs/run-request.ts))
   calls `classifyRunRequest` (the **deterministic mode classifier** in
   [mode-classifier.ts](packages/backend/src/mode-classifier.ts)) to pick a
   workflow, then maps it to a `.smithers/workflows/*.tsx` path and a Smithers
   input object.
2. The route writes a `tasks` row, seeds `task_rows` for table modes, writes a
   bootstrap artifact, then `launchSmithersDetached` spawns
   `bunx smithers-orchestrator up <workflow> --detach --run-id osf-<uuid>`.
3. Smithers runs CodexAgent(s) durably, persisting **its own** state to SQLite
   under `SMITHERS_STATE_DIR` (`data/smithers`). The workflow does **not** write
   to Postgres.
4. **Reconciliation is lazy / on-read**: `reconcileRunningTasks`
   ([run-service.ts](packages/backend/src/run-service.ts)) is invoked when a run
   is *read* (`GET /api/runs/[taskId]`, the SSE events route, the report page,
   the benchmark routes). It inspects the Smithers run, reads node outputs, and
   projects artifacts / source-bank / forecast attempts / aggregates / scores
   into Postgres. There is no background poller — nothing lands in Postgres until
   something reads the run.

### Layout

- **`apps/web`** — Next.js App Router. `src/app/api/**/route.ts` handlers are the
  real backend API; `src/components`, `src/lib`, `src/hooks` are the UI (polling
  + SSE, no server push). Route groups: `(workspace)` cockpit, `(report)`
  shareable reports.
- **`apps/worker`** — a thin Bun HTTP server exposing `/health` + `/codex-auth`
  (strict Codex checks). This is the container Compose runs as the `smithers`
  service; it is where CodexAgent workflows execute with mounted Codex auth.
- **`packages/backend`** — all service logic imported by the web routes:
  `run-service`, `benchmark-service` (large; benchmark suites, BTF-2 import,
  eval modes, promotion gates, comparison reports), `resolution-service`
  (product resolution + calibration), `mode-classifier`, `metrics-service`
  (Prometheus `/metrics`), `diagnostics-service`, `maintenance-service`,
  `smithers-launcher`, `trace-bundle`, `object-storage`.
- **`packages/workflows`** — Smithers workflow definitions (`*.workflow.tsx`)
  built from `CodexAgent` (see [agents.ts](packages/workflows/src/agents.ts)).
  **`.smithers/workflows/*.tsx` are thin re-export entrypoints** the Smithers
  CLI loads — edit the real logic in `packages/workflows/src`, not the
  re-exports.
- **`packages/db`** — Drizzle ORM. Schema is the single source of truth in
  [schema.ts](packages/db/src/schema.ts); migrations in `packages/db/migrations`
  (generated, not hand-edited). Postgres via `postgres-js`, `prepare: false`.
- **`packages/workflow-contracts`** — shared Zod schemas/enums that both the API
  and workflows agree on: operation modes, forecast types, task/artifact/trace
  enums. Start here to understand the domain vocabulary.
- **`packages/config`** — `loadAppConfig` parses+defaults all env via Zod and
  resolves data dirs relative to the detected project root.
- **`packages/artifact-store`**, **`packages/evals`**, **`packages/ui`** —
  supporting stores/helpers.

### Domain vocabulary

Operation modes: `forecast`, `multi_agent` (deep research), `agent_map`, `rank`,
`classify`, `merge`, `dedupe`, `benchmark_iteration`, `fixed_evidence_eval`,
`agentic_pastcasting_eval`. Forecast types: `binary`, `date`, `numeric`,
`categorical`, `thresholded`, `conditional`. Table modes cap input rows (50
string rows / 80 object rows).

### Data-store division of labor

- **Postgres** = product ledger, the source of truth for product-visible state.
- **MinIO** = large artifacts, trace bundles, export archives (with local file
  mirrors for host dev).
- **DuckDB** = read-only analytics mart, rebuilt from Postgres by `duckdb:sync`.
- **Smithers SQLite** (`data/smithers`) = durable orchestration state; protected
  from reset/cleanup scripts.

## Conventions & gotchas

- **`apps/web` runs a modified Next.js (16.x) with breaking changes.** Per
  [apps/web/AGENTS.md](apps/web/AGENTS.md), read the relevant guide in
  `node_modules/next/dist/docs/` before writing Next.js code — training-data
  conventions may be wrong.
- Cross-package imports use the `@open-superforecaster/*` aliases (mapped in
  [tsconfig.base.json](tsconfig.base.json)); app-internal imports use `@/*`.
  Packages export through `src/index.ts`.
- Typecheck runs against `tsconfig.check.json` (covers `apps`, `packages`,
  `scripts`, excludes generated migrations) — `bun run check` is the gate.
- **CodexAgent workflows need a Codex subscription.** `CODEX_HOME` (default
  `~/.codex`) is mounted only into the `smithers` service; `CODEX_MODEL`
  defaults to `gpt-5.5`. Without valid auth, real workflow runs fail — which is
  why most smoke suites are infrastructure checks rather than agent runs.
- After changing `packages/db/src/schema.ts`, run `db:generate` then
  `db:migrate`; never edit files in `packages/db/migrations` by hand.
