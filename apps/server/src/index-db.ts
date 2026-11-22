import { publish } from "./events";
import { extractLinks } from "./links";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { allTags, extractCards, snippetOf, type Card, type Note, type NoteSummary } from "@vigil/shared";
import { REPO_ROOT, listNotes as vaultListNotes, slugify } from "./vault";

export type NoteRow = Note;
export type SearchHit = { id: string; title: string; snippet: string };

export function dbPath(): string {
  const configured = process.env.DB_PATH;
  return configured ? path.resolve(configured) : path.join(REPO_ROOT, "data", "index.db");
}

/**
 * Bump when a table changes. The index is disposable (ADR-0001), so a different version drops every
 * table and the server rebuilds from the vault on start (`isEmpty` then `rebuildAll`).
 */
const SCHEMA_VERSION = 6;

function migrate(db: Database.Database): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version !== SCHEMA_VERSION) {
    db.exec("DROP TABLE IF EXISTS notes; DROP TABLE IF EXISTS notes_body; DROP TABLE IF EXISTS links; DROP TABLE IF EXISTS notes_fts; DROP TABLE IF EXISTS cards;");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT,
      updated_at TEXT,
      author TEXT NOT NULL DEFAULT 'human',
      tags TEXT NOT NULL DEFAULT '[]',
      agent_name TEXT,
      hash TEXT,
      tags_all TEXT NOT NULL DEFAULT '[]',
      snippet TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS notes_body (
      id TEXT PRIMARY KEY,
      body TEXT
    );
    -- dst may name a note that does not exist yet: a dangling link still draws a graph edge.
    CREATE TABLE IF NOT EXISTS links (
      src TEXT,
      dst TEXT
    );
    -- Study cards written in the notes (ADR-0017). The scheduling state is durable and lives in state.db.
    CREATE TABLE IF NOT EXISTS cards (
      id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      line INTEGER NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (note_id, id)
    );
    CREATE INDEX IF NOT EXISTS cards_id ON cards(id);
    CREATE INDEX IF NOT EXISTS links_src ON links(src);
    CREATE INDEX IF NOT EXISTS links_dst ON links(dst);
  `);
  if (version !== SCHEMA_VERSION) db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

let current: { key: string; db: Database.Database; fts: boolean } | null = null;

function open(): { db: Database.Database; fts: boolean } {
  const key = dbPath();
  if (current && current.key === key) return { db: current.db, fts: current.fts };
  if (current) current.db.close();
  const file = key;
  if (!existsSync(path.dirname(file))) mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  migrate(db);
  let fts = true;
  try {
    // Standalone FTS5 table (not contentless) so rows can be replaced per note.
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(id UNINDEXED, title, body)");
  } catch {
    fts = false;
  }
  current = { key, db, fts };
  return { db, fts };
}

export function closeDb(): void {
  if (current) {
    current.db.close();
    current = null;
  }
}


// Link extraction lives in links.ts (shared with rename); re-exported for existing callers.
export { extractLinks } from "./links";

/** Every link in the index (source and target ids). Targets may not exist. */
export function allLinks(): { src: string; dst: string }[] {
  const { db } = open();
  return db.prepare("SELECT src, dst FROM links").all() as { src: string; dst: string }[];
}

export type Backlink = { id: string; title: string; snippet: string };

const SNIPPET_MAX = 160;

/** The first line of `body` that links to `id`, trimmed and capped; empty when none is found. */
function snippetFor(body: string, id: string): string {
  const line = body.split("\n").find((l) => extractLinks(l).includes(id)) ?? "";
  const text = line.trim();
  return text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX - 1)}…` : text;
}

/** Notes that link to `id`, newest first. The target need not exist: dangling links still have sources. */
export function backlinks(id: string): Backlink[] {
  const { db } = open();
  const rows = db
    .prepare(
      `SELECT n.id AS id, n.title AS title, b.body AS body FROM links l
       JOIN notes n ON n.id = l.src LEFT JOIN notes_body b ON b.id = n.id
       WHERE l.dst = ? ORDER BY n.updated_at DESC`,
    )
    .all(id) as { id: string; title: string; body: string | null }[];
  return rows.map((r) => ({ id: r.id, title: r.title, snippet: snippetFor(r.body ?? "", id) }));
}

export type OutgoingLink = { id: string; title: string; ghost: boolean };

/** Where a note links to, in order of first appearance. A link to a note that does not exist is a ghost, titled by its id. */
export function outgoingLinks(id: string): OutgoingLink[] {
  const { db } = open();
  const rows = db
    .prepare("SELECT l.dst AS id, n.title AS title FROM links l LEFT JOIN notes n ON n.id = l.dst WHERE l.src = ? GROUP BY l.dst ORDER BY MIN(l.rowid)")
    .all(id) as { id: string; title: string | null }[];
  return rows.map((r) => ({ id: r.id, title: r.title ?? r.id, ghost: r.title === null }));
}

export type Mention = { id: string; title: string; snippet: string };

/** A title shorter than this would match half the vault ("it", "a"), so it is never searched for. */
const MIN_MENTION_TITLE = 3;
const MENTION_LIMIT = 20;

/** Notes whose text contains `title` but that do not link to the note `id` (and are not that note). Newest first. */
export function mentionsOf(id: string, title: string): Mention[] {
  const needle = title.trim().toLowerCase();
  if (needle.length < MIN_MENTION_TITLE) return [];
  const { db } = open();
  const like = `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db
    .prepare(
      `SELECT n.id AS id, n.title AS title, b.body AS body FROM notes n JOIN notes_body b ON b.id = n.id
       WHERE n.id != ? AND lower(b.body) LIKE ? ESCAPE '\\'
         AND n.id NOT IN (SELECT src FROM links WHERE dst = ?)
       ORDER BY n.updated_at DESC LIMIT ?`,
    )
    .all(id, like, id, MENTION_LIMIT) as { id: string; title: string; body: string }[];
  return rows.map((r) => {
    const line = r.body.split("\n").find((l) => l.toLowerCase().includes(needle))?.trim() ?? "";
    return { id: r.id, title: r.title, snippet: line.length > SNIPPET_MAX ? `${line.slice(0, SNIPPET_MAX - 1)}…` : line };
  });
}

export function reindexNote(note: Note): void {
  const { db, fts } = open();
  const existed = db.prepare("SELECT 1 AS x FROM notes WHERE id = ?").get(note.id) !== undefined;
  const hash = createHash("sha256")
    .update(`${note.title}\n${note.tags.join(",")}\n${note.body}`)
    .digest("hex");
  db.prepare(
    "INSERT INTO notes (id, title, updated_at, author, tags, agent_name, hash, tags_all, snippet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at, author = excluded.author, tags = excluded.tags, agent_name = excluded.agent_name, hash = excluded.hash, tags_all = excluded.tags_all, snippet = excluded.snippet",
  ).run(note.id, note.title, note.updatedAt, note.author, JSON.stringify(note.tags), note.agentName ?? null, hash, JSON.stringify(allTags(note.tags, note.body)), snippetOf(note.body));
  db.prepare(
    "INSERT INTO notes_body (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body",
  ).run(note.id, note.body);
  if (fts) {
    db.prepare("DELETE FROM notes_fts WHERE id = ?").run(note.id);
    db.prepare("INSERT INTO notes_fts (id, title, body) VALUES (?, ?, ?)").run(
      note.id,
      note.title,
      note.body,
    );
  }
  db.prepare("DELETE FROM cards WHERE note_id = ?").run(note.id);
  for (const l of listeners) l(note.id);
  const addCard = db.prepare("INSERT OR IGNORE INTO cards (id, note_id, kind, front, back, line, context) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const c of extractCards(note.body)) addCard.run(c.id, note.id, c.kind, c.front, c.back, c.line, c.context);
  db.prepare("DELETE FROM links WHERE src = ?").run(note.id);
  const insert = db.prepare("INSERT INTO links (src, dst) VALUES (?, ?)");
  for (const dst of extractLinks(note.body)) {
    if (dst === note.id) continue;
    insert.run(note.id, dst);
  }
  publish({ type: "note", id: note.id, change: existed ? "updated" : "created", author: note.author });
}

export function removeNote(id: string): void {
  const { db, fts } = open();
  const row = db.prepare("SELECT author FROM notes WHERE id = ?").get(id) as { author: string } | undefined;
  db.prepare("DELETE FROM notes WHERE id = ?").run(id);
  db.prepare("DELETE FROM notes_body WHERE id = ?").run(id);
  if (fts) db.prepare("DELETE FROM notes_fts WHERE id = ?").run(id);
  // Links FROM this note go; links TO it stay, as dangling links, because other notes still say them.
  db.prepare("DELETE FROM links WHERE src = ?").run(id);
  db.prepare("DELETE FROM cards WHERE note_id = ?").run(id);
  if (row) publish({ type: "note", id, change: "deleted", author: row.author === "agent" ? "agent" : "human" });
}

export async function rebuildAll(): Promise<number> {
  const { db, fts } = open();
  db.prepare("DELETE FROM notes").run();
  db.prepare("DELETE FROM notes_body").run();
  db.prepare("DELETE FROM links").run();
  db.prepare("DELETE FROM cards").run();
  if (fts) db.prepare("DELETE FROM notes_fts").run();
  const notes = await vaultListNotes();
  for (const note of notes) reindexNote(note);
  return notes.length;
}

export function isEmpty(): boolean {
  const { db } = open();
  const row = db.prepare("SELECT COUNT(*) AS c FROM notes").get() as { c: number };
  return row.c === 0;
}

type DbNote = {
  id: string;
  title: string;
  updated_at: string;
  author: string;
  tags: string;
  agent_name: string | null;
  body: string | null;
};

const NOTE_COLUMNS =
  "n.id AS id, n.title AS title, n.updated_at AS updated_at, n.author AS author, n.tags AS tags, n.agent_name AS agent_name, b.body AS body";

function toNote(row: DbNote): NoteRow {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? "",
    tags: JSON.parse(row.tags) as string[],
    author: row.author === "agent" ? "agent" : "human",
    ...(row.agent_name ? { agentName: row.agent_name } : {}),
    updatedAt: row.updated_at,
  };
}

/** {id: hash} for every indexed note; the hash covers title, tags and body. `excludeAgent` leaves out notes that agent last wrote (heartbeat loop guard). */
export function noteHashes(excludeAgent?: string): Record<string, string> {
  const { db } = open();
  const rows = db
    .prepare("SELECT id, hash FROM notes WHERE hash IS NOT NULL AND (? IS NULL OR agent_name IS NULL OR agent_name != ?)")
    .all(excludeAgent ?? null, excludeAgent ?? null) as {
    id: string;
    hash: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.hash]));
}

export function listNotes(): NoteRow[] {
  const { db } = open();
  const rows = db
    .prepare(`SELECT ${NOTE_COLUMNS} FROM notes n LEFT JOIN notes_body b ON b.id = n.id ORDER BY n.updated_at DESC`)
    .all() as DbNote[];
  return rows.map(toNote);
}

/** The list view: no bodies, so the payload stays small however long the notes are. */
export function listNoteSummaries(): NoteSummary[] {
  const { db } = open();
  const rows = db
    .prepare("SELECT id, title, updated_at, author, tags, agent_name, tags_all, snippet FROM notes ORDER BY updated_at DESC")
    .all() as (Omit<DbNote, "body"> & { tags_all: string; snippet: string })[];
  return rows.map((row) => {
    const { body: _body, ...summary } = toNote({ ...row, body: null });
    return { ...summary, tags: JSON.parse(row.tags_all) as string[], snippet: row.snippet };
  });
}

/** Every tag on a note (frontmatter and inline), or an empty list for an unknown note. */
export function noteTagsAll(id: string): string[] {
  const row = open().db.prepare("SELECT tags_all FROM notes WHERE id = ?").get(id) as { tags_all: string } | undefined;
  return row ? (JSON.parse(row.tags_all) as string[]) : [];
}

export function getNote(id: string): NoteRow | null {
  const { db } = open();
  const row = db
    .prepare(`SELECT ${NOTE_COLUMNS} FROM notes n LEFT JOIN notes_body b ON b.id = n.id WHERE n.id = ?`)
    .get(id) as DbNote | undefined;
  return row ? toNote(row) : null;
}

function sanitize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 0);
}

export function searchNotes(query: string): SearchHit[] {
  const { db, fts } = open();
  const tokens = sanitize(query);
  if (tokens.length === 0) return [];
  if (fts) {
    const match = tokens.map((t) => `"${t}"`).join(" ");
    const rows = db
      .prepare(
        "SELECT id, title, snippet(notes_fts, 2, '', '', '…', 12) AS snippet FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank",
      )
      .all(match) as { id: string; title: string; snippet: string }[];
    return rows;
  }
  const like = `%${tokens.join("%")}%`;
  const rows = db
    .prepare("SELECT n.id AS id, n.title AS title, b.body AS body FROM notes n LEFT JOIN notes_body b ON b.id = n.id WHERE n.title LIKE ? OR b.body LIKE ?")
    .all(like, like) as { id: string; title: string; body: string | null }[];
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    snippet: (r.body ?? "").slice(0, 80),
  }));
}

/** Ids of the notes that contain ANY of the words, best match first (a question is not an exact phrase). */
export function searchNotesAny(words: string[], limit: number): string[] {
  const { db, fts } = open();
  const clean = words.filter((w) => w.length > 0);
  if (clean.length === 0) return [];
  if (fts) {
    const match = clean.map((w) => `"${w.replaceAll('"', "")}"`).join(" OR ");
    const rows = db.prepare("SELECT id FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?").all(match, limit) as { id: string }[];
    return rows.map((r) => r.id);
  }
  const where = clean.map(() => "(n.title LIKE ? OR b.body LIKE ?)").join(" OR ");
  const args = clean.flatMap((w) => [`%${w}%`, `%${w}%`]);
  const rows = db.prepare(`SELECT n.id AS id FROM notes n LEFT JOIN notes_body b ON b.id = n.id WHERE ${where} LIMIT ?`).all(...args, limit) as { id: string }[];
  return rows.map((r) => r.id);
}

/** For meaning search: the open index database, and every note with its content hash. */
export const indexDb = (): Database.Database => open().db;
export function notesForEmbedding(): { id: string; title: string; body: string; hash: string }[] {
  return open().db.prepare("SELECT n.id AS id, n.title AS title, COALESCE(b.body, '') AS body, COALESCE(n.hash, '') AS hash FROM notes n LEFT JOIN notes_body b ON b.id = n.id").all() as { id: string; title: string; body: string; hash: string }[];
}

type IndexListener = (noteId: string) => void;
const listeners: IndexListener[] = [];
/** Called after a note is (re)indexed, so a background job can follow changes. */
export function onNoteIndexed(listener: IndexListener): void {
  listeners.push(listener);
}

export function isFtsAvailable(): boolean {
  return open().fts;
}

export type IndexedCard = Card & { noteId: string };

type CardRow = { id: string; note_id: string; kind: string; front: string; back: string; line: number; context: string };
const toCard = (r: CardRow): IndexedCard => ({ id: r.id, noteId: r.note_id, kind: r.kind === "cloze" ? "cloze" : "qa", front: r.front, back: r.back, line: r.line, context: r.context });

/** Every card in the vault, in note then line order. */
export function listCards(): IndexedCard[] {
  return (open().db.prepare("SELECT id, note_id, kind, front, back, line, context FROM cards ORDER BY note_id, line").all() as CardRow[]).map(toCard);
}

export function cardsForNote(noteId: string): IndexedCard[] {
  return (open().db.prepare("SELECT id, note_id, kind, front, back, line, context FROM cards WHERE note_id = ? ORDER BY line").all(noteId) as CardRow[]).map(toCard);
}
