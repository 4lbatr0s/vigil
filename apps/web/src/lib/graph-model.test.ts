import { describe, expect, it } from "vitest";
import { agentsTouching, buildGraph, glowAlpha, groupByConnections, matchesQuery, memoryColor, memoryLine, mixColor, neighborSet, withAlpha, nodeSize, seedPosition, type GraphApi, type GraphColors } from "./graph-model";

const colors: GraphColors = { note: "n", agent: "a", ghost: "g", link: "l", agentEdge: "ae" };
const data: GraphApi = {
  truncated: false,
  nodes: [
    { id: "a", title: "A", kind: "note", updatedAt: "2026-11-15T10:00:00Z", author: "human", degree: 3 },
    { id: "b", title: "B", kind: "note", updatedAt: "2026-11-01T10:00:00Z", author: "agent", degree: 2 },
    { id: "c", title: "C", kind: "note", updatedAt: "2026-10-01T10:00:00Z", degree: 0 },
    { id: "idea", title: "idea", kind: "note", ghost: true, degree: 1 },
    { id: "agent:digest", title: "digest", kind: "agent", degree: 2 },
  ],
  edges: [
    { source: "a", target: "b", kind: "link" },
    { source: "a", target: "idea", kind: "link", dangling: true },
    { source: "agent:digest", target: "a", kind: "agent-read" },
    { source: "agent:digest", target: "a", kind: "agent-wrote" },
  ],
};

describe("glowAlpha", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  it("is 1 for now, falls linearly, and is 0 from 14 days on", () => {
    expect(glowAlpha("2026-11-15T12:00:00Z", now)).toBe(1);
    expect(glowAlpha("2026-11-08T12:00:00Z", now)).toBeCloseTo(0.5, 5);
    expect(glowAlpha("2026-11-01T12:00:00Z", now)).toBe(0);
    expect(glowAlpha("2026-01-01T00:00:00Z", now)).toBe(0);
  });
  it("is 0 for a missing or bad time, and never above 1 for a time in the future", () => {
    expect(glowAlpha(undefined, now)).toBe(0);
    expect(glowAlpha("garbage", now)).toBe(0);
    expect(glowAlpha("2026-11-20T00:00:00Z", now)).toBe(1);
  });
});

describe("buildGraph", () => {
  it("creates nodes with colors, sizes and positions, and edges with hidden agent edges", () => {
    const g = buildGraph(data, colors);
    expect(g.order).toBe(5);
    expect(g.size).toBe(4);
    expect(g.getNodeAttribute("a", "color")).toBe("n");
    expect(g.getNodeAttribute("idea", "color")).toBe("g");
    expect(g.getNodeAttribute("agent:digest", "color")).toBe("a");
    expect(g.getNodeAttribute("a", "label")).toBe("A");
    expect(typeof g.getNodeAttribute("a", "x")).toBe("number");
    const hidden = g.edges().filter((e) => g.getEdgeAttribute(e, "hidden"));
    expect(hidden).toHaveLength(2); // the two agent edges, both kept although they share a pair
    expect(g.edges().filter((e) => g.getEdgeAttribute(e, "kind") === "link")).toHaveLength(2);
  });
  it("skips edges whose ends are missing and duplicate nodes", () => {
    const g = buildGraph({ truncated: false, nodes: [...data.nodes, data.nodes[0]!], edges: [...data.edges, { source: "a", target: "nope", kind: "link" }] }, colors);
    expect(g.order).toBe(5);
    expect(g.size).toBe(4);
  });
  it("positions are stable for the same id and sizes are clamped", () => {
    expect(seedPosition("a")).toEqual(seedPosition("a"));
    expect(seedPosition("a")).not.toEqual(seedPosition("b"));
    expect(nodeSize(0, "note")).toBe(1.2);
    expect(nodeSize(10_000, "note")).toBe(2.8);
    expect(nodeSize(5, "agent")).toBe(3.4);
  });
});

describe("neighborSet", () => {
  it("returns the node and its direct neighbours in both directions", () => {
    const g = buildGraph(data, colors);
    expect([...neighborSet(g, "b")].sort()).toEqual(["a", "b"]);
    expect([...neighborSet(g, "a")].sort()).toEqual(["a", "agent:digest", "b", "idea"]);
    expect(neighborSet(g, "missing").size).toBe(0);
  });
});

describe("list view helpers", () => {
  it("groups notes by connection count, most connected first, ghosts last", () => {
    const groups = groupByConnections(data);
    expect(groups.map((g) => g.label)).toEqual(["2 to 4 links", "No links", "Linked but not written yet"]);
    expect(groups[0]?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });
  it("names the agents that touched a note", () => {
    expect(agentsTouching(data, "a")).toEqual(["digest"]);
    expect(agentsTouching(data, "c")).toEqual([]);
  });
  it("filters titles case-insensitively", () => {
    expect(matchesQuery("Launch Plan", "plan")).toBe(true);
    expect(matchesQuery("Launch Plan", "  ")).toBe(true);
    expect(matchesQuery("Launch Plan", "zzz")).toBe(false);
  });
});

describe("withAlpha", () => {
  it("mixes any color with transparent at the given strength, clamped", () => {
    expect(withAlpha("red", 0.4)).toBe("color-mix(in srgb, red 40%, transparent)");
    expect(withAlpha(" blue ", 2)).toBe("color-mix(in srgb, blue 100%, transparent)");
    expect(withAlpha("green", -1)).toBe("color-mix(in srgb, green 0%, transparent)");
  });
});

describe("memory view", () => {
  // Built from numbers: raw color literals are not allowed outside app.css.
  const hex = (v: number): string => `#${[v, v, v].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  const black = hex(0);
  const white = hex(255);
  const grey = hex(119);

  it("mixes two hex colors and falls back to the first for anything else", () => {
    expect(mixColor(black, white, 0)).toBe(black);
    expect(mixColor(black, white, 1)).toBe(white);
    expect(mixColor(black, white, 0.5)).toMatch(/^#(7f|80){3}$/);
    expect(mixColor(black, white, 7)).toBe(white);
    expect(mixColor("oklch(0.5 0 0)", white, 0.5)).toBe("oklch(0.5 0 0)");
  });

  it("colors by how much is remembered, and leaves unanswered notes plain", () => {
    const c = { fading: black, strong: white, plain: grey };
    const m = (strength: number | null) => ({ cards: 2, reviewed: strength === null ? 0 : 2, strength, recallDue: false, examDays: null });
    expect(memoryColor(m(0.3), c)).toBe(black);
    expect(memoryColor(m(0.99), c)).toBe(white);
    expect(memoryColor(m(0.725), c)).toMatch(/^#(7f|80){3}$/);
    expect(memoryColor(m(null), c)).toBe(grey);
    expect(memoryColor(undefined, c)).toBe(grey);
  });

  it("says it in one plain line", () => {
    expect(memoryLine({ cards: 4, reviewed: 3, strength: 0.82, recallDue: true, examDays: 5 })).toBe("about 82% remembered (3 of 4 cards answered) · recall check is due · exam in 5 days");
    expect(memoryLine({ cards: 1, reviewed: 0, strength: null, recallDue: false, examDays: 0 })).toBe("1 card, none answered yet · exam today");
  });
});
