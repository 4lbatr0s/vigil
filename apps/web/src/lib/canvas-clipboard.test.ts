import { describe, expect, it } from "vitest";
import type { BoardNode, LooseEdge } from "./canvas";
import { boundsOf, copySelection, groupAround, pasteClip, restack } from "./canvas-clipboard";

const card = (id: string, x: number, y: number, z: number, type: BoardNode["type"] = "text"): BoardNode => ({ id, type, position: { x, y }, width: 100, height: 50, zIndex: z, data: { kind: type, ...(type === "text" ? { text: id } : {}), extra: {} } });
const arrow = (id: string, source: string, target: string): LooseEdge => ({ id, source, target, sourceHandle: "right", targetHandle: "left", data: { fromEnd: "none", toEnd: "arrow", extra: {} } });

const nodes = [card("a", 0, 0, 1), card("b", 200, 0, 2), card("c", 400, 0, 3)];
const edges = [arrow("e1", "a", "b"), arrow("e2", "b", "c")];

describe("copySelection and pasteClip", () => {
  it("keeps only arrows that have both ends among the copied cards", () => {
    const clip = copySelection(nodes, edges, ["a", "b"]);
    expect(clip.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(clip.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("pastes new ids, moved, stacked on top, with the arrows rewired", () => {
    const clip = copySelection(nodes, edges, ["a", "b"]);
    const taken = new Set([...nodes.map((n) => n.id), ...edges.map((e) => e.id)]);
    const out = pasteClip(clip, taken, { x: 24, y: 24 }, 3);
    expect(out.nodes).toHaveLength(2);
    for (const n of out.nodes) expect(taken.has(n.id)).toBe(false);
    expect(out.nodes.map((n) => n.position)).toEqual([{ x: 24, y: 24 }, { x: 224, y: 24 }]);
    expect(out.nodes.map((n) => n.zIndex)).toEqual([4, 5]);
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]?.source).toBe(out.nodes[0]?.id);
    expect(out.edges[0]?.target).toBe(out.nodes[1]?.id);
    expect(taken.has(out.edges[0]?.id ?? "")).toBe(false);
  });

  it("does not change the clip or the board it came from", () => {
    const clip = copySelection(nodes, edges, ["a"]);
    pasteClip(clip, new Set(["a"]), { x: 10, y: 10 }, 1);
    expect(clip.nodes[0]?.position).toEqual({ x: 0, y: 0 });
    expect(nodes[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it("can paste the same clip twice without id clashes", () => {
    const clip = copySelection(nodes, edges, ["a", "b", "c"]);
    const taken = new Set(nodes.map((n) => n.id));
    const first = pasteClip(clip, taken, { x: 10, y: 10 }, 3);
    first.nodes.forEach((n) => taken.add(n.id));
    const second = pasteClip(clip, taken, { x: 20, y: 20 }, 6);
    const all = [...first.nodes, ...second.nodes].map((n) => n.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps a group at the bottom and a lock on the copy", () => {
    const locked: BoardNode = { ...card("g1", 0, 0, 0, "group"), data: { kind: "group", label: "L", extra: { vigilLock: true } } };
    const out = pasteClip(copySelection([locked], [], ["g1"]), new Set(["g1"]), { x: 5, y: 5 }, 9);
    expect(out.nodes[0]?.zIndex).toBe(0);
    expect(out.nodes[0]?.data.extra).toEqual({ vigilLock: true });
  });
});

describe("boundsOf and groupAround", () => {
  it("measures the box around cards", () => {
    expect(boundsOf(nodes)).toEqual({ x: 0, y: 0, width: 500, height: 50 });
    expect(boundsOf([])).toBeNull();
  });

  it("makes a group with room around the chosen cards and below nothing else", () => {
    const g = groupAround(nodes, ["a", "b"], new Set());
    expect(g).not.toBeNull();
    expect(g?.type).toBe("group");
    expect(g?.zIndex).toBe(0);
    expect(g?.position).toEqual({ x: -32, y: -60 });
    expect(g?.width).toBe(300 + 64);
    expect(g?.height).toBe(50 + 64 + 28);
  });

  it("makes no group when nothing usable is chosen", () => {
    expect(groupAround(nodes, [], new Set())).toBeNull();
    expect(groupAround([card("g", 0, 0, 0, "group")], ["g"], new Set())).toBeNull();
  });
});

describe("restack", () => {
  it("brings chosen cards to the front and renumbers", () => {
    const z = restack(nodes, ["a"], "front");
    expect([...z.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id)).toEqual(["b", "c", "a"]);
  });

  it("sends chosen cards to the back but under no group", () => {
    const g = card("g", 0, 0, 0, "group");
    const z = restack([g, ...nodes], ["c"], "back");
    expect([...z.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id)).toEqual(["g", "c", "a", "b"]);
  });
});
