import { existsSync, mkdirSync } from "node:fs";
import type { CardState } from "./srs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { AgentSchema, type Agent, type Run, type RunEvent, type RunStatus } from "@vigil/shared";
import { publish } from "./events";
import { REPO_ROOT } from "./vault";

/**
 * Durable state: agent definitions, runs, run logs, snapshot records. Unlike the index
 * (ADR-0001, ADR-0008) this file is NOT disposable, so migrations only ever add.
 */
export function statePath(): string {
  const configured = process.env.STATE_DB_PATH;
  return configured ? path.resolve(configured) : path.join(REPO_ROOT, "data", "state.db");
}

/** Pre-write copies of notes live next to the state file, outside the vault (the vault is indexed). */
export function snapshotsDir(): string {
  return path.join(path.dirname(statePath()), "snapshots");
}

// Each step runs once, in order. Never edit or reorder a released step; append a new one.
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE agents (
    name TEXT PRIMARY KEY,
    definition TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    token_budget INTEGER NOT NULL,
    error TEXT,
    undone INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX runs_agent ON runs(agent, started_at);
  CREATE TABLE run_events (
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (run_id, seq)
  );
  CREATE TABLE snapshots (
    run_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    existed INTEGER NOT NULL,
    file TEXT,
    written_updated_at TEXT,
    PRIMARY KEY (run_id, note_id)
  );
  `,
  `
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
  `,
  `
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
  `,
  `
  -- migration 4: retention. A pruned snapshot keeps its row (the run still shows what it touched)
  -- but its file is gone, so the run can no longer be undone.
  ALTER TABLE snapshots ADD COLUMN expired INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- migration 5: approvals (strict mode). One row per proposed write; the graph waits for the owner.
  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    tool_call_id TEXT NOT NULL,
    tool TEXT NOT NULL,
    args TEXT NOT NULL,            -- JSON: note text only, never a key
    base_updated_at TEXT,          -- the note's updatedAt when proposed (null = the note did not exist)
    status TEXT NOT NULL,          -- 'pending' | 'approved' | 'rejected'
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE INDEX approvals_run ON approvals(run_id);
  CREATE INDEX approvals_status ON approvals(status);
  `,
  `
  -- migration 6: chat. The messages the UI shows; the model-side state (tool messages included) is in
  -- the checkpoint under thread id = chat id.
  CREATE TABLE chat_threads (
    id TEXT PRIMARY KEY,
    agent TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE chat_messages (
    thread_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,            -- 'user' | 'assistant' | 'error'
    content TEXT NOT NULL,
    run_id TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (thread_id, seq)
  );
  CREATE INDEX chat_messages_run ON chat_messages(run_id);
  `,
  `
  -- migration 7: pinned notes. A UI choice of the owner, kept out of the note files so a pin never
  -- changes a note's author or modification time.
  CREATE TABLE pins (
    note_id TEXT PRIMARY KEY,
    pinned_at TEXT NOT NULL
  );
  `,
  `
  -- migration 8: study cards (ADR-0017). The cards themselves are text in the notes; this is only what the
  -- scheduler remembers about each one, plus a log of every review.
  CREATE TABLE card_state (
    card_id TEXT PRIMARY KEY,
    due TEXT NOT NULL,
    state TEXT NOT NULL            -- JSON: the scheduler's memory state (srs.ts CardState)
  );
  CREATE INDEX card_state_due ON card_state(due);
  CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    rating INTEGER NOT NULL,       -- 1 again, 2 hard, 3 good, 4 easy
    elapsed_days REAL NOT NULL,
    reviewed_at TEXT NOT NULL
  );
  CREATE INDEX reviews_at ON reviews(reviewed_at);
  CREATE INDEX reviews_note ON reviews(note_id);
  `,
  `
  -- migration 9: the full final answer of a run (run events are cut at 1000 characters). Used by the card
  -- maker: its answer is the list of proposed cards.
  CREATE TABLE run_results (
    run_id TEXT PRIMARY KEY,
    text TEXT NOT NULL
  );
  `,
  `
  -- migration 10: what a card's state was before a review, so the last answer can be undone exactly.
  ALTER TABLE reviews ADD COLUMN prev_state TEXT;
  `,
  `
  -- migration 11: exam dates (ADR-0019). A goal is a date for one note or one tag; the scheduler paces
  -- the cards in that scope to land before it.
  CREATE TABLE goals (
    scope_kind TEXT NOT NULL,      -- 'note' or 'tag'
    scope_value TEXT NOT NULL,
    day TEXT NOT NULL,             -- YYYY-MM-DD, the viewer's calendar day
    created_at TEXT NOT NULL,
    PRIMARY KEY (scope_kind, scope_value)
  );
  `,
  `
  -- migration 12: note recall checks (ADR-0020). A note on a short ladder of days; the learner writes what
  -- they remember and the step moves with how it went.
  CREATE TABLE note_recall (
    note_id TEXT PRIMARY KEY,
    step INTEGER NOT NULL,
    due TEXT NOT NULL,
    last_result TEXT,
    updated_at TEXT NOT NULL
  );
  `,
  `
  -- migration 13: things the learner got wrong in a recall check, to watch for next time (ADR-0023)
  CREATE TABLE misconceptions (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX misconceptions_note ON misconceptions(note_id, resolved_at);
  `,
  `
  -- migration 14: model connections the owner added in Settings (ADR-0026); the key is stored encrypted
  CREATE TABLE connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key_enc TEXT,
    default_model TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
];

let current: { key: string; db: Database.Database } | null = null;

function open(): Database.Database {
  const key = statePath();
  if (current && current.key === key) return current.db;
  if (current) current.db.close();
  if (!existsSync(path.dirname(key))) mkdirSync(path.dirname(key), { recursive: true });
  const db = new Database(key);
  db.pragma("journal_mode = WAL");
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i] ?? "");
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  current = { key, db };
  return db;
}

export function closeState(): void {
  if (current) {
    current.db.close();
    current = null;
  }
}

/** Runs left `running` by a crash or restart can never finish: say so. Call once at start. */
export function markInterruptedRuns(): number {
  const result = open()
    .prepare("UPDATE runs SET status = 'interrupted', finished_at = ?, error = 'server restarted during the run' WHERE status = 'running'")
    .run(new Date().toISOString());
  return result.changes;
}

// ---- agents ----

export function putAgent(agent: Agent): Agent {
  open()
    .prepare("INSERT INTO agents (name, definition, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET definition = excluded.definition, updated_at = excluded.updated_at")
    .run(agent.name, JSON.stringify(agent), new Date().toISOString());
  return agent;
}

export function getAgent(name: string): Agent | null {
  const row = open().prepare("SELECT definition FROM agents WHERE name = ?").get(name) as { definition: string } | undefined;
  return row ? AgentSchema.parse(JSON.parse(row.definition)) : null;
}

export function listAgents(): Agent[] {
  const rows = open().prepare("SELECT definition FROM agents ORDER BY name").all() as { definition: string }[];
  return rows.map((r) => AgentSchema.parse(JSON.parse(r.definition)));
}

// ---- runs ----

type RunRow = {
  id: string;
  agent: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  tokens_used: number;
  token_budget: number;
  error: string | null;
  undone: number;
  trigger?: string | null;
  parent_run_id?: string | null;
};

function toRun(row: RunRow): Run {
  const touched = (
    open()
      .prepare(
        `SELECT DISTINCT note_id FROM snapshots
         WHERE run_id = ? OR run_id IN (SELECT id FROM runs WHERE parent_run_id = ?)`,
      )
      .all(row.id, row.id) as { note_id: string }[]
  ).map((r) => r.note_id);
  return {
    id: row.id,
    agent: row.agent,
    status: row.status as RunStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    tokensUsed: row.tokens_used,
    tokenBudget: row.token_budget,
    error: row.error,
    // The column is written only by createRun (union-typed) or the migration default 'manual'.
    trigger: (row.trigger ?? "manual") as Run["trigger"],
    parentRunId: row.parent_run_id ?? null,
    touched,
    undone: row.undone === 1,
  };
}

export function createRun(id: string, agent: string, tokenBudget: number, trigger: Run["trigger"] = "manual", parentRunId: string | null = null): Run {
  open()
    .prepare("INSERT INTO runs (id, agent, status, started_at, token_budget, trigger, parent_run_id) VALUES (?, ?, 'running', ?, ?, ?, ?)")
    .run(id, agent, new Date().toISOString(), tokenBudget, trigger, parentRunId);
  const run = getRun(id) as Run;
  publish({ type: "run", run });
  return run;
}

export function finishRun(id: string, status: RunStatus, tokensUsed: number, error: string | null): void {
  open()
    .prepare("UPDATE runs SET status = ?, finished_at = ?, tokens_used = ?, error = ? WHERE id = ?")
    .run(status, new Date().toISOString(), tokensUsed, error, id);
  const run = getRun(id);
  if (run) publish({ type: "run", run });
}

export function setTokensUsed(id: string, tokensUsed: number): void {
  open().prepare("UPDATE runs SET tokens_used = ? WHERE id = ?").run(tokensUsed, id);
}

export function getRun(id: string): Run | null {
  const row = open().prepare("SELECT * FROM runs WHERE id = ?").get(id) as RunRow | undefined;
  return row ? toRun(row) : null;
}

export function listRuns(agent?: string, limit = 50): Run[] {
  const rows = (
    agent
      ? open().prepare("SELECT * FROM runs WHERE agent = ? ORDER BY started_at DESC LIMIT ?").all(agent, limit)
      : open().prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?").all(limit)
  ) as RunRow[];
  return rows.map(toRun);
}

export function hasRunning(agent: string): boolean {
  // A run waiting for approval still owns its agent: a second run could write the same notes.
  const row = open().prepare("SELECT 1 AS x FROM runs WHERE agent = ? AND status IN ('running', 'waiting-approval') LIMIT 1").get(agent);
  return row !== undefined;
}

export function markUndone(id: string): void {
  open().prepare("UPDATE runs SET undone = 1 WHERE id = ?").run(id);
  const run = getRun(id);
  if (run) publish({ type: "run", run });
}

// ---- run log ----

export function addEvent(runId: string, kind: RunEvent["kind"], text: string, data: Record<string, unknown> = {}): void {
  const db = open();
  const next = (db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM run_events WHERE run_id = ?").get(runId) as { n: number }).n;
  db.prepare("INSERT INTO run_events (run_id, seq, at, kind, text, data) VALUES (?, ?, ?, ?, ?, ?)").run(
    runId,
    next,
    new Date().toISOString(),
    kind,
    text,
    JSON.stringify(data),
  );
  publish({ type: "run-event", runId, seq: next, kind });
}

/** Events of a run in order; with `after`, only those with a larger sequence number. */
export function listEvents(runId: string, after = 0): RunEvent[] {
  const rows = open()
    .prepare("SELECT seq, at, kind, text, data FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq")
    .all(runId, after) as { seq: number; at: string; kind: string; text: string; data: string }[];
  return rows.map((r) => ({
    seq: r.seq,
    at: r.at,
    kind: r.kind as RunEvent["kind"],
    text: r.text,
    data: JSON.parse(r.data) as Record<string, unknown>,
  }));
}

// ---- snapshots ----

export type SnapshotRow = { runId: string; noteId: string; existed: boolean; file: string | null; writtenUpdatedAt: string | null; expired: boolean };

export function getSnapshot(runId: string, noteId: string): SnapshotRow | null {
  const row = open()
    .prepare("SELECT run_id, note_id, existed, file, written_updated_at, expired FROM snapshots WHERE run_id = ? AND note_id = ?")
    .get(runId, noteId) as { run_id: string; note_id: string; existed: number; file: string | null; written_updated_at: string | null; expired: number } | undefined;
  return row
    ? { runId: row.run_id, noteId: row.note_id, existed: row.existed === 1, file: row.file, writtenUpdatedAt: row.written_updated_at, expired: row.expired === 1 }
    : null;
}

export function listSnapshots(runId: string): SnapshotRow[] {
  const rows = open().prepare("SELECT note_id FROM snapshots WHERE run_id = ? ORDER BY rowid").all(runId) as { note_id: string }[];
  return rows.map((r) => getSnapshot(runId, r.note_id) as SnapshotRow);
}

/**
 * Copy the note's current file content aside, once per (run, note). `content` null = it did not
 * exist. Returns true when a new snapshot was taken, false when this run already had one.
 */
export async function recordSnapshot(runId: string, noteId: string, content: string | null): Promise<boolean> {
  if (getSnapshot(runId, noteId)) return false;
  let file: string | null = null;
  if (content !== null) {
    const dir = path.join(snapshotsDir(), noteId);
    mkdirSync(dir, { recursive: true });
    file = path.join(dir, `${runId}.md`);
    await writeFile(file, content, "utf8");
  }
  open()
    .prepare("INSERT INTO snapshots (run_id, note_id, existed, file) VALUES (?, ?, ?, ?)")
    .run(runId, noteId, content === null ? 0 : 1, file);
  return true;
}

/** Forget a snapshot whose write failed. */
export async function dropSnapshot(runId: string, noteId: string): Promise<void> {
  const snap = getSnapshot(runId, noteId);
  if (!snap) return;
  open().prepare("DELETE FROM snapshots WHERE run_id = ? AND note_id = ?").run(runId, noteId);
  if (snap.file) await rm(snap.file, { force: true });
}

/** Remember the `updatedAt` the agent's latest write produced, so undo can tell a later human edit. */
export function setWrittenUpdatedAt(runId: string, noteId: string, updatedAt: string): void {
  open().prepare("UPDATE snapshots SET written_updated_at = ? WHERE run_id = ? AND note_id = ?").run(updatedAt, runId, noteId);
}

export async function readSnapshotFile(file: string): Promise<string> {
  return readFile(file, "utf8");
}

// ---- Schedule state (WP2) ----

export type ScheduleState = {
  agent: string;
  lastScheduledFor: string | null;
  lastStartedAt: string | null;
  lastSkipReason: string | null;
};

export function getSchedule(agent: string): ScheduleState | null {
  const row = open()
    .prepare("SELECT agent, last_scheduled_for, last_started_at, last_skip_reason FROM schedule_state WHERE agent = ?")
    .get(agent) as { agent: string; last_scheduled_for: string | null; last_started_at: string | null; last_skip_reason: string | null } | undefined;
  if (!row) return null;
  return { agent: row.agent, lastScheduledFor: row.last_scheduled_for, lastStartedAt: row.last_started_at, lastSkipReason: row.last_skip_reason };
}

/** Merges the given fields into the agent's schedule row (creating it when missing). */
export function putSchedule(agent: string, patch: Partial<Omit<ScheduleState, "agent">>): void {
  const now = getSchedule(agent) ?? { agent, lastScheduledFor: null, lastStartedAt: null, lastSkipReason: null };
  const next = { ...now, ...patch };
  open()
    .prepare(
      `INSERT INTO schedule_state (agent, last_scheduled_for, last_started_at, last_skip_reason) VALUES (?, ?, ?, ?)
       ON CONFLICT(agent) DO UPDATE SET last_scheduled_for = excluded.last_scheduled_for,
         last_started_at = excluded.last_started_at, last_skip_reason = excluded.last_skip_reason`,
    )
    .run(next.agent, next.lastScheduledFor, next.lastStartedAt, next.lastSkipReason);
}

/** Sum of tokens used by runs that started at or after `sinceIso`. */
export function tokensSince(sinceIso: string): number {
  const row = open().prepare("SELECT COALESCE(SUM(tokens_used), 0) AS total FROM runs WHERE started_at >= ?").get(sinceIso) as { total: number };
  return row.total;
}

// ---- Settings (key/value JSON) ----

export function getSetting(key: string): unknown {
  const row = open().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as unknown) : undefined;
}

export function putSetting(key: string, value: unknown): void {
  open()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

// ---- Retention (WP3-T6) ----

/** Runs whose logs and snapshots must never be pruned. */
const LIVE = "('running', 'waiting-approval')";

/** Delete run events older than `beforeIso`, except for runs that are still live. Returns the count. */
export function pruneEvents(beforeIso: string): number {
  const res = open()
    .prepare(`DELETE FROM run_events WHERE at < ? AND run_id NOT IN (SELECT id FROM runs WHERE status IN ${LIVE})`)
    .run(beforeIso);
  return res.changes;
}

/**
 * Remove the snapshot files of runs that started before `beforeIso` and mark those snapshots expired.
 * The rows stay so the run still lists what it touched. Returns the number of snapshots expired.
 */
export async function expireSnapshots(beforeIso: string): Promise<number> {
  const rows = open()
    .prepare(
      `SELECT s.run_id, s.note_id, s.file FROM snapshots s JOIN runs r ON r.id = s.run_id
       WHERE s.expired = 0 AND r.started_at < ? AND r.status NOT IN ${LIVE}`,
    )
    .all(beforeIso) as { run_id: string; note_id: string; file: string | null }[];
  for (const row of rows) {
    if (row.file) await rm(row.file, { force: true });
    open().prepare("UPDATE snapshots SET expired = 1 WHERE run_id = ? AND note_id = ?").run(row.run_id, row.note_id);
  }
  return rows.length;
}

// ---- Heartbeat state (WP6) ----

export type HeartbeatState = { agent: string; lastCheckedAt: string | null; lastHashes: Record<string, string> | null };

export function getHeartbeat(agent: string): HeartbeatState | null {
  const row = open().prepare("SELECT agent, last_checked_at, last_hashes FROM heartbeat_state WHERE agent = ?").get(agent) as
    | { agent: string; last_checked_at: string | null; last_hashes: string | null }
    | undefined;
  if (!row) return null;
  return { agent: row.agent, lastCheckedAt: row.last_checked_at, lastHashes: row.last_hashes ? (JSON.parse(row.last_hashes) as Record<string, string>) : null };
}

export function putHeartbeat(agent: string, state: { lastCheckedAt: string; lastHashes: Record<string, string> }): void {
  open()
    .prepare(
      `INSERT INTO heartbeat_state (agent, last_checked_at, last_hashes) VALUES (?, ?, ?)
       ON CONFLICT(agent) DO UPDATE SET last_checked_at = excluded.last_checked_at, last_hashes = excluded.last_hashes`,
    )
    .run(agent, state.lastCheckedAt, JSON.stringify(state.lastHashes));
}

/** Only the check time moves: the pending change (last_hashes) stays as it was. */
export function touchHeartbeat(agent: string, lastCheckedAt: string): void {
  open().prepare("UPDATE heartbeat_state SET last_checked_at = ? WHERE agent = ?").run(lastCheckedAt, agent);
}

export function clearHeartbeat(agent: string): void {
  open().prepare("DELETE FROM heartbeat_state WHERE agent = ?").run(agent);
}

/** Runs started by `call_agent` from this run, oldest first. */
export function listChildRuns(parentRunId: string): Run[] {
  const rows = open().prepare("SELECT * FROM runs WHERE parent_run_id = ? ORDER BY started_at").all(parentRunId) as RunRow[];
  return rows.map(toRun);
}

/** Change a live run's status without finishing it (running <-> waiting-approval). */
export function setRunStatus(id: string, status: "running" | "waiting-approval"): void {
  open().prepare("UPDATE runs SET status = ? WHERE id = ?").run(status, id);
  const run = getRun(id);
  if (run) publish({ type: "run", run });
}

// ---- Approvals (WP8) ----

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type Approval = {
  id: string;
  runId: string;
  toolCallId: string;
  tool: string;
  args: Record<string, unknown>;
  baseUpdatedAt: string | null;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt: string | null;
};

type ApprovalRow = { id: string; run_id: string; tool_call_id: string; tool: string; args: string; base_updated_at: string | null; status: string; created_at: string; decided_at: string | null };
const toApproval = (r: ApprovalRow): Approval => ({
  id: r.id,
  runId: r.run_id,
  toolCallId: r.tool_call_id,
  tool: r.tool,
  args: JSON.parse(r.args) as Record<string, unknown>,
  baseUpdatedAt: r.base_updated_at,
  status: r.status as ApprovalStatus,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
});

export function pendingApprovalCount(): number {
  return (open().prepare("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'").get() as { n: number }).n;
}

/** One pending approval per (run, tool call): a repeated call for the same pair returns the existing row. */
export function createApproval(input: { id: string; runId: string; toolCallId: string; tool: string; args: Record<string, unknown>; baseUpdatedAt: string | null }): Approval {
  const db = open();
  const existing = db.prepare("SELECT * FROM approvals WHERE run_id = ? AND tool_call_id = ?").get(input.runId, input.toolCallId) as ApprovalRow | undefined;
  if (existing) return toApproval(existing);
  db.prepare("INSERT INTO approvals (id, run_id, tool_call_id, tool, args, base_updated_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)").run(
    input.id,
    input.runId,
    input.toolCallId,
    input.tool,
    JSON.stringify(input.args),
    input.baseUpdatedAt,
    new Date().toISOString(),
  );
  publish({ type: "approval", count: pendingApprovalCount() });
  return getApproval(input.id) as Approval;
}

export function getApproval(id: string): Approval | null {
  const row = open().prepare("SELECT * FROM approvals WHERE id = ?").get(id) as ApprovalRow | undefined;
  return row ? toApproval(row) : null;
}

export function listApprovals(status?: ApprovalStatus): Approval[] {
  const rows = (status
    ? open().prepare("SELECT * FROM approvals WHERE status = ? ORDER BY created_at, rowid").all(status)
    : open().prepare("SELECT * FROM approvals ORDER BY created_at, rowid").all()) as ApprovalRow[];
  return rows.map(toApproval);
}

export function approvalsForRun(runId: string): Approval[] {
  return (open().prepare("SELECT * FROM approvals WHERE run_id = ? ORDER BY created_at, rowid").all(runId) as ApprovalRow[]).map(toApproval);
}

export function pendingForRun(runId: string): Approval[] {
  return approvalsForRun(runId).filter((a) => a.status === "pending");
}

/** Decide a pending approval. Returns false when it was already decided (so two clicks cannot both win). */
export function decideApproval(id: string, decision: "approve" | "reject"): boolean {
  const res = open()
    .prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
    .run(decision === "approve" ? "approved" : "rejected", new Date().toISOString(), id);
  if (res.changes === 0) return false;
  publish({ type: "approval", count: pendingApprovalCount() });
  return true;
}

/** Runs waiting for the owner. */
export function listWaitingRunIds(): string[] {
  return (open().prepare("SELECT id FROM runs WHERE status = 'waiting-approval' ORDER BY started_at").all() as { id: string }[]).map((r) => r.id);
}

/** Snapshots of several runs in the order they were taken (oldest first), across runs. */
export function listSnapshotsInOrder(runIds: string[]): SnapshotRow[] {
  if (runIds.length === 0) return [];
  const marks = runIds.map(() => "?").join(",");
  const rows = open().prepare(`SELECT run_id, note_id FROM snapshots WHERE run_id IN (${marks}) ORDER BY rowid`).all(...runIds) as { run_id: string; note_id: string }[];
  return rows.map((r) => getSnapshot(r.run_id, r.note_id) as SnapshotRow);
}

// ---- Chat (WP9) ----

export type ChatThread = { id: string; agent: string; title: string; createdAt: string; updatedAt: string };
export type ChatMessage = { seq: number; role: "user" | "assistant" | "error"; content: string; runId: string | null; createdAt: string };

type ThreadRow = { id: string; agent: string; title: string; created_at: string; updated_at: string };
const toThread = (r: ThreadRow): ChatThread => ({ id: r.id, agent: r.agent, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at });

export function createChatThread(id: string, agent: string): ChatThread {
  const now = new Date().toISOString();
  open().prepare("INSERT INTO chat_threads (id, agent, title, created_at, updated_at) VALUES (?, ?, 'New chat', ?, ?)").run(id, agent, now, now);
  return getChatThread(id) as ChatThread;
}

export function getChatThread(id: string): ChatThread | null {
  const row = open().prepare("SELECT * FROM chat_threads WHERE id = ?").get(id) as ThreadRow | undefined;
  return row ? toThread(row) : null;
}

export function listChatThreads(): ChatThread[] {
  return (open().prepare("SELECT * FROM chat_threads ORDER BY updated_at DESC").all() as ThreadRow[]).map(toThread);
}

export function setChatTitle(id: string, title: string): void {
  open().prepare("UPDATE chat_threads SET title = ? WHERE id = ?").run(title, id);
}

export function deleteChatThread(id: string): void {
  const db = open();
  db.prepare("DELETE FROM chat_messages WHERE thread_id = ?").run(id);
  db.prepare("DELETE FROM chat_threads WHERE id = ?").run(id);
}

export function addChatMessage(threadId: string, role: ChatMessage["role"], content: string, runId: string | null): ChatMessage {
  const db = open();
  const seq = (db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM chat_messages WHERE thread_id = ?").get(threadId) as { n: number }).n;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO chat_messages (thread_id, seq, role, content, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(threadId, seq, role, content, runId, now);
  db.prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?").run(now, threadId);
  return { seq, role, content, runId, createdAt: now };
}

export function listChatMessages(threadId: string): ChatMessage[] {
  const rows = open().prepare("SELECT seq, role, content, run_id, created_at FROM chat_messages WHERE thread_id = ? ORDER BY seq").all(threadId) as {
    seq: number; role: string; content: string; run_id: string | null; created_at: string;
  }[];
  return rows.map((r) => ({ seq: r.seq, role: r.role as ChatMessage["role"], content: r.content, runId: r.run_id, createdAt: r.created_at }));
}

/** The chat thread a run was a turn of, if any (the user's message carries the run id). */
export function chatThreadForRun(runId: string): string | null {
  const row = open().prepare("SELECT thread_id FROM chat_messages WHERE run_id = ? LIMIT 1").get(runId) as { thread_id: string } | undefined;
  return row?.thread_id ?? null;
}

// ---- Agent touches (WP11): which notes an agent read or wrote, for the graph ----

export type Touch = { agent: string; noteId: string; kind: "read" | "wrote"; runId: string; at: string };

export function recordTouch(agent: string, noteId: string, kind: Touch["kind"], runId: string): void {
  open().prepare("INSERT INTO agent_touches (agent, note_id, kind, run_id, at) VALUES (?, ?, ?, ?, ?)").run(agent, noteId, kind, runId, new Date().toISOString());
}

/** Distinct (agent, note, kind) triples touched at or after `sinceIso`, with the latest time of each. */
export function recentTouches(sinceIso: string): Touch[] {
  const rows = open()
    .prepare("SELECT agent, note_id, kind, MAX(run_id) AS run_id, MAX(at) AS at FROM agent_touches WHERE at >= ? GROUP BY agent, note_id, kind")
    .all(sinceIso) as { agent: string; note_id: string; kind: string; run_id: string; at: string }[];
  return rows.map((r) => ({ agent: r.agent, noteId: r.note_id, kind: r.kind as Touch["kind"], runId: r.run_id, at: r.at }));
}

// ---- Pins (migration 7) ----

/** Pinned note ids, most recently pinned first. */
export function listPins(): string[] {
  return (open().prepare("SELECT note_id FROM pins ORDER BY pinned_at DESC, note_id").all() as { note_id: string }[]).map((r) => r.note_id);
}

export function addPin(noteId: string): void {
  open().prepare("INSERT INTO pins (note_id, pinned_at) VALUES (?, ?) ON CONFLICT(note_id) DO NOTHING").run(noteId, new Date().toISOString());
}

export function removePin(noteId: string): void {
  open().prepare("DELETE FROM pins WHERE note_id = ?").run(noteId);
}

/** A rename keeps the pin: the pin moves to the new id. */
export function movePin(from: string, to: string): void {
  if (from === to) return;
  open().prepare("UPDATE OR REPLACE pins SET note_id = ? WHERE note_id = ?").run(to, from);
}

// ---- Study cards (migration 8) ----

export function getCardState(cardId: string): CardState | null {
  const row = open().prepare("SELECT state FROM card_state WHERE card_id = ?").get(cardId) as { state: string } | undefined;
  return row ? (JSON.parse(row.state) as CardState) : null;
}

/** Scheduling state for many cards at once, keyed by card id. */
export function allCardStates(): Map<string, CardState> {
  const rows = open().prepare("SELECT card_id, state FROM card_state").all() as { card_id: string; state: string }[];
  return new Map(rows.map((r) => [r.card_id, JSON.parse(r.state) as CardState]));
}

/** Saves the new state and logs the review in one step, so the two can never disagree. */
export function saveReview(cardId: string, noteId: string, next: CardState, log: { rating: number; elapsedDays: number }, at: Date): void {
  const db = open();
  const prev = db.prepare("SELECT state FROM card_state WHERE card_id = ?").get(cardId) as { state: string } | undefined;
  db.transaction(() => {
    db.prepare("INSERT INTO card_state (card_id, due, state) VALUES (?, ?, ?) ON CONFLICT(card_id) DO UPDATE SET due = excluded.due, state = excluded.state").run(cardId, next.due, JSON.stringify(next));
    db.prepare("INSERT INTO reviews (card_id, note_id, rating, elapsed_days, reviewed_at, prev_state) VALUES (?, ?, ?, ?, ?, ?)").run(cardId, noteId, log.rating, log.elapsedDays, at.toISOString(), prev?.state ?? null);
  })();
}

/** How many reviews were logged at or after `since` (ISO), and how many of them were answered "again". */
export function reviewCountsSince(since: string): { total: number; again: number } {
  const row = open().prepare("SELECT COUNT(*) AS total, COALESCE(SUM(rating = 1), 0) AS again FROM reviews WHERE reviewed_at >= ?").get(since) as { total: number; again: number };
  return row;
}

/** Timestamps (ISO) of every review at or after `since`, oldest first. */
export function reviewTimesSince(since: string): string[] {
  return (open().prepare("SELECT reviewed_at FROM reviews WHERE reviewed_at >= ? ORDER BY reviewed_at").all(since) as { reviewed_at: string }[]).map((r) => r.reviewed_at);
}

/** Reviews per note, for the retention line on a note: [total, answered again]. */
export function reviewCountsForNote(noteId: string): { total: number; again: number } {
  return open().prepare("SELECT COUNT(*) AS total, COALESCE(SUM(rating = 1), 0) AS again FROM reviews WHERE note_id = ?").get(noteId) as { total: number; again: number };
}

// ---- Run results (migration 9) ----

export function setRunResult(runId: string, text: string): void {
  open().prepare("INSERT INTO run_results (run_id, text) VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET text = excluded.text").run(runId, text);
}

export function getRunResult(runId: string): string | null {
  const row = open().prepare("SELECT text FROM run_results WHERE run_id = ?").get(runId) as { text: string } | undefined;
  return row ? row.text : null;
}

/** Review counts for every note that has any: [total, answered again]. */
export function reviewCountsByNote(): Map<string, { total: number; again: number }> {
  const rows = open().prepare("SELECT note_id, COUNT(*) AS total, COALESCE(SUM(rating = 1), 0) AS again FROM reviews GROUP BY note_id").all() as { note_id: string; total: number; again: number }[];
  return new Map(rows.map((r) => [r.note_id, { total: r.total, again: r.again }]));
}

/**
 * Takes back the most recent review: the card goes back to what it was (or to "never reviewed") and the
 * log row is removed. Returns the card id, or null when there is nothing to undo.
 */
export function undoLastReview(): string | null {
  const db = open();
  const last = db.prepare("SELECT id, card_id, prev_state FROM reviews ORDER BY id DESC LIMIT 1").get() as { id: number; card_id: string; prev_state: string | null } | undefined;
  if (!last) return null;
  db.transaction(() => {
    if (last.prev_state === null) db.prepare("DELETE FROM card_state WHERE card_id = ?").run(last.card_id);
    else {
      const prev = JSON.parse(last.prev_state) as CardState;
      db.prepare("INSERT INTO card_state (card_id, due, state) VALUES (?, ?, ?) ON CONFLICT(card_id) DO UPDATE SET due = excluded.due, state = excluded.state").run(last.card_id, prev.due, last.prev_state);
    }
    db.prepare("DELETE FROM reviews WHERE id = ?").run(last.id);
  })();
  return last.card_id;
}

// ---- Exam dates (migration 11) ----

export type GoalRow = { kind: "note" | "tag"; value: string; day: string };

export function listGoals(): GoalRow[] {
  const rows = open().prepare("SELECT scope_kind, scope_value, day FROM goals ORDER BY day, scope_value").all() as { scope_kind: string; scope_value: string; day: string }[];
  return rows.map((r) => ({ kind: r.scope_kind === "tag" ? "tag" : "note", value: r.scope_value, day: r.day }));
}

export function setGoal(goal: GoalRow, now: Date): void {
  open()
    .prepare("INSERT INTO goals (scope_kind, scope_value, day, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(scope_kind, scope_value) DO UPDATE SET day = excluded.day")
    .run(goal.kind, goal.value, goal.day, now.toISOString());
}

export function removeGoal(kind: "note" | "tag", value: string): boolean {
  return open().prepare("DELETE FROM goals WHERE scope_kind = ? AND scope_value = ?").run(kind, value).changes > 0;
}

// ---- Note recall checks (migration 12) ----

export type RecallRow = { noteId: string; step: number; due: string; lastResult: string | null };

type RecallDbRow = { note_id: string; step: number; due: string; last_result: string | null };
const toRecall = (r: RecallDbRow): RecallRow => ({ noteId: r.note_id, step: r.step, due: r.due, lastResult: r.last_result });

export function listRecall(): RecallRow[] {
  return (open().prepare("SELECT note_id, step, due, last_result FROM note_recall ORDER BY due").all() as RecallDbRow[]).map(toRecall);
}

export function getRecall(noteId: string): RecallRow | null {
  const r = open().prepare("SELECT note_id, step, due, last_result FROM note_recall WHERE note_id = ?").get(noteId) as RecallDbRow | undefined;
  return r ? toRecall(r) : null;
}

export function saveRecall(row: RecallRow, now: Date): void {
  open()
    .prepare("INSERT INTO note_recall (note_id, step, due, last_result, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(note_id) DO UPDATE SET step = excluded.step, due = excluded.due, last_result = excluded.last_result, updated_at = excluded.updated_at")
    .run(row.noteId, row.step, row.due, row.lastResult, now.toISOString());
}

export function removeRecall(noteId: string): boolean {
  return open().prepare("DELETE FROM note_recall WHERE note_id = ?").run(noteId).changes > 0;
}

// ---- Misconceptions (ADR-0023): what the learner got wrong, kept until they say it is sorted ----

export type MisconceptionRow = { id: string; noteId: string; text: string; createdAt: string };

export function listMisconceptions(noteId?: string): MisconceptionRow[] {
  const rows = (noteId === undefined
    ? open().prepare("SELECT id, note_id, text, created_at FROM misconceptions WHERE resolved_at IS NULL ORDER BY created_at DESC")
    : open().prepare("SELECT id, note_id, text, created_at FROM misconceptions WHERE resolved_at IS NULL AND note_id = ? ORDER BY created_at DESC")
  ).all(...(noteId === undefined ? [] : [noteId])) as { id: string; note_id: string; text: string; created_at: string }[];
  return rows.map((r) => ({ id: r.id, noteId: r.note_id, text: r.text, createdAt: r.created_at }));
}

export function insertMisconception(row: MisconceptionRow): void {
  open().prepare("INSERT INTO misconceptions (id, note_id, text, created_at) VALUES (?, ?, ?, ?)").run(row.id, row.noteId, row.text, row.createdAt);
}

/** True when an open item was resolved; false when there is none with that id. */
export function resolveMisconception(id: string, now: Date): boolean {
  return open().prepare("UPDATE misconceptions SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL").run(now.toISOString(), id).changes > 0;
}

// ---- Model connections (ADR-0026) ----

export type ConnectionRow = { id: string; name: string; kind: string; baseUrl: string; apiKeyEnc: string | null; defaultModel: string | null; createdAt: string; updatedAt: string };
type ConnectionDb = { id: string; name: string; kind: string; base_url: string; api_key_enc: string | null; default_model: string | null; created_at: string; updated_at: string };
const toConnection = (r: ConnectionDb): ConnectionRow => ({ id: r.id, name: r.name, kind: r.kind, baseUrl: r.base_url, apiKeyEnc: r.api_key_enc, defaultModel: r.default_model, createdAt: r.created_at, updatedAt: r.updated_at });

export function listConnectionRows(): ConnectionRow[] {
  return (open().prepare("SELECT * FROM connections ORDER BY created_at, id").all() as ConnectionDb[]).map(toConnection);
}

export function getConnectionRow(id: string): ConnectionRow | null {
  const r = open().prepare("SELECT * FROM connections WHERE id = ?").get(id) as ConnectionDb | undefined;
  return r ? toConnection(r) : null;
}

export function putConnectionRow(row: ConnectionRow): void {
  open()
    .prepare(
      "INSERT INTO connections (id, name, kind, base_url, api_key_enc, default_model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, base_url = excluded.base_url, api_key_enc = excluded.api_key_enc, default_model = excluded.default_model, updated_at = excluded.updated_at",
    )
    .run(row.id, row.name, row.kind, row.baseUrl, row.apiKeyEnc, row.defaultModel, row.createdAt, row.updatedAt);
}

export function deleteConnectionRow(id: string): boolean {
  return open().prepare("DELETE FROM connections WHERE id = ?").run(id).changes > 0;
}
