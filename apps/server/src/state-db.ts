import { existsSync, mkdirSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { AgentSchema, type Agent, type Run, type RunEvent, type RunStatus } from "@vigil/shared";
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
    open().prepare("SELECT note_id FROM snapshots WHERE run_id = ? ORDER BY rowid").all(row.id) as { note_id: string }[]
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
  return getRun(id) as Run;
}

export function finishRun(id: string, status: RunStatus, tokensUsed: number, error: string | null): void {
  open()
    .prepare("UPDATE runs SET status = ?, finished_at = ?, tokens_used = ?, error = ? WHERE id = ?")
    .run(status, new Date().toISOString(), tokensUsed, error, id);
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
  const row = open().prepare("SELECT 1 AS x FROM runs WHERE agent = ? AND status = 'running' LIMIT 1").get(agent);
  return row !== undefined;
}

export function markUndone(id: string): void {
  open().prepare("UPDATE runs SET undone = 1 WHERE id = ?").run(id);
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
}

export function listEvents(runId: string): RunEvent[] {
  const rows = open()
    .prepare("SELECT seq, at, kind, text, data FROM run_events WHERE run_id = ? ORDER BY seq")
    .all(runId) as { seq: number; at: string; kind: string; text: string; data: string }[];
  return rows.map((r) => ({
    seq: r.seq,
    at: r.at,
    kind: r.kind as RunEvent["kind"],
    text: r.text,
    data: JSON.parse(r.data) as Record<string, unknown>,
  }));
}

// ---- snapshots ----

export type SnapshotRow = { runId: string; noteId: string; existed: boolean; file: string | null; writtenUpdatedAt: string | null };

export function getSnapshot(runId: string, noteId: string): SnapshotRow | null {
  const row = open()
    .prepare("SELECT run_id, note_id, existed, file, written_updated_at FROM snapshots WHERE run_id = ? AND note_id = ?")
    .get(runId, noteId) as { run_id: string; note_id: string; existed: number; file: string | null; written_updated_at: string | null } | undefined;
  return row
    ? { runId: row.run_id, noteId: row.note_id, existed: row.existed === 1, file: row.file, writtenUpdatedAt: row.written_updated_at }
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
