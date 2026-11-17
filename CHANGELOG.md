# Changelog

## Unreleased: UI v2 (ADR-0016)

A note app first, with agents inside it.

- Notes: "From text" turns pasted text into an empty outline of headings and questions for you to answer in your own words, and there is a Cornell-style note template.
- Study: download your cards as text for Anki, and import cards from an Anki plain-text export (no review history).
- Study: recall checks (ADR-0020). Write what you remember of a note, an agent shows what you covered and missed from the note itself, and the note comes back after 1, 3, 7 and 21 days.
- Study: exam dates (ADR-0019) for a note or a tag. Reviews are paced to land before the day and the retention target rises in the last weeks. Today shows where the nearest one stands.
- Study: card hints (long answer, a list, yes or no, several blanks, front not a question) when the card maker proposes cards, and a prompt on cards you have forgotten six times.
- Notes: a calendar for daily notes with marks for days that have a note and days you studied.
- Study: a quiet 14-day strip of how many cards you answered each day (plain counts, no streaks).
- Responsive layout: labelled navigation on wide screens, icon rail in the middle, drawer and slide-over list on narrow screens; the top strip is a search field.
- Note list: filter box with full-text hits, snippets, relative times, tag chips (frontmatter and inline `#tags`), pins (stored by the server, outside the note files) and a sort menu.
- Writing: formatting shortcuts, floating selection toolbar, `/` menu for blocks, tables, callouts, dividers, tag pills, inline-editable title, word count.
- Agents in the note: provenance bar with undo, agent activity per note, pending approvals shown on the note, and Ask an agent (Cmd/Ctrl J) which opens a chat with the selection filled in.
- Today view of what agents did since you last looked, and Appearance settings (theme, text size).
- Study: write `Question :: Answer` or `{{hidden}}` cards in any note; a Study page with spaced review (FSRS), reveal-then-rate keys, and a calm end screen; a Card maker agent (no tools) that proposes cards you review before they are saved; warmer colors and kinder wording.
- Chat: answers stream token by token; long chats send only recent turns to the model.
- Fixes: delete confirmation keeps keyboard focus; the graph page no longer renders with zero height when there is no banner.

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
