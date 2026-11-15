import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// The move step fails after the incoming notes were already rewritten: everything must come back.
vi.mock("./vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vault")>();
  return {
    ...actual,
    moveNote: vi.fn(async () => {
      throw new Error("disk full");
    }),
  };
});

import { closeDb, getNote as indexGet, reindexNote } from "./index-db";
import { renameNote } from "./rename";
import { createNote } from "./vault";

let root = "";
const saved = { ...process.env };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-rollback-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
});
afterEach(async () => {
  closeDb();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

describe("rename rollback", () => {
  it("restores already-edited notes byte for byte and answers 500 rename-failed", async () => {
    for (const [title, body] of [["Target", "t"], ["Linker one", "see [[Target]]"], ["Linker two", "and [x](target)"]] as const) {
      reindexNote(await createNote({ title, body }));
    }
    const dir = path.join(root, "vault");
    const snapshot = async () => Object.fromEntries(await Promise.all((await readdir(dir)).map(async (f) => [f, await readFile(path.join(dir, f), "utf8")] as const)));
    const before = await snapshot();

    await expect(renameNote("target", "Moved")).rejects.toMatchObject({ code: "rename-failed", status: 500 });

    expect(await snapshot()).toEqual(before);
    expect(indexGet("target")?.title).toBe("Target");
    expect(indexGet("moved")).toBeNull();
    expect(indexGet("linker-one")?.body).toBe("see [[Target]]");
  });
});
