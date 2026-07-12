# Live run updates

## Why the old system looked stuck

The original SSE endpoint watched `trace_events` in Postgres. A launch inserted
`trace_start`, but ordinary Smithers node, heartbeat, and agent-action events
were never projected into that table. Most remaining trace rows appeared only
while the final ledger was materialized. The browser was correctly connected
to SSE but received no meaningful events for several minutes, so `0%` and
`0 attempts` were technically consistent with Postgres and operationally
misleading.

The live path now reads the execution source that actually changes during the
run. Postgres remains authoritative for completed product artifacts rather than
being overloaded with high-frequency heartbeat rows.

## Trust contract

The run workspace must distinguish three independent facts:

1. **Transport connectivity** — the browser has an open SSE connection.
2. **Execution liveness** — Smithers is still producing durable events or heartbeats.
3. **Product state** — the task and forecast ledger have been reconciled into Postgres.

None implies either of the others. In particular, an open SSE connection is not proof that a forecast agent is working, and `RunFinished` is not a completed product forecast until the ledger commit succeeds.

## Data flow

```text
Smithers workflow
  └─ appends .smithers/executions/<run-id>/logs/stream.ndjson
       └─ readSmithersLiveSnapshot (1-second cached projection)
            └─ SSE event: activity (full resumable snapshot)
                 └─ useRunWorkspace
                      └─ LiveRunActivityPanel and supporting workspace panels

Smithers inspect/output
  └─ reconcileRunningTasks (single-flight, 2-second loop)
       └─ Postgres task, forecast ledger, durable product trace
            └─ SSE events: status, trace, done
```

Live activity and product reconciliation use separate loops. A slow Smithers CLI inspection cannot delay liveness feedback.

## Live snapshot contract

`SmithersLiveSnapshot` v2 is a sanitized, versioned projection of Smithers'
append-only stream. It contains:

- run status and stream cursor;
- start and most-recent activity timestamps;
- honest node counts and completion percentage;
- cumulative token usage for every recorded model call, split into input,
  output, and provider-reported total tokens;
- current state for each named workflow node;
- the latest safe activity labels and web-search queries.

The projection deliberately excludes model thoughts, raw commands, model output, credentials, and arbitrary provider messages. The full snapshot is sent when its cursor changes, so refresh and reconnect recovery do not depend on replaying every transient SSE message.

Token usage is reconstructed from the same durable stream. Reports are keyed by
run, node, iteration, and attempt, then the highest-fidelity report is retained
when Smithers emits the same call in more than one event format. This includes
model-backed researchers and orchestration nodes, including retries. Purely
deterministic orchestration does not consume tokens and therefore has no usage
event to count.

## Progress semantics

Progress is derived from observed Smithers nodes:

```text
(completed nodes + failed nodes) / all observed nodes
```

It is not a time estimate. The total can grow when dynamic workflow nodes are introduced. The UI names active, pending, completed, and failed nodes so the percentage never stands alone.

## Frontend behavior

The workspace provides feedback in layers:

- header badges show `Live feed`, active worker count, and product task status;
- the compact stream card shows execution progress and latest activity;
- `Live execution` shows node state, last heartbeat age, and recent verified actions;
- decision, research, and researcher panels consume the same snapshot;
- refresh reconstructs the current snapshot from the durable log;
- terminal `done` reloads the committed product data and closes SSE.

Motion is limited to a liveness pulse and active-node spinner. Both use `motion-safe` variants and disappear under reduced-motion preferences.

## Extending the system

To expose a new Smithers event safely:

1. Add an explicit mapping in `packages/backend/src/smithers-live-events.ts`.
2. Project only user-safe fields; never forward the raw event object.
3. Add parser tests for the new event and malformed/truncated input.
4. Extend the versioned frontend parser if the snapshot shape changes.
5. Exercise launch, mid-run, refresh/reconnect, and completion in Playwright.

Do not add workflow-specific filesystem readers to React components or API routes. The backend projector is the sole translation boundary.

## Deployment and failure behavior

- The app process serving SSE must see the same `.smithers/executions` volume as
  the process launching workflows. This is already true for the local Compose
  topology.
- Snapshot reads are cached by file size and modification time and shared by
  tabs in one app process. The cache is bounded to 100 runs.
- A missing log is treated as a normal startup state; the UI says that it is
  waiting for the first execution event.
- A later read error emits `activity_error` without destroying the independent
  status channel.
- If heartbeats stop for 30 seconds while a task remains running, the UI stops
  animating the worker and explicitly says the heartbeat is stale.
- SSE cancellation and terminal closure clear both timers and close the
  request-scoped database connection.
