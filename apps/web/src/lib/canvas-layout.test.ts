import { describe, expect, it } from "vitest";
import type { BoardNode } from "./canvas";
import { gridLayout, outlineToBoard, parseOutline, relativeSpot, starterBoard, tidy, treeLayout } from "./canvas-layout";

const item = (id: string, parent: string | null, width = 100, height = 40) => ({ id, parent, width, height });
const card = (id: string, x: number, y: number): BoardNode => ({ id, type: "text", position: { x, y }, width: 100, height: 40, zIndex: 1, data: { kind: "text", text: id, extra: {} } });

describe("treeLayout", () => {
  it("puts each depth in its own column and children below one another", () => {
    const at = treeLayout([item("r", null), item("a", "r"), item("b", "r"), item("a1", "a")]);
    expect(at.get("r")?.x).toBe(0);
    expect(at.get("a")?.x).toBe(at.get("b")?.x);
    expect((at.get("a")?.x ?? 0) > 0).toBe(true);
    expect((at.get("a1")?.x ?? 0) > (at.get("a")?.x ?? 0)).toBe(true);
    expect((at.get("b")?.y ?? 0) > (at.get("a")?.y ?? 0)).toBe(true);
  });

  it("centres a parent on its children and never overlaps cards in a column", () => {
    const at = treeLayout([item("r", null, 100, 40), item("a", "r"), item("b", "r"), item("c", "r")]);
    const ys = ["a", "b", "c"].map((id) => at.get(id)?.y ?? 0);
    expect(ys).toEqual([...ys].sort((x, y) => x - y));
    for (let i = 1; i < ys.length; i++) expect((ys[i] ?? 0) - (ys[i - 1] ?? 0)).toBeGreaterThanOrEqual(40);
    expect((at.get("r")?.y ?? 0) + 20).toBeCloseTo(((ys[0] ?? 0) + (ys[2] ?? 0) + 40) / 2, 0);
  });

  it("does not hang or lose cards when the arrows make a loop", () => {
    const at = treeLayout([item("a", "b"), item("b", "a"), item("c", "c")]);
    expect([...at.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("treats a parent that is not in the list as no parent", () => {
    const at = treeLayout([item("a", "ghost")]);
    expect(at.get("a")).toEqual({ x: 0, y: 0 });
  });
});

describe("gridLayout and tidy", () => {
  it("lays cards in rows of about the same length", () => {
    const at = gridLayout([1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, width: 100, height: 40 })));
    expect(at.get("c1")).toEqual({ x: 0, y: 0 });
    expect(at.get("c4")?.y).toBe(at.get("c4") && (at.get("c4")?.y ?? 0));
    expect(new Set([...at.values()].map((p) => p.y)).size).toBe(2);
  });

  it("keeps the top left corner of the chosen cards", () => {
    const nodes = [card("a", 500, 300), card("b", 900, 700)];
    const at = tidy(nodes, [{ source: "a", target: "b" }], "tree");
    expect(at.get("a")).toEqual({ x: 500, y: 300 });
    expect((at.get("b")?.x ?? 0) > 500).toBe(true);
  });

  it("leaves groups alone and returns nothing for no cards", () => {
    expect(tidy([], [], "grid").size).toBe(0);
  });
});

describe("relativeSpot", () => {
  const from = { x: 0, y: 0, width: 200, height: 100 };
  const size = { width: 200, height: 100 };
  it("puts a child to the right and a sibling below", () => {
    expect(relativeSpot(from, "child", [], size)).toEqual({ x: 290, y: 0 });
    expect(relativeSpot(from, "sibling", [], size)).toEqual({ x: 0, y: 128 });
  });
  it("moves down past a card that is already there", () => {
    const taken = { x: 290, y: 0, width: 200, height: 100 };
    expect(relativeSpot(from, "child", [taken], size).y).toBeGreaterThanOrEqual(128);
  });
});

describe("parseOutline and outlineToBoard", () => {
  const body = ["# Guide", "intro line", "## L0 Machine", "- [ ] cpu", "- [x] memory", "### L0.1 Cache", "text", "```", "# not a heading", "```", "## L1 Network"].join("\n");

  it("finds headings, their first lines and their parents, and skips code", () => {
    const items = parseOutline(body);
    expect(items.map((i) => i.title)).toEqual(["Guide", "L0 Machine", "L0.1 Cache", "L1 Network"]);
    expect(items.map((i) => i.parent)).toEqual([null, 0, 1, 0]);
    expect(items[1]?.lines).toEqual(["- [ ] cpu", "- [x] memory"]);
  });

  it("caps the number of headings", () => {
    const many = Array.from({ length: 100 }, (_, i) => `## H${i}`).join("\n");
    expect(parseOutline(many)).toHaveLength(60);
  });

  it("makes a board: the note, one card per heading, an arrow from each parent", () => {
    const file = outlineToBoard("guide", body);
    expect(file.nodes?.[0]).toMatchObject({ id: "root", type: "file", file: "guide.md" });
    expect(file.nodes).toHaveLength(5);
    expect(file.edges).toHaveLength(4);
    expect(file.edges?.[0]).toMatchObject({ fromNode: "root", toNode: "h0" });
    expect(file.edges?.[2]).toMatchObject({ fromNode: "h1", toNode: "h2" });
    const text = file.nodes?.find((n) => n.id === "h1")?.text as string;
    expect(text).toContain("## L0 Machine");
    expect(text).toContain("- [ ] cpu");
    const ids = file.nodes?.map((n) => n.id) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes a board with only the note for a note without headings", () => {
    const file = outlineToBoard("plain", "just words");
    expect(file.nodes).toHaveLength(1);
    expect(file.edges).toHaveLength(0);
  });
});

describe("starterBoard", () => {
  it("gives a path with arrows between steps and a mind map with branches", () => {
    const path = starterBoard("path");
    expect(path.nodes).toHaveLength(4);
    expect(path.edges).toHaveLength(3);
    const map = starterBoard("mindmap");
    expect(map.nodes).toHaveLength(5);
    expect(map.edges?.every((e) => e.fromNode === "c")).toBe(true);
  });
});
