import { describe, expect, it } from "vitest";
import { NO_FILTERS, agentsTouching, attention, buildGraph, filterGraph, hasTagOrChild, linkDegrees, primaryTag, radialLayout, tagCounts, tagSlot, glowAlpha, groupByConnections, matchesQuery, memoryColor, memoryLine, mixColor, neighborSet, withAlpha, nodeSize, seedPosition, type GraphApi, type GraphColors } from "./graph-model";

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

describe("filters", () => {
  const tagged: GraphApi = {
    truncated: false,
    nodes: [
      { id: "a", title: "A", kind: "note", tags: ["work/launch"], degree: 2 },
      { id: "b", title: "B", kind: "note", tags: ["work"], degree: 1 },
      { id: "c", title: "C", kind: "note", tags: ["home"], degree: 0 },
      { id: "ghost", title: "ghost", kind: "note", ghost: true, degree: 1 },
      { id: "agent:d", title: "d", kind: "agent", degree: 1 },
    ],
    edges: [
      { source: "a", target: "b", kind: "link" },
      { source: "a", target: "ghost", kind: "link", dangling: true },
      { source: "agent:d", target: "c", kind: "agent-read" },
    ],
  };

  it("counts links, not agent visits", () => {
    expect([...linkDegrees(tagged)].sort()).toEqual([["a", 2], ["b", 1], ["ghost", 1]]);
  });

  it("keeps everything with no filters", () => {
    expect(filterGraph(tagged, NO_FILTERS).nodes).toHaveLength(5);
  });

  it("filters by tag including nested tags, and drops edges and agents that lose an end", () => {
    const g = filterGraph(tagged, { ...NO_FILTERS, tag: "work" });
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(g.edges).toEqual([{ source: "a", target: "b", kind: "link" }]);
    expect(hasTagOrChild(["work/launch"], "work")).toBe(true);
    expect(hasTagOrChild(["network"], "work")).toBe(false);
  });

  it("shows only orphans, hides ghosts, and applies a minimum number of links", () => {
    // the agent that visited the orphan stays, because it still has an edge
    expect(filterGraph(tagged, { ...NO_FILTERS, orphansOnly: true }).nodes.map((n) => n.id).sort()).toEqual(["agent:d", "c"]);
    expect(filterGraph(tagged, { ...NO_FILTERS, hideGhosts: true }).nodes.map((n) => n.id)).not.toContain("ghost");
    expect(filterGraph(tagged, { ...NO_FILTERS, minLinks: 2 }).nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("counts tags and picks a stable colour slot", () => {
    expect(tagCounts(tagged)[0]).toEqual({ tag: "home", count: 1 });
    expect(tagSlot("work")).toBe(tagSlot("work"));
    expect(tagSlot("work")).toBeGreaterThanOrEqual(0);
    expect(tagSlot("work")).toBeLessThan(6);
    expect(primaryTag(["work/launch", "x"])).toBe("work");
    expect(primaryTag([])).toBeNull();
  });
});

describe("attention", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  const d: GraphApi = {
    truncated: false,
    nodes: [
      { id: "hub", title: "Hub", kind: "note", updatedAt: "2026-11-14T00:00:00Z", degree: 2, memory: { cards: 3, reviewed: 3, strength: 0.6, recallDue: true, examDays: null } },
      { id: "old", title: "Old", kind: "note", updatedAt: "2026-06-01T00:00:00Z", degree: 1 },
      { id: "lonely", title: "Lonely", kind: "note", updatedAt: "2026-11-10T00:00:00Z", degree: 0 },
      { id: "from-agent", title: "From agent", kind: "note", author: "agent", updatedAt: "2026-11-10T00:00:00Z", degree: 0 },
      { id: "idea", title: "idea", kind: "note", ghost: true, degree: 2 },
    ],
    edges: [
      { source: "hub", target: "old", kind: "link" },
      { source: "hub", target: "idea", kind: "link", dangling: true },
    ],
  };

  it("lists orphans, ghosts, due recall checks, notes with no cards and stale linked notes", () => {
    const a = attention(d, now);
    expect(a.orphans.map((n) => n.id)).toEqual(["from-agent", "lonely"]);
    expect(a.ghosts.map((n) => n.id)).toEqual(["idea"]);
    expect(a.due.map((n) => n.id)).toEqual(["hub"]);
    expect(a.noCards.map((n) => n.id)).toEqual(["lonely", "old"]); // the agent's own note is not yours to make cards for
    expect(a.stale.map((n) => n.id)).toEqual(["old"]);
  });
});

describe("radialLayout", () => {
  const g: GraphApi = {
    truncated: false,
    nodes: ["f", "n1", "n2", "far"].map((id) => ({ id, title: id, kind: "note" as const, degree: 1 })),
    edges: [
      { source: "f", target: "n1", kind: "link" },
      { source: "f", target: "n2", kind: "link" },
      { source: "n1", target: "far", kind: "link" },
    ],
  };

  it("puts the focus in the middle and each hop on a wider ring, the same every time", () => {
    const a = radialLayout(g, "f");
    expect(a.get("f")).toEqual({ x: 0, y: 0 });
    const radius = (id: string): number => Math.hypot(a.get(id)!.x, a.get(id)!.y);
    expect(radius("n1")).toBeCloseTo(radius("n2"), 5);
    expect(radius("far")).toBeGreaterThan(radius("n1"));
    expect(radialLayout(g, "f")).toEqual(a);
  });
});
