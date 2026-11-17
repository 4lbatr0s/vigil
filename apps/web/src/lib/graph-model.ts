import Graph from "graphology";

/** Mirrors `NoteMemory` in apps/server/src/memory.ts. */
export type NoteMemoryData = { cards: number; reviewed: number; strength: number | null; recallDue: boolean; examDays: number | null };

/** Mirrors GET /api/graph (apps/server/src/graph.ts). */
export type GraphNodeData = { id: string; title: string; kind: "note" | "agent"; updatedAt?: string; author?: "human" | "agent"; ghost?: boolean; degree: number; memory?: NoteMemoryData };
export type GraphEdgeData = { source: string; target: string; kind: "link" | "agent-read" | "agent-wrote"; dangling?: boolean };
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
