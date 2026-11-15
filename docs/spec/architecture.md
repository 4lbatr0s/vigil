# Vigil architecture overview

Status: describes the system as of commit `2b5039b` (built) and the target after `implementation-plan.md` (planned). Items marked **[planned]** do not exist yet.

## 1. One-paragraph summary

One Node process serves a JSON API (and, in production, the built web app). The user's notes are markdown files in a vault directory. A SQLite index, rebuilt from the vault, gives fast listing, search and links. A second SQLite file holds durable state: agent definitions, runs, run logs, snapshot records, schedules, approvals, chats. Agents run inside the server as small LangGraph graphs that call a user-configured model and a short allowlist of tools. Every agent write snapshots the note first, so a run can be undone.

## 2. Components

```
 Browser (SvelteKit SPA)                        Model endpoint (user's)
   notes, agents, runs, chat, graph                OpenAI-compatible URL | Ollama
        |  fetch /api/*  (same origin)                      ^
        v                                                   | chat completions
 +---------------------------- vigil server (one Node process) --------------------------+
 | access.ts   Host / Origin / token / cookie checks                                       |
 | http.ts     router, JSON envelope, error mapping                                        |
 | vault.ts    note files (atomic write, mtime, frontmatter)   <--- lock.ts (one lock)     |
 | index-db.ts SQLite index: notes, FTS5, links, hashes        <--- watcher.ts (chokidar)  |
 | state-db.ts SQLite state: agents, runs, events, snapshots, schedules, approvals, chats  |
 | runs.ts     startRun / resumeRun / undoRun, one run per agent                           |
 | agent-runtime.ts  LangGraph: agent node -> [approve node] -> tools node -> agent        |
 | agent-tools.ts    read_notes, write_notes, web_fetch, call_agents   (allowlisted)       |
 | llm.ts      model adapters from env, key redaction                                      |
 | scheduler.ts cron tick loop, catch-up, at-most-once (heartbeat planned)                 |
 | safe-fetch.ts [planned] allowlisted, SSRF-safe HTTP GET                                 |
 | static.ts   [planned] serves the built web app                                          |
 | permissions.ts [planned] instance switches + effectiveGrants    events.ts [planned] bus   |
 +------------------------------------------------------------------------------------------+
        |                         |                         |
   vault/ (markdown)         data/index.db            data/state.db, data/snapshots/,
   source of truth           disposable               data/checkpoints.db [planned]
```

## 3. Stores and who may touch them

| Store | Written by | Read by | Loss means |
| --- | --- | --- | --- |
| `vault/*.md` | `vault.ts` only (API saves, agent `write_note`, undo); the user's other editors (Obsidian) | everything via `vault.ts` / index | the user's data is gone. Back up the vault. |
| `data/index.db` | `index-db.ts`; rebuilt from the vault on start when empty or when its schema version changes | API reads, tools | nothing; rebuilt automatically |
| `data/state.db` | `state-db.ts` only | runtime, API | agents, run history, approvals lost. Back up. |
| `data/snapshots/` | `state-db.ts` (`recordSnapshot`) | undo | undo no longer possible for old runs |
| `data/checkpoints.db` [planned] | LangGraph sqlite saver | runtime (resume) | paused runs cannot resume |
| `data/session.key` [planned] | first start | login cookie signing | everyone is logged out |

Rule: only the server touches the filesystem or SQLite; the web app talks to `/api` and nothing else.

## 4. Module map (`apps/server/src`)

| File | Role | State |
| --- | --- | --- |
| `index.ts` | process entry: marks interrupted runs, rebuilds index if empty, starts server and watcher | built |
| `server.ts` | `createServer`, bind address from `access.ts` | built |
| `access.ts` | Host/Origin/token checks; later the login cookie | built |
| `http.ts` | route table, envelope, `readJsonBody` | built |
| `errors.ts` | `AppError(code, message, status)` | built |
| `vault.ts` | notes as files: create, update (conflict check), restore, list, delete | built |
| `index-db.ts` | index schema versioning, reindex, search, links | built |
| `watcher.ts` | reconcile external file changes into the index | built |
| `lock.ts` | `withNoteLock`: serialize every note-changing operation | built, uncommitted |
| `state-db.ts` | append-only migrations; agents, runs, events, snapshots | built; later tables planned |
| `agent-tools.ts` | tool builders per grant | built (`read_notes`, `write_notes`) |
| `agent-runtime.ts` | graph, budget, step limit, run log | built |
| `llm.ts` | `modelFactoryFromEnv`, `redact` | built |
| `runs.ts` | background execution, undo | built |
| `scheduler.ts`, `cron.ts` | cron firing with catch-up; cron validation | built (WP2); heartbeat planned (WP6) |
| `safe-fetch.ts` | fetch tool core | planned (WP10) |
| `usage.ts` | monthly token totals | planned (WP3) |
| `permissions.ts` | instance permission settings and `effectiveGrants(agent, settings)` | planned (WP3) |
| `housekeeping.ts` | daily pruning of old run events and snapshots | planned (WP3) |
| `events.ts` | in-process event bus feeding `GET /api/events` | planned (WP4) |
| `static.ts` | static file serving | planned (WP12) |

`apps/web/src`: `routes/+page.svelte` (notes), `lib/api.ts` (typed client), `lib/render.ts` (markdown to sanitized HTML), `lib/components/*`. Planned routes: `/agents`, `/agents/[name]`, `/runs/[id]`, `/approvals`, `/chat`, `/graph`, `/settings`, `/login`.

## 5. Sequences

### 5.1 Human saves a note

1. UI sends `PUT /api/notes/:id` with `{ title, body, baseUpdatedAt }`.
2. `checkAccess` passes (Host, Origin, token).
3. Inside `withNoteLock`: if the note exists and `baseUpdatedAt` differs from the file's mtime, answer `409 note-conflict`. Otherwise write the file atomically (temp file, rename), then `reindexNote`.
4. Response carries the new `updatedAt` (the file mtime). The watcher also sees the change and reindexes again (harmless).

### 5.2 Manual agent run

1. `POST /api/agents/:name/run`. `startRun` checks the agent exists and has no `running` run (`409 agent-busy`), creates a `running` run row, starts the work in the background, and returns `202` with the row.
2. `runAgent` builds the tool set from the agent's grants and a graph: `agent` node (model call) and `tools` node.
3. Loop: model replies; usage tokens are summed (estimated at characters / 4 when missing); if the budget is used up with tool calls pending, stop with `budget-exceeded` before running any tool; otherwise run each tool call and append a tool message for every call (errors become `error: ...` text); repeat until the model answers without tool calls or the step limit (`recursionLimit` 25) is hit.
4. `write_note` inside `withNoteLock`: read the file, record a snapshot (once per run and note), write as author `agent` (frontmatter `author: agent`, `agent: <name>`), remember the resulting `updatedAt`, reindex, log a `note` event. If the write fails, the snapshot is dropped.
5. `finishRun` stores status, tokens and error. The run log (`run_events`) holds prompt, model replies, tool calls and results, notes written, and the stop reason.

### 5.3 Undo

`POST /api/runs/:id/undo` (inside `withNoteLock`): refuse if the run is running or already undone; consider only snapshots with a recorded write time; if any such note's current mtime differs from the recorded one, refuse the whole undo with `409 undo-conflict` (a human edited it after the agent); otherwise restore each snapshot (or delete a note the run created), re-checking each note just before touching it; mark the run undone. Children of a run (call_agent) are undone first. **[children planned]**

### 5.4 Scheduled run **[planned]**

Tick loop every 15 s: per cron agent compute the latest scheduled time at or before now; if it is later than the stored `last_scheduled_for`, store it first, then start a run unless one is running (then record a skip). On first sight of an agent only a baseline is stored (no run). On server start the same logic runs once, which is the catch-up (within a 24 h window).

### 5.5 Heartbeat run **[planned]**

Every `everyMinutes`, compute content hashes of the notes the agent may see (excluding notes this agent wrote); if nothing differs from the stored hashes, do nothing (no model call); otherwise store the new hashes, then start a run whose task lists added, changed and removed note ids.

### 5.6 Strict-mode approval **[planned]**

Graph: `agent -> approve -> tools`. The `approve` node (no side effects) gathers `write_note` calls and calls `interrupt()` once. The run becomes `waiting-approval`, approvals are stored, the checkpoint is saved. The owner decides in the UI; when the last approval for the run is decided, `resumeRun` resumes the graph with the decisions; the `tools` node executes approved calls and answers rejected ones with a rejection text. A restart while waiting keeps the run waiting; the checkpoint survives.

### 5.7 Chat turn **[planned]**

`POST /api/chats/:id/messages` starts a run with trigger `chat`, resumes the thread's checkpoint, streams newline-delimited JSON (`token`, `tool`, `approval`, `done`, `error`) back, persists both messages, and records tokens like any other run.

### 5.8 Live updates and permissions **[planned]**

Every state change publishes a small event (`run`, `run-event`, `note`, `approval`) on an in-process bus; `GET /api/events` streams them as NDJSON to open tabs (max 20), which update without polling and fall back to polling if the stream fails. Before any run starts, `effectiveGrants(agent, instanceSettings)` computes the tools actually offered (agent grant AND instance switch) and clamps the token budget; the run's `prompt` event records the final list.

## 6. Concurrency model

- One process; one Node event loop. All note mutations go through `withNoteLock` (a promise chain). This is why API saves, agent writes and undo cannot interleave.
- At most one `running` run per agent (checked in `startRun`; the check and the insert are synchronous with respect to each other because the check reads the row inserted by the previous call).
- `waitForRuns()` tracks in-flight runs for shutdown and tests.
- Anything outside the process (Obsidian, `git pull` in the vault) can still change files at any time; the mtime check, the per-note recheck in undo, and the watcher handle that.

## 7. Failure modes

| What fails | What happens | Recovery |
| --- | --- | --- |
| Server killed mid-run | run row stays `running`; on next start marked `interrupted` (not `waiting-approval` rows) | start again; re-run the agent |
| Server killed mid-write | atomic rename means the note is old or new, never half | none needed |
| Index corrupt or schema bumped | index dropped and rebuilt from the vault | automatic |
| `state.db` lost | agents and history gone; vault untouched | restore backup; recreate agents from templates |
| Model unreachable / bad key | run ends `failed` with a redacted error; nothing written | fix env, run again |
| Model ignores the budget | per-call `maxTokens` = remaining budget; run stops when used up | raise budget or shorten task |
| Model loops | step limit gives status `step-limit` | fix the prompt |
| Provider omits usage | tokens estimated (characters / 4), so the budget still binds | none |
| Human edits a note after an agent wrote it | undo refuses, naming the notes | resolve by hand |
| Two undos at once | the second answers `already-undone` | none |
| Missed cron ticks while down | one catch-up run on start if within 24 h, else skipped and noted | none |
| Poisoned note or web page | cannot call tools it was not granted, cannot reach unlisted hosts, writes are snapshotted and logged (strict mode: also approved by hand) | undo the run |

## 8. Extension points (v1 stops here on purpose)

- New tool: add the grant to `ToolGrantSchema`, build it in `agent-tools.ts` under the grant, add tests and a threat-model line.
- New provider: add a branch in `llm.ts`; keep the `ChatModel` interface (`invoke(messages) -> AIMessage`).
- New trigger kind: extend `TriggerSchema` and the scheduler tick; add tests with the fake clock.
- Replace LangGraph: everything outside `agent-runtime.ts` sees only `AgentRunner`.
