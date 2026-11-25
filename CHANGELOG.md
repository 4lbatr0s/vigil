# Changelog

## Unreleased: UI v2 (ADR-0016), then design system v3 (ADR-0029)

- Agents: the agent page shows the note an agent saved for its next run, with a Clear note button; MCP clients now see the `format` option of `read_note` and `list_notes`.
- Models: a "Check tools" button on each connection in Settings asks the model to call a harmless tool once (a few tokens) and says whether agents with tools can work with it, or why the provider refused.
- Evals: `pnpm --filter @vigil/server eval --agent --trials 3` runs five agent cases (finding an answer by reading notes, a write that waits for approval, an instruction planted in a note, a job the agent has no tool for, a note that does not exist) several times each against a real model, judges the result from what the agent left behind (tool calls, approvals, notes), and reports pass^k. A regression case that fails once fails the run.
- Runs: the run page shows tokens and time for each model and tool step, the setup fingerprint of the agent, and a "Run again" button; the Cancel button and the title row wrap on a phone.
- Agents: an optional token limit per day for each agent (Advanced on the agent page). When an agent has used it, a new run or chat message is refused with a clear message until tomorrow (UTC). The monthly caps are unchanged.
- Agents: every run's log now records a short config version (eight characters from the instructions, tools, limits, hosts, model and strict switch), so you can tell which setup produced a run.
- Agents: an agent can keep a short state note between runs (switch "Remember where it stopped" on its page). It saves the note with an `update_state` tool (at most 2,000 characters, stored in the state database, not in your notes) and reads it first on the next run. Good for cron agents that work through a backlog.
- AI runtime: `list_notes` and `read_note` take `format: "concise"` (fewer tokens); a missing note tells the agent to use `search_notes` or `list_notes`; when a long run's prompt gets big, the oldest tool results are replaced by a short marker (the newest four stay, and the run log and checkpoint keep the full text).
- AI runtime: `write_note` refuses an empty body (it would erase the note) and reads the note back, so its answer says how many characters are on disk; the agents' safety text now tells them not to invent facts and to name conflicts between sources.
- AI runtime: models behind an OpenAI-compatible connection that return `reasoning_content` (DeepSeek thinking mode, some routers) now get it back on later requests; before, DeepSeek answered 400 once an agent used a tool.
- AI runtime: model calls retry on rate limits, server errors and dropped connections; Anthropic calls use prompt caching; chat summaries survive a restart; an agent that answers with nothing and uses no tool now fails with a clear message; the agent page, Chat and the pictures setting warn when your Ollama model cannot use tools or read pictures; `pnpm --filter @vigil/server eval` compares models on a fixed set of questions. See ADR-0031.
- Graph: a Connections panel on every note (a small graph of the note and its neighbours, lists of links, backlinks and notes that mention it without a link, and the agents that touched it; links to notes not written yet have a Create note button). The Graph page now has filters (tag, orphans, hide unwritten, search), three lenses (tags, memory, agents) and a Needs attention panel, follows changes live, and keeps its place when you change a filter. See ADR-0030.
- Notes: a table of contents block. Type `/contents` (or `/toc`) and a list of the note's headings appears, always current as you edit them; click an entry to jump there. The file keeps one line, `[TOC]`.
- Design system v3 "Quiet paper": one system sans, a neutral palette, soft fills instead of boxes, one primary action per screen, and a component library (`apps/web/src/lib/ui`, built on Bits UI) used by every screen. The Notes screen, Today, Study, Agents, Chat, Approvals, Settings, the Tools pages, Graph and the Canvas list were rebuilt on it. New note is a dialog, secondary note actions are in a More menu, the no-model banner shows only where a model is needed, and every dialog and menu has real focus handling. Rules are in `docs/design/ui-rules.md` and `DESIGN.md`; `ui-lint.test.ts` fails on raw colours, sizes and durations, uppercase labels, gradients, accent stripes and per-route buttons.

A note app first, with agents inside it.

- Notes: "From text" turns pasted text into an empty outline of headings and questions for you to answer in your own words, and there is a Cornell-style note template.
- Note editor v2: the note page reads like a document (large page title in the text column, slim action bar, empty-note hint, clear caret and selection); code blocks have a language bar, a Copy button and real syntax colours; callouts show an icon and a tone; a handle beside each block drags it to a new place or opens a menu to turn it into another kind, duplicate, move or delete it (Alt+Up and Alt+Down move the block under the caret); the `/` menu has groups, icons, tip and warning callouts, a link to a note, today's date and an image chooser; Tab moves between table cells and lines the columns up; find and replace, link paste over a selection, spellcheck, an Outline of headings, a Focus mode and a Markdown switch.
- Note editor v3 (ADR-0028): notes open in a block editor (Tiptap) with round task boxes, real table grids with row and column controls, callouts with icons and folding, highlighted code, a grouped `/` menu, a `[[` note picker, a plus and grip beside every block (drag to move, click for a menu), Alt+Up/Down, a floating format bar and an outline list. Notes are still plain markdown files. A note the block editor could not write back unchanged (footnotes, raw HTML, comments) opens as plain markdown instead, and a Markdown / Blocks switch moves between them.
- Agents: "Test tasks" on an agent page keeps up to five sample tasks to re-run after you change the instructions. Today suggests making cards for a note you wrote lately that has none.
- Capture: "Save a longer text as a source note" on the Capture page turns a pasted article, transcript or an .srt/.vtt/.txt/.md file into a "Source: ..." note tagged #source (caption cues removed), so Ask, the Wiki keeper and the Gap check can use it.
- Skills: "Copy as SKILL.md" on an agent page, and "Import a skill" on the Agents page. A SKILL.md is the open format many AI tools read. An imported skill brings only its words: no tools, no web sites, switched off, asks before writing; you grant what it needs.
- Safer web reading for agents: lines on a fetched page that look like orders to an AI are removed (and the agent is told how many), and addresses that could carry note text out (a long query, a password in the address, a huge path piece) are refused. A partial guard on top of the allowed-sites list and approvals.
- Cards: when the Card maker proposes cards, an answer whose words mostly are not in your note gets the hint "Part of this answer is not in your note", next to the existing one-fact-per-card hints.
- Search by meaning (off until you name an embedding model in Settings): Ask, agents' `search_notes` and a "Related notes" strip find notes that mean the same without sharing a word. Notes are read in the background and re-read only when they change; the word search keeps working if the model is missing or fails, and the Settings line says what went wrong.
- Agents: a ready-made "Wiki keeper" builds `Wiki: ` pages from your notes. Every key point ends with the note it came from, questions have no answers, contradictions are listed, and each write waits for your yes. Your own notes are never edited.
- Agents: the agent page shows "What it can reach" (sees your notes, reads outside text, can send data out) and says when all three are on. Chat replies link to "How it worked" (the run log). Settings, Other agents: a copy-ready rules file for Claude Code, Codex and other tools that work in your vault, and the `claude mcp add` command.
- Canvas v2 (ADR-0027 amendment): copy, cut, paste, duplicate, right-click menus, lock, group with Ctrl/Cmd+G, Space to pan and scroll to move, paste or drop a link or picture; a Map button that turns a note's headings into a board; Tab and Shift+Enter to grow a mind map; checklists with progress that can be ticked on the board; align, space evenly, tidy as tree or grid, snapping guides; arrowheads and line styles; show only one heading of a note on a card; an icon dock, a keys panel, a learning-path and a mind-map starter, board duplicate, and export as PNG.
- Agents: ready-made agents show tags (when it runs, what it touches, whether it uses the web) and the gallery search matches them. The agent page folds model, budget and instructions under "Advanced". The Today empty state is centred.
- Study: a "Keeps slipping" list of cards you have forgotten again and again.
- Study: a "Coming up" strip of reviews due over the next 14 days, settings for new cards per day and the remembering target, and sessions that take turns between notes.
- Study: download your cards as text for Anki, and import cards from an Anki plain-text export (no review history).
- Study: recall checks (ADR-0020). Write what you remember of a note, an agent shows what you covered and missed from the note itself, and the note comes back after 1, 3, 7 and 21 days.
- Study: exam dates (ADR-0019) for a note or a tag. Reviews are paced to land before the day and the retention target rises in the last weeks. Today shows where the nearest one stands.
- Study: card hints (long answer, a list, yes or no, several blanks, front not a question) when the card maker proposes cards, and a prompt on cards you have forgotten six times.
- Agents: on a note an agent wrote, "Review changes" shows each change with the line around it and lets you put the old text back one change at a time ("Undo this run" still undoes everything).
- Settings: remove pictures that no note uses any more (after a confirm).
- Settings, Pictures: let the card maker, the recall checker and the tutors see the pictures in a note (off by default; needs a model that reads images). Ollama is now asked for a 16,384-token window so a note plus a picture plus a thinking model no longer ends in an empty answer.
- Today: a Capture box adds a line to your Inbox note, and "File my inbox" asks the Inbox triager where each line belongs. Its writes wait under "Needs you" for your yes, and filed lines are marked `- [x]` instead of removed.
- Recall: after a check you can keep the points you got wrong (the checker's list, or your own). The next check on that note shows them first, the card maker writes cards on them, and the weekly study review sees them. You cross each one off yourself.
- Other agents (MCP, ADR-0022): switch it on in Settings and tools like Claude Code or Claude Desktop can search and read your notes at `/api/mcp`, and, with a second switch, write notes. Each write is a run you can undo. Off by default.
- Chat: a long conversation keeps a short summary of the turns that no longer fit instead of forgetting them (it costs one small model call now and then, shown in the run log).
- Security: during a login spray from many addresses, an address you signed in from in the last week is no longer held in the slow queue.
- Security: logging out now ends every session, so a copied cookie stops working (it signs out every device).
- Notes: nested tags (`work/launch`) show as a tree: top-level chips, and the tags under the one you picked on a second row.
- Capture: share text or a link to Vigil (installed as an app) and it opens the Capture page, ready to add to your Inbox.
- Today: a "Start here" section lists up to three things in order: an exam within a week, changes waiting for your yes, recall checks due, cards to review, cards that keep slipping.
- Study: a card shows the heading it sits under, and the same question under two different headings is now two cards instead of one.
- Gap check (`/gap`): paste an article or transcript and an agent compares it with your notes: what you already have, what is missing, what disagrees.
- Graph: a "Memory" view colors each note by how much of it you remember (green strong, red fading, grey nothing answered yet, a ring when its recall check is due). Clicking a note shows the numbers and links to "Study this note" and "Recall check".
- Canvas: a Canvas button on a note, "put it and its neighbours on a canvas" in the Graph panel, and picture cards.
- Agents: Duplicate makes a switched-off copy; the agent page warns when its model connection was removed; Settings shows when a connection was last tested.
- Navigation: grouped into Write, Learn, Agents and App, and a new Tools page lists Ask, Gap check, Recall, Outline, Capture and Import (they had no link before). Settings starts with AI models, has a jump bar and clearer sections. The Agents page has a search box and a clearer empty state. See `docs/design/ui-audit.md`.
- Canvas (ADR-0027): a free board of note cards, text, links and groups with arrows, colors, undo and autosave, saved as JSON Canvas files (`canvases/*.canvas`) that Obsidian can open. Built on Svelte Flow.
- Agents: "Create an agent" describes what you want in plain words, picks when it runs and what it may touch, and a model drafts the name and instructions for you to edit; nothing is saved until you press Create, and the agent starts off (with approvals on if it can write). The agent page now edits the schedule, the tools, the model connection and the model (from the connection's list).
- Models: connect a model in Settings (Ollama, LM Studio, OpenAI, Anthropic, DeepSeek, OpenRouter, Groq or any OpenAI-compatible address), test it, list its models, pick a default. Keys are stored encrypted on this computer (ADR-0026) and never shown again. Agents can use a specific connection. Environment variables still work.
- Ask your notes (`/ask`, or the command palette): answers come only from lines of your own notes, each claim carries a mark that points at the exact line (note and line number shown), and a question your notes do not touch is answered "your notes do not cover this" without calling a model. An answer with no marks, or marks to lines that were never given, is flagged. A source opens its note scrolled to that line.
- Agents: a read-only `learner_status` tool (with the notes-reading permission) lets an agent see your study memory: cards due, exam dates, recall rate per note, cards that keep slipping, recall checks. New "Weekly study review" template writes a Sunday note from it.
- Notes: paste or drop an image into a note. It is saved inside your vault (`attachments/`) and linked with a normal relative markdown link, so other markdown apps show it too.
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
