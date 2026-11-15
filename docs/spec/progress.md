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

- [ ] WP12-T1: Browser login (ADR-0007 follow-through)
- [ ] WP12-T2: One process serves the web app
- [ ] WP12-T3: Dev story stays working
- [ ] WP12-T4: Docker
- [ ] WP12-T5: PWA
- [ ] WP12-T6: README and the demo
- [ ] WP12-T7: CI
- [ ] WP12-T8: Release hygiene

## WP13: after v1 (ordered backlog, do not start before the release)


## Release

- [ ] Release checklist (implementation-plan.md section 10) all ticked
- [ ] `docs/spec/roadmap.md` marks M0 to M6 done with dates

