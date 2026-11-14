import { afterEach, describe, expect, it, vi } from "vitest";
import { getNote, listNotes, putNote } from "./api";

function stubFetch(payload: unknown, ok = true) {
  const spy = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 400,
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("unwraps the data envelope", async () => {
    stubFetch({ data: [{ id: "hello", title: "Hello", body: "", updatedAt: "2026-11-14" }] });
    const notes = await listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe("hello");
  });

  it("throws code: message for an error envelope", async () => {
    stubFetch({ error: { code: "note-not-found", message: "Note not found: x" } });
    await expect(getNote("x")).rejects.toThrow("note-not-found: Note not found: x");
  });

  it("sends a PUT body as JSON", async () => {
    const spy = stubFetch({ data: { id: "hello", title: "Hello", body: "b", tags: [], author: "human", updatedAt: "t" } });
    await putNote("hello", { title: "Hello", body: "b" });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/notes/hello");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ title: "Hello", body: "b" });
  });

  it("sends the base updatedAt so the server can detect a conflict", async () => {
    const spy = stubFetch({ data: { id: "hello", title: "Hello", body: "b", tags: [], author: "human", updatedAt: "t2" } });
    await putNote("hello", { title: "Hello", body: "b", baseUpdatedAt: "t1" });
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ baseUpdatedAt: "t1" });
  });
});
