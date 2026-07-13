# Claude Code Guidance

Read and follow [`AGENTS.md`](AGENTS.md) before changing this repository. It is
the shared source of repository instructions for every coding agent.

Use Bun for package management and scripts. The current validation contract is:

```bash
bun run typecheck
bun test
bun run forecast:scripts:check
bun run --cwd apps/web lint
bun run build
git diff --check
```

Before changing forecasting architecture, evidence collection, aggregation,
calibration, live updating, benchmark evaluation, or promotion policy, read
both canonical documents completely:

- [`docs/agentic-superforecasting.md`](docs/agentic-superforecasting.md)
- [`docs/agentic-superforecasting-implementation.md`](docs/agentic-superforecasting-implementation.md)

Claude Code is supported through the unified provider policy. Configure
`claude:<profile>` in `AGENT_DEFAULT` or the purpose-specific `AGENT_*`
variables and keep credentials under `AGENT_AUTH_ROOT`; see
[`docs/agent-providers.md`](docs/agent-providers.md). The older
`AGENT_ENGINE=claude` and `CLAUDE_WEB_SEARCH=on` switches remain compatibility
aliases when their unified replacements are absent.
