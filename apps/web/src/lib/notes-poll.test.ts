import { describe, expect, it } from "vitest";
import type { Note } from "@vigil/shared";
import { newAgentNotes } from "./notes-poll";

const n = (id: string, updatedAt: string, author: Note["author"] = "agent"): Note => ({ id, title: id, body: "", tags: [], author, updatedAt });

describe("newAgentNotes", () => {
  it("does nothing on the first load", () => {
    expect(newAgentNotes(null, [n("a", "2026-11-15T07:00:00Z")])).toEqual([]);
  });
  it("finds agent notes that are new or newer", () => {
    const prev = [n("a", "2026-11-15T07:00:00Z"), n("b", "2026-11-15T07:00:00Z")];
    const next = [n("a", "2026-11-15T07:05:00Z"), n("b", "2026-11-15T07:00:00Z"), n("c", "2026-11-15T07:06:00Z")];
    expect(newAgentNotes(prev, next)).toEqual(["a", "c"]);
  });
  it("ignores human edits and unchanged notes", () => {
    const prev = [n("h", "2026-11-15T07:00:00Z", "human")];
    expect(newAgentNotes(prev, [n("h", "2026-11-15T08:00:00Z", "human"), n("x", "2026-11-15T08:00:00Z", "human")])).toEqual([]);
    expect(newAgentNotes([n("a", "2026-11-15T07:00:00Z")], [n("a", "2026-11-15T07:00:00Z")])).toEqual([]);
  });
});
