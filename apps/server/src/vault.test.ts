import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AppError } from "./errors";
import { createNote, deleteNote, getNote, listNotes, slugify, updateNote, validateId } from "./vault";

let dir = "";
const originalVaultDir = process.env.VAULT_DIR;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vigil-vault-"));
  process.env.VAULT_DIR = dir;
});

afterEach(async () => {
  if (originalVaultDir === undefined) delete process.env.VAULT_DIR;
  else process.env.VAULT_DIR = originalVaultDir;
  await rm(dir, { recursive: true, force: true });
});

describe("slugify", () => {
  it("lowercases and dashes", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("  A  B  ")).toBe("a-b");
  });

  it("strips unsafe characters and collapses dashes", () => {
    expect(slugify("../evil")).toBe("evil");
    expect(slugify("a---b")).toBe("a-b");
  });

  it("caps at 80 characters", () => {
    expect(slugify("x".repeat(200)).length).toBe(80);
  });
});

describe("validateId", () => {
  it("accepts slugified ids", () => {
    expect(validateId("hello-world-1")).toBe("hello-world-1");
  });

  it("rejects path traversal and malformed ids", () => {
    for (const bad of ["../evil", "..", ".hidden", "a/b", "", "Hello"]) {
      expect(() => validateId(bad)).toThrow(AppError);
      try {
        validateId(bad);
      } catch (err) {
        expect((err as AppError).code).toBe("invalid-id");
        expect((err as AppError).status).toBe(400);
      }
    }
  });
});

describe("vault store", () => {
  it("round-trips a created note", async () => {
    const created = await createNote({ title: "Hello", body: "# Hi\n\nbody text" });
    expect(created).toMatchObject({ id: "hello", title: "Hello", body: "# Hi\n\nbody text" });
    const fetched = await getNote("hello");
    expect(fetched).toEqual(created);
  });

  it("rejects a duplicate slug with 409", async () => {
    await createNote({ title: "Hello", body: "b" });
    await expect(createNote({ title: "Hello", body: "c" })).rejects.toMatchObject({
      code: "note-exists",
      status: 409,
    });
  });

  it("throws 404 for a missing note", async () => {
    await expect(getNote("missing")).rejects.toMatchObject({
      code: "note-not-found",
      status: 404,
    });
  });

  it("updates body and bumps updatedAt", async () => {
    const created = await createNote({ title: "Note", body: "old" });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateNote("note", { body: "new" });
    expect(updated.body).toBe("new");
    expect(updated.title).toBe("Note");
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
    expect(await getNote("note")).toEqual(updated);
  });

  it("lists notes sorted by updatedAt desc", async () => {
    await createNote({ title: "First", body: "1" });
    await new Promise((r) => setTimeout(r, 5));
    await createNote({ title: "Second", body: "2" });
    const notes = await listNotes();
    expect(notes.map((n) => n.id)).toEqual(["second", "first"]);
  });

  it("deletes a note", async () => {
    await createNote({ title: "Gone", body: "x" });
    await deleteNote("gone");
    await expect(getNote("gone")).rejects.toMatchObject({ code: "note-not-found" });
  });
});

describe("vault details", () => {
  it("uses the first heading, then the file name, when there is no frontmatter title", async () => {
    await writeFile(path.join(dir, "from-heading.md"), "# Real Title\n\ntext\n", "utf8");
    await writeFile(path.join(dir, "bare.md"), "just text\n", "utf8");
    expect((await getNote("from-heading")).title).toBe("Real Title");
    expect((await getNote("bare")).title).toBe("bare");
  });

  it("round-trips tags and records the author", async () => {
    const made = await createNote({ title: "Tagged", body: "x", tags: ["a", "b"] }, { author: "agent" });
    expect(made).toMatchObject({ tags: ["a", "b"], author: "agent" });
    expect(await getNote("tagged")).toEqual(made);
    const raw = await readFile(path.join(dir, "tagged.md"), "utf8");
    expect(raw).toContain("author: agent");
    const human = await updateNote("tagged", { body: "y" });
    expect(human).toMatchObject({ author: "human", tags: ["a", "b"] });
  });

  it("takes updatedAt from the file's mtime, so outside edits count", async () => {
    await createNote({ title: "Edited", body: "x" });
    const when = new Date("2026-01-02T03:04:05.000Z");
    await utimes(path.join(dir, "edited.md"), when, when);
    expect((await getNote("edited")).updatedAt).toBe(when.toISOString());
  });

  it("leaves no temp files behind", async () => {
    await createNote({ title: "Clean", body: "x" });
    await updateNote("clean", { body: "y" });
    expect(await readdir(dir)).toEqual(["clean.md"]);
  });

  it("refuses to overwrite a note that changed since it was read", async () => {
    const first = await createNote({ title: "Race", body: "x" });
    const later = new Date(new Date(first.updatedAt).getTime() + 5000);
    await utimes(path.join(dir, "race.md"), later, later);
    await expect(
      updateNote("race", { body: "mine" }, { expectedUpdatedAt: first.updatedAt }),
    ).rejects.toMatchObject({ code: "note-conflict", status: 409 });
    expect((await getNote("race")).body).toBe("x");
    const ok = await updateNote("race", { body: "mine" }, { expectedUpdatedAt: later.toISOString() });
    expect(ok.body).toBe("mine");
  });
});
