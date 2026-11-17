import { describe, expect, it } from "vitest";
import { diffLines, diffStats, revertChange, segments } from "./diff";

const render = (d: ReturnType<typeof diffLines>) => d.map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`);

describe("diffLines", () => {
  it("marks a new note as all added", () => {
    expect(render(diffLines(null, "a\nb"))).toEqual(["+a", "+b"]);
  });
  it("finds additions, removals and unchanged lines", () => {
    expect(render(diffLines("a\nb\nc", "a\nx\nc\nd"))).toEqual([" a", "-b", "+x", " c", "+d"]);
  });
  it("identical text has no changes", () => {
    const d = diffLines("same\ntext", "same\ntext");
    expect(diffStats(d)).toEqual({ added: 0, removed: 0 });
  });
  it("handles empty sides and ignores one trailing newline", () => {
    expect(render(diffLines("", "a"))).toEqual(["+a"]);
    expect(render(diffLines("a", ""))).toEqual(["-a"]);
    expect(diffStats(diffLines("a\n", "a"))).toEqual({ added: 0, removed: 0 });
  });
  it("keeps moved blocks as a removal plus an addition", () => {
    expect(diffStats(diffLines("a\nb\nc", "b\nc\na"))).toEqual({ added: 1, removed: 1 });
  });
  it("falls back for huge inputs instead of building a giant table", () => {
    const big = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n");
    const other = Array.from({ length: 2500 }, (_, i) => `other ${i}`).join("\n");
    const d = diffLines(big, other);
    expect(diffStats(d)).toEqual({ added: 2500, removed: 2500 });
  });
});

describe("segments and revertChange", () => {
  const before = "one\ntwo\nthree\nfour\nfive\n";
  const after = "one\nTWO\nthree\nfour\nfive\nsix\n";
  it("finds each change separately", () => {
    const changes = segments(diffLines(before, after)).filter((s) => s.kind === "change");
    expect(changes).toEqual([
      { kind: "change", id: 0, del: ["two"], add: ["TWO"] },
      { kind: "change", id: 1, del: [], add: ["six"] },
    ]);
  });
  it("puts back one change and keeps the others", () => {
    expect(revertChange(before, after, 0)).toBe("one\ntwo\nthree\nfour\nfive\nsix\n");
    expect(revertChange(before, after, 1)).toBe("one\nTWO\nthree\nfour\nfive\n");
  });
  it("reverting a pure removal brings the lines back", () => {
    expect(revertChange("a\nb\nc\n", "a\nc\n", 0)).toBe("a\nb\nc\n");
  });
  it("an id that matches nothing changes nothing", () => {
    expect(revertChange(before, after, 9)).toBe(after);
  });
});
