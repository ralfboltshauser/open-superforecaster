# Agent Providers and Auth Profiles

Open Superforecaster uses Smithers CLI agents through `packages/workflows/src/agents.ts`.
Workflows ask for an agent by purpose, and the provider policy decides whether
that purpose uses Codex, Claude Code, Pi, Kimi, or another Smithers-supported
CLI.

## Provider Policy

Configure the policy in `.env`:

```bash
AGENT_AUTH_ROOT=./data/agent-auth
AGENT_DEFAULT=codex:default
AGENT_STRUCTURED=codex:default
AGENT_RESEARCH=codex:default,claude:default
AGENT_FORECAST=codex:default,claude:default,pi:default
AGENT_CRITIC=claude:default,codex:default
AGENT_ALLOW_NATIVE_WEB=false
```

Each value is `provider:profile`. The provider must be one Smithers knows:

```text
amp, antigravity, claude, codex, forge, gemini, hermes, kimi, opencode, openclaw, pi, vibe
```

Codex remains the default because the quickstart assumes a Codex subscription.
Add other providers only after their CLI and auth profile work locally.

## Auth Root Layout

Use one mounted auth root with provider-specific subdirectories:

```text
data/agent-auth/
  codex/default/      # CODEX_HOME
  claude/default/     # CLAUDE_CONFIG_DIR
  kimi/default/       # KIMI_SHARE_DIR
  pi/default/         # PI sessions/config
```

Do not flatten these into one shared home directory. Each CLI expects a
different file layout.

## Host Setup

Create an isolated Codex profile:

```bash
mkdir -p ./data/agent-auth/codex/default
CODEX_HOME="$PWD/data/agent-auth/codex/default" codex login
```

Or copy an existing Codex login:

```bash
mkdir -p ./data/agent-auth/codex/default
cp "$HOME/.codex/auth.json" ./data/agent-auth/codex/default/auth.json
chmod 600 ./data/agent-auth/codex/default/auth.json
```

Create an isolated Claude Code profile:

```bash
mkdir -p ./data/agent-auth/claude/default
CLAUDE_CONFIG_DIR="$PWD/data/agent-auth/claude/default" claude
```

Inside Claude Code, complete `/login`, then exit.

Or copy an existing Claude Code login:

```bash
mkdir -p ./data/agent-auth/claude/default
cp "$HOME/.claude/.credentials.json" ./data/agent-auth/claude/default/.credentials.json
chmod 600 ./data/agent-auth/claude/default/.credentials.json
```

For direct host development, copy the host env file and run the app:

```bash
cp .env.host.example .env
bun install
bun run dev
```

To opt into Claude for research and critic tasks, edit `.env`:

```bash
AGENT_RESEARCH=codex:default,claude:default
AGENT_CRITIC=claude:default,codex:default
CLAUDE_CONFIG_DIR=./data/agent-auth/claude/default
```

## Docker Setup

For Compose, copy the Docker env file:

```bash
cp .env.example .env
```

Create or copy auth profiles under `./data/agent-auth`:

```bash
mkdir -p ./data/agent-auth/codex/default
cp "$HOME/.codex/auth.json" ./data/agent-auth/codex/default/auth.json
```

For Claude, either run the isolated host login above or copy the existing
credentials file:

```bash
mkdir -p ./data/agent-auth/claude/default
cp "$HOME/.claude/.credentials.json" ./data/agent-auth/claude/default/.credentials.json
```

Compose mounts the whole auth root:

```yaml
${AGENT_AUTH_HOST_ROOT:-./data/agent-auth}:${AGENT_AUTH_CONTAINER_ROOT:-/agent-auth}
```

Inside the container the default paths are:

```bash
AGENT_AUTH_ROOT=/agent-auth
CODEX_HOME=/agent-auth/codex/default
CLAUDE_CONFIG_DIR=/agent-auth/claude/default
```

Start the stack:

```bash
docker compose up --build
```

## Verify

Check static setup assumptions:

```bash
bun run onboarding:check
```

Check the active provider policy and auth directories:

```bash
curl http://localhost:3000/api/health
```

Open the setup page:

```text
http://localhost:3000/setup
```

The selected provider profiles should show both a CLI binary and an auth
directory. If a provider is missing, keep it out of the `AGENT_*` policy until
the CLI and profile are installed.

## Native Web Search

Keep `AGENT_ALLOW_NATIVE_WEB=false` by default. If an agent uses provider-native
web search, those sources are outside the deterministic evidence ledger. Turn it
on only for live exploratory runs, and keep it off for fixed-evidence and
pastcasting evaluation.
