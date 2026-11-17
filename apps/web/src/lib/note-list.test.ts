import { describe, expect, it } from "vitest";
import type { NoteSummary } from "@vigil/shared";
import { hasTag, matchesQuery, relativeTime, tagCounts, untilText, viewNotes } from "./note-list";

const n = (id: string, over: Partial<NoteSummary> = {}): NoteSummary => ({ id, title: id.toUpperCase(), tags: [], author: "human", updatedAt: "2026-11-16T10:00:00Z", snippet: "", ...over });

describe("filtering", () => {
  it("a tag matches itself and its children, not a longer sibling", () => {
    expect(hasTag(n("a", { tags: ["work/launch"] }), "work")).toBe(true);
    expect(hasTag(n("a", { tags: ["workshop"] }), "work")).toBe(false);
    expect(hasTag(n("a", { tags: ["work"] }), "work/launch")).toBe(false);
  });
  it("matches title, snippet and tags, ignoring case and a leading #", () => {
    const note = n("a", { title: "Budget plan", snippet: "Quarterly numbers", tags: ["finance"] });
    expect(["budget", "QUARTERLY", "#fin", ""].every((q) => matchesQuery(note, q))).toBe(true);
    expect(matchesQuery(note, "zebra")).toBe(false);
  });
});

describe("viewNotes", () => {
  const notes = [n("c", { title: "Cherry" }), n("a", { title: "apple", tags: ["fruit"] }), n("b", { title: "Banana", tags: ["fruit/yellow"] })];
  const base = { query: "", tag: null, sort: "modified" as const, pins: [] as string[] };
  it("keeps server order for modified, sorts by title ignoring case", () => {
    expect(viewNotes(notes, base).map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(viewNotes(notes, { ...base, sort: "title" }).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("puts pinned notes first in pin order, whatever the sort", () => {
    expect(viewNotes(notes, { ...base, pins: ["b", "c"] }).map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(viewNotes(notes, { ...base, sort: "title", pins: ["c"] }).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
  it("filters by tag and query, and lets server hits through", () => {
    expect(viewNotes(notes, { ...base, tag: "fruit" }).map((x) => x.id)).toEqual(["a", "b"]);
    expect(viewNotes(notes, { ...base, query: "cher" }).map((x) => x.id)).toEqual(["c"]);
    expect(viewNotes(notes, { ...base, query: "nomatch", extraIds: new Set(["b"]) }).map((x) => x.id)).toEqual(["b"]);
  });
  it("ignores pins of notes that are filtered out or gone", () => {
    expect(viewNotes(notes, { ...base, tag: "fruit", pins: ["c", "gone"] }).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("tagCounts and relativeTime", () => {
  it("orders tags by use then name and caps the list", () => {
    const list = [n("a", { tags: ["x", "y"] }), n("b", { tags: ["y"] }), n("c", { tags: ["z", "y", "x"] })];
    expect(tagCounts(list)).toEqual([{ tag: "y", count: 3 }, { tag: "x", count: 2 }, { tag: "z", count: 1 }]);
    expect(tagCounts(list, 1)).toHaveLength(1);
  });
  it("words the age of a note", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(relativeTime("2026-11-16T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-11-16T11:56:00Z", now)).toBe("4 min ago");
    expect(relativeTime("2026-11-16T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime("2026-11-15T09:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("2026-11-13T12:00:00Z", now)).toBe("3 d ago");
    expect(relativeTime("2026-11-01T12:00:00Z", now)).toBe("2026-11-01");
    expect(relativeTime("garbage", now)).toBe("garbage");
  });
});

describe("untilText", () => {
  const now = new Date("2026-11-17T09:00:00Z");
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  it("words coming times", () => {
    expect(untilText(at(10_000), now)).toBe("now");
    expect(untilText(at(-5 * 60_000), now)).toBe("now");
    expect(untilText(at(20 * 60_000), now)).toBe("in 20 min");
    expect(untilText(at(5 * 3_600_000), now)).toBe("in 5 h");
    expect(untilText(at(26 * 3_600_000), now)).toBe("tomorrow");
    expect(untilText(at(3 * 86_400_000), now)).toBe("in 3 days");
  });
});
