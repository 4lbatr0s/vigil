# Vigil

A self-hosted notes app where your AI agents keep vigil — reading, writing, and running on schedules.

- Markdown files are the source of truth. SQLite is a disposable index.
- Agents (chat, cron, heartbeat) are first-class citizens.
- BYOK: any OpenAI-compatible endpoint + Ollama.

AGPL-3.0. Work in progress.

## Prerequisites

- Node 24
- pnpm 11 (`corepack enable` provides pnpm)

## Install

```
pnpm install
```

## Run

Two dev processes. The API first:

```
pnpm --filter @vigil/server dev   # API on http://127.0.0.1:3001
```

Then the UI:

```
pnpm --filter @vigil/web dev      # UI on http://localhost:5173, proxies /api
```

## Configure

The full variable list, with comments, is in `.env.example`. The server reads the environment directly, so set variables in your shell:

```
VIGIL_LLM_PROVIDER=ollama VIGIL_LLM_MODEL=llama3.1 pnpm --filter @vigil/server dev
```

`VIGIL_LLM_PROVIDER=openai` works with any OpenAI-compatible endpoint via `VIGIL_LLM_BASE_URL`; add `VIGIL_LLM_API_KEY` when the endpoint needs one.

## Safety

- Agents write into your vault. Every agent write is snapshotted before it happens, and each snapshot is one-click undoable.
- The server is local-only by default: it binds 127.0.0.1, sends no CORS headers, and checks the Host and Origin headers (ADR-0007). A non-loopback bind requires `VIGIL_TOKEN`.
