import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  closeDb,
  getNote,
  isFtsAvailable,
  listNotes,
  rebuildAll,
  reindexNote,
  removeNote,
  searchNotes,
} from "./index-db";
import { createNote } from "./vault";

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
    reindexNote({ id: "hello", title: "Hello", body: "Agents kept vigil.", updatedAt: "2026-11-14T00:00:00.000Z" });
    const notes = listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: "hello", title: "Hello", body: "Agents kept vigil." });
  });

  it("returns a note by id", () => {
    reindexNote({ id: "hello", title: "Hello", body: "b", updatedAt: "2026-11-14T00:00:00.000Z" });
    expect(getNote("hello")).toMatchObject({ id: "hello" });
    expect(getNote("nope")).toBeNull();
  });

  it("searches note bodies", () => {
    reindexNote({ id: "hello", title: "Hello", body: "Agents kept vigil.", updatedAt: "2026-11-14T00:00:00.000Z" });
    reindexNote({ id: "other", title: "Other", body: "unrelated", updatedAt: "2026-11-14T00:00:01.000Z" });
    const hits = searchNotes("vigil");
    expect(hits.map((h) => h.id)).toContain("hello");
    expect(hits.map((h) => h.id)).not.toContain("other");
    expect(isFtsAvailable()).toBe(true);
  });

  it("deindexes a removed note", () => {
    reindexNote({ id: "hello", title: "Hello", body: "b", updatedAt: "2026-11-14T00:00:00.000Z" });
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
