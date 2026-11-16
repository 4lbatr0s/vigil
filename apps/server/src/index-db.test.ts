import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  closeDb,
  getNote,
  isEmpty,
  isFtsAvailable,
  listNotes,
  noteHashes,
  rebuildAll,
  reindexNote,
  removeNote,
  searchNotes,
} from "./index-db";
import { createNote, getNote as getVaultNote } from "./vault";

import type { Note } from "@vigil/shared";
import Database from "better-sqlite3";
import { extractLinks } from "./index-db";

function note(partial: Pick<Note, "id" | "title" | "body" | "updatedAt"> & Partial<Note>): Note {
  return { tags: [], author: "human", ...partial };
}

let vault = "";
let dbFile = "";
const originalVaultDir = process.env.VAULT_DIR;
const originalDbPath = process.env.DB_PATH;

beforeEach(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "vigil-vault-"));
  dbFile = path.join(await mkdtemp(path.join(tmpdir(), "vigil-db-")), "index.db");
  process.env.VAULT_DIR = vault;
  process.env.DB_PATH = dbFile;
});

afterEach(async () => {
  closeDb();
  if (originalVaultDir === undefined) delete process.env.VAULT_DIR;
  else process.env.VAULT_DIR = originalVaultDir;
  if (originalDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = originalDbPath;
  await rm(vault, { recursive: true, force: true });
  await rm(path.dirname(dbFile), { recursive: true, force: true });
});

describe("sqlite index", () => {
  it("indexes a note and lists it", () => {
    reindexNote(note({ id: "hello", title: "Hello", body: "Agents kept vigil.", updatedAt: "2026-11-14T00:00:00.000Z" }));
    const notes = listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: "hello", title: "Hello", body: "Agents kept vigil." });
  });

  it("returns a note by id", () => {
    reindexNote(note({ id: "hello", title: "Hello", body: "b", updatedAt: "2026-11-14T00:00:00.000Z" }));
    expect(getNote("hello")).toMatchObject({ id: "hello" });
    expect(getNote("nope")).toBeNull();
  });

  it("searches note bodies", () => {
    reindexNote(note({ id: "hello", title: "Hello", body: "Agents kept vigil.", updatedAt: "2026-11-14T00:00:00.000Z" }));
    reindexNote(note({ id: "other", title: "Other", body: "unrelated", updatedAt: "2026-11-14T00:00:01.000Z" }));
    const hits = searchNotes("vigil");
    expect(hits.map((h) => h.id)).toContain("hello");
    expect(hits.map((h) => h.id)).not.toContain("other");
    expect(isFtsAvailable()).toBe(true);
  });

  it("deindexes a removed note", () => {
    reindexNote(note({ id: "hello", title: "Hello", body: "b", updatedAt: "2026-11-14T00:00:00.000Z" }));
    removeNote("hello");
    expect(listNotes()).toHaveLength(0);
    expect(getNote("hello")).toBeNull();
    expect(searchNotes("b")).toHaveLength(0);
  });

  it("rebuilds from files written outside the API", async () => {
    await writeFile(
      path.join(vault, "manual.md"),
      `---\nid: manual\ntitle: Manual\nupdatedAt: 2026-11-14T00:00:00.000Z\n---\n\nwritten by hand\n`,
      "utf8",
    );
    const count = await rebuildAll();
    expect(count).toBe(1);
    expect(listNotes().map((n) => n.id)).toEqual(["manual"]);
  });

  it("rebuilds from vault notes created through the store", async () => {
    await createNote({ title: "Stored", body: "content" });
    await rebuildAll();
    expect(listNotes().map((n) => n.id)).toEqual(["stored"]);
  });
});

describe("index details", () => {
  it("round-trips tags and author", () => {
    reindexNote(note({ id: "a", title: "A", body: "b", updatedAt: "2026-11-14T00:00:00.000Z", tags: ["x", "y"], author: "agent" }));
    expect(getNote("a")).toMatchObject({ tags: ["x", "y"], author: "agent" });
  });

  it("keeps links to notes that do not exist yet", () => {
    expect(extractLinks("see [[Future Note]] and [[Other|alias]] and [x](plain-id) and [web](https://a.b/c)")).toEqual([
      "future-note",
      "other",
      "plain-id",
    ]);
    expect(extractLinks("[[Page#Heading]]")).toEqual(["page"]);
  });

  it("stores dangling links and keeps them when the target is removed", () => {
    reindexNote(note({ id: "a", title: "A", body: "[[b]]", updatedAt: "2026-11-14T00:00:00.000Z" }));
    reindexNote(note({ id: "b", title: "B", body: "x", updatedAt: "2026-11-14T00:00:00.000Z" }));
    removeNote("b");
    closeDb();
    const raw = new Database(dbFile);
    const rows = raw.prepare("SELECT src, dst FROM links").all();
    raw.close();
    expect(rows).toEqual([{ src: "a", dst: "b" }]);
  });

  it("drops and rebuilds an index from an older schema version", async () => {
    const old = new Database(dbFile);
    old.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, updated_at TEXT); INSERT INTO notes VALUES ('stale','Stale','t');");
    old.close();
    expect(listNotes()).toEqual([]);
    await createNote({ title: "Fresh", body: "x" });
    expect(await rebuildAll()).toBe(1);
    expect(listNotes().map((n) => n.id)).toEqual(["fresh"]);
  });

  it("noteHashes() changes when the body changes and not when only updatedAt changes", () => {
    reindexNote(note({ id: "a", title: "A", body: "one", updatedAt: "2026-11-14T00:00:00.000Z" }));
    const first = noteHashes()["a"];
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    reindexNote(note({ id: "a", title: "A", body: "one", updatedAt: "2026-11-15T00:00:00.000Z" }));
    expect(noteHashes()["a"]).toBe(first);
    reindexNote(note({ id: "a", title: "A", body: "two", updatedAt: "2026-11-15T00:00:00.000Z" }));
    expect(noteHashes()["a"]).not.toBe(first);
  });

  it.each([2, 3])("opening an index at version %i rebuilds", async (oldVersion) => {
    await createNote({ title: "Digest", body: "summary" }, { author: "agent", agentName: "digest" });
    reindexNote(await getVaultNote("digest"));
    expect(isEmpty()).toBe(false);
    const old = new Database(dbFile);
    old.pragma(`user_version = ${oldVersion}`);
    old.close();
    closeDb();
    // Reopening sees the old version, drops every table and stamps the new version.
    expect(isEmpty()).toBe(true);
    const raw = new Database(dbFile, { readonly: true });
    expect(raw.pragma("user_version", { simple: true })).toBe(4);
    raw.close();
    expect(await rebuildAll()).toBe(1);
    const fetched = getNote("digest");
    expect(fetched).toMatchObject({ id: "digest", author: "agent", agentName: "digest" });
  });
});
