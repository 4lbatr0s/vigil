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
- [ ] WP0-T4: Make it impossible for a test to touch real data
- [ ] WP0-T5: Docs

## WP1: Agent model v2 (schema changes everything later needs)

- [ ] WP1-T1: New `AgentSchema`
- [ ] WP1-T2: Migration 2 and 3 in `state-db.ts`
- [ ] WP1-T3: Provenance: `agent` frontmatter and index column
- [ ] WP1-T4: API validation

## WP2: M2 scheduled agents (cron with catch-up)

- [ ] WP2-T1: ADR-0010 and dependency
- [ ] WP2-T2: `scheduler.ts`
- [ ] WP2-T3: Validation at the API
- [ ] WP2-T4: Schedule visibility endpoint

## WP3: M2 templates and usage cap

- [ ] WP3-T1: Template registry
- [ ] WP3-T2: API
- [ ] WP3-T3: Usage and soft monthly cap
- [ ] WP3-T4: LLM status endpoint (onboarding support)
- [ ] WP3-T5: Instance permission settings (the configuration page's backend)
- [ ] WP3-T6: Retention housekeeping

## WP4: M2 web: agents screen, run viewer, command palette, usage banner

- [ ] WP4-T1: App shell and routing
- [ ] WP4-T2: Agents list ("ledger rows")
- [ ] WP4-T3: Agent detail
- [ ] WP4-T4: Run viewer
- [ ] WP4-T5: Lantern flicker and provenance in the note list
- [ ] WP4-T6: Command palette (⌘K)
- [ ] WP4-T7: Settings and banners
- [ ] WP4-T8: Notes list without bodies (performance)
- [ ] WP4-T9: One live event stream instead of polling
- [ ] WP4-T10: Performance budgets and code splitting
- [ ] WP4-NF: Non-functional checks (svelte-check clean, keyboard pass, contrast test, no-raw-colors test, light theme tokens)

## WP5: Editor quality bar (live preview, wikilinks, backlinks)

- [ ] WP5-T1: Live-preview decorations
- [ ] WP5-T2: Wikilink autocomplete
- [ ] WP5-T3: Backlinks API and panel
- [ ] WP5-T4: Rename
- [ ] WP5-T5: Delete with confirmation

## WP6: M3 heartbeat

- [ ] WP6-T1: Change detection
- [ ] WP6-T2: Scheduler integration
- [ ] WP6-T3: Visibility

## WP7: M3 `call_agent` (bounded agent-to-agent)

- [ ] WP7-T1: Tool and runtime plumbing
- [ ] WP7-T2: Undo across a family
- [ ] WP7-T3: Tests

## WP8: M3 strict mode and the approvals queue

- [ ] WP8-T1: ADR-0011 and checkpointer
- [ ] WP8-T2: Migration 4 and store
- [ ] WP8-T3: Runner changes
- [ ] WP8-T4: API
- [ ] WP8-T5: Web
- [ ] WP8-T6: Defaults and the owner's control
- [ ] WP8-T7: Tests

## WP9: M3 chat

- [ ] WP9-T1: Storage and routes
- [ ] WP9-T2: Streaming turn
- [ ] WP9-T3: Web
- [ ] WP9-T4: Tests

## WP10: M4 `web_fetch` (ADR-0006 implemented to the letter)

- [ ] WP10-T1: `safe-fetch.ts`
- [ ] WP10-T2: The tool
- [ ] WP10-T3: UI

## WP11: M5 graph

- [ ] WP11-T1: Record touches
- [ ] WP11-T2: `GET /api/graph`
- [ ] WP11-T3: The view

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

