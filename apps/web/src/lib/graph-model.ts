import Graph from "graphology";

/** Mirrors `NoteMemory` in apps/server/src/memory.ts. */
export type NoteMemoryData = { cards: number; reviewed: number; strength: number | null; recallDue: boolean; examDays: number | null };

/** Mirrors GET /api/graph (apps/server/src/graph.ts). */
export type GraphNodeData = { id: string; title: string; kind: "note" | "agent"; updatedAt?: string; author?: "human" | "agent"; ghost?: boolean; tags?: string[]; degree: number; memory?: NoteMemoryData };
export type GraphEdgeData = { source: string; target: string; kind: "link" | "agent-read" | "agent-wrote"; dangling?: boolean; at?: string; runId?: string };
export type GraphApi = { nodes: GraphNodeData[]; edges: GraphEdgeData[]; truncated: boolean };

/** Colors come from the design tokens at run time, never from literals in code. */
export type GraphColors = { note: string; agent: string; ghost: string; link: string; agentEdge: string };

const GLOW_DAYS = 14;

/** Amber halo strength for a note: 1 right now, 0 after 14 days or when the time is unknown. */
export function glowAlpha(updatedAt: string | undefined, now: Date = new Date()): number {
  if (!updatedAt) return 0;
  const ageDays = (now.getTime() - Date.parse(updatedAt)) / 86_400_000;
  if (Number.isNaN(ageDays)) return 0;
  return Math.max(0, Math.min(1, 1 - ageDays / GLOW_DAYS));
}

/** Node size from its degree: small for loners, growing slowly, clamped. Sigma's unit is roughly a third of a pixel of radius, so these are small numbers. */
export function nodeSize(degree: number, kind: "note" | "agent"): number {
  if (kind === "agent") return 3.4;
  return Math.max(1.2, Math.min(2.8, 1.2 + Math.sqrt(degree) * 0.45));
}

/** A stable pseudo-random position from an id, so the first layout is the same every time. */
export function seedPosition(id: string): { x: number; y: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = ((h >>> 0) % 36000) / 36000 * Math.PI * 2;
  const r = 1 + (((h >>> 8) >>> 0) % 1000) / 1000;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/**
 * The API data as a graphology graph. Link edges are normal edges; agent edges are added hidden
 * (`agent: true`), because they are drawn dashed on a 2D overlay (ADR-0012). Parallel and repeated
 * edges are allowed, so a note can be both read and written by one agent.
 */
export function buildGraph(data: GraphApi, colors: GraphColors): Graph {
  const graph = new Graph({ multi: true, type: "directed" });
  for (const n of data.nodes) {
    if (graph.hasNode(n.id)) continue;
    graph.addNode(n.id, {
      ...seedPosition(n.id),
      label: n.title,
      size: nodeSize(n.degree, n.kind),
      color: n.kind === "agent" ? colors.agent : n.ghost ? colors.ghost : colors.note,
      kind: n.kind,
      ghost: n.ghost === true,
      updatedAt: n.updatedAt ?? null,
      author: n.author ?? null,
      degree: n.degree,
      memory: n.memory ?? null,
    });
  }
  let i = 0;
  for (const e of data.edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
    const agent = e.kind !== "link";
    graph.addEdgeWithKey(`e${i++}`, e.source, e.target, {
      kind: e.kind,
      agent,
      dangling: e.dangling === true,
      color: agent ? colors.agentEdge : colors.link,
      size: 1,
      hidden: agent,
    });
  }
  return graph;
}

/** The node and everything directly connected to it, in either direction. */
export function neighborSet(graph: Graph, id: string): Set<string> {
  const out = new Set<string>();
  if (!graph.hasNode(id)) return out;
  out.add(id);
  for (const n of graph.neighbors(id)) out.add(n);
  return out;
}

export type ListGroup = { label: string; nodes: GraphNodeData[] };

/** For the list view: notes grouped by how connected they are, most connected first; ghosts last. */
export function groupByConnections(data: GraphApi): ListGroup[] {
  const notes = data.nodes.filter((n) => n.kind === "note" && !n.ghost);
  const ghosts = data.nodes.filter((n) => n.ghost);
  const bucket = (n: GraphNodeData): string => (n.degree === 0 ? "No links" : n.degree === 1 ? "1 link" : n.degree <= 4 ? "2 to 4 links" : "5 or more links");
  const order = ["5 or more links", "2 to 4 links", "1 link", "No links"];
  const groups = order.map((label) => ({
    label,
    nodes: notes.filter((n) => bucket(n) === label).sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title)),
  }));
  if (ghosts.length > 0) groups.push({ label: "Linked but not written yet", nodes: ghosts.sort((a, b) => a.title.localeCompare(b.title)) });
  return groups.filter((g) => g.nodes.length > 0);
}

/** The agents that touched a note, for the list view's secondary text. */
export function agentsTouching(data: GraphApi, noteId: string): string[] {
  const names = new Set<string>();
  for (const e of data.edges) if (e.kind !== "link" && e.target === noteId) names.add(e.source.replace(/^agent:/, ""));
  return [...names].sort();
}

/** Case-insensitive title filter; an empty query matches everything. */
export function matchesQuery(title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || title.toLowerCase().includes(q);
}

/** A color at a given strength, for the canvas overlay: any CSS color (a token's value) mixed with transparent. */
export function withAlpha(color: string, alpha: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, alpha)) * 100);
  return `color-mix(in srgb, ${color.trim()} ${pct}%, transparent)`;
}

const HEX = /^#([0-9a-f]{6})$/i;

/** A color `t` of the way from `a` to `b` (both `#rrggbb` tokens); the first color when either is not a hex value. */
export function mixColor(a: string, b: string, t: number): string {
  const ma = HEX.exec(a.trim());
  const mb = HEX.exec(b.trim());
  if (!ma?.[1] || !mb?.[1]) return a;
  const k = Math.max(0, Math.min(1, t));
  const ch = (hex: string, i: number): number => parseInt(hex.slice(i, i + 2), 16);
  const out = [0, 2, 4].map((i) => Math.round(ch(ma[1]!, i) + (ch(mb[1]!, i) - ch(ma[1]!, i)) * k));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Memory view: red-ish where recall is fading, green where it is strong; notes with nothing answered yet keep `plain`. */
export function memoryColor(memory: NoteMemoryData | undefined, c: { fading: string; strong: string; plain: string }): string {
  if (!memory || memory.strength === null) return c.plain;
  // Below 50% is as bad as it gets on this scale; 95% and above is as good.
  return mixColor(c.fading, c.strong, (memory.strength - 0.5) / 0.45);
}

/** One plain line about a note's memory for the side panel. */
export function memoryLine(m: NoteMemoryData): string {
  const parts: string[] = [];
  parts.push(m.strength === null ? `${m.cards} ${m.cards === 1 ? "card" : "cards"}, none answered yet` : `about ${Math.round(m.strength * 100)}% remembered (${m.reviewed} of ${m.cards} cards answered)`);
  if (m.recallDue) parts.push("recall check is due");
  if (m.examDays !== null) parts.push(m.examDays === 0 ? "exam today" : `exam in ${m.examDays} ${m.examDays === 1 ? "day" : "days"}`);
  return parts.join(" · ");
}

// ---- Filters, lenses and the "needs attention" lists ----

export type GraphFilters = { tag: string | null; orphansOnly: boolean; hideGhosts: boolean; minLinks: number };
export const NO_FILTERS: GraphFilters = { tag: null, orphansOnly: false, hideGhosts: false, minLinks: 0 };

/** How many links (not agent visits) touch each node. */
export function linkDegrees(data: GraphApi): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of data.edges) {
    if (e.kind !== "link") continue;
    out.set(e.source, (out.get(e.source) ?? 0) + 1);
    out.set(e.target, (out.get(e.target) ?? 0) + 1);
  }
  return out;
}

/** True when a note carries `tag`, or a tag nested under it (`work` matches `work/launch`). */
export function hasTagOrChild(tags: string[] | undefined, tag: string): boolean {
  return (tags ?? []).some((t) => t === tag || t.startsWith(`${tag}/`));
}

/** Every tag in the data with the number of notes that carry it, most used first. */
export function tagCounts(data: GraphApi): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of data.nodes) for (const t of n.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * The part of the graph that passes the filters. Notes are filtered; an edge stays when both ends stay; an agent
 * stays when it still has an edge.
 */
export function filterGraph(data: GraphApi, f: GraphFilters): GraphApi {
  const deg = linkDegrees(data);
  const keep = new Set<string>();
  for (const n of data.nodes) {
    if (n.kind === "agent") continue;
    if (f.hideGhosts && n.ghost) continue;
    if (f.tag !== null && !hasTagOrChild(n.tags, f.tag)) continue;
    const links = deg.get(n.id) ?? 0;
    if (f.orphansOnly && links > 0) continue;
    if (links < f.minLinks) continue;
    keep.add(n.id);
  }
  const edges = data.edges.filter((e) => keep.has(e.target) && (keep.has(e.source) || e.source.startsWith("agent:")) && (e.kind !== "link" || keep.has(e.source)));
  const agents = new Set(edges.filter((e) => e.kind !== "link").map((e) => e.source));
  const nodes = data.nodes.filter((n) => (n.kind === "agent" ? agents.has(n.id) : keep.has(n.id)));
  return { nodes, edges, truncated: data.truncated };
}

/** A tag's colour slot 0 to 5 (the six canvas colours), the same every time. */
export function tagSlot(tag: string): number {
  let h = 2166136261;
  for (let i = 0; i < tag.length; i++) h = Math.imul(h ^ tag.charCodeAt(i), 16777619);
  return (h >>> 0) % 6;
}

/** The tag a note is coloured by: its first tag's top level (`work/launch` is `work`), or null for an untagged note. */
export function primaryTag(tags: string[] | undefined): string | null {
  const first = tags?.[0];
  return first === undefined ? null : (first.split("/")[0] ?? null);
}

export type Attention = {
  /** Notes nothing links to and that link to nothing. */
  orphans: GraphNodeData[];
  /** Links to notes that are not written yet, most linked first. */
  ghosts: GraphNodeData[];
  /** Notes whose recall check is due. */
  due: GraphNodeData[];
  /** Notes you wrote with no study cards. */
  noCards: GraphNodeData[];
  /** Notes not touched for a long time that other notes still link to. */
  stale: GraphNodeData[];
};

const STALE_DAYS = 90;

/** The lists behind "needs attention": each one something the learner can act on. */
export function attention(data: GraphApi, now: Date = new Date()): Attention {
  const deg = linkDegrees(data);
  const notes = data.nodes.filter((n) => n.kind === "note" && !n.ghost);
  const byTitle = (a: GraphNodeData, b: GraphNodeData): number => a.title.localeCompare(b.title);
  const age = (n: GraphNodeData): number => (n.updatedAt ? (now.getTime() - Date.parse(n.updatedAt)) / 86_400_000 : 0);
  return {
    orphans: notes.filter((n) => (deg.get(n.id) ?? 0) === 0).sort(byTitle),
    ghosts: data.nodes.filter((n) => n.ghost).sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0) || byTitle(a, b)),
    due: notes.filter((n) => n.memory?.recallDue === true).sort(byTitle),
    noCards: notes.filter((n) => n.author !== "agent" && (n.memory?.cards ?? 0) === 0).sort(byTitle),
    stale: notes.filter((n) => age(n) > STALE_DAYS && (deg.get(n.id) ?? 0) > 0).sort((a, b) => age(b) - age(a)),
  };
}

/** Where to put the notes of a local graph: the focus in the middle, each hop on a ring, evenly spread and stable. */
export function radialLayout(data: GraphApi, focus: string): Map<string, { x: number; y: number }> {
  const near = new Map<string, string[]>();
  const join = (a: string, b: string): void => void near.set(a, [...(near.get(a) ?? []), b]);
  for (const e of data.edges) {
    if (e.kind !== "link") continue;
    join(e.source, e.target);
    join(e.target, e.source);
  }
  const ring = new Map<string, number>([[focus, 0]]);
  let frontier = [focus];
  for (let depth = 1; frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const o of near.get(id) ?? []) {
        if (ring.has(o)) continue;
        ring.set(o, depth);
        next.push(o);
      }
    }
    frontier = next;
  }
  const out = new Map<string, { x: number; y: number }>();
  const at = new Map<number, string[]>();
  for (const n of data.nodes) {
    // Agents and anything not reached by links sit on the outer ring.
    const d = ring.get(n.id) ?? (Math.max(...ring.values()) + 1);
    at.set(d, [...(at.get(d) ?? []), n.id]);
  }
  for (const [d, ids] of at) {
    ids.sort();
    ids.forEach((id, i) => {
      if (d === 0) return void out.set(id, { x: 0, y: 0 });
      const angle = (i / ids.length) * Math.PI * 2 + d * 0.6;
      out.set(id, { x: Math.cos(angle) * d * 1.6, y: Math.sin(angle) * d * 1.6 });
    });
  }
  return out;
}
