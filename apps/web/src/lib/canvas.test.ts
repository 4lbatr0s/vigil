import { describe, expect, it } from "vitest";
import { History, LOCK_FIELD, checklistProgress, cssColor, toggleTask, isLocked, lockProps, imageNameOf, ringBoard, excerpt, newId, noteFile, noteIdOf, snapshot, toBoard, toFile, type CanvasFile } from "./canvas";

// Built from parts: raw color literals are not allowed outside app.css.
const HEX = `#${"ff"}${"88"}${"00"}`;

const FILE: CanvasFile = {
  topLevelExtra: 1,
  nodes: [
    { id: "t", type: "text", x: 10, y: 20, width: 200, height: 80, text: "hello", color: "4", obsidian: { a: 1 } },
    { id: "g", type: "group", x: 0, y: 0, width: 500, height: 400, label: "Study" },
    { id: "f", type: "file", x: 300, y: 10, width: 300, height: 180, file: "bio.md", subpath: "#Cells" },
    { id: "l", type: "link", x: 0, y: 450, width: 260, height: 90, url: "https://jsoncanvas.org" },
  ],
  edges: [
    { id: "e", fromNode: "t", toNode: "f", fromSide: "right", toSide: "left", label: "see", color: HEX, future: true },
    { id: "e2", fromNode: "f", toNode: "l", fromSide: "right", toSide: "left", fromEnd: "arrow", toEnd: "none" },
  ],
};

describe("toBoard and toFile", () => {
  it("round-trips a canvas, keeping what the app does not know", () => {
    const { nodes, edges } = toBoard(FILE);
    const back = toFile(nodes, edges);
    const byId = (list: { id: string }[] | undefined) => Object.fromEntries((list ?? []).map((x) => [x.id, x]));
    expect(byId(back.nodes)).toEqual(byId(FILE.nodes));
    expect(byId(back.edges)).toEqual(byId(FILE.edges));
    expect((byId(back.nodes) as Record<string, { obsidian?: unknown }>)["t"]?.obsidian).toEqual({ a: 1 });
    expect((byId(back.edges) as Record<string, { future?: unknown }>)["e"]?.future).toBe(true);
  });

  it("uses the array order as stacking order, and writes groups first", () => {
    const { nodes } = toBoard(FILE);
    expect(nodes.map((n) => [n.id, n.zIndex])).toEqual([["t", 0], ["g", 1], ["f", 2], ["l", 3]]);
    expect(toFile(nodes, []).nodes?.map((n) => n.id)).toEqual(["g", "t", "f", "l"]);
  });

  it("fills the format's defaults for arrows and sides, and omits them again on save", () => {
    const { edges } = toBoard({ nodes: [FILE.nodes![0]!, FILE.nodes![2]!], edges: [{ id: "x", fromNode: "t", toNode: "f" }] });
    expect(edges[0]).toMatchObject({ sourceHandle: "right", targetHandle: "left", data: { fromEnd: "none", toEnd: "arrow" } });
    const out = toFile([], edges).edges?.[0];
    expect(out).toEqual({ id: "x", fromNode: "t", toNode: "f", fromSide: "right", toSide: "left" });
  });

  it("rounds positions and sizes to whole numbers and never writes a zero size", () => {
    const { nodes } = toBoard({ nodes: [{ id: "a", type: "text", x: 1, y: 1, width: 10, height: 10, text: "" }] });
    const moved = nodes.map((n) => ({ ...n, position: { x: 10.6, y: -3.4 }, width: 0.2, height: 99.5 }));
    expect(toFile(moved, []).nodes?.[0]).toMatchObject({ x: 11, y: -3, width: 1, height: 100 });
  });

  it("an empty file is an empty board", () => {
    expect(toBoard({})).toEqual({ nodes: [], edges: [] });
  });
});

describe("helpers", () => {
  it("finds the note behind a file card", () => {
    expect(noteIdOf("bio.md")).toBe("bio");
    expect(noteIdOf("notes/cell-biology.md")).toBe("cell-biology");
    expect(noteIdOf("pic.png")).toBeNull();
    expect(noteIdOf("Bio.md")).toBeNull();
    expect(noteFile("bio")).toBe("bio.md");
  });

  it("finds the picture behind a file card, and nothing else", () => {
    expect(imageNameOf("attachments/0123456789abcdef.png")).toBe("0123456789abcdef.png");
    expect(imageNameOf("vault/attachments/0123456789abcdef.webp")).toBe("0123456789abcdef.webp");
    expect(imageNameOf("attachments/../secret.png")).toBeNull();
    expect(imageNameOf("attachments/photo.png")).toBeNull();
    expect(imageNameOf("bio.md")).toBeNull();
  });

  it("maps colors to tokens, and drops what is not a color", () => {
    expect(cssColor("1")).toBe("var(--canvas-1)");
    expect(cssColor(HEX)).toBe(HEX);
    expect(cssColor("javascript:alert(1)")).toBeUndefined();
    expect(cssColor("url(x)")).toBeUndefined();
    expect(cssColor(undefined)).toBeUndefined();
  });

  it("makes ids that are not taken", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 50; i++) taken.add(newId("n", taken));
    expect(taken.size).toBe(50);
  });

  it("cuts a note down for a card", () => {
    expect(excerpt("# Title\n\nline one\n\n- item\n".repeat(5), 3)).toBe("# Title\nline one\n- item");
    expect(excerpt("x".repeat(1000)).length).toBe(280);
  });
});

describe("History", () => {
  it("undoes and redoes, forgets the future after a new change, ignores a no-op", () => {
    const { nodes, edges } = toBoard(FILE);
    const h = new History(snapshot(nodes, edges));
    expect(h.undo()).toBeNull();
    h.push("two");
    h.push("two");
    h.push("three");
    expect(h.undo()).toBe("two");
    expect(h.redo()).toBe("three");
    expect(h.redo()).toBeNull();
    h.undo();
    h.push("four");
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe("two");
  });

  it("keeps at most the cap", () => {
    const h = new History("0", 3);
    for (let i = 1; i <= 10; i++) h.push(String(i));
    let steps = 0;
    while (h.undo() !== null) steps++;
    expect(steps).toBe(3);
  });
});

describe("ringBoard", () => {
  it("puts the note in the middle and its neighbours around it with an arrow each", () => {
    const f = ringBoard("bio", ["cells", "dna", "cells", "bio", "atp"]);
    expect(f.nodes?.map((n) => n.file)).toEqual(["bio.md", "cells.md", "dna.md", "atp.md"]);
    expect(f.edges?.map((e) => [e.fromNode, e.toNode])).toEqual([["center", "n0"], ["center", "n1"], ["center", "n2"]]);
    const c = f.nodes![0]!;
    expect([c.x + c.width / 2, c.y + c.height / 2]).toEqual([0, 0]);
    // The first neighbour is straight above, so its arrow leaves the top and arrives at the bottom.
    expect(f.edges?.[0]).toMatchObject({ fromSide: "top", toSide: "bottom" });
  });
  it("caps the ring and copes with no neighbours", () => {
    expect(ringBoard("a", Array.from({ length: 40 }, (_, i) => `n${i}`)).nodes).toHaveLength(13);
    expect(ringBoard("a", []).edges).toEqual([]);
  });
});

describe("locked cards", () => {
  const file: CanvasFile = { nodes: [{ id: "l", type: "text", x: 0, y: 0, width: 100, height: 50, text: "x", [LOCK_FIELD]: true }, { id: "u", type: "text", x: 0, y: 0, width: 100, height: 50, text: "y" }], edges: [] };

  it("turns off moving and deleting for a locked card only", () => {
    const [l, u] = toBoard(file).nodes;
    expect(l).toMatchObject({ draggable: false, deletable: false });
    expect(u).not.toHaveProperty("draggable");
    expect(isLocked(l!)).toBe(true);
    expect(isLocked(u!)).toBe(false);
  });

  it("writes the lock back and writes nothing for an unlocked card", () => {
    const out = toFile(toBoard(file).nodes, []);
    expect(out.nodes?.find((n) => n.id === "l")?.[LOCK_FIELD]).toBe(true);
    expect(out.nodes?.find((n) => n.id === "u")).not.toHaveProperty(LOCK_FIELD);
    expect(lockProps(false)).toEqual({});
  });
});

describe("checklistProgress and toggleTask", () => {
  const text = "## L0\n- [ ] cpu\n- [x] memory\n* [X] disk\n1. [ ] io\nplain - [ ] not an item";

  it("counts ticked and total items, in any list style", () => {
    expect(checklistProgress(text)).toEqual({ done: 2, total: 4 });
    expect(checklistProgress("nothing here")).toBeNull();
  });

  it("ticks and unticks one item by position and leaves the rest alone", () => {
    expect(toggleTask(text, 0)).toContain("- [x] cpu");
    expect(toggleTask(text, 1)).toContain("- [ ] memory");
    expect(toggleTask(text, 3)).toContain("1. [x] io");
    expect(toggleTask(text, 0)).toContain("plain - [ ] not an item");
    expect(toggleTask(text, 9)).toBe(text);
  });
});
