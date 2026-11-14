import { describe, expect, it } from "vitest";
import { NoteSchema } from "./index";

describe("NoteSchema", () => {
  it("parses a valid note", () => {
    const note = { id: "n1", title: "T", body: "B", updatedAt: "2026-11-14T00:00:00.000Z" };
    expect(NoteSchema.parse(note)).toMatchObject(note);
  });
  it("rejects a note without id", () => {
    expect(() => NoteSchema.parse({ title: "T", body: "B" })).toThrow();
  });
});
