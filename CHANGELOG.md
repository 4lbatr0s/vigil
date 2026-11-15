# Changelog

## 1.0.0

First release. Built in milestones; each one is a working product on its own.

### M6: ship it
- Browser login with a signed HttpOnly cookie; sessions bound to the access token; per-address and global limits on failed logins.
- One process serves the API and the web app (static single-page app, strict Content-Security-Policy).
- Docker image (non-root, health check, one `/data` volume), esbuild server bundle run with plain `node`, `docs/deploy.md`.
- Installable app (manifest, icons) with an offline shell that never caches the API.
- CI: typecheck, tests, bundle budget, bundle smoke test, Docker run checks.

### M5: graph
- Notes and agents as a graph (Sigma): amber glow for recent notes, dashed agent read/write edges, ghost nodes for unwritten links, list view fallback.

### M4: web fetch
- `fetch_url` tool: exact-host allowlist, public addresses only (checked and pinned against DNS rebinding), re-checked on every redirect, size, time and content-type limits, every address logged.

### M3: heartbeat, call_agent, strict mode, chat
- Heartbeat agents run only when notes they can read changed, never on their own writes.
- `call_agent`: one level deep, inside the parent's budget, undone together with the parent.
- Strict mode: writes wait in an approvals queue with a diff; paused runs survive restarts; stale writes are flagged.
- Chat with any agent: persisted, cancellable, saved as a note on request.

### M2: scheduled agents and the Morning Digest
- Cron agents with catch-up after downtime and at-most-once firing.
- Templates (created switched off), run viewer with live log and undo, command palette, usage warning level, permissions page, retention.
- Live-preview markdown editor, wikilink completion, backlinks, rename with link rewriting, delete.

### M1: one agent, run by hand
- LangGraph agent runtime with read and write tools, a token budget that fails closed, a step limit, a run log, snapshots and one-click undo.

### M0: notes
- Markdown vault, disposable SQLite index with full-text search, file watcher, local-only API, editor.
