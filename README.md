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

## Getting Started

### Prerequisites

- Docker Compose
- A Codex subscription, with local auth available under `${HOME}/.codex`
- Bun only if you want to run the web app directly on the host

### Start the Full Local Stack

```bash
cp .env.example .env
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000), ask a forecast, and inspect
the run from the sidebar.

The app binds to `127.0.0.1` by default because this local v1 does not include
user auth. To test from another machine on your LAN, set this in `.env` first:

```bash
OSF_WEB_BIND_ADDRESS=0.0.0.0
```

Then restart Compose and open `http://<host-lan-ip>:3000`. Do not expose it
publicly without adding authentication.

### Check Your Setup

After the stack is running, use the built-in onboarding check:

```bash
bun run onboarding:check
```

For a broader local smoke check:

```bash
bun run smoke:local
```

### Try Example Runs

Seed requests and CSVs live in [`examples/`](examples/). For example:

```bash
curl -X POST http://localhost:3000/api/runs \
  -H 'content-type: application/json' \
  -d @examples/request-binary-forecast.json
```

You can also plan sample workflows without launching agent work:

```bash
bun run workflow:samples
```

### Host Development

For direct host development, keep the backing services in Docker and run the web
app with Bun:

```bash
cp .env.host.example .env
docker compose up -d postgres redis minio minio-init otel-collector prometheus tempo grafana
bun install
bun run db:migrate
bun run dev
```

## More Detail

- Development history: [`DEVELOPMENT_LOG.md`](DEVELOPMENT_LOG.md)
- Example inputs: [`examples/`](examples/)
- Postgres container notes: [`docker/postgres/README.md`](docker/postgres/README.md)
