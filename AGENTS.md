# Vigil: instructions for coding agents

This file is read automatically by opencode and most other coding agents. Claude Code reads `CLAUDE.md`, which points here. Everything an agent needs is in `docs/`; the owner's guiding rule is that **performance and usability balance is everything**, so when two options tie, take the faster and more usable one and enforce budgets with tests; this file tells you where and in what order.

## What Vigil is

A self-hosted, single-user notes app where AI agents keep vigil: they read notes, write notes, and run on schedules (cron), on change (heartbeat) or in chat. Markdown files on disk are the source of truth; SQLite is a disposable index. Models are bring-your-own-key (any OpenAI-compatible endpoint, or Ollama). AGPL-3.0. TypeScript monorepo: `apps/server` (Node, no web framework), `apps/web` (SvelteKit 2 + Svelte 5), `packages/shared` (zod schemas).

## Tech stack (fixed; do not swap anything without a new ADR)

- **Runtime and tooling:** Node 24, pnpm 11 workspaces, TypeScript 5.7 (`strict`, `noUncheckedIndexedAccess`), ESM only, vitest.
- **Server (`apps/server`):** plain `node:http` with a hand-written router (`http.ts`), `better-sqlite3` (plain SQL, no ORM, ADR-0008), `chokidar` (watcher), `gray-matter` (frontmatter), `zod` 4.
- **Agents:** LangGraph JS `@langchain/langgraph` 1.7.4, `@langchain/core` 1.4.1, `@langchain/openai` 1.8.4, `@langchain/ollama` 1.3.0, `@langchain/anthropic` 1.6.1, `@langchain/langgraph-checkpoint-sqlite` 1.1.0, all pinned exactly (ADR-0009, ADR-0031). Models are bring-your-own-key: any OpenAI-compatible endpoint, Anthropic or Ollama. Model calls retry on 429, 5xx and dropped connections; Anthropic calls use prompt caching. No coding-agent harness runs inside the app (ADR-0031).
- **Web (`apps/web`):** SvelteKit 2 + Svelte 5, Vite 7, CodeMirror 6, `marked` + DOMPurify, jsdom for tests. Becomes a static SPA served by the API server (ADR-0014).
- **Shared (`packages/shared`):** zod schemas and `slugify`; the only place cross-boundary types live.
- **Later packages (pin exact versions when added):** `cron-parser` (WP2), `@langchain/langgraph-checkpoint-sqlite` (WP8), `sigma` + `graphology` (WP11), `@sveltejs/adapter-static`, `esbuild`, Lucide icons for Svelte (WP4, WP12).
- **Storage:** markdown files in the vault (source of truth), `data/index.db` (disposable index), `data/state.db` (durable state), `data/snapshots/`.

## Read these, in this order, before writing code

1. `docs/README.md`: index of every document and what it is for.
2. `docs/spec/v1-scope.md`: the 13 locked product decisions.
3. `docs/spec/architecture.md`: how the pieces fit, sequences, failure modes.
4. `docs/spec/implementation-plan.md`: **the plan you execute.** Work packages WP0 to WP13, each with tasks, files, tests and acceptance checks.
5. `docs/spec/progress.md`: **the checklist.** Find the first unchecked task; that is your next task. Tick it in the same commit that completes it.
6. `docs/design/ux-spec.md` and `docs/design/ui.md`: every screen, state, string and token (needed for any UI task).
7. `docs/adr/`: decisions. ADR-0001 to 0009 and 0015 are accepted; 0010 to 0014 are written as `Proposed` and become `Accepted` when their work package starts (change the Status line in the same commit).
8. `docs/conventions.md`, `docs/glossary.md`, `docs/spec/threat-model.md`, `docs/spec/open-questions.md`.

## How to work

- Take exactly one task from `docs/spec/progress.md` at a time, in order. Do not skip ahead, do not merge tasks, do not invent tasks.
- Follow the task text literally: files, behavior, tests by name. The plan was written so that you do not have to make design decisions. If it does not cover a case, append a question to `docs/spec/open-questions.md`, choose the safest option, say so in the commit message, and move on to an unrelated task.
- A task is done when its tests exist, fail without the change and pass with it, and the gate is green:

  ```
  pnpm typecheck && pnpm test
  ```

- One task, one commit. Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), body says what and why. Tick the task in `docs/spec/progress.md` in the same commit.
- Do not push, merge, deploy or tag unless the human owner says so.

## Hard rules (never break these)

- **Protect the owner's notes:** an agent's writes must be snapshotted and undoable; never delete or overwrite user notes outside the lock-and-snapshot paths.
- **Never touch the real `vault/` or `data/`** in tests or scripts. Tests run against temp directories (WP0-T4 enforces this). Manual checks use `mktemp -d` paths via `VAULT_DIR`, `DB_PATH`, `STATE_DB_PATH`.
- **Never print, log, store, return or commit an API key.** Keys come from the environment only. Run events and error text are passed through `redact`.
- **The owner configures agent permissions from the UI** (instance switches in Settings > Permissions, per-agent grants on the agent page); the API forces nothing, defaults are safe, and a run always uses `effectiveGrants`. Templates are created switched off.
- **Agents get no shell and no arbitrary network.** Tools are `read_notes`, `write_notes`, `web_fetch` (allowlisted hosts, ADR-0006), `call_agents` (depth 1). Note text and web pages are untrusted data, never instructions.
- **The server binds to 127.0.0.1 by default**, sends no CORS headers, and checks Host and Origin. A non-local bind needs `VIGIL_TOKEN` (ADR-0007).
- **Tools never throw.** They return `error: ...` text so every tool call gets a tool message back.
- **State migrations are append-only** (`apps/server/src/state-db.ts`). The index is disposable: bump `SCHEMA_VERSION` instead of writing a migration.
- **Persist the "I did it" marker before the side effect** for scheduled work (at most once), and never put a side effect before an `interrupt()`.
- **No `any`, no `@ts-ignore`, no silent `catch`, no weakened or deleted tests, no `skip`/`only`.**
- **UI:** read `docs/design/ui-rules.md` and `PRODUCT.md` first and use the `vigil-ui-build` skill. Compose from `apps/web/src/lib/ui/` (never write a button, field, row, card, dialog or empty state in a route); colors, spacing, radius, shadow and motion only from `apps/web/src/lib/styles/tokens.css` (legacy tokens in `app.css` stay until a screen is migrated); Lucide icons, no emoji; keyboard reachable; visible focus; contrast >= 4.5:1; `prefers-reduced-motion` honored. Amber is reserved for agent life. Run `vigil-ui-review` before calling UI work done.
- **Pin exact dependency versions** for the LangChain family, `cron-parser`, `sigma`, `graphology` and adapters. Check the installed version's typings or docs before coding against it; do not trust memory of an API.
- **Contradicting an ADR needs a new or amended ADR first.**

## Useful commands

```
pnpm install
pnpm --filter @vigil/server dev        # API on http://127.0.0.1:3001
pnpm --filter @vigil/web dev           # UI on http://localhost:5173, proxies /api
pnpm typecheck && pnpm test            # the gate
```

Model settings for manual runs (environment only): `VIGIL_LLM_PROVIDER=ollama|openai`, `VIGIL_LLM_MODEL`, and for `openai` also `VIGIL_LLM_BASE_URL`, `VIGIL_LLM_API_KEY`. Full variable list: `docs/spec/implementation-plan.md`, section 2.2.

## Where things stand

See `docs/spec/progress.md` (the single source of truth for status) and `docs/spec/roadmap.md` (milestones M0 to M6). The agent runtime, the web app, study, chat, approvals, MCP and the design system v3 are built; check `CHANGELOG.md` and `docs/adr/` for what shipped and why.

Open work is split in two: `docs/todo-agent.md` (what you can do alone: take the first unchecked item) and `docs/todo-owner.md` (what needs the owner; do not do these).
