# Vigil Roadmap (v1)

Order of work for the scope frozen in `v1-scope.md`. Agents are the product (ADR-0002), so the first demo is an agent writing a note, not a prettier editor. A milestone is done when its acceptance command passes, not when it feels finished.

Run from the repo root unless noted. `CHECK` means: `pnpm typecheck && pnpm test && pnpm --filter @vigil/web check`.

## M0: Notes foundation (done)
Vault store, SQLite index, watcher, notes API, search, editor UI, markdown preview, local-only access (ADR-0007).
Acceptance: `CHECK` passes; `pnpm --filter @vigil/server dev` then `curl -s localhost:3001/api/health`.

## M1: One agent, run by hand (done 2026-11-14, server only; ADR-0009)
- `@vigil/shared`: `Agent` and `Run` zod schemas (name, system prompt, tool allowlist, trigger, token budget).
- Provider adapter: OpenAI-compatible base URL + key, native Ollama (ADR-0003). Keys come from env.
- Tools: `read_notes`, `write_note` (author = agent, snapshot first). No web fetch yet.
- Run log table and API: prompt, tool calls, outputs, token spend. Per-run token budget stops the run.
- Snapshots: `data/snapshots/<note-id>/<timestamp>.md`, plus an undo endpoint.
Acceptance: `pnpm --filter @vigil/server test` includes a fake-provider run that reads a note, writes a digest note, leaves a snapshot and a run log row; and `curl -X POST localhost:3001/api/agents/morning-digest/run` against a real or Ollama model writes a note.

## M2: Scheduled agents and the Morning Digest demo
- `node-cron` in the server process. Agent trigger `cron: "0 7 * * *"`.
- **Catch-up rule:** store `last_run_at` per agent. On start, if a scheduled run was missed (the previous cron tick is later than `last_run_at`), run once, not once per missed tick. Runs never overlap: a running agent skips its next tick and logs it.
- Agents UI: ledger rows (ui.md), run log view, lantern flicker when a run lands a note.
- One-click template: Morning Digest.
Acceptance: test with an injected clock proves the 07:00 run, the catch-up run after downtime, and the skip while running; README leads with a recording of the digest.

## M3: Heartbeat and chat
- **Change signal for heartbeats:** hash of the sorted `(note id, content hash)` list the agent may read. The index stores a content hash per note. A heartbeat run fires only when the hash differs from its last run; unchanged means no model call and a `skipped: unchanged` log line.
- Chat archetype: streaming conversation with tools, saved as a note.
- `call_agent`: depth 1, shared budget, all calls in the run log.
- Strict mode: approve-before-write queue.
Acceptance: tests for unchanged-skip, changed-run, depth limit, and strict-mode queue.

## M4: Web fetch (ADR-0006)
- Per-agent domain allowlist, address blocking, redirect re-checks, size and time caps.
Acceptance: tests for blocked private/metadata/IPv6-mapped addresses, a redirect to a blocked host, and an empty allowlist.

## M5: Graph
- `/api/graph`: notes, links (including links to notes that do not exist yet), agent edges.
- Sigma.js view per ui.md: amber glow by recency, dashed agent edges.
Acceptance: API test for nodes and edges; the view renders the demo vault.

## M6: Ship it
- Login screen with HttpOnly cookie for non-local installs (ADR-0007), one Docker image, one volume, PWA manifest, README with the demo.
Acceptance: `docker build` and `docker run -v vault:/vault` serve the UI; `curl` without a token returns 401.

## Parked until M2 is shown
Subfolders in the vault (ids are flat today), `tags` UI, command palette depth, soft monthly cost cap.

## How to run an agent today (M1)
Set the model (env only, never in notes): `VIGIL_LLM_PROVIDER=ollama|openai`, `VIGIL_LLM_MODEL`, and for `openai` also `VIGIL_LLM_BASE_URL` and `VIGIL_LLM_API_KEY`. Then:
`PUT /api/agents/<name>` (name, systemPrompt, tools: read_notes/write_notes, tokenBudget), `POST /api/agents/<name>/run`, `GET /api/runs/<id>` (log), `POST /api/runs/<id>/undo`.
Run state lives in `data/state.db`; pre-write copies in `data/snapshots/`. There is no agents screen until M2.
