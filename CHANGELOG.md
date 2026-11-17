# Changelog

## Unreleased: UI v2 (ADR-0016)

A note app first, with agents inside it.

- Notes: "From text" turns pasted text into an empty outline of headings and questions for you to answer in your own words, and there is a Cornell-style note template.
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
