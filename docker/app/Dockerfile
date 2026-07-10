FROM oven/bun:1.3.14

ARG CODEX_CLI_VERSION=0.143.0
ARG CLAUDE_CLI_VERSION=2.1.205

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git nodejs ripgrep \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests first so source-only changes reuse the install
# layer. Keep this list aligned with the workspaces in the root package.json.
COPY package.json bun.lock ./
COPY apps/marketing/package.json ./apps/marketing/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/artifact-store/package.json ./packages/artifact-store/package.json
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/evals/package.json ./packages/evals/package.json
COPY packages/workflow-contracts/package.json ./packages/workflow-contracts/package.json
COPY packages/workflows/package.json ./packages/workflows/package.json

RUN bun install --frozen-lockfile \
  && bun add --global @openai/codex@${CODEX_CLI_VERSION} @anthropic-ai/claude-code@${CLAUDE_CLI_VERSION}

COPY . .

EXPOSE 3000 3010
