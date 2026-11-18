import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "@vigil/shared";
import { closeDb, rebuildAll, reindexNote } from "./index-db";
import { hybridIds, relatedIds, semanticIds, semanticStatus, syncVectors } from "./semantic";
import { setEmbedModel } from "./embeddings";
import { findPassages } from "./ask";

const note = (id: string, title: string, body: string): Note => ({ id, title, body, updatedAt: "2026-01-01T00:00:00.000Z", tags: [], author: "human" });

/** A stand-in embedding server: text about animals points one way, text about money the other. */
function fakeEmbedServer(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const input = (JSON.parse(String((init as RequestInit).body)) as { input: string[] }).input;
    const vec = (t: string): number[] => (/cat|dog|pet|feline/i.test(t) ? [1, 0.05] : /tax|money|bank/i.test(t) ? [0.05, 1] : [0.5, 0.5]);
    return new Response(JSON.stringify({ embeddings: input.map(vec) }), { status: 200 });
  });
}

beforeEach(async () => {
  process.env.VIGIL_LLM_PROVIDER = "ollama";
  process.env.VIGIL_LLM_BASE_URL = "http://embed.test";
  process.env.VIGIL_LLM_MODEL = "chat";
  closeDb();
  await rebuildAll();
  reindexNote(note("cats", "Cats", "Felines purr and sleep a lot."));
  reindexNote(note("dogs", "Dogs", "A pet that barks."));
  reindexNote(note("tax", "Tax", "Money owed to the state."));
  setEmbedModel("embed-model");
});

afterEach(() => {
  vi.restoreAllMocks();
  setEmbedModel(null);
  delete process.env.VIGIL_LLM_PROVIDER;
  delete process.env.VIGIL_LLM_BASE_URL;
  delete process.env.VIGIL_LLM_MODEL;
});

describe("meaning search", () => {
  it("does nothing while no embedding model is set", async () => {
    setEmbedModel(null);
    expect(await semanticIds("cats", 3)).toEqual([]);
    expect(semanticStatus().model).toBeNull();
  });

  it("embeds every note, then finds notes by meaning without a shared word", async () => {
    const spy = fakeEmbedServer();
    await syncVectors();
    expect(semanticStatus()).toMatchObject({ model: "embed-model", notes: 3, embedded: 3, error: null });
    // "feline pets" shares no word with "Dogs".
    const ids = await semanticIds("a feline pet", 3);
    expect(ids.slice(0, 2).sort()).toEqual(["cats", "dogs"]);
    expect(ids).not.toContain("tax");
    expect(spy).toHaveBeenCalled();
  });

  it("embeds only the notes that changed", async () => {
    const spy = fakeEmbedServer();
    await syncVectors();
    const first = spy.mock.calls.length;
    await syncVectors();
    expect(spy.mock.calls.length).toBe(first);
    reindexNote(note("tax", "Tax", "Bank rules for money."));
    await syncVectors();
    expect(spy.mock.calls.length).toBe(first + 1);
  });

  it("lists related notes from the stored vectors, never the note itself", async () => {
    fakeEmbedServer();
    await syncVectors();
    expect(relatedIds("cats", 5).map((r) => r.id)).toEqual(["dogs"]);
  });

  it("merges meaning with word matches, and Ask can use a note found only by meaning", async () => {
    fakeEmbedServer();
    await syncVectors();
    const ids = await hybridIds("which feline sleeps", ["feline", "sleeps"], 5);
    expect(ids[0]).toBe("cats");
    const passages = findPassages("which pet", ["pet"], 8, ["cats"]);
    expect(passages.map((p) => p.noteId)).toContain("dogs");
    expect(passages.map((p) => p.noteId)).toContain("cats");
  });

  it("keeps a failure for the status line instead of breaking search", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404 }));
    reindexNote(note("new", "New", "A fresh note nobody embedded."));
    await syncVectors();
    expect(semanticStatus().error).toContain("404");
    expect(await hybridIds("cats", ["cats"], 3)).toEqual(["cats"]);
  });
});
