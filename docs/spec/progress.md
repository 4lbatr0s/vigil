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

## UI v2: a note app people want to write in (ADR-0016; plan in the owner's approved UI plan, 2026-11-17)

- [x] UI-1: Shell, tokens, responsive (labelled nav, icon rail, drawer, slide-over list, search field, empty states). *Done 2026-11-17: checked at 1568, 900 and 390 px (media queries evaluated in the page, since the browser window cannot be resized) in dark and light; not checked on a real phone.*
- [x] UI-2: Note list people expect (search box, snippets, tags, pins, sort). *Done 2026-11-17: pins live in state.db (migration 7), not in note files, so a pin never changes author or mtime; index schema 4 adds snippet and all tags; nested tag tree not built (chips show full paths).*
- [x] UI-3: Writing surface (inline title, formatting keys, selection toolbar, slash menu, tables, callouts). *Done 2026-11-17: tables are styled mono rows (no grid widget); image paste and rendering, and focus mode, are not built: images need an attachments route and a threat-model entry first.*
- [x] UI-4: Agents inside the note (provenance bar, activity panel, ask an agent). *Done 2026-11-17: review of a landed change reuses the run viewer and the approvals page (links from the bar); an inline per-hunk accept or revert inside the editor is not built.*
- [x] UI-5: Today view and onboarding. *Done 2026-11-17: /today with a nav badge, empty-vault state (write a note or add an agent), Appearance settings. The demo-vault button and a self-completing checklist are not built; Today is a nav entry, not the landing page, so opening the app is never a redirect.*
- [x] UI-6: Polish and proof (partly). *Done 2026-11-17: graph page fixed (content pinned to the third shell row; it had zero height when no banner showed), keyboard audit on the new pages (filter box got a real focus ring), bundle budget still passes (81.7 KB of 180 KB first load), changelog. Not done: the benchmark scoring against other apps, README screenshots and the demo recording (both need the owner's eye), a check on a real phone.*

## Warm UI (ADR-0018)

- [x] Warm palette (charcoal with a brown undertone, warm off-white paper), 8px and 12px radii, warmer shadows. *Done 2026-11-17; contrast test green.*
- [ ] Copy pass done for the main empty states and a time-of-day greeting on Today (2026-11-17); line illustrations, agent lantern glyphs and motion polish still to do.

## Study v1 (ADR-0017, plan in the owner's approved plan)

- [x] Cards core. Done 2026-11-17: `extractCards` (packages/shared), `srs.ts` wrapper over ts-fsrs 6.0.0 (pinned) with tests on a fixed clock. Also done: index cards table (schema 5), state migration 8 (card_state, reviews), study.ts and the API (`GET /api/study/due|stats`, `POST /api/study/review`, `GET /api/notes/:id/cards`). `runs.result` is left for the Card maker task (a later migration).
- [x] Study page and note integration. *Done 2026-11-17: /study with a keyboard-only flow, nav badge, card count on the note. Not done: a Study card on the Today view; checked in the browser at one width only, not on a phone.*
- [x] Card maker agent with the review panel. Done 2026-11-17: `card-maker` template (read_notes only, manual), run answers stored whole (migration 9 `run_results`), `POST /api/notes/:id/card-proposals`, `GET /api/runs/:id/result`, tests. Review panel (`CardMaker.svelte`) and the Make cards button done 2026-11-17, with tests for the pure parts (`card-review.ts`). Verified 2026-11-17 with the local Ollama 4B model after a design change: the first version let the agent read the note with a tool, and the 4B model failed that tool call twice (XML parse error). The note text now travels in the task and the agent has no tools, which also removes a prompt-injection surface. Result: 7 cards, all grounded in the note; one had odd wording, which the review step is there to catch.
- [x] Tutor, explain-it-back and quiz master. *Done 2026-11-17: three no-tool chat templates, a Study dialog on the note (the note goes in the first message, minus its card lines so answers are not leaked), prompts that forbid facts or praise in the first reply. Tutor checked on the local 4B model (greeting plus one question); explain-it-back and quiz master were not run against a model. The quiz does not save a result note (no tools).*
- [x] Insight and planner. *Done 2026-11-17: a By note list on /study (cards, waiting, recall rate shown only after 8 answers) from GET /api/study/decks. No separate planner agent: the Today Study card plus the due queue already plan the day, and a no-tool agent would add nothing to it.*

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
- [x] README "Run it" commands on a clean machine or an empty directory and volume. *Done 2026-11-16: fresh `git clone`, `pnpm install --frozen-lockfile`, typecheck and 277 server + web tests pass; `docker build` and `docker run` with a new volume: health 200, `/api/notes` 401 without the token and 200 with it, UI 200.*
- [x] Permissions page: switch off web fetch, confirm a run no longer offers the tool; templates are created switched off. *Done 2026-11-16: saved from the UI, run's prompt event listed no fetch_url, then listed it after switching back; templates created disabled.*
- [x] Research Scout on a real model: allowed host works, a loopback URL is refused and logged. *Done 2026-11-16 (Ollama 4B): example.com fetched; http://127.0.0.1:3001/api/notes refused with 'port 3001 is not allowed' and logged.*
- [x] Heartbeat: observe live that an agent's own write does not trigger a second run. *Done 2026-11-16: 5-minute heartbeat agent ran once after a note changed (wrote `hb-out`), the next tick logged `skipped: unchanged`, still one run.*
- [x] Graph: force the no-WebGL path and confirm the automatic list fallback. *Done 2026-11-16: stubbed `getContext("webgl*")` to null and navigated client-side to /graph: notice "Showing a list because your browser can't draw the graph.", no canvas, list rendered.*
- [ ] Record the 20-second Morning Digest demo (under 5 MB) and put it at the top of the README.

Known gaps (from `docs/spec/open-questions.md`):
- [x] True per-token chat streaming. *Done 2026-11-16: optional `stream()` on `ChatModel`; a chat turn emits `delta` lines as the model writes (the whole-reply `token` line stays as the fallback); runs nobody watches still use one call. Verified on Ollama, including a tool-call turn.*
- [x] Trim long chat history. *Done 2026-11-16: each model call gets the system message plus the newest whole turns within 48,000 characters (`history.ts`); the stored conversation stays whole. Summarising older turns is not done.*
- [ ] Trim the editor chunk (about 240 KB gzip, loads lazily after the shell).
- [ ] Logout only clears the browser cookie; add a server-side session epoch if copied cookies matter.
- [ ] A botnet with 25+ addresses can make the owner wait at login while an attack lasts.
- [ ] WP13 backlog (post-v1) in `docs/spec/implementation-plan.md`.
