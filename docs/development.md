# Development and Repository Hygiene

The root README documents first-run setup. This page defines the boundary
between source, generated state, and the commands used to validate changes.

## Source and Runtime Boundaries

Commit application code and configuration from `apps/`, `packages/`, `scripts/`,
`docker/`, `docs/`, and `examples/`. The checked-in files under
`.smithers/workflows/` are small workflow entrypoints and are source too.
`data/screenshots/` is tracked documentation and marketing media, not runtime
state.

Local execution state is not source. The ignored runtime subdirectories under
`data/` include Postgres, MinIO, DuckDB, Smithers state, artifacts, exports,
evals, forecast operations, resolutions, reports, and agent auth. Executions
under `.smithers/executions/`, generated `*.log` files, and `smithers.db*` are
runtime state too. Framework output such as `.next/`, `.astro/`, `dist/`, and
`coverage/` is also generated. Docker excludes those paths, local env files, and
auth data while retaining `.env.example` and `.env.host.example`.

An ignored file can still contain the only local copy of a trace, benchmark,
export, or credential. A clean Git status does not mean ignored state is safe to
delete.

## Validation

Install exactly what the lockfile records, then run the repository gate and the
Compose-specific onboarding check:

```bash
bun install --frozen-lockfile
bun run check
bun run onboarding:check
```

`bun run check` combines the repository typecheck, web lint, Bun tests, the
58-check forecast contract suite, and production builds for both the web and
marketing apps. Run its component scripts directly only when narrowing a local
failure.

`bun run onboarding:check` also normalizes the Compose configuration and verifies
that the web port stays on `127.0.0.1` by default while honoring an explicit
`OSF_WEB_BIND_ADDRESS=0.0.0.0` request.

## Browser Logs in the Server Console

The web app installs client instrumentation before React hydration. Calls to
`console.debug`, `console.info`, `console.log`, `console.warn`,
`console.error`, and `console.trace`, plus uncaught browser errors and unhandled
promise rejections, are batched to `/api/browser-logs`. The API writes each
entry to the Next.js server console as one JSON line prefixed with
`[browser-console]`.

In the Compose stack, an agent can inspect recent browser output without access
to the browser UI:

```bash
docker compose logs app | rg '\[browser-console\]'
```

Forwarding is bounded, truncates oversized values, handles circular objects,
and redacts credential-shaped object fields. It never reports transport errors
through the patched console, which prevents a failed forwarding request from
creating a logging loop.

## Clean, Cleanup, and Reset Are Different

- `bun run clean` removes only `apps/web/.next`.
- `bun run cleanup-local -- --task <id>` previews deletion of one task's
  projected Postgres rows. Artifact and benchmark-run targets are also
  supported. The command requires its printed confirmation token before it
  deletes anything and never deletes Smithers SQLite state.
- `bun run reset-local -- --dry-run` previews removal of local artifacts, evals,
  exports, DuckDB, and MinIO state. A confirmed reset still preserves Smithers
  and Postgres state unless their explicit include flags are supplied.

None of these commands removes every ignored build, log, report, execution, or
database file. Stop the Compose stack before resetting bind-mounted data, and
review the dry-run output and file ownership first. Container-created Postgres
or MinIO files may not be writable by the host user.

Treat confirmation tokens, manual `rm`, and `git clean -x` as destructive
operations. Before using them, decide which local evidence must be exported or
retained and confirm the exact paths being removed.
