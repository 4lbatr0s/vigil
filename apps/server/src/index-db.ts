import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Note } from "@vigil/shared";
import { REPO_ROOT, listNotes as vaultListNotes, slugify } from "./vault";

export type NoteRow = { id: string; title: string; body: string; updatedAt: string };
export type SearchHit = { id: string; title: string; snippet: string };

export function dbPath(): string {
  const configured = process.env.DB_PATH;
  return configured ? path.resolve(configured) : path.join(REPO_ROOT, "data", "index.db");
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS notes_body (
      id TEXT PRIMARY KEY,
      body TEXT
    );
    CREATE TABLE IF NOT EXISTS links (
      src TEXT,
      dst TEXT
    );
    CREATE INDEX IF NOT EXISTS links_src ON links(src);
    CREATE INDEX IF NOT EXISTS links_dst ON links(dst);
  `);
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

/** Naive link extraction: [[wikilink]] and [text](target). */
export function extractLinks(body: string, knownIds: string[]): string[] {
  const found = new Set<string>();
  const known = new Set(knownIds);
  const wiki = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  for (const match of body.matchAll(wiki)) {
    const raw = (match[1] ?? "").trim();
    if (!raw) continue;
    const slug = slugify(raw);
    if (known.has(slug)) found.add(slug);
  }
  const md = /\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const match of body.matchAll(md)) {
    const raw = (match[1] ?? "").trim();
    if (!raw || raw.includes("#")) continue;
    const candidate = raw.replace(/^\.\//, "").replace(/\.md$/, "");
    if (known.has(candidate)) found.add(candidate);
  }
  return [...found];
}

export function reindexNote(note: Note): void {
  const { db, fts } = open();
  db.prepare(
    "INSERT INTO notes (id, title, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at",
  ).run(note.id, note.title, note.updatedAt);
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
  const knownIds = (db.prepare("SELECT id FROM notes").all() as { id: string }[]).map((r) => r.id);
  db.prepare("DELETE FROM links WHERE src = ?").run(note.id);
  const insert = db.prepare("INSERT INTO links (src, dst) VALUES (?, ?)");
  for (const dst of extractLinks(note.body, knownIds)) {
    if (dst === note.id) continue;
    insert.run(note.id, dst);
  }
}

export function removeNote(id: string): void {
  const { db, fts } = open();
  db.prepare("DELETE FROM notes WHERE id = ?").run(id);
  db.prepare("DELETE FROM notes_body WHERE id = ?").run(id);
  if (fts) db.prepare("DELETE FROM notes_fts WHERE id = ?").run(id);
  db.prepare("DELETE FROM links WHERE src = ? OR dst = ?").run(id, id);
}

export async function rebuildAll(): Promise<number> {
  const { db, fts } = open();
  db.prepare("DELETE FROM notes").run();
  db.prepare("DELETE FROM notes_body").run();
  db.prepare("DELETE FROM links").run();
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

export function listNotes(): NoteRow[] {
  const { db } = open();
  const rows = db
    .prepare(
      "SELECT n.id AS id, n.title AS title, n.updated_at AS updated_at, b.body AS body FROM notes n LEFT JOIN notes_body b ON b.id = n.id ORDER BY n.updated_at DESC",
    )
    .all();
  return rows.map((r) => {
    const row = r as { id: string; title: string; updated_at: string; body: string | null };
    return {
      id: row.id,
      title: row.title,
      body: row.body ?? "",
      updatedAt: row.updated_at,
    };
  });
}

export function getNote(id: string): NoteRow | null {
  const { db } = open();
  const row = db
    .prepare(
      "SELECT n.id AS id, n.title AS title, n.updated_at AS updated_at, b.body AS body FROM notes n LEFT JOIN notes_body b ON b.id = n.id WHERE n.id = ?",
    )
    .get(id);
  if (!row) return null;
  const r = row as { id: string; title: string; updated_at: string; body: string | null };
  return { id: r.id, title: r.title, body: r.body ?? "", updatedAt: r.updated_at };
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

export function isFtsAvailable(): boolean {
  return open().fts;
}
