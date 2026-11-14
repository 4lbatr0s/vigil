import { describe, expect, it } from "vitest";
import { NoteSchema, slugify } from "./index";

describe("NoteSchema", () => {
  it("parses a valid note", () => {
    const note = { id: "n1", title: "T", body: "B", updatedAt: "2026-11-14T00:00:00.000Z" };
    expect(NoteSchema.parse(note)).toMatchObject(note);
  });
  it("defaults tags to none and author to human", () => {
    const parsed = NoteSchema.parse({ id: "n1", title: "T", body: "B", updatedAt: "t" });
    expect(parsed.tags).toEqual([]);
    expect(parsed.author).toBe("human");
  });
  it("rejects an unknown author", () => {
    expect(() =>
      NoteSchema.parse({ id: "n1", title: "T", body: "B", updatedAt: "t", author: "robot" }),
    ).toThrow();
  });
  it("rejects a note without id", () => {
    expect(() => NoteSchema.parse({ title: "T", body: "B" })).toThrow();
  });
});

describe("slugify", () => {
  it("dash-separates words", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
  it("strips non-ascii characters and collapses dashes", () => {
    expect(slugify("Ärger & Straße!")).toBe("rger-strae");
  });
  it("clamps long titles to 80 characters", () => {
    expect(slugify("a".repeat(120))).toHaveLength(80);
  });
  it("trims leading and trailing dashes", () => {
    expect(slugify("  --Hello--  ")).toBe("hello");
  });
});
