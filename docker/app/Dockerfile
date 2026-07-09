FROM oven/bun:1.3.14

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git nodejs ripgrep \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

ARG CODEX_CLI_VERSION=0.143.0
ARG CLAUDE_CLI_VERSION=2.1.205

# Install both engine CLIs so a mixed team can pick via AGENT_ENGINE at runtime:
#   - Codex CLI  (AGENT_ENGINE=codex, the default)
#   - Claude Code CLI (AGENT_ENGINE=claude), authenticated at runtime by a
#     CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or a mounted
#     ~/.claude/.credentials.json — see docker-compose.yml.
RUN bun install \
  && bun add --global @openai/codex@${CODEX_CLI_VERSION} @anthropic-ai/claude-code@${CLAUDE_CLI_VERSION} \
  && claude --version

EXPOSE 3000 3010
