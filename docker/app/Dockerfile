FROM oven/bun:1.3.14

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git nodejs ripgrep \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

ARG CODEX_CLI_VERSION=0.143.0
ARG CLAUDE_CLI_VERSION=2.1.205

RUN bun install \
  && bun add --global @openai/codex@${CODEX_CLI_VERSION} @anthropic-ai/claude-code@${CLAUDE_CLI_VERSION}

EXPOSE 3000 3010
