import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { cosine, dropVectors, fuse, loadVectors, nearest, noteText, saveVector, textHash } from "./embeddings";

const v = (...n: number[]) => Float32Array.from(n);

describe("cosine", () => {
  it("is 1 for the same direction, 0 for unrelated, and safe for odd input", () => {
    expect(cosine(v(1, 2, 3), v(2, 4, 6))).toBeCloseTo(1);
    expect(cosine(v(1, 0), v(0, 1))).toBe(0);
    expect(cosine(v(0, 0), v(1, 1))).toBe(0);
    expect(cosine(v(1), v(1, 2))).toBe(0);
  });
});

describe("fuse", () => {
  it("puts an id found by both searches first", () => {
    expect(fuse([["a", "b", "c"], ["c", "d"]], 10)[0]).toBe("c");
  });
  it("keeps every id once and honours the limit", () => {
    expect(fuse([["a", "b"], ["b", "a"]], 10).sort()).toEqual(["a", "b"]);
    expect(fuse([["a", "b", "c"]], 2)).toEqual(["a", "b"]);
    expect(fuse([], 5)).toEqual([]);
  });
});

describe("storage and nearest", () => {
  it("stores vectors per model, finds the closest, skips the note itself and weak matches", () => {
    const db = new Database(":memory:");
    saveVector(db, "cats", "h1", "m", v(1, 0));
    saveVector(db, "dogs", "h2", "m", v(0.9, 0.1));
    saveVector(db, "tax", "h3", "m", v(0, 1));
    saveVector(db, "old", "h4", "other-model", v(1, 0));
    const all = loadVectors(db, "m");
    expect([...all.keys()].sort()).toEqual(["cats", "dogs", "tax"]);
    expect(nearest(all, v(1, 0), 5).map((r) => r.id)).toEqual(["cats", "dogs"]);
    expect(nearest(all, v(1, 0), 5, "cats").map((r) => r.id)).toEqual(["dogs"]);
  });

  it("forgets vectors of notes that are gone and round-trips values exactly", () => {
    const db = new Database(":memory:");
    saveVector(db, "a", "h", "m", v(0.25, -0.5, 3));
    saveVector(db, "b", "h", "m", v(1, 1, 1));
    dropVectors(db, new Set(["a"]));
    const rest = loadVectors(db, "m");
    expect([...rest.keys()]).toEqual(["a"]);
    expect([...(rest.get("a")?.vec ?? [])]).toEqual([0.25, -0.5, 3]);
  });
});

describe("noteText and textHash", () => {
  it("joins the title and body and cuts a long note", () => {
    expect(noteText("T", "body")).toBe("T\n\nbody");
    expect(noteText("T", "x".repeat(5000)).length).toBe(2000);
  });
  it("changes with the model or the text", () => {
    expect(textHash("m", "a")).not.toBe(textHash("n", "a"));
    expect(textHash("m", "a")).not.toBe(textHash("m", "b"));
    expect(textHash("m", "a")).toBe(textHash("m", "a"));
  });
});
