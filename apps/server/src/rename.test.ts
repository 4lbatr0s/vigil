import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb, getNote as indexGet, listNotes as indexList, reindexNote } from "./index-db";
import { planRename, renameNote } from "./rename";
import { createNote, getNote } from "./vault";

let root = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-rename-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
});
afterEach(async () => {
  closeDb();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

async function add(title: string, body: string, opts?: Parameters<typeof createNote>[1]) {
  const n = await createNote({ title, body }, opts);
  reindexNote(n);
  return n;
}
const files = async () => (await readdir(path.join(root, "vault"))).sort();

describe("rename", () => {
  it("moves the file, updates frontmatter, rewrites incoming wikilinks and md links, skips code, and reindexes", async () => {
    await add("Old title", "Body of the note. Self: [[Old title]].");
    await add("Linker", "See [[Old title]] and [x](old-title) and [[old title#Part|alias]].\n```\n[[Old title]]\n```\n");
    await add("Bystander", "Nothing here, only [[Other]].");

    const note = await renameNote("old-title", "Brand new name");
    expect(note.id).toBe("brand-new-name");
    expect(note.title).toBe("Brand new name");
    expect(note.body).toBe("Body of the note. Self: [[Brand new name]].");

    expect(await files()).toEqual(["brand-new-name.md", "bystander.md", "linker.md"]);
    const raw = await readFile(path.join(root, "vault", "brand-new-name.md"), "utf8");
    expect(raw).toContain("id: brand-new-name");
    expect(raw).toContain("title: Brand new name");

    const linker = await getNote("linker");
    expect(linker.body).toBe("See [[Brand new name]] and [x](brand-new-name) and [[Brand new name#Part|alias]].\n```\n[[Old title]]\n```\n");
    expect((await getNote("bystander")).body).toBe("Nothing here, only [[Other]].");

    // Index follows: old id gone, new id present, links updated.
    expect(indexGet("old-title")).toBeNull();
    expect(indexGet("brand-new-name")?.title).toBe("Brand new name");
    expect(indexList().map((n) => n.id).sort()).toEqual(["brand-new-name", "bystander", "linker"]);
  });

  it("keeps tags and agent provenance of the renamed note, and of edited notes", async () => {
    await createNote({ title: "Agent made", body: "x", tags: ["t1"] }, { author: "agent", agentName: "digest" }).then(reindexNote);
    await createNote({ title: "Agent linker", body: "[[Agent made]]" }, { author: "agent", agentName: "other" }).then(reindexNote);
    const note = await renameNote("agent-made", "Agent renamed");
    expect(note).toMatchObject({ author: "agent", agentName: "digest", tags: ["t1"] });
    expect(await getNote("agent-linker")).toMatchObject({ author: "agent", agentName: "other", body: "[[Agent renamed]]" });
  });

  it("refuses a title whose id is taken (409 note-exists) and changes nothing", async () => {
    await add("One", "[[Two]] stays");
    await add("Two", "two");
    await expect(renameNote("one", "Two")).rejects.toMatchObject({ code: "note-exists", status: 409 });
    expect(await files()).toEqual(["one.md", "two.md"]);
    expect((await getNote("one")).body).toBe("[[Two]] stays");
  });

  it("handles a note with no incoming links", async () => {
    await add("Lonely", "Just me.");
    const note = await renameNote("lonely", "Less lonely");
    expect(note.id).toBe("less-lonely");
    expect(await files()).toEqual(["less-lonely.md"]);
  });

  it("only changes the title when the slug stays the same", async () => {
    await add("Same slug", "[[Same slug]]");
    await add("Other", "[[Same slug]]");
    const note = await renameNote("same-slug", "Same Slug!");
    expect(note.id).toBe("same-slug");
    expect(note.title).toBe("Same Slug!");
    expect((await getNote("other")).body).toBe("[[Same slug]]");
    expect(await files()).toEqual(["other.md", "same-slug.md"]);
  });

  it("404 for a missing note, 400 for an empty title", async () => {
    await expect(renameNote("nope", "Whatever")).rejects.toMatchObject({ code: "note-not-found" });
    await add("Real", "x");
    await expect(renameNote("real", "   ")).rejects.toMatchObject({ code: "invalid-body" });
  });
});

describe("dry run", () => {
  it("lists the notes that would change and writes nothing", async () => {
    await add("Target", "t");
    await add("A", "[[Target]]");
    await add("B", "[b](target)");
    await add("C", "nothing");
    const before = await Promise.all((await files()).map((f) => readFile(path.join(root, "vault", f), "utf8")));
    const plan = await planRename("target", "Moved");
    expect(plan.newId).toBe("moved");
    expect(plan.notesToChange.sort()).toEqual(["a", "b"]);
    expect(plan.titles.sort()).toEqual(["A", "B"]);
    const after = await Promise.all((await files()).map((f) => readFile(path.join(root, "vault", f), "utf8")));
    expect(after).toEqual(before);
    expect(await files()).toEqual(["a.md", "b.md", "c.md", "target.md"]);
  });

  it("refuses a taken id like the real thing", async () => {
    await add("X", "x");
    await add("Y", "y");
    await expect(planRename("x", "Y")).rejects.toMatchObject({ code: "note-exists" });
  });
});
