# Vigil: implementation plan (M1 close-out to v1 release)

Written 2026-11-14 against commit `2b5039b` plus a small uncommitted change (section 1). This plan is written so that a cheaper model, or a person, can execute it task by task without making design decisions and without skipping the boring parts. Where a decision is needed it is already made here, with the reason. Where a fact must be checked at the time of work (a package version, a library API), the plan says so and says where to record the answer.

Read in this order: section 0 (rules), section 1 (state), section 2 (reference), section 3 (gates), then the work packages (WP) in section 4 in the order given. Section 9 lists the shortcuts that break this project; read it before starting.

Companion documents (all in this repo, indexed in `docs/README.md`; coding agents start from `AGENTS.md` at the repo root): `docs/spec/progress.md` (the checklist: tick tasks there), `docs/spec/architecture.md`, `docs/spec/threat-model.md`, `docs/design/ux-spec.md` (every screen, state, string and key; required reading for any UI task), `docs/spec/open-questions.md`, and ADR-0010 to 0014 (drafted, status `Proposed`) and ADR-0015 (accepted).

---

## 0. Rules for whoever implements this

1. **One task at a time.** Each task has an ID (for example `WP2-T3`). Do the task, run its tests and the gates (section 3), then commit it. Do not start the next task with a red gate.
2. **Tests first when the task says so, always before "done".** A task is done when its listed tests exist, fail without the change, and pass with it. "It runs on my machine" is not done.
3. **Do not make design decisions.** If the plan does not cover a case, append the question to `docs/spec/open-questions.md`, then pick the safest option, say so in the commit message, and continue with an unrelated task.
4. **Do not weaken anything to get green.** No deleting a failing test, no loosening an assertion, no `try { } catch { }` that swallows, no `any`, no `@ts-ignore`, no `skip`/`only`, no widening a type to dodge an error. If a gate fails, fix the cause.
5. **Contradicting an ADR needs a new ADR first.** The ADRs live in `docs/adr/`. ADR-0010 to 0014 are already written with status `Proposed` (0015 is accepted); when the work package that implements one starts, change its Status line to `Accepted (date)` and fill in anything the ADR says to record at implementation time (pinned versions, behavior of the installed library) in the same commit. A new decision gets the next number (0016 and up). An ADR is short: Status, Context, Decision, Consequences.
6. **Docs change in the same commit as the behavior.** Each task lists the docs it touches. `docs/spec/progress.md` gets the ticked box for the task; `docs/spec/roadmap.md` gets a status line per finished milestone; `docs/spec/threat-model.md` gets a row for any new tool, route, outbound call or stored secret; `docs/glossary.md` gets any new term.
7. **Never touch the real `vault/`, `data/` or any real API key in tests or scripts.** Tests use temp directories (WP0-T4 enforces this globally). Manual checks use `VAULT_DIR`, `DB_PATH`, `STATE_DB_PATH` pointing at `mktemp -d`.
8. **Never print or log a key.** Not in run events, errors, test output, or commit messages.
9. **Commit style:** conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`), one concern per commit, body says what and why. End the message with the attribution line your tooling requires. Do not push or merge unless the owner asks.
10. **When something surprises you, record it.** A surprising behavior of a library goes in the ADR for that work package, under Consequences.

---

## 1. Where the repo is today

### 1.1 Layout

```
vigil/
  apps/server/src/      Node HTTP API (no framework; hand-written router in http.ts)
  apps/web/src/         SvelteKit 2 + Svelte 5, one route (+page.svelte), 3 components
  packages/shared/src/  zod schemas and slugify (index.ts)
  docs/                 spec/, adr/ (0001 to 0009), design/ui.md, conventions.md, glossary.md
  vault/  data/         runtime data, gitignored. Never commit, never use in tests.
```

### 1.2 What is built (committed)

- **M0 notes foundation.** Flat markdown vault (`vault.ts`), SQLite index (`index-db.ts`, `SCHEMA_VERSION = 2`, FTS5 table `notes_fts`), file watcher (`watcher.ts`), REST API for notes and search, editor UI (CodeMirror source pane plus separate preview pane), local-only access control (`access.ts`, ADR-0007).
- **M1 agent runtime (server only).** `agent-runtime.ts` (LangGraph graph: `agent` node, own `tools` node), `agent-tools.ts` (`read_notes`, `write_notes` grants), `llm.ts` (OpenAI-compatible and Ollama adapters from env), `runs.ts` (`startRun`, `undoRun`), `state-db.ts` (`data/state.db`, migration 1: `agents`, `runs`, `run_events`, `snapshots`), routes under `/api/agents` and `/api/runs`.
- 60 server tests, 8 shared, 9 web; typecheck covers all three packages.

### 1.3 Uncommitted at the time of writing (finish first, WP0)

Files: `apps/server/src/lock.ts` (new), and edits to `http.ts`, `agent-tools.ts`, `runs.ts`, `state-db.ts`. They answer an automated security review of the M1 commit:

- Undo skipped its edit check when a snapshot had no recorded write time. Now such snapshots are skipped entirely (the agent never finished writing that note), and a snapshot whose write failed is dropped (`dropSnapshot`).
- A check-then-act race between undo, API saves/deletes and the agent's write tool. Now all of them run under one in-process lock (`withNoteLock`), and undo re-checks each note right before touching it.
- All 60 tests pass with these edits, but **no test covers the new behavior yet**. WP0-T1 adds them.

### 1.3a Known gaps (the work below closes each)

| Gap | Closed in |
| --- | --- |
| No tests for the lock, `dropSnapshot`, null-write-time skip | WP0-T1 |
| Server does not shut down cleanly; no `.env.example` | WP0-T2, T3 |
| Any test that forgets its env could write into the repo's `data/` (one stray `state.db` was seen once) | WP0-T4 |
| Agent `trigger` only allows `"manual"`; no `enabled`, no `strict` | WP1 |
| No cron, no heartbeat, no chat, no `call_agent`, no strict mode | WP2, WP6 to WP9 |
| No agents UI, run viewer, command palette | WP4 |
| Editor is source + separate preview, not live preview; no wikilink help, no backlinks | WP5 |
| No `web_fetch` tool | WP10 |
| No graph | WP11 |
| No browser login for non-local installs, no Docker, no PWA, README has no demo | WP12 |

---

## 2. Reference

### 2.1 Processes and data stores

One Node process (the server) serves the JSON API, and in production also the built web app (WP12). Three stores, never mixed:

| Store | Path (default) | Env override | Disposable? | Holds |
| --- | --- | --- | --- | --- |
| Vault | `vault/` | `VAULT_DIR` | **No. This is the user's data.** | markdown notes (`<id>.md`) |
| Index | `data/index.db` | `DB_PATH` | Yes, rebuilt from the vault | notes, `notes_fts`, `notes_body`, `links` |
| State | `data/state.db` | `STATE_DB_PATH` | **No.** Additive migrations only | agents, runs, run events, snapshot records, schedules, approvals, chats |
| Snapshots | `data/snapshots/<note-id>/<run-id>.md` | follows state path | No | pre-write copies of notes |
| Checkpoints (WP8) | `data/checkpoints.db` | `CHECKPOINT_DB_PATH` | No | paused LangGraph runs |
| Session key (WP12) | `data/session.key` | `SESSION_KEY_PATH` | No | 32 random bytes for signing login cookies, mode 0600 |

### 2.2 Environment variables (final list)

| Variable | Default | Used by |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | server bind address. Non-loopback requires `VIGIL_TOKEN` |
| `PORT` | `3001` | server |
| `VIGIL_TOKEN` | unset | API bearer token and login password |
| `VIGIL_ALLOWED_HOSTS` | empty | extra Host header names (reverse proxy domain) |
| `VAULT_DIR`, `DB_PATH`, `STATE_DB_PATH`, `CHECKPOINT_DB_PATH`, `SESSION_KEY_PATH` | see 2.1 | stores |
| `VIGIL_LLM_PROVIDER` | `openai` | `openai` or `ollama` |
| `VIGIL_LLM_BASE_URL` | OpenAI URL / Ollama `http://127.0.0.1:11434` | model endpoint |
| `VIGIL_LLM_API_KEY` | unset | endpoint key. Never stored, logged or returned by the API |
| `VIGIL_LLM_MODEL` | unset | default model; an agent may override |
| `VIGIL_TZ` | system zone | default time zone for cron (WP2) |
| `VIGIL_MONTHLY_TOKEN_CAP` | unset | soft monthly cap (WP3) |
| `VIGIL_STATIC_DIR` | unset | serve the built web app from this directory (WP12) |
| `VIGIL_COOKIE_SECURE` | auto | force the `Secure` cookie flag (WP12) |

### 2.3 Error codes in use (`AppError(code, message, status)`)

`invalid-id` 400, `invalid-body` 400, `bad-host` 403, `bad-origin` 403, `unauthorized` 401, `note-not-found` 404, `agent-not-found` 404, `run-not-found` 404, `not-found` 404, `note-exists` 409, `note-conflict` 409, `agent-busy` 409, `run-active` 409, `already-undone` 409, `undo-conflict` 409, `payload-too-large` 413, `internal` 500. New codes are added in the task that needs them and listed in the API reference (section 6).

### 2.4 Response envelope (unchanged, never deviate)

Success `{ "data": ... }`. Failure `{ "error": { "code", "message" } }` with the right HTTP status. kebab-case URL segments, camelCase JSON.

### 2.5 Where things are decided

`docs/spec/v1-scope.md` (13 locked decisions), ADR-0001 to 0009. The ones agents work must honor: ADR-0004 (tools, budgets, snapshots), ADR-0006 (web fetch rules), ADR-0007 (access), ADR-0009 (LangGraph).

---

## 3. Gates and definition of done

### 3.1 The gate command

Run from the repo root. It must be green before every commit:

```
pnpm typecheck && pnpm test
```

`pnpm typecheck` covers shared, server and web (`svelte-check`). CI (`.github/workflows/ci.yml`) runs the same two commands; WP12 adds a Docker build.

### 3.2 Definition of done for any task

- The task's tests exist and pass; the new tests fail when the change is removed (spot-check by reverting the source change once).
- The gate command passes with zero new warnings from `svelte-check`.
- No `any`, no unexplained `as` casts (a cast needs a one-line comment saying why it is safe), no `console.log` left over (use `console.error` for operational errors only), no TODO without an entry in `docs/spec/open-questions.md`.
- Docs listed in the task are updated.
- No file outside the task's list changed, except test fixtures.
- For UI tasks: keyboard reachable, visible focus, contrast >= 4.5:1, `prefers-reduced-motion` honored, no raw color values outside `apps/web/src/app.css`, no emoji icons (Lucide, 1.5px stroke).

### 3.3 Manual smoke test (run after each WP that changes runtime behavior)

```
T=$(mktemp -d)
VAULT_DIR=$T/vault DB_PATH=$T/index.db STATE_DB_PATH=$T/state.db PORT=3199 pnpm --filter @vigil/server dev
# in another shell
curl -s localhost:3199/api/health
```

Then exercise the new feature with `curl` and read the response bodies; do not assume. Stop the server and delete `$T` afterwards.

---

## 4. Work packages

Order is fixed: WP0, WP1, WP2, WP3, WP4, WP5, WP6, WP7, WP8, WP9, WP10, WP11, WP12. WP13 is the post-v1 backlog. Each WP lists its dependencies; do not reorder past them.

Why this order: M2 (scheduled agents with the Morning Digest) is the first demo and the point of the product, so the scheduler, the template and the screens that show them come before anything else. The editor upgrade (WP5) and graph come later because they do not change whether agents work.

---

### WP0: Close M1 (finish and harden what exists)

**Goal:** the uncommitted security fixes are tested and committed; the server can start and stop safely; tests can never touch real data.

**Depends on:** nothing.

#### WP0-T1: Tests for the lock, `dropSnapshot`, and null-write-time skip

Files: new `apps/server/src/lock.test.ts`, new `apps/server/src/agent-write-failure.test.ts`, edit `apps/server/src/agents.test.ts`.

Tests to write (names are the contract):

1. `lock.test.ts`, `withNoteLock runs tasks one at a time, in call order`: start three async tasks that each push "start-N", await a short timer, push "end-N". Assert the log is `start-1, end-1, start-2, end-2, start-3, end-3`.
2. `lock.test.ts`, `withNoteLock keeps going after a task throws`: first task rejects; second still runs and resolves; the first caller still receives the rejection.
3. `agents.test.ts`, describe `undo`, `two concurrent undos of one run: one succeeds, the other answers already-undone`: run an agent that creates a note, then `await Promise.allSettled([undoRun(id), undoRun(id)])`. Exactly one fulfilled, the other rejected with code `already-undone`; note is gone.
4. `agents.test.ts`, `undo leaves a note alone when its snapshot has no recorded write time`: seed a human note "Plan"; create a run row with `createRun`; call `recordSnapshot(runId, "plan", <raw file text>)` and never `setWrittenUpdatedAt`; edit the note as a human; `undoRun` resolves, the human edit is intact, and `touched` still lists the note (snapshot row is kept).
5. `agent-write-failure.test.ts` (separate file because it mocks a module): use `vi.mock("./vault", async (orig) => ({ ...(await orig<typeof import("./vault")>()), createNote: vi.fn().mockRejectedValue(new Error("disk full")) }))`. Run an agent whose script calls `write_note` for a new title. Assert: the run still ends `succeeded` (the tool returned error text to the model), `listSnapshots(runId)` is empty, no snapshot file exists under `data/snapshots`, and the run log has a `tool-result` event starting with `error:`.
6. `agents.test.ts`, `an API save and an undo never interleave`: unit-level, assert via `withNoteLock` order test with the real `undoRun` and a PUT-like function wrapped in the lock. Optional if test 1 and 3 already cover it; do it only if cheap.

Done when: all new tests pass; temporarily removing `withNoteLock` from `undoRun` makes test 3 fail (check once, restore).

Commit: `test(server): cover note lock, failed-write snapshots, undo without write time`, then a separate `fix(server): serialize note writes and undo, harden undo checks` for the already-written source edits. If the source edits are still uncommitted, commit them first with the fix message, then the tests.

#### WP0-T2: Graceful shutdown

Files: `apps/server/src/index.ts`, `apps/server/src/server.ts`, test `apps/server/src/shutdown.test.ts`.

Behavior: on `SIGTERM` and `SIGINT`: stop accepting connections (`server.close`), stop the watcher (`startWatcher()` already returns `{ close() }`; keep its handle), wait for `waitForRuns()` up to 10 seconds, then `closeDb()`, `closeState()`, exit 0. A second signal exits immediately with code 1. Runs still `running` after the 10 s are left as they are; the next start marks them `interrupted` (already implemented in `markInterruptedRuns`).

Implementation notes: export `async function shutdown(deps)` from a new `apps/server/src/shutdown.ts` taking `{ server, watcher, timeoutMs }` so it is testable without signals. `index.ts` wires the signals.

Tests: `shutdown stops the server and waits for a running run`, `shutdown gives up waiting after the timeout` (inject a never-resolving run via `setRunDeps`, `timeoutMs: 50`).

#### WP0-T3: `.env.example` and README run section

Files: new `.env.example` at the repo root (already allowed by `.gitignore`: `!.env.example`), `README.md`.

`.env.example` lists every variable from 2.2 with a one-line comment, with example values that are obviously fake (`VIGIL_LLM_API_KEY=` empty). README gets: prerequisites (Node 24, pnpm 11), install, the two dev commands, how to point at Ollama, the warning that agents write into your vault (undo exists), and the local-only default. Do not add the Docker section yet (WP12).

#### WP0-T4: Make it impossible for a test to touch real data

Files: `apps/server/vitest.config.ts` (new), `apps/server/src/test-setup.ts` (new).

`test-setup.ts` runs before every test file: create a throwaway directory with `mkdtempSync(path.join(os.tmpdir(), "vigil-test-"))`, set `VAULT_DIR`, `DB_PATH`, `STATE_DB_PATH`, `CHECKPOINT_DB_PATH`, `SESSION_KEY_PATH` under it, and register `process.on("exit")` to remove it. Individual tests may still override (existing tests do). `vitest.config.ts`: `{ test: { setupFiles: ["./src/test-setup.ts"] } }`.

Add a guard test `test-setup.test.ts`: `default paths point into the temp directory, not the repo` asserting `vaultDir()`, `dbPath()`, `statePath()` do not start with `REPO_ROOT`.

Done when: running the whole suite leaves `git status` clean and `ls data/` unchanged (check before and after).

#### WP0-T5: Docs

`docs/spec/roadmap.md`: M1 line stays "done"; add "hardened" with the date. Mention `.env.example`.

**WP0 acceptance:** gate green; `git status` clean after the suite; the three commits exist.

---

### WP1: Agent model v2 (schema changes everything later needs)

**Goal:** change the shared agent schema once, correctly, so WP2 to WP9 do not each reshape it. Also add per-note author-agent provenance used by heartbeat loop prevention and the UI.

**Depends on:** WP0.

#### WP1-T1: New `AgentSchema`

File: `packages/shared/src/index.ts`, tests in `packages/shared/src/index.test.ts`.

Replace the `trigger` field and add fields. Final shape:

```ts
export const TriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("cron"), expression: z.string().min(1), timezone: z.string().optional() }),
  z.object({ kind: z.literal("heartbeat"), everyMinutes: z.number().int().min(5).max(1440) }),
]);

export const ToolGrantSchema = z.enum(["read_notes", "write_notes", "web_fetch", "call_agents"]);

export const AgentSchema = z.object({
  name: AgentNameSchema,
  description: z.string().max(280).default(""),
  systemPrompt: z.string().min(1),
  tools: z.array(ToolGrantSchema).default([]),
  trigger: z.preprocess(
    (v) => (v === "manual" ? { kind: "manual" } : v), // definitions saved by M1 stored the string
    TriggerSchema,
  ).default({ kind: "manual" }),
  enabled: z.boolean().default(true),
  /** Writes wait for approval (WP8). The owner decides per agent in the UI; the default for a new agent comes from instance permission settings (WP3-T5). */
  strict: z.boolean().default(false),
  tokenBudget: z.number().int().positive().max(1_000_000).default(20_000),
  model: z.string().min(1).optional(),
  defaultTask: z.string().default("Do your job now."),
  /** Hosts `web_fetch` may call (WP10). Exact host names, no wildcards. */
  allowedHosts: z.array(z.string().min(1)).default([]),
  /** Agents this one may start with `call_agent` (WP7). Empty means none. */
  callable: z.array(AgentNameSchema).default([]),
  /** Instruction for a chat agent: appended to the system prompt in chat threads (WP9). */
  archetypeHint: z.string().optional(),
});
```

Also: `RunStatusSchema` gains `"waiting-approval"` and `"skipped"` (skipped is used by WP2 for overlaps; it is a run row with no events but one `stop` event). `RunSchema` gains `trigger: z.enum(["manual","cron","heartbeat","chat","call"])`, `parentRunId: z.string().nullable()`. `NoteSchema` gains `agentName: z.string().optional()`.

Tests: old stored definition (`trigger: "manual"` string) still parses to `{kind:"manual"}`; cron without expression is rejected; `everyMinutes: 1` rejected; unknown tool grant rejected; every default is applied.

#### WP1-T2: Migration 2 and 3 in `state-db.ts`

Append two entries to `MIGRATIONS` (never edit migration 1):

```sql
-- migration 2: schedules, run lineage, instance settings
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL            -- JSON
);
CREATE TABLE schedule_state (
  agent TEXT PRIMARY KEY,
  last_scheduled_for TEXT,       -- ISO time of the last cron tick we acted on
  last_started_at TEXT,
  last_skip_reason TEXT
);
ALTER TABLE runs ADD COLUMN trigger TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE runs ADD COLUMN parent_run_id TEXT;
CREATE INDEX runs_parent ON runs(parent_run_id);

-- migration 3: what agents read and wrote (graph edges, WP11) and heartbeat memory (WP6)
CREATE TABLE agent_touches (
  agent TEXT NOT NULL,
  note_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'read' | 'wrote'
  run_id TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX agent_touches_agent ON agent_touches(agent, at);
CREATE INDEX agent_touches_note ON agent_touches(note_id, at);
CREATE TABLE heartbeat_state (
  agent TEXT PRIMARY KEY,
  last_checked_at TEXT,
  last_hashes TEXT               -- JSON {"note-id": "hash", ...}
);
```

`createRun` gets optional `trigger` and `parentRunId` parameters (defaults `manual`, `null`); `toRun` maps them. Existing callers keep working.

Tests (in a new `state-db.test.ts`): a database created by migration 1 only, opened with the new code, ends at `user_version = 3` and keeps its rows (create a v1 file by running only `MIGRATIONS[0]` through a helper, or by copying the SQL into the test); `createRun` with trigger and parent round-trips.

#### WP1-T3: Provenance: `agent` frontmatter and index column

Files: `apps/server/src/vault.ts`, `apps/server/src/index-db.ts`, tests in `vault.test.ts` and `index-db.test.ts`.

- `serialize`: when `note.author === "agent"` and `note.agentName` is set, write `agent: <name>` in frontmatter. `parse` reads it into `agentName`.
- `WriteOptions` gains `agentName?: string`; `createNote`/`updateNote` pass it into the note. `write_note` in `agent-tools.ts` needs the agent's name: add `agentName` to `ToolContext` (set in `runAgent` from `agent.name`).
- Index: `SCHEMA_VERSION = 3`. `notes` table gains `agent_name TEXT` and `hash TEXT`. `hash` = sha256 hex of `title + "\n" + tags.join(",") + "\n" + body`. `reindexNote` computes it. `NoteRow` (= `Note`) carries `agentName` but not `hash`; add `export function noteHashes(): Record<string,string>` returning `{id: hash}` for all notes (used by WP6).
- Because the version changed, the index rebuilds itself on next start (existing mechanism).

Tests: a note written by agent "digest" round-trips `agentName`; a human edit clears `agent` frontmatter and `agentName` (an `updateNote` without `agentName` option writes author human); `noteHashes()` changes when the body changes and not when only `updatedAt` changes; opening an index at version 2 rebuilds.

#### WP1-T4: API validation

`PUT /api/agents/:name` already validates with `AgentSchema`. Add: reject `tools` containing `web_fetch` while `allowedHosts` is empty? No: an empty allowlist means the tool refuses every request (ADR-0006), so it is allowed. Reject `call_agents` without `callable` entries? Allowed, same reason. Reject a `cron` expression that does not parse: implement in WP2-T1 (needs the parser); until then store it.

Docs: ADR-0010 is written in WP2 (scheduler). Update `docs/glossary.md`: add "Trigger", "Enabled", "Strict", "Callable".

**WP1 acceptance:** gate green; an agent saved by M1 (string trigger) still loads; fresh index rebuild works with `author`/`agent` fields.

---

### WP2: M2 scheduled agents (cron with catch-up)

**Goal:** an agent with a cron trigger runs on schedule, at most once per scheduled time, survives restarts without double-running, and runs once on start when a recent tick was missed.

**Depends on:** WP1.

#### WP2-T1: ADR-0010 and dependency

ADR-0010 (`docs/adr/0010-scheduler-tick-loop.md`) is already drafted; set its Status to Accepted and fill in the pinned parser version. It amends v1 scope decision 13 ("node-cron in-process"):

- **Decision:** do not use `node-cron` for firing. A one-second-resolution timer cannot catch up after downtime, and its callbacks are hard to test. Use a tick loop (`setInterval` every 15 seconds) that asks a cron parser "what is the latest scheduled time at or before now?" and compares it with the persisted `last_scheduled_for`.
- **Parser:** `cron-parser`. At implementation time run `npm view cron-parser version` and `npm view cron-parser peerDependencies`, pin the exact version with `pnpm add --save-exact cron-parser@<version>` in `apps/server`, record the version in the ADR, and read its current docs (Context7 or the README) for the API of that version; do not rely on memory of an older API. If the API is awkward, the fallback is `croner`; record the choice either way.
- **Guarantees:** at most once per scheduled time (persist before starting); run at most once on start for the latest missed tick; no catch-up if the missed tick is older than `catchUpWindowHours` (default 24); never two runs of one agent at once; a tick that lands while the agent is running is recorded as skipped.
- **Time zones:** each cron trigger has an optional IANA time zone; default `VIGIL_TZ`, then the system zone. Validate zones with `Intl.DateTimeFormat(undefined, { timeZone })` in a try block, and reject unknown zones with `invalid-body`.

#### WP2-T2: `scheduler.ts`

File: `apps/server/src/scheduler.ts`, test `apps/server/src/scheduler.test.ts`.

Interface (injectable clock and runner, so tests never sleep):

```ts
export type SchedulerDeps = {
  now: () => Date;
  listAgents: () => Agent[];
  startRun: (name: string, task: string | undefined, trigger: "cron" | "heartbeat") => Run;
  hasRunning: (name: string) => boolean;
  catchUpWindowMs: number;
};
export function createScheduler(deps: SchedulerDeps): { tick(): void; start(intervalMs?: number): void; stop(): void };
```

`tick()` logic, per agent with `enabled && trigger.kind === "cron"`:

1. `prev = latestTickAtOrBefore(expression, timezone, now)`. If the expression does not parse, record `last_skip_reason = "bad cron expression"` and continue (never throw out of a tick).
2. Read `schedule_state.last_scheduled_for` (`last`).
3. **First sight** (`last` is null): write `last_scheduled_for = prev` and do not run. Reason: saving an agent at 10:00 must not fire the 07:00 run.
4. If `prev <= last`: nothing to do.
5. If `now - prev > catchUpWindowMs`: write `last_scheduled_for = prev`, set skip reason `"missed, older than catch-up window"`, do not run.
6. Otherwise: **write `last_scheduled_for = prev` first** (at most once, even if the process dies right after), then if `hasRunning(name)` set skip reason `"previous run still going"`, else call `startRun(name, undefined, "cron")` and set `last_started_at`.

`start()` calls `tick()` immediately (this is the on-start catch-up) and then every `intervalMs` (default 15000). `stop()` clears the timer. The timer is `unref()`ed so it never keeps the process alive.

Wire in `index.ts`: create and start the scheduler after `markInterruptedRuns()`; `shutdown` (WP0-T2) stops it.

`startRun` gains a `trigger` argument (`manual` default) and stores it on the run row. The API route keeps `manual`.

Also in WP2-T2: when an agent is saved or enabled (`PUT /api/agents/:name`), call `scheduler.refresh(name)` which performs the first-sight step immediately, so a freshly saved agent has its baseline before the next tick. Expose `refresh` on the scheduler object.

Tests (all with a fake clock and a fake `startRun`):

1. first sight records the baseline and does not run
2. a tick at 07:00:10 runs once for the 07:00 schedule; a second tick at 07:00:25 does not run again
3. restart: a new scheduler instance over the same state, now 07:30, last run was yesterday 07:00 => runs once (catch-up)
4. three missed days: now is 3 days after the last tick => no run, skip reason mentions the window
5. overlap: `hasRunning` true at the tick => no run, skip reason set, `last_scheduled_for` advanced
6. disabled agent never runs; re-enabling does the first-sight step, no immediate run
7. time zone: expression `0 7 * * *` with `Europe/Istanbul` fires at 04:00 UTC, not 07:00 UTC
8. bad expression: tick does not throw, skip reason recorded
9. daylight saving: pick a zone with a transition (for example `America/New_York` on a March date) and assert the tick count is one per calendar day, not zero or two
10. the persist-before-start rule: make the fake `startRun` throw; `last_scheduled_for` is still advanced (so a crashing agent cannot retry in a tight loop)

#### WP2-T3: Validation at the API

`PUT /api/agents/:name`: when `trigger.kind === "cron"`, validate the expression and zone with the same parser; reject with `invalid-body` and a message that names the problem. When `trigger.kind === "heartbeat"` and the agent has no `read_notes`, reject (a heartbeat that cannot read has nothing to watch). Add tests in `agents-api.test.ts`.

#### WP2-T4: Schedule visibility endpoint

`GET /api/agents/:name/schedule` returns `{ trigger, enabled, nextRunAt, lastScheduledFor, lastStartedAt, lastSkipReason }`. `nextRunAt` comes from the parser (`next()` after now in the zone). The agents screen (WP4) shows it.

**WP2 acceptance:** gate green. Manual: save an agent with cron `* * * * *` (every minute), watch a run appear within about 15 s of each minute boundary, stop the server, wait two minutes, start it, see exactly one catch-up run (not two), and `GET /api/agents/:name/schedule` shows the skip/start fields. Record the commands and what you saw in the commit body.

---

### WP3: M2 templates and usage cap

**Goal:** one-click agent creation from templates, with the Morning Digest as the flagship, and the soft monthly token cap from ADR-0003.

**Depends on:** WP2 (for the cron trigger).

#### WP3-T1: Template registry

File: `packages/shared/src/templates.ts` (exported from `index.ts`), test `templates.test.ts`.

```ts
export type AgentTemplate = { id: string; title: string; summary: string; needs: ("llm" | "web")[]; agent: Omit<Agent, "name"> };
export const TEMPLATES: AgentTemplate[]
```

Every template's `agent` must parse with `AgentSchema` (the test loops over all of them). Templates for v1 (ship these five; text is final, copy it exactly, adjust only typos):

1. **`morning-digest`**, tools `read_notes`, `write_notes`, trigger `{kind:"cron", expression:"0 7 * * *"}`, `tokenBudget: 30000`, `strict: false`. System prompt:
   > You write a short morning digest of the user's notes. Steps: (1) Work out yesterday's date from today's date and call `list_notes` with `since` set to the start of yesterday (00:00 in the user's day; if unsure use 36 hours ago). (2) Read each listed note with `read_note`; skip notes whose author is an agent unless they are the only source of an important fact. (3) Write ONE note with `write_note`, title exactly `Digest YYYY-MM-DD` using today's date, body in Markdown: a one-line summary, then sections "What changed", "Open questions", "Suggested next steps". Be concrete and short; quote note titles in `[[double brackets]]` so they become links. (4) If there is nothing new, write the note anyway with the single line "Nothing changed." (5) Reply with the single word `done`.
   The title rule makes the run idempotent: a second run on the same day replaces the same note (and the snapshot protects the first version).
2. **`weekly-review`**: cron `0 18 * * 5` (Friday 18:00), reads the last 7 days, writes `Weekly review YYYY-MM-DD` with wins, stalled items, and three priorities for next week. Budget 40000.
3. **`inbox-triager`**: heartbeat every 30 minutes, tools `read_notes`, `write_notes`; watches the note titled "Inbox" and, when it changes, appends each new line to the right existing note or proposes a new note title; never deletes anything. Budget 15000. `strict: true` by default (it edits existing notes).
4. **`backlink-gardener`**: heartbeat every 60 minutes, tools `read_notes`, `write_notes`, `strict: true`; finds notes that mention another note's title in plain text and proposes adding `[[wikilinks]]`. Budget 20000.
5. **`research-scout`**: manual, tools `read_notes`, `write_notes`, `web_fetch`, `strict: true`, `allowedHosts: []` (the user must fill hosts in; the UI shows a warning when empty). Reads a note named "Research queue", fetches the listed URLs, writes `Scout YYYY-MM-DD` with summaries and source URLs. Budget 40000.

Each template also has a plain-English `summary` of at most 160 characters shown in the gallery.

Tests: all templates parse; names/ids unique; cron templates have valid expressions (use the WP2 parser helper); any template with `web_fetch` has `strict: true`; any template with `read_notes` and `web_fetch` together has `strict: true` (ADR-0006).

#### WP3-T2: API

`GET /api/agent-templates` returns the registry. `POST /api/agents/from-template/:id` with body `{ name?: string }` creates the agent **with `enabled: false`** (name defaults to the template id; `409 agent-exists` if taken, new error code) and returns it. The route must not run the agent and must not schedule it: a template does nothing until the owner presses "Turn on" on the agent page (decision 7: templates ship, but they only work once the user starts them). `POST /api/agents/:name/run` (Run now) still works on a disabled agent, so a user can try it before turning it on.

Tests in `agents-api.test.ts`: list returns five; creating twice conflicts; created agent equals the template with the name set.

#### WP3-T3: Usage and soft monthly cap

File: `apps/server/src/usage.ts`, route `GET /api/usage`, test `usage.test.ts`.

- `monthTokens(now)`: `SELECT COALESCE(SUM(tokens_used),0) FROM runs WHERE started_at >= <first of month, UTC ISO>`.
- `GET /api/usage` returns `{ month: "2026-11", tokens, cap: number | null, level: "ok" | "warn" | "over" }`; `warn` at 80% of `VIGIL_MONTHLY_TOKEN_CAP`, `over` at 100%. No cap set means `level: "ok"`, `cap: null`.
- **Soft cap:** exceeding the cap never blocks a run (ADR-0003 says "soft cap with warning"). The cap only drives the `level` that the UI banner shows (WP4-T7). Do not add run events, do not change `startRun`, do not change the scheduler.

Tests: tokens from two runs in one month sum; a run from last month is excluded; level thresholds at 79/80/100 percent.

#### WP3-T4: LLM status endpoint (onboarding support)

`GET /api/llm/status` returns `{ provider, baseUrl, model, hasKey: boolean, reachable: boolean | null }`. **Never return the key.** `reachable` is computed only when the caller passes `?probe=1`: for `ollama`, GET `<baseUrl>/api/tags` with a 2 s timeout; for `openai`, GET `<baseUrl>/models` with the key and a 3 s timeout; any failure gives `false`, never an error. Test with a local stub server (loopback is fine here: this endpoint talks to the user's own configured model host, not to arbitrary URLs from a model). Add a test that the response body, serialized, does not contain the configured key.

#### WP3-T5: Instance permission settings (the configuration page's backend)

Goal: the owner configures what agents may do, from the UI, without touching files. Two layers: instance-wide switches (a kill switch above every agent) and per-agent grants (WP4-T3).

Files: `apps/server/src/permissions.ts`, route `GET|PUT /api/settings/permissions`, test `permissions.test.ts`. Storage: the `settings` table from migration 2, key `permissions`, JSON validated by a shared zod schema `PermissionSettingsSchema` in `packages/shared/src/index.ts`:

```ts
export const PermissionSettingsSchema = z.object({
  /** Instance-wide switches. A tool that is off here is unavailable to every agent, whatever its own grants say. */
  tools: z.object({
    read_notes: z.boolean().default(true),
    write_notes: z.boolean().default(true),
    web_fetch: z.boolean().default(true),
    call_agents: z.boolean().default(true),
  }).default({}),
  /** New agents (and agents created from templates) start with approvals on or off. */
  newAgentsStrict: z.boolean().default(true),
  /** No run may use more tokens than this, whatever an agent's own budget says. */
  maxTokenBudget: z.number().int().positive().max(1_000_000).default(200_000),
});
```

Semantics (enforced in one function `effectiveGrants(agent, settings)` used by `buildTools`, the scheduler and `startRun`):

- A grant is effective only if the agent has it **and** the instance switch is on. An agent whose grant is switched off keeps its definition; the run log's `prompt` event lists the tools actually available.
- `tokenBudget` used by a run is `min(agent.tokenBudget, settings.maxTokenBudget)`.
- Turning a switch off takes effect for runs that start afterwards; a run already in progress keeps the tools it started with.
- `newAgentsStrict` only sets the default `strict` value when an agent is created without one (API default and template creation); it never changes existing agents.
- The owner can turn off approvals for any agent (no hidden forced behavior). The UI shows a warning when the agent can both read notes and fetch the web (WP4-T3), but the API accepts the change with no extra flag.

Tests: defaults when nothing is stored; a stored partial object is filled with defaults; invalid body gives `400 invalid-body`; with `web_fetch` off the fake model never sees a `fetch_url` tool even for an agent that has the grant; budget clamp; `newAgentsStrict: false` makes a template-created agent non-strict, `true` makes it strict; existing agents are unchanged when the setting changes.

#### WP3-T6: Retention housekeeping

File: `apps/server/src/housekeeping.ts`, test `housekeeping.test.ts`. A function `prune(now)` run once at startup and then every 24 hours (unref'd timer, stopped by shutdown):

- delete `run_events` older than the retention period (default **90 days**, setting `retentionDays` in the same settings table, min 7, 0 means keep forever);
- delete snapshot files and `snapshots` rows for runs older than the retention period and mark such runs as not undoable (`touched` stays for display; `undoRun` answers `410 undo-expired`, new error code, with the message "This run is too old to undo.");
- never delete `runs` rows, approvals that are pending, or anything for a run in `running` or `waiting-approval`.

Add `retentionDays` (default 90) to `PermissionSettingsSchema`'s sibling `GeneralSettingsSchema` or to the same object; keep one `GET|PUT /api/settings/permissions` for permissions and add `retentionDays` as a field of the same schema to avoid a second endpoint. Tests: old events pruned, recent kept, waiting run untouched, undo of an expired run answers `undo-expired`, `0` keeps everything.

**WP3 acceptance:** gate green; `curl -X POST .../api/agents/from-template/morning-digest` then the schedule endpoint shows the next 07:00; run it manually with Ollama and read the digest note.

---

### WP4: M2 web: agents screen, run viewer, command palette, usage banner

**Goal:** the owner can see what agents are doing, run one, read its log, and undo. This is the product's home surface (ADR-0002: "the home surface shows agent activity").

**Depends on:** WP2, WP3. Read `docs/design/ui.md` and ADR-0005 before starting; the two-pass rule applies (conventions.md): write the tokens/layout plan as a comment block in the PR description or commit body first, critique it against generic AI looks (cream+serif+terracotta, near-black+acid-green, uniform rounded card grids, all-caps eyebrows), then build.

#### WP4-T1: App shell and routing

Files: `apps/web/src/routes/+layout.svelte` (keep font imports and `app.css`), new `apps/web/src/lib/components/Shell.svelte`, routes:

```
/                  notes (move the current +page.svelte logic here unchanged in behavior)
/agents            agents list (ledger)
/agents/[name]     agent detail: definition, schedule, run now, run list
/runs/[id]         run viewer
/settings          LLM status, usage, version (read-only in v1)
```

A narrow left rail (icons: Lucide `notebook-text`, `bot`, `settings`) plus a top strip with the ⌘K hint. Add `lucide-svelte`? Check at implementation time which Lucide package supports Svelte 5 (`@lucide/svelte`); pin the exact version; icons are 1.5px stroke (`strokeWidth={1.5}`).

Web API client: extend `apps/web/src/lib/api.ts` with typed functions for every endpoint used here (agents, templates, runs, undo, schedule, usage, llm status). Keep the one `request<T>` helper. Add tests in `api.test.ts` for URL, method and body of each new function (the file's `stubFetch` helper exists).

#### WP4-T2: Agents list ("ledger rows")

`/agents`: a ledger, not cards (ui.md): one row per agent: status dot (amber while running, `--ok` last run succeeded, `--err` last run failed/budget/step-limit, muted when never run or disabled), mono timestamp of the last run, serif agent name, mono schedule text ("daily 07:00" derived from the cron expression with a tiny formatter, fall back to the raw expression; test the formatter), next run time. Row click opens `/agents/[name]`. Empty state (centered, the only centered text allowed): "No agents yet" with the template gallery below it.

Template gallery: five rows from `GET /api/agent-templates` with title, summary, a "needs" note (LLM configured? web?), and an "Add" button calling `POST /api/agents/from-template/:id`. The Morning Digest row is first and visually the primary action. After adding, the app opens the new agent's page with the "Turn on" panel showing (see WP4-T3); the agent stays off until the owner turns it on.

Poll `GET /api/runs?limit=...` every 3 s while the tab is visible (`document.visibilityState`), stop polling when hidden. Add a `limit` query to `GET /api/runs` (default 50, max 200) with a test.

#### WP4-T3: Agent detail

**Turn on panel:** while an agent is disabled, a bordered panel at the top reads "This agent is off. It will not run on its own until you turn it on." and shows, in plain words, the schedule ("Runs daily at 07:00"), the permissions it has ("Can read your notes. Can write notes: every write is saved first so you can undo. Needs your approval before writing: on/off") and a primary "Turn on" button (calls `PUT` with `enabled: true`) beside a ghost "Run once now". Enabling performs the scheduler's baseline step (WP2-T2 `refresh`). Permissions blocked by an instance switch (WP3-T5) show as disabled checkboxes with the text "Turned off in Settings" and a link to Settings > Permissions.

Shows: description, trigger and next run (from the schedule endpoint), enabled toggle, strict toggle (with a note explaining it), token budget, model, tool grants as read-only chips, "Run now" button (disabled while a run is in progress, shows the 409 message if any), and the last 20 runs as ledger rows. Editing the system prompt: a plain textarea with a Save button that `PUT`s the whole definition (client builds the object from the loaded agent plus edits; never send fields the form does not know about as undefined; round-trip test the form-to-agent function).

Validation errors from the API (`invalid-body` messages) display inline under the field, using the message text.

#### WP4-T4: Run viewer

`/runs/[id]`: header with agent name, status, tokens used / budget (a thin bar, not a chart), times, trigger, and an **Undo** button (enabled when `touched` is non-empty, status is not `running`, and `undone` is false). Body: the event list as a terminal-grade log: mono, muted ink, one line per event with a short kind label (`PROMPT`, `MODEL`, `CALL`, `RESULT`, `DENIED`, `NOTE`, `STOP`), expandable for long text. `note` events render the note id as a link to `/?note=<id>` (WP4-T6 reads the query parameter). Auto-refresh every 2 s while `status === "running"` using the `after` parameter below, so the log appends instead of reloading.

Server addition: `GET /api/runs/:id?after=<seq>` returns only events with `seq > after` (default 0). Test it.

Undo conflict (`undo-conflict`, 409) shows the server's message plainly and links to the notes it names. After a successful undo the viewer shows "Undone" and the touched notes' state.

#### WP4-T5: Lantern flicker and provenance in the note list

- `NoteList` marks agent-written notes with a small amber dot (the only place amber appears besides run activity). `author === "agent"` drives it; the tooltip/title says "written by <agentName>".
- The flicker: when a poll sees a note whose `author` is agent and whose `updatedAt` is newer than the last poll, its title in the list pulses amber once (about 600 ms, CSS animation `flicker`). `prefers-reduced-motion: reduce` replaces it with a static amber dot that stays for the session. Implement as a small pure function `newAgentNotes(prev, next)` with tests, and a CSS class. Do not animate on first load.
- Polling `GET /api/notes` every 5 s while visible, use `If-None-Match`-free simple polling (do not build ETags in v1).

#### WP4-T6: Command palette (⌘K)

`apps/web/src/lib/components/CommandPalette.svelte`, opened by ⌘K / Ctrl+K, closed by Escape, focus-trapped, restores focus on close, `role="dialog"` with an accessible label, list uses `role="listbox"`. Sources: notes (title match, using `GET /api/search`), agents (name match), and fixed commands: "New note", "Run agent...", "Open Agents", "Open Settings". Fuzzy match: implement a small scoring function (prefix > word start > substring) in `lib/fuzzy.ts` with tests; do not add a dependency. Arrow keys move, Enter activates. Tests for `fuzzy.ts` and for a pure `buildCommands(state)` function.

#### WP4-T7: Settings and banners

`/settings`: **Permissions** first (the configuration page for what agents may do, backed by WP3-T5): one switch per tool ("Agents can read notes", "Agents can write notes", "Agents can fetch web pages", "Agents can call other agents") with a one-line consequence under each, a switch "New agents ask for my approval before writing" (`newAgentsStrict`), a number field "Highest token budget any run may use" (`maxTokenBudget`), and a number field "Keep run history for [90] days" (`retentionDays`, 0 = forever). Saving is explicit (a Save button), with the server's validation message under the field. Then LLM status (provider, base URL, model, key present yes/no, a "Test connection" button using `?probe=1`), usage (this month's tokens with cap and level), and instructions for setting env variables with the exact variable names. No key entry field in v1 (keys come from env only, ADR-0003). A top banner appears on every page when: the LLM is not configured (`hasKey` false for `openai` provider, or no model), or usage `level` is `warn`/`over`. Banner text is plain and links to `/settings`.

#### WP4-T8: Notes list without bodies (performance)

`GET /api/notes?fields=summary` returns `{ id, title, tags, author, agentName, updatedAt }` without `body`. The web list uses it; the full note loads on select (already the case). Default (no query) keeps returning full notes so existing callers and tests keep working. Test both shapes.

#### WP4-T9: One live event stream instead of polling

Goal: the UI updates the moment something happens, with less load than several pollers (performance and usability).

Server: `GET /api/events` returns `application/x-ndjson`, kept open, one JSON line per event: `{"type":"run","run":{...}}` when a run is created or changes status, `{"type":"run-event","runId":"...","event":{...}}` for new run log lines, `{"type":"note","id":"...","change":"created|updated|deleted","author":"human|agent"}` when a note changes (from the save/delete/watch paths), `{"type":"approval","count":N}` when the pending count changes, and `{"type":"ping"}` every 20 seconds. An in-process `EventBus` (`apps/server/src/events.ts`: `publish(event)`, `subscribe(fn) => unsubscribe`) is the only way events are produced; call `publish` from `startRun`/`finishRun`, `addEvent`, note writers and the watcher. Never put note bodies, prompts or keys in an event. Each connection is removed on `close`; cap 20 concurrent streams (the 21st gets `429 too-many-streams`, new error code). `checkAccess` applies as for every route.

Client: `lib/events.ts` opens the stream with `fetch` and the NDJSON reader from WP9-T2 (move the reader into `lib/ndjson.ts` now and reuse it there), reconnects with exponential backoff (1s to 30s), pauses when the tab is hidden and reconnects on `visibilitychange`, and exposes a Svelte store per event type. **Fallback:** if the stream cannot connect three times in a row, the client switches to the polling described in WP4-T2 and WP4-T5 and keeps trying to reconnect every 60 s. The polling code stays; the stream is an upgrade.

Tests: `events.test.ts` (server): a subscriber receives run, run-event and note events in order; a closed connection is unsubscribed; the 21st stream is refused; no event contains a body or key (publish a note change and assert the serialized line has no `body`). `lib/events.test.ts`: reconnect backoff schedule, fallback after three failures, hidden tab pauses.

#### WP4-T10: Performance budgets and code splitting

Goal: the app stays fast as the vault and history grow.

- **Route-level code splitting:** the shell, notes list and editor load first; the graph (Sigma, graphology), the diff view, and the command palette's heavy parts load only when their route or dialog opens (dynamic `import()`); CodeMirror language data (`@codemirror/language-data`) loads lazily per fenced-code language.
- **List virtualization:** the note list renders only visible rows when there are more than 300 notes (a small windowing component with fixed 48 px rows; test with 5,000 synthetic notes that at most about 40 row elements exist).
- **Budgets (enforced):**
  - initial JavaScript for `/` at most 180 KB gzip (shell + notes + editor core), checked by `scripts/check-bundle-size.mjs` reading the SvelteKit build output and failing CI above the budget (record the first measured number in the commit and set the budget at 15% above it, not below 180 KB if the first measure is lower);
  - graph chunk loaded only on `/graph` (script asserts it is not referenced from the entry chunk);
  - server `GET /api/notes?fields=summary` for 1,000 notes at most 50 ms and `GET /api/search` at most 30 ms on a developer laptop; the test seeds 1,000 notes in a temp index and asserts at most 5x those numbers (generous margin so CI machines do not flake);
  - autosave round trip at most 100 ms locally (not asserted; measure and write it in the PR);
  - typing latency: no synchronous work above 8 ms per keystroke in the live-preview plugin (measure with `performance.now()` in a test over a 20,000-character document building decorations only for the visible range plus margin; assert under 50 ms for the full build as the guard).
- Images and fonts: self-hosted fonts only (already fontsource), `font-display: swap`, no web font above two weights per family loaded on first paint.

#### WP4 non-functional checks (do all)

- Run `svelte-check`; no warnings.
- Keyboard: tab through every page; every control reachable; focus ring visible (a 2px outline using a token, defined once in `app.css`).
- Contrast check on amber text at 13px medium on `--bg` and `--surface` (ui.md requires >= 4.5:1; compute with the WCAG formula in a small test `contrast.test.ts` that parses the tokens from `app.css`, so a token change cannot silently fail the rule). If dark amber text fails, use amber only for dots/outlines, not text.
- Add a test that no `.svelte` or `.ts` file under `apps/web/src` (except `app.css`) contains a raw `#rrggbb` color: `no-raw-colors.test.ts` walking the directory.
- Light theme: `app.css` must define the light token set under `@media (prefers-color-scheme: light)` and a `[data-theme="light"]` override (ui.md table). Check it exists; add it if missing.

**WP4 acceptance:** gate green; manual with a real model: add Morning Digest from the gallery, press Run now, watch the viewer log fill, see the digest note appear with an amber dot and the flicker once, press Undo, see it removed. Record a 20-second screen recording for the README (WP12).

---

### WP5: Editor quality bar (live preview, wikilinks, backlinks)

**Goal:** the editor is good enough that people open Vigil to write (ADR-0002: "the editor quality bar stays non-negotiable"). Spec decision 5: live-preview markdown in CodeMirror 6, never a block database.

**Depends on:** WP4-T1 (shell). Can run in parallel with WP6 to WP9 if two people work.

#### WP5-T1: Live-preview decorations

Files: `apps/web/src/lib/editor/livePreview.ts` (new), `Editor.svelte` (use it), tests `livePreview.test.ts`.

Approach: a `ViewPlugin` that builds a `DecorationSet` from the Lezer markdown syntax tree (`syntaxTree(state)` from `@codemirror/language`; `@codemirror/lang-markdown` is already installed). Behavior:

- Hide markup marks (`HeaderMark`, `EmphasisMark`, `StrongEmphasisMark`, `CodeMark`, `LinkMark`, `QuoteMark`) with `Decoration.replace({})` **except on lines that contain the selection** (so editing a heading shows `# `). Recompute when the selection or document changes.
- Style headings with line decorations (`Decoration.line({ class: "cm-h1" })` and so on) using the type scale tokens.
- Bold/italic/strike/inline code via mark decorations.
- Lists: bullet and number markers drawn with a widget; task items `- [ ]` render a checkbox widget that toggles the text on click (dispatch a change replacing `[ ]`/`[x]`).
- Links `[text](url)`: show text styled as a link; Cmd/Ctrl+click opens it (`noopener noreferrer`, `_blank`); never navigate on plain click while editing.
- Fenced code: mono, subtle surface background via line decoration.
- Wikilinks `[[Title]]`: decoration via a regex pass over visible ranges (not in code), class `cm-wikilink`; Cmd/Ctrl+click navigates to the note with that slug (`slugify` from `@vigil/shared`), creating it if missing after confirming (a small inline prompt, not `window.confirm`).

Make the decoration builder a pure function `buildDecorations(state: EditorState): DecorationSet` so it is testable with `EditorState.create({ doc, extensions: [markdown()] })` without a browser view. Tests assert, for a document with a heading, bold, a link, a wikilink and a task item: which ranges are replaced when the cursor is elsewhere; that the cursor line keeps its marks; that wikilinks inside code blocks are not decorated; that toggling a task produces the right transaction (`toggleTask(state, pos)` pure helper).

Remove the Source/Preview toggle and `Preview.svelte` from the notes page once live preview ships. Keep `render.ts` (it is used by the run viewer to show note text and by copy-as-HTML later).

Typography: prose uses the serif tokens, mono for code, column max 68ch (`--measure`).

#### WP5-T2: Wikilink autocomplete

Add `@codemirror/autocomplete` (pin exact; check the version compatible with the installed `@codemirror/state`/`view`). Typing `[[` opens a completion list of note titles from the already-loaded note summaries (WP4-T8) with a fuzzy filter (`lib/fuzzy.ts` from WP4-T6); accepting inserts `Title]]`. Test `completeWikilink(context, notes)` as a pure function: triggers only after `[[`, not inside code blocks, returns titles filtered and ordered by score.

#### WP5-T3: Backlinks API and panel

Server: `GET /api/notes/:id/backlinks` returns `[{ id, title, snippet }]` for notes whose `links.dst = id`. The snippet is the line of the source note around the first occurrence of `[[...]]` or the link (computed on request from `notes_body`; cap 160 chars). Test with three notes including a dangling target (the target note does not exist yet; backlinks still return its sources).

Web: a collapsible "Linked from" panel under the editor listing backlinks, each a link to that note. Also a "Unlinked mentions" section is out of scope for v1.

#### WP5-T4: Rename

A note's id is its file name, so a title edit does not change the id (this is already the behavior; document it in the UI: the title field changes the displayed title only). Add `POST /api/notes/:id/rename` with `{ title }`: computes the new slug, 409 `note-exists` if taken, renames the file atomically (`rename`), updates frontmatter id/title, rewrites `[[old title]]` and `[old](old-id)` references in other notes **inside the note lock**, reindexes everything touched, and returns the new note. The rewriting uses the same regexes as `extractLinks` (extract them into one shared function to avoid drift). Write it as a transaction-like sequence with a pre-computed list of edits; if any write fails, restore the already-edited files from memory and return 500 (`internal`).

Tests: rename updates incoming wikilinks and markdown links, leaves links in code fences untouched (the regex must skip fenced code; add a helper `stripCode` shared with `extractLinks`, and a test that links inside fences are not extracted either: today they are, fix it in this task), refuses duplicates, handles a note with no incoming links.

Web: rename action in the note header. Before renaming, `POST /api/notes/:id/rename?dryRun=1` returns `{ newId, notesToChange: [ids] }` and the dialog says "This will update links in N notes." with the titles; confirming sends the real request. After success select the new id. Add a test for the dry run (no file changed, correct list).

#### WP5-T5: Delete with confirmation

Web action to delete with an inline two-step confirm (not `window.confirm`). Server route exists. After delete select the next note.

**WP5 acceptance:** gate green; manual: open a note, type a heading and see it styled, move the cursor onto it and see the `#`, type `[[`, accept a completion, Cmd+click it, rename a note and confirm the linking note updated, check backlinks.

---

### WP6: M3 heartbeat

**Goal:** a heartbeat agent runs only when the notes it can read have changed, and never reacts to its own writes.

**Depends on:** WP1 (hash, agentName, `heartbeat_state`), WP2 (scheduler).

#### WP6-T1: Change detection

File: `apps/server/src/heartbeat.ts`, test `heartbeat.test.ts`.

```ts
export function diffHashes(prev: Record<string,string>, next: Record<string,string>): { added: string[]; changed: string[]; removed: string[] }
export function visibleHashes(agentName: string): Record<string,string>  // from noteHashes(), excluding notes whose agent_name === agentName
```

`visibleHashes` excludes notes last written by that same agent, which prevents the loop "agent writes note -> heartbeat sees change -> agent runs again". Notes written by a *different* agent are visible (agent chains are allowed, bounded by the min interval).

Vault size guard: if there are more than 5000 notes, store only a single combined signature (sha256 of the sorted `id:hash` list) and the task message says "many notes changed" without a list. Test the guard with a synthetic 5001-entry map.

#### WP6-T2: Scheduler integration

In `createScheduler.tick()` add a second pass for `enabled && trigger.kind === "heartbeat"` agents:

1. `state = heartbeat_state(agent)`. If `last_checked_at` exists and `now - last_checked_at < everyMinutes`, skip.
2. `next = visibleHashes(agent.name)`.
3. First sight (no row): store `last_hashes = next`, `last_checked_at = now`; do not run.
4. `diff = diffHashes(last_hashes, next)`; if all three lists are empty: update `last_checked_at`, record skip reason `"unchanged"` (no run row, no model call), done.
5. If `hasRunning`: record skip reason, do not advance `last_hashes` (the change is still pending), update `last_checked_at`.
6. Else: **write `last_hashes = next` and `last_checked_at` first**, then `startRun(name, task, "heartbeat")` where `task` is built by `heartbeatTask(agent, diff)`: "These notes changed since your last check. Added: ... Changed: ... Removed: ... React according to your instructions." (ids only, capped at 50 per list with "and N more").

Rationale for write-before-run: same at-most-once rule as cron; a crashing agent cannot retry every check.

Tests: unchanged => no run and no model call; a human edit => one run whose task names the note; the agent's own write => no run next check; another agent's write => run; two quick checks inside `everyMinutes` => one check only; overlap leaves the change pending and runs it on the next check after the first run ends; first sight stores a baseline without running; removed note appears in `removed`.

#### WP6-T3: Visibility

`GET /api/agents/:name/schedule` (WP2-T4) also returns `lastCheckedAt` and `lastSkipReason` for heartbeats. Agent detail (WP4-T3) shows "Checked 4 min ago, unchanged".

**WP6 acceptance:** gate green; manual with a real model: create the Inbox Triager from its template (with `everyMinutes: 5` for the test), edit the "Inbox" note, see exactly one run within about 5 minutes and none while idle.

---

### WP7: M3 `call_agent` (bounded agent-to-agent)

**Goal:** an agent can ask another agent for help, one level deep, inside the parent's budget, fully logged, and undoable together.

**Depends on:** WP1.

Rules (final, from ADR-0004 plus the safety analysis here):

- Only agents with the `call_agents` grant get the tool, and only for names in their `callable` list. An empty `callable` list means none.
- **Depth is 1**: a run started by `call_agent` gets a tool set that never contains `call_agent`, whatever its grants say.
- **Budget:** the child's budget is `min(child.tokenBudget, parentRemaining)`; the child's `tokensUsed` is added to the parent's `used` when the call returns. If the parent has no budget left, the call returns `error: no token budget left`.
- **Strict mode:** if the parent or the child is `strict` and the child has `write_notes`, the call is refused with `error: strict agents cannot delegate writes` (approvals need a human, and a paused child inside a parent's tool node cannot wait). Read-only children are always fine.
- A child never inherits the parent's tool grants; it uses its own.
- **Concurrency:** the one-run-per-agent rule applies to children too (`agent-busy` becomes tool error text).
- The parent calling itself, or a name not in `callable`, returns tool error text.

#### WP7-T1: Tool and runtime plumbing

Files: `apps/server/src/agent-tools.ts` (add `call_agent` builder, needs a `ToolContext` extension: `{ runId, agentName, depth: 0|1, remainingBudget(): number, runChild(name, message): Promise<{ text: string; tokensUsed: number }> }`), `agent-runtime.ts` (provide `runChild` that creates a child run row via `createRun(..., { trigger: "call", parentRunId })` and runs `runAgent` recursively with `depth: 1`), `runs.ts`.

The tool's schema: `{ name: string, message: string }`. Its result text is the child's final assistant text, truncated to 8000 characters. The child's final text is the content of the last `AIMessage`; expose it from `runAgent`'s outcome as `finalText` (add the field to `RunOutcome`; update the existing tests that deep-equal an outcome, if any).

Events: parent run gets `tool-call` and `tool-result` for `call_agent`; the child has its own run row with its own events; the parent run viewer links to the child run (event `data.childRunId`).

#### WP7-T2: Undo across a family

`undoRun(parent)` also undoes every child run (`parent_run_id = parent`), children first, all inside the single lock acquisition. `getRun().touched` for a parent includes the union of its children's touched notes. Undoing a child alone is allowed. Tests: parent calls a child that writes a note; undo of the parent removes that note; a human edit after the child's write blocks the undo with `undo-conflict`.

#### WP7-T3: Tests

1. a parent with `call_agents` and `callable: ["writer"]` calls `writer`; the child run exists with `parentRunId`, trigger `call`, and the note is written
2. `callable` without the name => error text, no child run
3. child tools never include `call_agent`, even when the child agent has the grant (assert the tool names the fake model sees)
4. budget: parent budget 100, child budget 1000 => child gets `maxTokens <= remaining`; the parent's `tokensUsed` includes the child's
5. no budget left => error text and no child run
6. strict parent + writing child => refused text
7. busy child => error text containing `already has a run`
8. recursion attempt: A calls B, B's script tries `call_agent` => tool denied event in B's run

**WP7 acceptance:** gate green; manual with a real model: a "digest" parent calling a "summarizer" child on one note, then undo both with one click (run viewer shows the child run nested).

---

### WP8: M3 strict mode and the approvals queue

**Goal:** an agent in strict mode proposes writes that wait for the owner's approval; the server survives a restart while waiting.

**Depends on:** WP1, WP4 (UI), and the design below. This is the hardest package; read `docs/adr/0009` and the LangGraph interrupt docs (check them at implementation time: `Command({ resume })`, `interrupt()`, checkpointer, `thread_id`) before starting.

#### WP8-T1: ADR-0011 and checkpointer

ADR-0011 (`docs/adr/0011-strict-mode-approvals.md`) is already drafted; set its Status to Accepted and record the pinned checkpointer version. Decisions:

- Checkpointer: `@langchain/langgraph-checkpoint-sqlite`, pinned exactly to the version that matches `@langchain/langgraph@1.7.4` (check `npm view` and its peer dependencies; do not mix major versions), writing to `data/checkpoints.db` (its own file, not `state.db`). Thread id = run id.
- Placement: approvals are decided in a dedicated **`approve` node placed before the `tools` node**. Reason: when a graph resumes, the interrupted node restarts from its beginning, so side effects inside it would repeat. The `approve` node does no side effects: it only collects the tool calls that need approval, calls `interrupt(...)` once with all of them, and on resume stores the owner's decisions in graph state. The `tools` node then runs approved calls and answers rejected ones with the text `error: the owner rejected this write`. Reads never need approval.
- What needs approval: calls to `write_note` when `agent.strict`. (`web_fetch` never needs approval but see WP10 for the default-strict rule.)
- Status flow: `running` -> `waiting-approval` -> `running` -> final. The run row stays alive across a restart; `markInterruptedRuns` must **not** touch `waiting-approval` rows.
- A pending approval that is never decided stays pending; there is no timeout in v1 (record this in the ADR). The UI shows a badge with the pending count.

#### WP8-T2: Migration 5 and store

Migration 5 in `state-db.ts` (migration 4 was used by WP3-T6 retention):

```sql
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  args TEXT NOT NULL,            -- JSON, secrets never present (tool args are note text only)
  base_updated_at TEXT,          -- the note's updatedAt when the write was proposed (null = note did not exist)
  status TEXT NOT NULL,          -- 'pending' | 'approved' | 'rejected'
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX approvals_run ON approvals(run_id);
CREATE INDEX approvals_status ON approvals(status);
```

Functions: `createApproval`, `listApprovals(status?)`, `decideApproval(id, decision)`, `pendingForRun(runId)`. Tests in `state-db.test.ts`.

#### WP8-T3: Runner changes

File: `agent-runtime.ts`. Build the graph with `compile({ checkpointer })`. Add the `approve` node and the edge `agent -> approve -> tools` when the agent is strict and has `write_notes`; non-strict agents keep the current `agent -> tools` path (their graphs are unchanged, no checkpointer cost... still pass the checkpointer so a future crash can resume; keep it simple: always compile with the checkpointer, same graph shape except the `approve` node being a no-op pass-through for non-strict agents).

`runAgent` input gains `resume?: { decisions: Record<string, "approve" | "reject"> }`. On a fresh run: `graph.invoke(input, { configurable: { thread_id: runId }, recursionLimit })`. When the result contains `__interrupt__`: create approval rows (one per pending tool call, id = new uuid, `tool_call_id` from the model), set the run to `waiting-approval`, return outcome `{ status: "waiting-approval", tokensUsed, error: null }`. On resume: initialise `used` from `getRun(runId).tokensUsed`, then `graph.invoke(new Command({ resume: decisions }), { configurable: { thread_id: runId } })`.

`startRun`'s background function must treat `waiting-approval` as "not finished": do not call `finishRun`; set status via a new `setRunStatus(runId, status)`.

New function in `runs.ts`: `resumeRun(runId)`: requires status `waiting-approval` and that every approval for the run is decided; flips the run to `running`, re-enters the background executor (same in-flight tracking as `startRun`), and returns the run row.

#### WP8-T4: API

- `GET /api/approvals?status=pending` returns approvals with the run's agent name and, for `write_note`, a diff preview: the current body (or null) and the proposed body (the client renders the diff).
- `POST /api/approvals/:id/decision` with `{ decision: "approve" | "reject", force?: boolean }`; 404 `approval-not-found`, 409 `approval-decided`. **Stale writes:** when approving, if the note's current `updatedAt` differs from the approval's `base_updated_at` (or the note now exists although it did not when proposed), answer `409 approval-stale` (new error code); the client then re-fetches `GET /api/approvals` (whose preview shows the current body) and offers "Apply anyway" (sends `force: true`) or "Reject". Only `force: true` applies a stale write (the snapshot is taken first as always). Rejecting never needs `force`. When the last approval of a run is decided, call `resumeRun`.
- Restart behavior: on server start, for runs in `waiting-approval` with all approvals decided (a crash between the decision and the resume), call `resumeRun`. Runs still waiting stay waiting.

#### WP8-T5: Web

An "Approvals" count badge on the rail; `/approvals` page: each pending write as a ledger row (agent, note title, time) that opens an inline diff (implement a simple line diff function `lib/diff.ts` with tests; no dependency) with Approve / Reject buttons. After the last decision the run viewer shows the run continuing.

#### WP8-T6: Defaults and the owner's control

The owner controls approvals per agent; nothing is forced by the API. Defaults only: a new agent (or one created from a template) gets `strict` from `PermissionSettingsSchema.newAgentsStrict` (default `true`, WP3-T5). Templates that edit existing notes or fetch the web are created with `strict: true` when `newAgentsStrict` is true. `PUT /api/agents/:name` accepts `strict: false` for any agent with no extra flag. The protection against a careless change is in the UI: when an agent has both `read_notes` and `web_fetch` and the owner turns approvals off, show the warning dialog from `ux-spec.md` section 5 (the owner can still confirm). Tests: default strictness follows the instance setting; an agent with read and fetch can be saved non-strict through the API; existing agents are not changed when the setting changes.

#### WP8-T7: Tests

1. strict agent proposes a write: run ends `waiting-approval`, the note does not exist yet, one pending approval with the args
2. approve: run resumes and ends `succeeded`, the note exists, author agent, snapshot exists
3. reject: run ends `succeeded`, no note, the model's next input contains the rejection text
4. two writes in one model reply: two approvals; one approved, one rejected; only the approved note exists
5. **restart**: simulate by closing and reopening the state DB and building a fresh runtime with the same checkpoint file; the run is still `waiting-approval` (not `interrupted`), and approving it completes it
6. read-only tool calls in a strict agent never create approvals
7. resumed run's token accounting continues from the stored `tokensUsed`, not zero
8. `markInterruptedRuns` leaves `waiting-approval` alone
9. an approval cannot be decided twice
10. the `approve` node does not repeat side effects: count `write_note` executions across an interrupt/resume (must be 1)

**WP8 acceptance:** gate green; manual with a real model: Inbox Triager strict; edit Inbox; see the approval; restart the server while waiting; approve; see the write land.

---

### WP9: M3 chat

**Goal:** a chat archetype: a conversation with an agent that has tools, persisted across restarts, streamed to the UI, saved as a note on request.

**Depends on:** WP8 (checkpointer), WP4.

#### WP9-T1: Storage and routes

Migration 5: `chat_threads(id TEXT PRIMARY KEY, agent TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)` and `chat_messages(thread_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, run_id TEXT, created_at TEXT NOT NULL, PRIMARY KEY (thread_id, seq))`. Messages in `chat_messages` are what the UI shows; the checkpoint holds the model-side state (including tool messages) under `thread_id = chat thread id`.

Routes: `GET /api/chats`, `POST /api/chats` `{ agent }`, `GET /api/chats/:id` (thread plus messages), `DELETE /api/chats/:id` (removes rows and its checkpoint rows), `POST /api/chats/:id/messages` `{ text }` (streaming, below), `POST /api/chats/:id/save` (writes the conversation as a note `Chat <title>` through the normal `write_note` path with author human... author is the human's save action).

#### WP9-T2: Streaming turn

`POST /api/chats/:id/messages` responds `200` with `content-type: application/x-ndjson`, one JSON object per line: `{"type":"token","text":"..."}`, `{"type":"tool","name":"read_note","status":"call"|"result"}`, `{"type":"approval","approvalId":"..."}` (a chat agent in strict mode pauses; the stream ends after this line and the UI resumes after the decision, polling the thread), `{"type":"done","run":{...}}`, `{"type":"error","message":"..."}`. Never send secrets in any line.

Implementation: each turn is a run (trigger `chat`) with its own budget (`agent.tokenBudget`), so cost and log work like every other run. Use the graph's streaming API for message tokens. Check the LangGraph streaming mode names in the installed version's docs (`streamMode: "messages"`); if token streaming is not supported by the adapter for a provider, fall back to emitting the whole reply as one `token` line. Persist the user's message before calling the model and the assistant's message after; on failure persist an `error` role message.

The fetch in the browser: `fetch` + `response.body.getReader()` and the line splitter in `lib/ndjson.ts` (created in WP4-T9 and reused here; its tests for split chunks and partial lines already exist). Do not use `EventSource` (it cannot send the Authorization header).

#### WP9-T3: Web

`/chat` and `/chat/[id]`: thread list on the left (ledger rows), conversation on the right: human text in serif, agent text in serif, tool activity as small mono lines, a stop button (aborts the fetch; the server cancels the run when the connection closes: listen for `req.on("close")` and abort via an `AbortController` passed into the runner; test that an aborted turn ends with status `failed` and error `cancelled`, or add a `cancelled` status if cleaner, and record the choice in the PR). A "Save as note" button.

Chat agents are agents with `archetypeHint` or a `chat` flag? Decision: any agent can be chatted with; chat uses the agent's tools and system prompt plus `archetypeHint` if present. Add a "New chat" action to the agent detail page and the command palette.

#### WP9-T4: Tests

1. a turn persists both messages and the stream ends with `done`
2. a second turn sees the first turn's context (the fake model receives the earlier messages)
3. server restart between turns keeps context (reopen DBs, same thread)
4. aborted connection cancels the run
5. a failing model gives an `error` line and a persisted error message, and does not leak the key
6. a strict chat agent that wants to write ends the stream with an `approval` line
7. `ndjson` reader handles a line split across chunks, multiple lines in one chunk, and a trailing partial line

**WP9 acceptance:** gate green; manual with a real model: ask the chat agent to summarize two notes, watch the tokens arrive, restart the server, continue the conversation.

---

### WP10: M4 `web_fetch` (ADR-0006 implemented to the letter)

**Goal:** agents can read allowlisted web pages without becoming an exfiltration or SSRF channel.

**Depends on:** WP1, WP8 (approvals), WP3-T5 (instance permission switches).

#### WP10-T1: `safe-fetch.ts`

File: `apps/server/src/safe-fetch.ts`, test `safe-fetch.test.ts`. No third-party HTTP client. Use `node:https` / `node:http`, `node:dns/promises`, `node:net` (`BlockList`).

```ts
export type FetchPolicy = { allowedHosts: string[]; maxBytes: number; timeoutMs: number; maxRedirects: number };
export async function safeFetch(rawUrl: string, policy: FetchPolicy, deps?: { resolve?: Resolver; request?: RequesterFactory }): Promise<{ status: number; contentType: string; text: string; finalUrl: string }>
```

Rules, each one enforced and tested:

1. Parse with `new URL`; scheme must be `https:` or `http:`; reject userinfo (`user:pass@`); allow only ports 80 and 443 (default ports when omitted).
2. Host must equal an entry of `allowedHosts` exactly (compare lower-cased, punycode form via `url.hostname`); an empty list refuses everything with `error: this agent may not fetch any host`. No wildcards, no subdomain matching.
3. IP literals as hosts are refused unless they are in the allowlist **and** public.
4. **Resolve, validate, pin:** resolve with `dns.lookup(host, { all: true })`; refuse if any returned address is not public; then connect using a custom `lookup` function in the request options that returns the validated address, so the address checked is the address connected to (this defeats DNS rebinding). TLS keeps the original host name for SNI and certificate verification.
5. Address blocking via `BlockList`: IPv4 `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16` (includes cloud metadata `169.254.169.254`), `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`; IPv6 `::/128`, `::1/128`, `fc00::/7`, `fe80::/10`, `ff00::/8`, `2001:db8::/32`, and IPv4-mapped `::ffff:0:0/96` (convert to IPv4 and re-check: `::ffff:127.0.0.1` must be refused).
6. Redirects: handle manually (`maxRedirects` = 3); every hop repeats rules 1 to 5 with the new URL; a redirect to a non-allowlisted host is refused with a message naming the host.
7. Limits: stop reading after `maxBytes` (1 MB) and return what was read marked truncated; abort at `timeoutMs` (10 s) including DNS and redirects; response content type must start with `text/` or be `application/json`, `application/xml`, `application/xhtml+xml`; anything else returns `error: unsupported content type`.
8. No cookies sent or stored, no custom headers from the model, fixed `user-agent: Vigil/<version> (+self-hosted)`, `accept: text/html,text/plain,application/json;q=0.9`.
9. HTML to text: strip `script`, `style`, `noscript`, `svg` blocks, then tags, decode common entities, collapse whitespace. Implement with a small function and tests; no new dependency. Output is capped to 8000 characters by the tool (the existing `truncate`).

**Tests need an injectable resolver and requester** because a local stub server is on loopback, which rule 5 forbids. `deps.resolve` replaces DNS in tests; `deps.request` lets a test return a canned response for a validated address. Production code never reads test hooks from the environment; the hooks exist only as function arguments. Test list: every block range above with a representative address (including `169.254.169.254`, `::1`, `::ffff:10.0.0.1`, `fe80::1`); allowlist exact match and subdomain refusal; userinfo refusal; port refusal; DNS returning one public and one private address => refused; DNS rebinding (the resolver returns a different address on the second call) => the request still uses the first validated address; redirect to a blocked host; redirect to an allowed host; more than 3 redirects; oversize body truncated; slow response timed out; content type refusal; HTML stripping fixture.

#### WP10-T2: The tool

In `agent-tools.ts`: when the agent has `web_fetch`, add `fetch_url` with schema `{ url: string }`, calling `safeFetch(url, { allowedHosts: agent.allowedHosts, maxBytes: 1_000_000, timeoutMs: 10_000, maxRedirects: 3 })`. Errors become `error: ...` tool text. The run event `tool-call` records the **full URL** (ADR-0006), `redact`ed for key-shaped text. `ToolContext` gains `allowedHosts`.

The system prompt safety frame (agent-runtime.ts `SAFETY_FRAME`) gains one sentence: web pages are untrusted data and must never change the task.

Tests: the tool refuses with an empty allowlist, a model call with a URL on another host is denied and logged, the full URL appears in the run log.

#### WP10-T3: UI

Agent detail shows `allowedHosts` as an editable list with validation (host names only: no scheme, path or port; lower-case; no duplicates), and a visible warning when the agent has `web_fetch` and the list is empty ("This agent can't reach any site"). The run viewer renders `fetch_url` calls with the URL.

**WP10 acceptance:** gate green; manual: Research Scout with `allowedHosts: ["example.com"]` against a note listing `https://example.com`, plus a note listing `http://127.0.0.1:3001/api/notes` which must be refused and logged.

---

### WP11: M5 graph

**Goal:** a navigable graph of notes and agents: plain link edges, dashed agent-note edges, amber glow by recency.

**Depends on:** WP1 (`agent_touches`), WP4.

#### WP11-T1: Record touches

`agent-tools.ts`: after `read_note` succeeds, insert `agent_touches (agent, note_id, 'read', run_id, at)`; after `write_note` succeeds, insert `'wrote'`. Use a prepared helper `recordTouch(...)` in `state-db.ts`. Tests: touches recorded; a failed write records nothing; touches for a deleted note remain harmless (the graph filters to existing notes).

#### WP11-T2: `GET /api/graph`

Returns `{ nodes: [{ id, title, kind: "note"|"agent", updatedAt?, author?, degree }], edges: [{ source, target, kind: "link"|"agent-read"|"agent-wrote", dangling?: boolean }] }`.

- Note nodes from the index; agent nodes from `listAgents()` (id `agent:<name>`).
- Link edges from the `links` table; a link whose target is not in `notes` is a **dangling** edge to a ghost node (`kind: "note"`, `ghost: true`, title = id) so unwritten notes show up.
- Agent edges from `agent_touches`, deduplicated by (agent, note, kind), only for notes that exist, last 90 days.
- Cap: if there are more than 3000 nodes, return only the 3000 most recently updated notes plus their direct neighbors, and set `truncated: true`.
- `degree` is computed on the server so the client need not.

Tests: three linked notes, one dangling link, one agent edge, one deleted note's touch ignored, the truncation rule.

#### WP11-T3: The view

Libraries: `sigma` and `graphology` (+ `graphology-layout-forceatlas2`). At implementation time check the current stable versions and their TypeScript typings, pin exact versions, and note them in `docs/adr/0012-graph-view.md` (already drafted; set its Status to Accepted). WebGL context: the page must work when WebGL is unavailable (a `/graph` fallback showing the notes as a list grouped by connections, with the same click behavior), and the layout runs in the library's web worker (`FA2Layout`) for graphs above 500 nodes, synchronous iterations below.

Visuals per `ui.md`:

- dark canvas (`--bg`), note nodes small (size by degree, clamped), color `--ink-muted`; agent nodes a distinct shape or ring in `--ink`; amber only for recency glow and agent-written notes.
- **Recency glow:** an extra node halo drawn with a custom node program or, simpler and acceptable, a second larger translucent node underneath with alpha from `max(0, 1 - ageDays/14)` in amber. Notes untouched for 14 days have no glow.
- **Dashed agent edges:** Sigma has no dashed edge program built in. Use this approach: agent edges are hidden from the WebGL layer (`hidden: true`) and drawn on a 2D canvas overlay in the `afterRender` event, with `ctx.setLineDash([4, 4])`, positions from `sigma.graphToViewport`, color amber at 40% alpha. Link edges stay as normal WebGL edges, 1px hairline color.
- Interaction: hover highlights neighbors; click selects and opens a side panel with the note title, backlinks and an "Open" button; a search box filters nodes by title; Escape clears. Keyboard: the side list view (fallback) is always reachable via a toggle so the graph is not mouse-only.
- Respect `prefers-reduced-motion`: no animated camera transitions.

Tests: pure functions only: `buildGraph(apiData)` (to graphology), `glowAlpha(updatedAt, now)`, `neighborSet(graph, id)`. The WebGL rendering itself is verified manually (record the check in the PR).

**WP11 acceptance:** gate green; manual: seed a vault (script `scripts/seed-demo-vault.ts` creating 30 notes with links and two agent runs; this script writes only to the directory in `VAULT_DIR` and refuses to run if it is unset), open `/graph`, see glow on recent notes, dashed amber edges for the digest agent, click through to a note.

---

### WP12: M6 ship it (login, single process, Docker, PWA, README, CI)

**Goal:** `docker run` gives a working, authenticated instance, with the Morning Digest demo front and center in the README.

**Depends on:** all of WP0 to WP11 for the demo; WP12-T1 to T3 can start after WP4.

#### WP12-T1: Browser login (ADR-0007 follow-through)

ADR-0013 (`docs/adr/0013-login-cookie.md`) is already drafted; set its Status to Accepted. Behavior:

- If `VIGIL_TOKEN` is unset (local mode), there is no login at all.
- If set: `POST /api/login` with `{ token }` compares in constant time (`sameToken` from `access.ts`), and on success sets `vigil_session=<payload>.<signature>` where payload is base64url of `{"exp": <unix seconds>}` and signature is HMAC-SHA256 of the payload with the key in `data/session.key` (32 random bytes, created on first start with mode `0600`, `chmod` after write; never logged). Cookie attributes: `HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` plus `Secure` when the request is HTTPS (`x-forwarded-proto: https` only counts when the host is in `VIGIL_ALLOWED_HOSTS`, otherwise ignore the header) or `VIGIL_COOKIE_SECURE=1`.
- `checkAccess` accepts either the Bearer header or a valid, unexpired cookie. `POST /api/logout` clears it. Both routes pass the Host/Origin checks.
- **Brute force:** keep an in-memory map `ip -> { failures, firstAt }`; after 5 failures within 60 seconds respond `429 too-many-attempts` for the rest of the window. (Behind a proxy `req.socket.remoteAddress` is the proxy's address, so honor `x-forwarded-for` only when the request host is in `VIGIL_ALLOWED_HOSTS` and take the right-most entry that is not a private address; test this.)
- Cookie-authenticated state-changing requests rely on the Origin check plus `SameSite=Strict` (already enforced in `checkAccess`: a present Origin must match Host). Add a test: a cross-origin POST with a valid cookie is refused with `bad-origin`.

Web: a `/login` page (single field, serif heading, no marketing), reached by redirect when the API answers `401` (the `request` helper in `api.ts` throws a typed `UnauthorizedError`; the layout catches it and navigates). Logout in settings.

Tests (server): login success sets the cookie with the expected attributes; wrong token 401; five failures then 429; expired cookie rejected; tampered signature rejected; session key created with mode 0600 (`fs.stat().mode & 0o777`); `/api/health` stays open.

#### WP12-T2: One process serves the web app

Decision (ADR-0014, already drafted; set Status to Accepted): the web app becomes a static SPA (no SSR), served by the API server. Reason: one process, one port, same origin (no CORS, matches ADR-0007), simplest container.

- `apps/web`: swap `@sveltejs/adapter-auto` for `@sveltejs/adapter-static` with `fallback: "index.html"` (pin exact version; check compatibility with the installed SvelteKit); add `apps/web/src/routes/+layout.ts` with `export const ssr = false; export const prerender = false;`. This also settles the DOMPurify-on-the-server concern: rendering only happens in the browser.
- Server: new `apps/server/src/static.ts`. When `VIGIL_STATIC_DIR` is set, any `GET`/`HEAD` not starting with `/api/` serves a file from that directory:
  - resolve with `path.resolve(dir, "." + decodeURIComponent(pathname))` and require the result to start with `dir + path.sep`; otherwise 404. Reject paths containing `\0`. Decode errors give 400.
  - unknown paths fall back to `index.html` (SPA routing), but paths with a file extension that do not exist return 404.
  - `Cache-Control: public, max-age=31536000, immutable` for `/_app/immutable/*`; `no-cache` for everything else; correct content types for `.html .js .css .svg .png .webmanifest .json .woff2`.
  - Security headers on every static response: `Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. If SvelteKit's static output needs an inline bootstrap script, configure `kit.csp` (hash mode) instead of adding `'unsafe-inline'` to `script-src`; verify in the browser console that nothing is blocked.
  - The Host check applies to static requests too; the token and cookie do not (the shell holds no data).
- `index.ts` and `http.ts` route order: API first, then static.

Tests (`static.test.ts`, temp dir with fixture files): serves `index.html`; serves a hashed asset with immutable cache; falls back for `/agents/digest`; 404 for `/missing.js`; **path traversal**: `/../secret.txt`, `/%2e%2e/secret.txt`, `/..%2fsecret.txt`, `/a/../../secret.txt` all return 404 and never the contents of a file outside the directory (place a `secret.txt` next to the static dir in the fixture); security headers present; HEAD works; the API route still wins over a static file named `api`.

#### WP12-T3: Dev story stays working

`pnpm --filter @vigil/web dev` keeps proxying `/api` (vite proxy) so day-to-day work is unchanged; add a root script `pnpm build` that builds the web app and prints the static directory.

#### WP12-T4: Docker

Files: `Dockerfile`, `.dockerignore`, `docker-compose.example.yml`, `docs/deploy.md`.

Dockerfile (multi-stage):

1. `builder` from `node:24-bookworm-slim`: install `python3 make g++` (needed to build `better-sqlite3` if no prebuilt binary matches), `corepack enable`, copy manifests first for layer caching, `pnpm install --frozen-lockfile`, copy sources, `pnpm --filter @vigil/web build`.
2. `runtime` from `node:24-bookworm-slim`: `corepack enable`, copy the installed workspace and the built web output, `pnpm install --frozen-lockfile --prod` for the server, run as the non-root `node` user, `ENV HOST=0.0.0.0 PORT=3001 VAULT_DIR=/data/vault DB_PATH=/data/index.db STATE_DB_PATH=/data/state.db CHECKPOINT_DB_PATH=/data/checkpoints.db SESSION_KEY_PATH=/data/session.key VIGIL_STATIC_DIR=/app/apps/web/build`, `VOLUME /data`, `HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`, `CMD ["pnpm","--filter","@vigil/server","start"]`.
3. **Decision: the server is bundled with esbuild and runs with plain `node`** (faster cold start, smaller image, no TypeScript runtime in production; performance matters). Add `scripts/build-server.mjs` (devDependency `esbuild`, pinned exactly): bundle `apps/server/src/index.ts` to `apps/server/dist/server.mjs` with `--platform=node --format=esm --target=node24 --sourcemap`, treating every dependency listed in `apps/server/package.json` as external **except** `@vigil/shared` (a TypeScript workspace package that esbuild inlines). `better-sqlite3` (native) and anything with a native or optional-native part (for example `fsevents`) must stay external and be installed by `pnpm install --prod` in the image. Add `"build": "node ../../scripts/build-server.mjs"` to the server package and make the Docker `CMD` `node apps/server/dist/server.mjs`. Add a test-less check in CI: `node apps/server/dist/server.mjs` starts against a temp data directory and answers `/api/health` (a smoke script `scripts/smoke-dist.mjs`). If bundling a LangChain package fails because of dynamic requires, mark that package external (it is already a production dependency) and note it in ADR-0014 under Consequences; do not fall back to `tsx`.
4. The container refuses to start without `VIGIL_TOKEN` because `HOST=0.0.0.0` (the server already enforces this; document the error message and put `VIGIL_TOKEN` in the compose example as a required variable).

`docs/deploy.md`: run with Docker; the required variables; how to put it behind a reverse proxy with TLS (Caddy example in 6 lines, `VIGIL_ALLOWED_HOSTS`, `VIGIL_COOKIE_SECURE=1`); backups: back up the whole `/data` volume (vault, state, checkpoints), the index may be skipped; pointing at Ollama running on the host (`VIGIL_LLM_BASE_URL=http://host.docker.internal:11434` plus the compose `extra_hosts` line); upgrading (pull, restart; the index rebuilds itself).

Verification (document the output in the commit body): `docker build -t vigil .`; `docker run --rm -e VIGIL_TOKEN=test-token -p 3001:3001 -v vigil-data:/data vigil`; `curl -s localhost:3001/api/health` is `{"data":{"ok":true,...}}`; `curl -s -o /dev/null -w '%{http_code}' localhost:3001/api/notes` is `401`; `curl -s localhost:3001/ | head -c 200` is HTML; with the bearer header the notes call is `200`; stop the container, start again with the same volume, notes and agents are still there.

#### WP12-T5: PWA

`apps/web/static/manifest.webmanifest` (name Vigil, `display: standalone`, `theme_color` and `background_color` taken from the dark tokens, icons 192 and 512 PNG plus a maskable 512), icons generated from an SVG mark under `apps/web/static/icons/` (the design: a small lantern/eye glyph in `--ink` on `--bg`; keep it simple; amber is reserved for agent life, so use it only if the mark is explicitly about an active agent, which it is not), `<link rel="manifest">` and `theme-color` in `app.html`.

Service worker: `apps/web/src/service-worker.ts` using SvelteKit's `$service-worker` module (`build`, `files`, `version`): precache the app shell and static files, cache-first for those, **never cache anything under `/api/`** (network only), and delete old caches on activate. Note in `docs/deploy.md`: service workers need HTTPS or localhost.

Tests: a unit test for the fetch-routing function `shouldCache(url)` (extract it into a pure helper in `lib/sw-rules.ts`): `/api/...` never cached, `/_app/immutable/...` cached.

#### WP12-T6: README and the demo

README structure, in this order: one-line pitch; the Morning Digest recording (the 20-second capture from WP4; a GIF or a short mp4 linked from the repo, kept under 5 MB); "Run it" (Docker command, then the dev commands); "Connect a model" (OpenAI-compatible and Ollama examples); "What agents can do" (tools, snapshots, undo, strict mode in plain words); "Safety model" (local-only default, token, allowlist for web, untrusted note text; link the ADRs); "Backups"; license AGPL-3.0. No claims the product cannot back up: every feature in the README must exist at the commit it describes.

#### WP12-T7: CI

`.github/workflows/ci.yml`: keep the existing job; add a second job `docker` (`needs: ci`) that runs `docker build .` and the three curl checks above against a started container. Cache the pnpm store. The workflow must not need any secret.

#### WP12-T8: Release hygiene

- `LICENSE` header check (AGPL-3.0 present), `package.json` versions to `1.0.0` where applicable, `CHANGELOG.md` with one entry per milestone.
- Run the whole release checklist (section 10).

**WP12 acceptance:** the Docker verification above passes; the README's Run section works copy-pasted on a clean machine (or a clean directory with an empty volume).

---

### WP13: after v1 (ordered backlog, do not start before the release)

1. **Subfolders in the vault** (Obsidian compatibility). Design already decided: note id = relative path without `.md`, `/`-separated; each segment must match the current id pattern; routes use `/api/notes/*` with the id URL-encoded as one parameter (`encodeURIComponent` of the full id) to avoid path-parameter ambiguity; the watcher becomes recursive; `listNotes` walks the tree; the web list shows a collapsible tree; `slugify` stays per title (new notes go in the root unless a folder is chosen); path traversal tests are mandatory (`..`, absolute paths, symlinks: refuse symlinks that resolve outside the vault with `fs.realpath`). Needs an ADR amending ADR-0001's "flat" statement and an index migration (ids with slashes).
3. **Tags UI** (filter by tag, edit tags in the header). The data model already carries tags.
4. **Token usage charts** per agent per week (only a number table in v1).
5. **More providers** if the OpenAI-compatible path proves insufficient (Anthropic native).
6. **Approval timeouts** and email/webhook notifications for pending approvals.
7. **Run retention policy** (delete old `run_events` after N days, keep run rows).
8. **Tauri desktop shell** and mobile (v2 in the scope document).

---

## 5. State database: complete migration list

`MIGRATIONS` in `apps/server/src/state-db.ts` is append-only. After all work packages it has exactly these entries in this order; never reorder or edit a released entry:

1. M1: `agents`, `runs`, `run_events`, `snapshots` (exists)
2. WP1: `settings`, `schedule_state`; `runs.trigger`, `runs.parent_run_id`
3. WP1: `agent_touches`, `heartbeat_state`
4. WP8: `approvals` (including `base_updated_at`)
5. WP9: `chat_threads`, `chat_messages`

Index schema (`index-db.ts`, disposable) versions: 2 (current) then 3 (WP1: `agent_name`, `hash` columns). Bump `SCHEMA_VERSION` whenever a column changes; never write migration code for the index.

---

## 6. API reference (final surface)

Notes: `GET /api/notes[?fields=summary]`, `GET|PUT|DELETE /api/notes/:id`, `POST /api/notes/:id/rename`, `GET /api/notes/:id/backlinks`, `GET /api/search?q=`, `GET /api/graph`.
Agents: `GET /api/agents`, `GET|PUT /api/agents/:name`, `POST /api/agents/:name/run`, `GET /api/agents/:name/schedule`, `GET /api/agent-templates`, `POST /api/agents/from-template/:id`.
Runs: `GET /api/runs[?agent=&limit=]`, `GET /api/runs/:id[?after=seq]`, `POST /api/runs/:id/undo`.
Approvals: `GET /api/approvals[?status=]`, `POST /api/approvals/:id/decision`.
Chat: `GET|POST /api/chats`, `GET|DELETE /api/chats/:id`, `POST /api/chats/:id/messages` (NDJSON stream), `POST /api/chats/:id/save`.
System: `GET /api/health` (always open), `GET /api/usage`, `GET /api/llm/status[?probe=1]`, `GET|PUT /api/settings/permissions`, `GET /api/events` (NDJSON stream), `POST /api/login`, `POST /api/logout`.

New error codes by package: WP3 `agent-exists` 409, `undo-expired` 410; WP4 `too-many-streams` 429; WP8 `approval-stale` 409; WP8 `approval-not-found` 404, `approval-decided` 409; WP9 `chat-not-found` 404; WP12 `too-many-attempts` 429. Add each to the table in section 2.3 in the same commit.

---

## 7. Test strategy

- **Where:** server tests next to the code (`*.test.ts`), web tests next to the code. Pure functions are extracted precisely so they can be unit tested without a browser.
- **Fake model:** `scripted([...])` in `agents.test.ts` (move it to `apps/server/src/test-helpers.ts` at the start of WP6 so every test file shares one copy, with `call()` and `say()` helpers). It must return real `AIMessage` instances with `usage_metadata`.
- **Provider stub:** the `node:http` stub in `agents.test.ts` shows how to test the real adapter without a key.
- **Clock:** scheduler and heartbeat tests inject `now`; nothing sleeps for real time except tiny ordering delays (under 50 ms).
- **Isolation:** `test-setup.ts` (WP0-T4) points every store at a temp directory; tests that start a server use `port: 0`.
- **Race and ordering tests** (lock, undo, approvals) assert both the success case and the refusal case.
- **Security regression tests are mandatory and permanent:** Host/Origin (exists), token (exists), path traversal (WP12), SSRF blocks (WP10), key redaction (exists, extend whenever a new event or error path is added), XSS (web `render.test.ts`, extend whenever markdown rendering changes).
- **Manual WebGL/PWA checks** are recorded in the PR text, because they cannot run in jsdom.

---

## 8. Security checklist (re-read before every WP is called done)

| Threat | Control | Where tested |
| --- | --- | --- |
| Other site or LAN device calls the API | loopback bind, no CORS, Host + Origin checks, token for non-local | `access.test.ts` |
| Prompt injection in a note or web page | untrusted-data framing, tool allowlist, snapshots, run log, strict mode, no shell | `agents.test.ts` |
| Exfiltration by URL | per-agent host allowlist, instance-wide web switch, approvals on by default for new agents (owner may change), warning when read + fetch run without approvals, full URL logged | `safe-fetch.test.ts`, `permissions.test.ts` |
| SSRF / DNS rebinding | address block list, resolve-validate-pin, per-hop redirect checks | `safe-fetch.test.ts` |
| Key leakage | env only, `redact`, never returned by the API, never in events | `agents.test.ts`, `llm status` test |
| Lost human edits | atomic writes, `baseUpdatedAt` conflicts, snapshots, undo refuses on later human edits, global note lock | `vault.test.ts`, `agents.test.ts` |
| Path traversal | `validateId`, static-file resolve guard, symlink check (WP13) | `vault.test.ts`, `static.test.ts` |
| XSS in rendered notes | DOMPurify after `marked`, CSP, `ssr = false` | `render.test.ts`, headers test |
| Runaway cost | per-run token budget (fails closed), step limit, one run per agent, soft monthly cap | `agents.test.ts`, `usage.test.ts` |
| Login brute force / CSRF | rate limit, constant-time compare, `SameSite=Strict`, Origin check | `login.test.ts` |
| Duplicate side effects on resume | approve node holds no side effects, at-most-once scheduling | `agents.test.ts`, `scheduler.test.ts` |

---

## 9. Shortcuts that break this project (read before starting)

Cheaper models and hurried people tend to do these. Each one has already caused a bug here or would.

1. **Calling a task done without its tests.** Every task lists tests by name. A missing test is a missing task.
2. **Mocking the thing under test.** The scheduler tests must use the real `schedule_state` table; the undo tests must use real files. Mock only the model and the clock.
3. **Testing with the real `vault/` or `data/`.** Use the temp-directory setup. If `git status` shows a changed file under `data/` or `vault/` after a test run, the test is broken.
4. **Throwing inside a tool.** Tools return `error: ...` text. A throw becomes a failed run and, worse, leaves a `tool_call` without a `ToolMessage`, which makes the next request to an OpenAI-compatible API fail.
5. **Writing to the vault outside the lock or without a snapshot** (agent path), or **without `baseUpdatedAt`** (UI path).
6. **Doing a side effect before persisting the "I did it" marker** (cron, heartbeat): persist first.
7. **Putting a side effect before an `interrupt()`** or inside a node that may re-run on resume.
8. **Catching an error and doing nothing.** Either handle it with a visible consequence (log line with `console.error`, a returned error, an event) or let it propagate.
9. **Returning or logging anything key-shaped.** After adding any new event or error path, add a redaction assertion.
10. **Editing a released migration or bumping nothing.** Append a migration; bump the index `SCHEMA_VERSION`.
11. **Widening a type to make an error go away** (`any`, `as unknown as`, `!`). Fix the model of the data instead.
12. **Adding a dependency for something small.** Fuzzy match, diff, NDJSON, HTML stripping are all small and have tests in this plan. Anything new needs an exact pinned version and a line in an ADR.
13. **Unpinned dependencies.** Always `--save-exact` for the LangChain family, `cron-parser`, `sigma`, `graphology`, and the adapters.
14. **Raw color values or emoji in UI code.** Tokens only (`app.css`); Lucide icons.
15. **Forgetting `prefers-reduced-motion`, focus rings, or keyboard paths.**
16. **Changing a flow without updating the docs** (`roadmap.md`, glossary, ADRs, README).
17. **Large commits that mix concerns.** One task, one commit, conventional message.
18. **Pushing, merging or deploying** without the owner saying so.
19. **Trusting memory of a library API.** LangGraph, LangChain, Sigma, cron-parser and SvelteKit adapters change; read the installed version's docs or typings (`node_modules/.../dist/*.d.ts`) before coding, and prefer the typings when docs and code disagree.
20. **Declaring a visual feature done from tests alone.** UI and WebGL work needs a real look in a browser; record what you checked.

---

## 10. Release checklist (v1.0.0)

- [x] Gate command green on a fresh clone (`pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`). *Checked 2026-11-15 on a fresh clone: typecheck and all tests pass.*
- [x] `git status` clean after the full test run; no changes under `data/` or `vault/`. *Clean; no data/ or vault/ created in the clone.*
- [x] Docker image builds; run, health, 401 without token, 200 with token, restart keeps data (WP12-T4). *Checked 2026-11-15, output in the WP12 commit message.*
- [x] Morning Digest demo works end to end with a real model on a fresh volume, including undo. *Done 2026-11-15 on a fresh Docker volume with Ollama on the host: run succeeded, digest written, undo removed it.*
- [x] Strict mode demo: approval queue, restart while waiting, approve. *Done on a real local model, including a restart while waiting (WP8).*
- [ ] Heartbeat demo: no run while idle; one run after an edit. *One run after an edit observed (WP6); the 'no run while idle after its own write' part is covered by tests, not observed live.*
- [ ] Web fetch demo: allowed host works; loopback URL refused and logged. *Live fetch of an allowed host and refusals checked against the real network; the Research Scout agent was not run on a model.*
- [x] Graph opens on the demo vault; fallback list works without WebGL. *Checked in a browser: graph draws and the list view toggle works. The automatic no-WebGL fallback was not forced.*
- [ ] Keyboard-only pass over every page; contrast test passes; reduced-motion pass. *Contrast and reduced-motion rules are tested; a manual keyboard pass over every page is still to do.*
- [x] `grep -rn "sk-\|api_key" apps packages --include=*.ts --include=*.svelte` shows no real secrets; `git log -p | grep -i "api_key=" ` shows none. *Only test fixtures match; none in history.*
- [ ] README commands copy-paste correctly on a clean directory; every README claim exists in the code. *Docker commands verified; a clean-machine run is still to do.*
- [x] Performance budgets hold: `scripts/check-bundle-size.mjs` passes, the 1,000-note index test passes, `node apps/server/dist/server.mjs` smoke test passes (WP4-T10, WP12-T4). *Bundle budget (73 KB of 180), 1,000-note test and the dist smoke test pass.*
- [ ] Name check done: "Vigil" searched on npm, GitHub and trademark databases; result written in `docs/spec/open-questions.md`. *Owner's task.*
- [ ] Permissions page works: switch off web fetch and confirm a run no longer offers the tool; template agents are created switched off. *Covered by tests; not re-run by hand in this pass.*
- [x] `docs/spec/roadmap.md` marks M0 to M6 done with dates; ADRs 0010 to 0013 written; `docs/spec/open-questions.md` reviewed with the owner.
- [x] `CHANGELOG.md` has the 1.0.0 entry; versions bumped; tag created only when the owner says so. *Versions are 1.0.0; no tag has been created.*

---

## 11. Decisions (confirmed by the owner 2026-11-15)

Recorded in `docs/spec/open-questions.md` (section A, now resolved) and in ADR-0010, 0011, 0013, 0014 and 0015. The guiding rule the owner gave: **performance and usability balance is everything**; where two options tie, pick the faster and more usable one.

1. **Scheduler:** tick loop with a cron parser (catch-up, testable, cheap).
2. **Keys are environment-only in v1.**
3. **Soft monthly cap is a warning only.**
4. **Permissions are configurable by the owner from a configuration page** (Settings > Permissions): instance-wide tool switches, default approvals for new agents, a token-budget ceiling, and per-agent grants, hosts and approvals on the agent page. Nothing is forced by the API; the UI warns when an agent can read notes and fetch the web with approvals off.
5. **Chat is available for every agent.**
6. **Static SPA served by the API server** (best usability and performance for a private app: instant navigation, installable PWA, code-split heavy views, no server rendering cost).
7. **Five templates ship, but none runs until the owner turns it on.** Adding one creates it switched off; "Turn on" is an explicit step.
8. **The server is bundled with esbuild and runs with plain `node`** (not `tsx`).
9. **No approval timeout. Run logs are kept 90 days by default** (configurable, 0 = forever); runs and notes are never deleted by housekeeping.
10. **Subfolders wait until after v1** (flat vault; designed in WP13).
11. **Cron time zone** is `VIGIL_TZ` or the server zone; per-agent override.
12. **Catch-up window** is 24 hours.
13. **App mark:** the eye-and-flame SVG in `ux-spec.md`.
14. **Name check:** search npm, GitHub and trademark databases for "Vigil" before the public launch (release checklist item).
15. **No telemetry or analytics of any kind.**
16. **Stale approvals** are not applied silently: approving a write whose note changed since the proposal answers `409 approval-stale`; the owner chooses "Apply anyway" or "Reject".
17. **Rename** rewrites the common link forms and shows how many notes will change before the owner confirms.
18. **Live updates** use one event stream with automatic polling fallback.
