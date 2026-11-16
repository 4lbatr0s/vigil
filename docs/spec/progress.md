# Vigil progress tracker

The single source of truth for status. Tick a box in the same commit that completes the task (tests written and passing, gate green, docs updated). Work top to bottom; do not start a work package before the ones above it are finished (dependencies are in `implementation-plan.md`). Tasks are named exactly as in the plan: open `implementation-plan.md` and search for the ID.

Legend: `[x]` done, `[ ]` not done. Add a short note after a task only for a deviation (and mirror it in `open-questions.md`).

## Already built (before this tracker)

- [x] M0 notes foundation: vault, index, watcher, notes API, editor, local-only access (ADR-0007)
- [x] M1 agent runtime, server only: LangGraph graph, tools, run log, snapshots, undo, adapters (ADR-0009)
- [x] Docs: spec, ADR-0001 to 0015, implementation plan, architecture, threat model, UX spec, open questions resolved (2026-11-15)


## WP0: Close M1 (finish and harden what exists)

- [x] WP0-T1: Tests for the lock, `dropSnapshot`, and null-write-time skip
- [x] WP0-T2: Graceful shutdown
- [x] WP0-T3: `.env.example` and README run section
- [x] WP0-T4: Make it impossible for a test to touch real data
- [x] WP0-T5: Docs

## WP1: Agent model v2 (schema changes everything later needs)

- [x] WP1-T1: New `AgentSchema`
- [x] WP1-T2: Migration 2 and 3 in `state-db.ts`
- [x] WP1-T3: Provenance: `agent` frontmatter and index column
- [x] WP1-T4: API validation

## WP2: M2 scheduled agents (cron with catch-up)

- [x] WP2-T1: ADR-0010 and dependency
- [x] WP2-T2: `scheduler.ts`
- [x] WP2-T3: Validation at the API
- [x] WP2-T4: Schedule visibility endpoint

## WP3: M2 templates and usage cap

- [x] WP3-T1: Template registry
- [x] WP3-T2: API
- [x] WP3-T3: Usage and soft monthly cap
- [x] WP3-T4: LLM status endpoint (onboarding support)
- [x] WP3-T5: Instance permission settings (the configuration page's backend)
- [x] WP3-T6: Retention housekeeping

## WP4: M2 web: agents screen, run viewer, command palette, usage banner

- [x] WP4-T1: App shell and routing
- [x] WP4-T2: Agents list ("ledger rows")
- [x] WP4-T3: Agent detail
- [x] WP4-T4: Run viewer
- [x] WP4-T5: Lantern flicker and provenance in the note list
- [x] WP4-T6: Command palette (⌘K)
- [x] WP4-T7: Settings and banners
- [x] WP4-T8: Notes list without bodies (performance)
- [x] WP4-T9: One live event stream instead of polling
- [x] WP4-T10: Performance budgets and code splitting
- [x] WP4-NF: Non-functional checks (svelte-check clean, keyboard pass, contrast test, no-raw-colors test, light theme tokens)

## WP5: Editor quality bar (live preview, wikilinks, backlinks)

- [x] WP5-T1: Live-preview decorations
- [x] WP5-T2: Wikilink autocomplete
- [x] WP5-T3: Backlinks API and panel
- [x] WP5-T4: Rename
- [x] WP5-T5: Delete with confirmation

## WP6: M3 heartbeat

- [x] WP6-T1: Change detection
- [x] WP6-T2: Scheduler integration
- [x] WP6-T3: Visibility

## WP7: M3 `call_agent` (bounded agent-to-agent)

- [x] WP7-T1: Tool and runtime plumbing
- [x] WP7-T2: Undo across a family
- [x] WP7-T3: Tests

## WP8: M3 strict mode and the approvals queue

- [x] WP8-T1: ADR-0011 and checkpointer
- [x] WP8-T2: Migration 5 and store
- [x] WP8-T3: Runner changes
- [x] WP8-T4: API
- [x] WP8-T5: Web
- [x] WP8-T6: Defaults and the owner's control
- [x] WP8-T7: Tests

## WP9: M3 chat

- [x] WP9-T1: Storage and routes
- [x] WP9-T2: Streaming turn
- [x] WP9-T3: Web
- [x] WP9-T4: Tests

## WP10: M4 `web_fetch` (ADR-0006 implemented to the letter)

- [x] WP10-T1: `safe-fetch.ts`
- [x] WP10-T2: The tool
- [x] WP10-T3: UI

## WP11: M5 graph

- [x] WP11-T1: Record touches
- [x] WP11-T2: `GET /api/graph`
- [x] WP11-T3: The view

## WP12: M6 ship it (login, single process, Docker, PWA, README, CI)

- [x] WP12-T1: Browser login (ADR-0007 follow-through)
- [x] WP12-T2: One process serves the web app
- [x] WP12-T3: Dev story stays working
- [x] WP12-T4: Docker
- [x] WP12-T5: PWA
- [x] WP12-T6: README and the demo
- [x] WP12-T7: CI
- [x] WP12-T8: Release hygiene

## WP13: after v1 (ordered backlog, do not start before the release)


## Release

- [x] `docs/spec/roadmap.md` marks M0 to M6 done with dates
- [x] v1.0.0 tagged (2026-11-15)
- [ ] Release checklist (implementation-plan.md section 10) all ticked: the items below are still open

### Open to-do list (after v1.0.0)

Owner:
- [ ] Name check: search npm, GitHub and trademark databases for "Vigil"; write the result in `docs/spec/open-questions.md`.
- [ ] Decide when to push release notes / announce.

To verify by hand (not yet done):
- [x] Keyboard-only pass over every page (focus ring, reachable controls, dialogs). *Done 2026-11-16: all focusable controls on /, /agents, /agents/[name], /approvals, /chat, /graph, /settings show a focus ring; palette traps focus and Escape returns it; found and fixed the inline delete confirm dropping focus to body (now focuses Keep, Escape cancels, focus returns to Delete).*
- [ ] README "Run it" commands on a clean machine or an empty directory and volume.
- [x] Permissions page: switch off web fetch, confirm a run no longer offers the tool; templates are created switched off. *Done 2026-11-16: saved from the UI, run's prompt event listed no fetch_url, then listed it after switching back; templates created disabled.*
- [x] Research Scout on a real model: allowed host works, a loopback URL is refused and logged. *Done 2026-11-16 (Ollama 4B): example.com fetched; http://127.0.0.1:3001/api/notes refused with 'port 3001 is not allowed' and logged.*
- [x] Heartbeat: observe live that an agent's own write does not trigger a second run. *Done 2026-11-16: 5-minute heartbeat agent ran once after a note changed (wrote `hb-out`), the next tick logged `skipped: unchanged`, still one run.*
- [x] Graph: force the no-WebGL path and confirm the automatic list fallback. *Done 2026-11-16: stubbed `getContext("webgl*")` to null and navigated client-side to /graph: notice "Showing a list because your browser can't draw the graph.", no canvas, list rendered.*
- [ ] Record the 20-second Morning Digest demo (under 5 MB) and put it at the top of the README.

Known gaps (from `docs/spec/open-questions.md`):
- [ ] True per-token chat streaming (needs `stream()` on the model adapters).
- [ ] Trim or summarise long chat history (each turn re-sends the whole conversation).
- [ ] Trim the editor chunk (about 240 KB gzip, loads lazily after the shell).
- [ ] Logout only clears the browser cookie; add a server-side session epoch if copied cookies matter.
- [ ] A botnet with 25+ addresses can make the owner wait at login while an attack lasts.
- [ ] WP13 backlog (post-v1) in `docs/spec/implementation-plan.md`.
