# Vigil UX spec: every screen, state, string and key

Companion to `ui.md` (tokens, component stances) and ADR-0005 ("Quiet Instrument"). This document is what an implementer builds the web app from; it adds layouts, states, copy, keyboard, motion, accessibility, icons and the app mark. When this and `ui.md` disagree about a token, `ui.md` wins; about anything else, this wins.

## 0. Principles (applied to every screen)

1. **Notes are the product; agents are the life in it.** The editor is calm and wide. Agent activity is visible but never loud.
2. **Two voices.** Serif (Newsreader) is the human voice: note titles, note bodies, agent names, headings. Monospace (IBM Plex Mono) is the machine voice: timestamps, ids, cron expressions, run logs, file paths, token counts. Chrome (Schibsted Grotesk) is for navigation, buttons, labels, settings.
3. **Amber is reserved for agent life:** a running run, an agent-written note marker, the lantern flicker, graph glow and agent edges. Never a button, link, selection, focus ring or decoration.
4. **Structure from hairlines and weight, not shadows or cards.** No soft shadows (except the focus ring). Radius 4px, only on interactive surfaces (buttons, inputs, chips). Rows, not cards.
5. **Left-aligned everywhere.** Centered text is allowed only in empty states.
6. **Say what happened, plainly.** Errors name the thing and the next step. No exclamation marks, no emoji, no "Oops". No jargon the user did not choose (say "monthly buy limit", not "orderCapExceeded"; here: say "token budget", not "maxTokens").
7. **Never lose the user's text.** A failed save keeps the draft in the editor and says so. A conflict offers a way to keep both versions.
8. **Everything works from the keyboard** and with reduced motion.

## 1. Global layout and responsive behavior

Three breakpoints (CSS `min-width`):

| Name | Width | Layout |
| --- | --- | --- |
| wide | >= 1200px | labelled navigation (`--nav-width` 200px, icon and text) + list pane (`--sidebar-width` 280px) + main (fluid). Prose column max `--measure` 68ch. |
| medium | 640 to 1199px | icon rail (`--rail-width` 56px) + main. Below 1024px the list pane is a slide-over opened by a "Notes" button in the main header; it closes on selection, on the scrim or on Escape. From 1024px the list pane is docked. |
| narrow | < 640px | single column. Top bar (menu button, name, search field); the navigation is a drawer from the left; the list pane is a full-width slide-over and opens first when the address names no note; no hover-only controls. |

(ADR-0016 changed the wide layout from the icon-only rail to a labelled navigation.)

Vigil is desktop-first; the narrow layout must work (it is an installable PWA) but is not polished beyond that in v1.

Header strip (top of main, hairline bottom): a search field that opens the command palette (placeholder "Search or run a command", `Cmd K` or `Ctrl K` shown inside); on narrow screens the menu button and the name come first. Banners (section 14) sit above this strip.

The rail (left, 56px wide, hairline right): icon buttons stacked from the top: Notes, Agents, Chat, Graph; pinned to the bottom: Approvals (with count badge), Settings. Each button has a visible label as a tooltip and an `aria-label`. The active item shows a 2px ink bar on its left edge (not amber).

## 2. Controls (build these once, reuse everywhere)

| Control | Spec |
| --- | --- |
| Primary button | background `--ink`, text `--bg`, 4px radius, 32px high, 12px horizontal padding, 15px chrome font weight 500. One per view at most. Never amber. |
| Ghost button | transparent, 1px `--hairline` border, text `--ink`. Hover: border `--ink-muted`. |
| Destructive button | ghost button with text `--err`; the confirm step uses a solid `--err` background with `--bg` text. |
| Text input | 32px high, 1px `--hairline`, 4px radius, `--surface` background, placeholder `--ink-muted`. Focus ring (below). Invalid: border `--err` plus message under the field in `--err` at 13px. |
| Chip | 24px high, 1px `--hairline`, 4px radius, 13px label. Used for tool grants, tags, hosts. Removable chips show an `x` icon button. |
| Status dot | 8px circle. Colors: amber (running, with a slow 1.6s opacity pulse; static under reduced motion), `--ok` (last run succeeded), `--err` (failed, budget exceeded, step limit), `--ink-muted` outline only (never run, disabled, undone). Always paired with text or a `title`; color is never the only signal. |
| Focus ring | `outline: 2px solid var(--ink); outline-offset: 2px` on every interactive element (the one shadow-like device allowed). Defined once in `app.css`. |
| Toggle | 32x18 track, 1px hairline, thumb in `--ink`; on = filled `--ink` track with `--bg` thumb. Has a text label; `role="switch"`, `aria-checked`. |
| Dialog | centered, max width 480px, `--surface`, 1px hairline, no shadow, backdrop `--bg` at 70% opacity. Focus trapped; Escape closes; restores focus to the opener; `role="dialog"`, `aria-modal`, `aria-labelledby`. |
| Ledger row | 48px high, hairline bottom; columns separated by space, not borders. Hover: background `--surface`. Whole row is one link or button. |
| Inline two-step confirm | a ghost button "Delete" becomes, in place, "Delete note? Yes / Cancel" (destructive button + ghost) for 5 seconds, then reverts. No `window.confirm`. |
| Tooltip | native `title` plus `aria-label` for icon-only buttons; no custom tooltips in v1. |
| Time display | relative ("4 min ago", "yesterday 07:00") in mono with the exact ISO time in `title`. Past 7 days, show the date `2026-11-14`. |

## 3. Notes screen (`/`)

### Layout (wide)

```
+----+--------------------+----------------------------------------------------+
|rail| [ Search notes   ] | Standup                       saved 14:02:11   ...  |
|    |  New note          |  ------------------------------------------------- |
|    |                    |  # Standup                                          |
|    |  o Digest 2026-11-14   <- amber dot (agent-written)                      |
|    |    Standup  14:02  |  Finished the vault store. Blocked on [[auth        |
|    |    Ideas    13:40  |  design]].                                          |
|    |    ...             |                                                     |
|    |                    |  Linked from (2)                                    |
|    |                    |   Ideas: ... see [[standup]] ...                    |
+----+--------------------+----------------------------------------------------+
```

### List pane

- Top: a "Filter notes" box (instant match on title, snippet and tags; from 2 characters the server's full-text hits are merged in after 150 ms; Escape clears), a count and a sort menu ("Recently changed" or "Title", remembered in the browser), and a row of tag chips (All plus the 12 most used tags; a tag matches its children, so `work` shows `work/launch`). Below the list: the title box and "New note".
- Row (68 px, fixed so long lists can be windowed): serif 17px title, relative time on the right in 13px muted; second line a one-line snippet in muted 13px and up to two tags. An 8px-less 6px amber dot marks agent-written notes. Selected row: raised surface plus the 2px ink bar. A pin button shows on hover and focus (always when pinned); pinned notes come first, most recently pinned first. A pin is stored by the server outside the note file, so pinning never changes the note.
- Tags come from the note's frontmatter and from inline `#tags` in the text (nested with `/`; code is ignored).
- Keyboard: Up and Down move between rows, Enter opens, `N` jumps to the new-note box.
- No match: "No notes match." with a "Clear the filter" link.

### States

| State | What is shown |
| --- | --- |
| Loading | three hairline rows in `--surface` (no spinner, no shimmer under reduced motion) |
| Empty vault | centered in the list pane: "Your vault is empty." then a ghost button "Create a note", and below a muted line "or add an agent" linking to `/agents` |
| Error | "Couldn't load notes." plus the message in mono, ghost button "Retry" |
| No search hits | "No notes match "<query>"." |
| Offline / server stopped | banner "Can't reach the Vigil server." (section 14) and the editor stays usable for the current note; saves queue visibly (see Editor) |

### Editor (main pane)

- **Rename dialog:** the Rename button opens a dialog with the new title input. As the user types it shows, below the input, "This will update links in N notes" (from the dry run) with the first five titles in muted text; Rename (primary) and Cancel.
- **Header:** the title is an inline-editable serif 26px field (click it; Enter or leaving the field saves, Escape reverts). Changing the title changes the displayed title only; the file name and id stay, and a help line says so while the field has focus ("The file name stays the same. Use Rename to change it."). A body whose first line is `# <the same title>` shows that line hidden until the cursor is on it, so the title is not shown twice. Right side: a ghost "Rename" button and a ghost "Delete" button (inline confirm). Below 1024px a "Notes" button opens the list.
- **Body:** CodeMirror 6 live preview: prose in serif 17px, line-height 1.6, column max 68ch. Markdown marks are hidden except on the line with the cursor. Rendered: headings, bold, italic, strikethrough, inline and fenced code, links, wikilinks, quotes, callouts (`> [!note]`, `[!tip]`, `[!warning]`; a left bar, tinted block), bullet, numbered and to-do lists (checkboxes toggle on click), tables (mono block, header bold), dividers and inline `#tags` as small pills.
- **Keys:** Cmd/Ctrl B bold, I italic, E code, Shift X strikethrough, Shift K link, Alt 1/2/3 headings, Shift 8/7/9 bulleted, numbered, to-do list; Tab and Shift Tab indent and outdent a list item (Tab does nothing special outside a list, so it never traps keyboard focus).
- **Selection toolbar:** selecting text shows a floating bar above it (bold, italic, strikethrough, code, link, heading, quote, list). It never takes focus from the editor.
- **Slash menu:** `/` at the start of a line lists blocks (headings, lists, to-do, quote, callout, code block, table, divider), filtered as you type; Enter inserts.
- **Agent provenance bar** (an agent wrote the note last, or an agent has a pending write for it), under the title: amber dot, "Written by <agent>, <time>", "View run" and "Undo this run" (inline confirm; a conflict message from the server is shown as is). It disappears when the owner edits the note. A pending approval adds a line "<agent> wants to change this note" with a "Review" link.
- **Agent activity** (collapsed, above "Linked from"): the runs that touched this note, newest first, each a link to the run.
- **Ask an agent** (Cmd/Ctrl J, the toolbar's agent button, or `/ask`): a dialog with an agent picker (enabled agents that can read notes), the selected text (or "the whole note") and an instruction. It opens a new chat with the message filled in; nothing is sent until the owner presses Send, and strict mode still queues writes.
- **Status line:** file name on the left; word count and save state on the right.
- **Autosave:** 1000ms after the last change, plus Cmd/Ctrl+S. Every save sends `baseUpdatedAt`. Status text follows the table below.
- **Agent provenance bar** (shown only when `author === "agent"`), directly under the header, hairline-separated, mono 13px: amber dot, "Written by morning-digest, today 07:00" and a ghost "View run" link (to `/runs/<id>` when the run is known) and, if the run is not undone and nothing has edited the note since, a ghost "Undo this run". The bar disappears after the user edits the note (it is then human-authored).
- **Linked from** panel (below the body, collapsible, collapsed by default when empty): rows "Title" + 160-char snippet in muted serif.

### Save states and conflict handling

| Event | Status text | Behavior |
| --- | --- | --- |
| Typing | "not saved" (muted) | draft kept in memory |
| Saving | "saving..." | request in flight |
| Success | "saved HH:MM:SS" | `baseUpdatedAt` updated |
| Network error | "not saved: can't reach the server" in `--err` | draft kept; retry automatically every 5 s while visible; Cmd/Ctrl+S retries now |
| `409 note-conflict` | "conflict" in `--err` | an inline panel replaces the provenance bar: "This note changed on disk after you opened it." with two buttons: "Load the new version" (discards the draft after copying it to the clipboard and saying "Your text was copied.") and "Keep mine and overwrite" (reloads `updatedAt`, then saves again). Never auto-resolve. |
| `404 note-not-found` while saving | "note was deleted" | offer "Recreate it" (creates the note from the draft) |

## 4. Agents screen (`/agents`)

### Layout

```
 Agents                                                         [ Add agent v ]
 ----------------------------------------------------------------------------
  o  morning-digest         daily 07:00        next 07:00 tomorrow   ok  2h ago
  o  inbox-triager          every 30 min       checked 4 min ago     unchanged
  .  research-scout         manual             -                     never run
 ----------------------------------------------------------------------------
 Templates
  Morning Digest      A note each morning that summarizes what changed.    Add
  Weekly Review       ...
```

- Ledger row columns (wide): status dot; serif agent name; mono schedule text; mono next-run or "checked N min ago, unchanged"; last-run result word (`ok`, `failed`, `budget`, `step limit`, `waiting`, `never run`); mono relative time of the last run. On medium and narrow widths the two middle columns collapse into a second muted line.
- **Schedule text formatter** (pure function, test it): `0 7 * * *` -> "daily 07:00"; `0 18 * * 5` -> "Fridays 18:00"; `*/15 * * * *` -> "every 15 min"; anything it cannot describe -> the raw expression in mono. Heartbeat -> "every 30 min, on change". Manual -> "manual".
- Row click opens `/agents/<name>`. A running agent's dot pulses amber and the last-run column reads "running".
- **Add agent** menu: "From a template" (scrolls to the gallery) and "Blank agent" (opens the detail form with empty fields).
- **Template gallery** (below the ledger; always visible when there are fewer than 5 agents, collapsible otherwise): each row has a serif title, a one-line muted summary, small chips for requirements ("needs a model", "needs web access"), and a ghost "Add" button. The Morning Digest row is first and its button is primary. Adding creates the agent **switched off** and opens its detail page with the "Turn on" panel; nothing runs until the owner turns it on. A switched-off agent shows a muted dot outline and the word "off" in the result column.
- **Empty state** (no agents): centered "No agents yet." and below, "Start with the Morning Digest: it writes a short summary of your notes every morning." then the primary button "Add Morning Digest".
- **No model configured** (from `/api/llm/status`): a muted line above the gallery "Agents need a model before they can run. Set it up in Settings." with a link; the Add buttons still work.

## 5. Agent detail (`/agents/[name]`)

Sections, top to bottom, separated by hairlines:

0. **Turn on panel** (only while the agent is off): a hairline-bordered block above the header, text "This agent is off. It will not run on its own until you turn it on." then three plain lines: the schedule ("Runs daily at 07:00"), what it can do ("Can read your notes. Can write notes; every write is saved first so you can undo.") and its approval state ("Asks for your approval before writing: on"). Buttons: primary "Turn on", ghost "Run once now". Permissions switched off for the whole instance appear struck through with "Turned off in Settings" and a link. After turning on, the panel is replaced by a muted line "On. Next run today 07:00." (the status text announced with `aria-live`).

1. **Header:** serif 26px name; status dot and last-run summary; right side: primary "Run now" (disabled with the reason as muted text next to it: "Already running", "Disabled", "No model set up"), ghost "Chat" (opens a new chat with this agent), ghost menu with "Disable"/"Enable" and "Delete" (two-step confirm; deleting an agent never deletes its run history or notes).
2. **Schedule:** trigger kind selector (Manual, Cron, Heartbeat). Cron: expression input (mono) with a live human readout under it ("daily 07:00"), time zone select (default: the server zone, shown as "Server time zone: Europe/Istanbul"), next three run times in mono. Heartbeat: "Check every [30] minutes" number input (min 5) and the line "Runs only when notes it can read have changed." Invalid values show the server's `invalid-body` message under the field.
3. **Instructions:** "What this agent does" (description, one line) and "System prompt" (a textarea, mono-free serif 15px, min 8 rows, resizable). Save button (ghost) enabled when changed; "Saved" status text after.
4. **Tools:** read-only chips of the granted tools with a one-line explanation each ("Read notes: list, read and search your notes", "Write notes: create or replace notes (every write is saved first so you can undo)", "Web access: fetch pages from the hosts below", "Call agents: ask other agents for help"). Checkboxes to change them. Under Web access: the allowed hosts editor (chips, add field; validation: host name only, lower-case, no duplicates; message "Enter a host like example.com, without https:// or a path."). If Web access is on and the list is empty, a warning line in `--ink` with an alert icon: "This agent can't reach any site until you add a host." If Call agents is on, a chip editor "May call:" listing existing agent names.
5. **Safety:** toggle "Ask me before it writes" (strict). Helper text: "Writes wait in Approvals until you accept them." If the agent has both read and web access, the toggle is on and turning it off opens a dialog: title "Turn off approvals for an agent that reads the web?", body "A web page could trick this agent into writing something or sending your note text to a host you allowed. With approvals on, you check every write first.", buttons "Keep approvals on" (primary) and "Turn off" (destructive). Token budget number input ("Token budget per run", mono, with a helper "A run stops when it has used this many tokens."). Model input ("Model (optional)", placeholder shows the instance default).
6. **Runs:** the last 20 runs as ledger rows: status dot, mono start time, trigger word (`manual`, `cron`, `heartbeat`, `chat`, `call`), result word, tokens "3,580 / 20,000", and "undone" in muted text when applicable. Row opens `/runs/<id>`. A "Load more" ghost button.

States: loading (hairline rows), not found ("No agent called "<name>"." with a link back), save error (message under the Save button in `--err`).

## 6. Run viewer (`/runs/[id]`)

```
 morning-digest   o succeeded     manual   started today 07:00:02   took 41 s
 Tokens  3,580 / 20,000  [=======-------------------------------------]
 [ Undo this run ]  [ Open Digest 2026-11-14 ]
 ----------------------------------------------------------------------------
 07:00:02  PROMPT   You write a short morning digest...            (expand)
 07:00:05  MODEL    (tool calls: list_notes)                 412 tok
 07:00:05  CALL     list_notes({})
 07:00:05  RESULT   ideas | Ideas | 2026-11-14T20:53 | human ...
 07:00:09  CALL     write_note({"title":"Digest 2026-11-14", ...})
 07:00:09  NOTE     created digest-2026-11-14                        -> opens note
 07:00:12  STOP     succeeded
```

- **Header:** serif agent name (link to the agent), status dot + word, trigger, relative start time (exact in `title`), duration in mono.
- **Token bar:** a 4px high hairline-bordered bar; fill `--ink-muted` (amber only while running). Text "3,580 / 20,000 tokens" in mono. If status is `budget-exceeded`, the text is "20,000 / 20,000 tokens: the run stopped because the budget was used up." (plain, `--err`).
- **Event rows:** mono 13px, muted ink; labels fixed-width: `PROMPT`, `MODEL`, `CALL`, `RESULT`, `DENIED`, `NOTE`, `STOP`. Text longer than two lines is clamped with an "expand" toggle (`aria-expanded`). `NOTE` rows show the note id as a link (opens `/?note=<id>`). `CALL` rows for `fetch_url` show the full URL. `DENIED` rows read "<tool>: not available to this agent". The `MODEL` row shows the token count from `data.tokens`. While status is `running` the label of the newest row ends with a blinking-free amber `_` cursor (static under reduced motion) and the list appends new events every 2 s (`?after=<seq>`).
- **Nested runs:** a `CALL call_agent` row has a "View child run" link; children appear as indented sections on the parent page, collapsed by default.
- **Undo:** button enabled when the run has touched notes, is not running, and is not undone. Click opens a dialog: title "Undo this run?", body "These notes go back to how they were before the run: <list of titles>. Notes the run created will be deleted.", buttons "Undo run" (primary) and "Cancel". Results: success replaces the button with muted text "Undone"; `undo-conflict` shows the server message in `--err` plus links to the notes named; `already-undone`/`run-active` show their messages.
- **States:** loading (hairline rows); not found ("Run not found."); failed run: an `--err` summary line above the log with the redacted error text.

## 7. Approvals (`/approvals`) [WP8]

- Page title "Approvals". Count badge on the rail (a number in a 16px circle, ink on `--surface`, hidden at 0).
- **Ledger of pending writes:** mono relative time, serif note title, agent name, "creates" or "replaces" word. Row expands inline into the review: a unified diff (mono 13px) with added lines marked by a `+` and `--ok` text on `--surface`, removed lines by `-` and `--err`; new notes show all lines as added. Buttons below: "Approve" (primary) and "Reject" (ghost). Keyboard: `A` approve and `R` reject on the focused row; Up/Down move.
- If the note changed after the agent proposed the write, "Approve" answers `approval-stale`: the row shows the diff against the note as it is now with the line "This note changed after the agent proposed this write." and two buttons, "Apply anyway" (destructive style; the previous text is saved first) and "Reject". After a decision the row shows "Approved" or "Rejected" muted for 3 seconds and leaves; when the run's last approval is decided, a muted line "Run continues" links to the run.
- **Empty:** centered "Nothing is waiting for you." Muted second line: "Agents in approval mode will appear here before they write."
- **Diff function** (`lib/diff.ts`, tested): line-based LCS; no dependency.

## 8. Chat (`/chat`, `/chat/[id]`) [WP9]

```
 +--------------------+-------------------------------------------------------+
 | New chat           |  Chat with morning-digest                  [ Save as note ] |
 |                    |  ---------------------------------------------------- |
 | Plan the week      |  You                                                   |
 | Digest tuning      |  What did I decide about auth?                         |
 |                    |  morning-digest                                        |
 |                    |  read_note(standup)                                    |
 |                    |  You wrote that auth design blocks the vault store...  |
 |                    |  [ message input...                         ] [ Send ] |
 +--------------------+-------------------------------------------------------+
```

- Thread list (ledger rows: title, agent name muted, relative time). "New chat" opens a small dialog "Which agent?" (select, defaults to the most recently used).
- Messages: no bubbles. A muted mono speaker label ("You", agent name) then serif 17px text, left-aligned, 68ch column. Tool activity is one muted mono line each ("read_note(standup)"). Streaming text appears token by token (no typewriter animation beyond the real stream).
- Input: multi-line textarea, Enter sends, Shift+Enter newline, Escape while streaming stops the turn (button "Stop" replaces "Send"). Disabled with a muted reason when no model is configured.
- Strict agent wants to write: an inline line "Waiting for your approval in Approvals." with a link; the stream ends; the thread continues after the decision.
- "Save as note": creates `Chat <title>` with the transcript; the button then reads "Saved" with a link.
- Errors: a muted `--err` line under the failed message with the redacted message and a ghost "Retry".

## 9. Graph (`/graph`) [WP11]

- Full-bleed canvas (dark, `--bg`) filling main. Top-left over the canvas: a search input ("Find a note") and a toggle "List view". Bottom-left: a legend in 13px muted text: dot = note, ring = agent, dashed line = agent read/wrote, glow = recently changed.
- Visual rules: note nodes small, color `--ink-muted`, size by degree (6 to 16px); agent nodes ringed in `--ink`; ghost (unwritten) notes drawn as hollow circles; link edges 1px `--hairline`; agent edges dashed amber at 40% alpha (2D overlay); recency halo amber with alpha `max(0, 1 - ageDays/14)`.
- Interaction: hover highlights the node and neighbors (others fade to 20%); click opens a right-hand panel (`--surface`, hairline left) with serif title, mono updated time, "Open note" primary button, backlinks list; Escape closes it. Drag to pan, wheel/pinch to zoom, double-click empty space to reset. Keyboard: Tab cycles nodes in recency order, Enter opens the panel, `+`/`-` zoom, `0` resets.
- **List view** (also the fallback when WebGL is unavailable; the banner says "Showing a list because your browser can't draw the graph."): groups by connection count; each row serif title, mono "3 links", and the agent names that touched it.
- Empty: "Nothing to draw yet. Create two notes and link them with [[double brackets]]."
- `prefers-reduced-motion`: no animated camera moves; layout settles instantly.
- Truncated graphs (more than 3000 nodes) show a muted line "Showing the 3000 most recent notes."

## 10. Settings (`/settings`)

Sections (serif 20px headings, hairline separated). The page order is Permissions, Model, Usage, Access, About; the page has a left-aligned in-page anchor list on wide screens.

0. **Permissions** (the configuration page for what agents may do). Intro line: "What agents are allowed to do on this instance. Each agent can have fewer permissions than this, never more." Four switches with one-line consequences: "Agents can read notes" ("Needed by most agents."), "Agents can write notes" ("Every write is saved first so you can undo it."), "Agents can fetch web pages" ("Only from hosts you list on each agent. Web pages can contain tricks aimed at the agent."), "Agents can call other agents" ("One level deep, inside the first agent's budget."). Then a switch "New agents ask for my approval before writing", a number field "Highest token budget any run may use" (mono, helper "Agents with a higher budget are capped to this."), and a number field "Keep run history for" with unit "days" (helper "0 keeps it forever. Notes and run summaries are never deleted."). An explicit "Save permissions" ghost button becomes primary when something changed; saved state is shown as "Saved" text. Turning a switch off shows an inline note: "Runs that are already going keep the tools they started with."
1. **Model:** read-only rows: Provider, Base URL, Model (mono), "API key: set / not set" (never the value). Ghost button "Test connection" shows "Connected" in `--ok` or "Can't reach <url>" in `--err`, text only. Under it a muted block "Set these in the server's environment:" with a mono code block listing `VIGIL_LLM_PROVIDER`, `VIGIL_LLM_BASE_URL`, `VIGIL_LLM_API_KEY`, `VIGIL_LLM_MODEL` and the Ollama example. A "Copy" ghost button copies the block.
2. **Usage:** "This month: 128,400 tokens" in mono; with a cap: "of 1,000,000" and a thin bar; `warn` level text "You've used 80% of the monthly limit you set."; `over` level "You've passed the monthly limit you set. Agents keep running." Explain that the limit is a reminder, not a block.
3. **Access:** "Signed in" / "Local access (no token set)"; "Sign out" button when a token is set.
4. **About:** version, link to the repository and license (AGPL-3.0), the vault path (mono) and data path.

## 11. Login (`/login`) [WP12]

Plain page, no marketing. Left-aligned column 360px wide, vertically near the top third: serif 26px "Vigil", muted line "Enter your access token.", a password-type input (labelled "Access token"), primary button "Sign in". Errors under the input: wrong token "That token isn't right."; rate limit "Too many tries. Wait a minute and try again."; network "Can't reach the server." Autofocus the input; Enter submits. After success navigate to where the user was going (`?next=`, same-origin paths only).

## 12. Command palette (Cmd/Ctrl+K) [WP4]

- Opens a dialog (480px wide, top-aligned 15% from the top). Input "Type a command or search notes". Results grouped with muted 13px group labels: **Notes** (title match, then full-text hits), **Agents** (name match), **Commands** (fixed: "New note", "New chat", "Run agent...", "Open Agents", "Open Graph", "Open Approvals", "Open Settings").
- Fuzzy scoring: prefix > start of a word > substring; ties by recency. Arrow keys move, Enter activates, Escape closes. "Run agent..." switches the list to agent names; choosing one runs it and navigates to the run.
- ARIA: `role="dialog"`, input `role="combobox"` with `aria-controls` and `aria-activedescendant`, list `role="listbox"`, items `role="option"`.
- Empty result: "Nothing matches "<query>"."

## 13. Global keyboard map

| Keys | Action |
| --- | --- |
| Cmd/Ctrl+K | command palette |
| Cmd/Ctrl+S | save the current note now |
| Cmd/Ctrl+click on a `[[link]]` or link | open it |
| `g` then `n` / `a` / `c` / `h` (when no text field is focused) | go to Notes / Agents / Chat / Graph |
| `?` (no text field focused) | open a dialog listing these shortcuts |
| Escape | close dialog, palette, panel; cancel inline edit or confirm |
| `N` in the note list | new note |
| `A` / `R` on a focused approval row | approve / reject |
| Up / Down | move in lists |

Shortcuts never fire while a text field, textarea or the editor is focused (except Cmd/Ctrl combinations).

## 14. Banners and notices

Banners sit above the header strip, full width, 40px, `--surface` background, hairline bottom, 15px chrome text, an icon (Lucide `circle-alert` for problems, `info` for notices) and, when useful, a ghost link on the right. They stack at most two; each is dismissible only when it is a notice (not a problem). Problems:

| Condition | Text | Link |
| --- | --- | --- |
| API unreachable | "Can't reach the Vigil server. Your changes are kept and will save when it's back." | none |
| No model configured | "Agents need a model before they can run." | Settings |
| Usage warn / over | "You've used 80% of this month's token limit." / "You've passed this month's token limit. Agents keep running." | Settings |

There are no toasts in v1. Success is shown where the action happened (status text, "Saved", "Undone").

## 15. Microcopy for API errors (map `error.code` to this text; show the server's `message` in mono under it when it adds information)

| Code | Text |
| --- | --- |
| `invalid-id` | "That note name isn't valid." |
| `invalid-body` | "Something in the form isn't right." (then the server message) |
| `note-not-found` | "That note doesn't exist anymore." |
| `note-exists` | "A note with that name already exists." |
| `note-conflict` | "This note changed on disk after you opened it." |
| `agent-not-found` | "That agent doesn't exist." |
| `agent-exists` | "An agent with that name already exists." |
| `agent-busy` | "This agent already has a run in progress." |
| `run-not-found` | "Run not found." |
| `run-active` | "This run is still going. Undo is available when it finishes." |
| `already-undone` | "This run was already undone." |
| `undo-conflict` | "You edited some notes after the agent wrote them, so undo would lose your changes." |
| `approval-decided` | "You already decided this one." |
| `approval-stale` | "This note changed after the agent proposed this write." |
| `undo-expired` | "This run is too old to undo." |
| `too-many-streams` | "Too many Vigil tabs are open. Close one and reload." |
| `unauthorized` | "Sign in to continue." (navigates to `/login`) |
| `bad-host`, `bad-origin` | "This address isn't allowed to use the server." |
| `too-many-attempts` | "Too many tries. Wait a minute and try again." |
| `payload-too-large` | "That's too large to save." |
| network failure | "Can't reach the server." |
| anything else / `internal` | "Something went wrong." (then the server message) |

## 16. Live updates

The app listens to one event stream (`/api/events`) and updates lists, run logs, the approvals badge and the note list as things happen, without a loading flash. If the stream cannot connect it falls back to polling and shows no error unless the server is unreachable (then the banner in section 14). The flicker (next section) plays when a note event with author `agent` arrives. The UI never blocks on the stream: every screen works from a normal request first.

## 17. Motion

- State changes 80 to 140ms, ease-out (`cubic-bezier(0, 0, 0.2, 1)`). No bounce, no parallax, no scroll-triggered reveals, no skeleton shimmer.
- **Lantern flicker:** when a poll finds a note newly written by an agent, its title in the note list pulses amber once over about 600ms (opacity and color from ink to amber and back). It never plays on first page load and never repeats for the same note version.
- Running status dot: opacity pulse 1.6s ease-in-out infinite.
- `prefers-reduced-motion: reduce`: the flicker becomes a static amber dot beside the title that stays until the note is opened; the running pulse stops (dot stays amber); the graph camera does not animate; all transitions drop to 0ms.

## 18. Accessibility floor (verify per screen)

- Contrast >= 4.5:1 for text, >= 3:1 for UI borders that carry meaning. Amber used as text only at 13px medium or larger and only if the computed ratio passes on the surface it sits on; otherwise use amber for dots and outlines only (a test computes this from the tokens, WP4).
- Every interactive element reachable by Tab in reading order; visible focus ring; no keyboard traps (dialogs trap focus deliberately and return it).
- Landmarks: `nav` (rail), `main`, `header`; one `h1` per page (the screen title).
- Status changes announced: save status, run completion and errors use `aria-live="polite"` regions; banners use `role="status"` (notices) or `role="alert"` (problems).
- Icon-only buttons have `aria-label`. Status dots have text equivalents.
- The graph has a keyboard-operable list view; the editor works with a screen reader in source mode (a "Show markdown" toggle in the editor menu removes live-preview decorations).
- Light and dark themes both pass the checks above.

## 19. Light theme

`ui.md` defines both token sets. `app.css` must define the light set under `@media (prefers-color-scheme: light)` and `:root[data-theme="light"]`, and the dark set under `:root[data-theme="dark"]`, with the dark set as the default when no preference exists. A theme selector is not in v1 (the OS decides). Check each screen in both themes before calling a UI task done.

## 20. Icons (Lucide, 1.5px stroke, 20px in the rail, 16px inline)

| Use | Lucide name |
| --- | --- |
| Notes | `notebook-text` |
| Agents | `bot` |
| Chat | `message-square` |
| Graph | `network` |
| Approvals | `shield-check` |
| Settings | `settings` |
| Search / palette | `search` |
| New | `plus` |
| Run now | `play` |
| Stop | `square` |
| Undo | `undo-2` |
| Delete | `trash-2` |
| Rename | `pencil` |
| Warning / problem | `circle-alert` |
| Notice | `info` |
| Link out | `external-link` |
| Copy | `copy` |
| Close / remove chip | `x` |
| Agent-written marker | no icon: an 8px amber dot |

At implementation time confirm the package name that supports Svelte 5 (`@lucide/svelte` at the time of writing) and pin the exact version.

## 21. The app mark

A small mark used as the favicon, PWA icon and the login heading glyph. Concept: a lantern flame seen as a watching eye, reduced to two shapes so it survives 16px. Monochrome in ink on the dark background (amber stays reserved for live agent state, so the static mark does not use it).

SVG (64x64 viewBox, copy as `apps/web/static/icons/vigil.svg`):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Vigil">
  <rect width="64" height="64" rx="12" fill="#111113"/>
  <path d="M10 32c6-10 14-15 22-15s16 5 22 15c-6 10-14 15-22 15S16 42 10 32z" fill="none" stroke="#EDEDEF" stroke-width="3" stroke-linejoin="round"/>
  <circle cx="32" cy="32" r="7" fill="#EDEDEF"/>
</svg>
```

Variants: light theme swaps the two colors (`#FAFAF8` background, `#16181D` strokes); maskable PWA icon scales the artwork to 60% of the canvas with a full-bleed background; favicon uses the 16, 32 and 48 px renders of the same SVG. Generate PNGs with a script in `scripts/` (one-off, not a runtime dependency). Raw hex values are allowed in this SVG and the manifest only (they are assets, not UI code); `no-raw-colors.test.ts` ignores `static/`.

## 22. Copy tone checklist

Short sentences. Name the object ("the note", "Digest 2026-11-14"). Say what the user can do next. Use "agent", "run", "note", "approval", "token budget" consistently (see `glossary.md`). Never "AI magic", "supercharge", "seamless". Numbers in mono with thousands separators. Dates `2026-11-14`, times 24-hour `07:00`.
