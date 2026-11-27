import type { Agent } from "@vigil/shared";
import { allLinks, listNoteSummaries, noteTagsAll } from "./index-db";
import { memoryMap, type NoteMemory } from "./memory";
import { listAgents, recentTouches } from "./state-db";

export const MAX_GRAPH_NODES = 3000;
const TOUCH_DAYS = 90;

export type GraphNode = {
  id: string;
  title: string;
  kind: "note" | "agent";
  updatedAt?: string;
  author?: "human" | "agent";
  /** Note that is linked to but not written yet. */
  ghost?: boolean;
  /** Every tag on a note, for colouring and filtering. */
  tags?: string[];
  /** Number of edges touching this node (computed here so the client need not). */
  degree: number;
  /** Study memory for a note that has cards or a recall check (the memory view of the graph). */
  memory?: NoteMemory;
};
export type GraphEdge = {
  source: string;
  target: string;
  kind: "link" | "agent-read" | "agent-wrote";
  dangling?: boolean;
  /** For agent edges: when the agent last did it, and in which run. */
  at?: string;
  runId?: string;
};
export type GraphOptions = {
  /** Only this note and what is within `hops` links of it (either direction). */
  focus?: string;
  hops?: number;
};
export const MAX_HOPS = 3;
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean };

/**
 * Notes and agents as a graph. Link edges come from the index (a link to a missing note becomes a
 * dangling edge to a ghost node); agent edges from recorded touches in the last 90 days, only for
 * notes that exist. Past 3,000 nodes only the most recently updated notes and their direct
 * neighbours are returned, with `truncated: true`.
 */
export function buildGraphData(now: Date = new Date(), agents: Agent[] = listAgents(), options: GraphOptions = {}): GraphData {
  const notes = listNoteSummaries(); // newest first
  const exists = new Set(notes.map((n) => n.id));
  const links = allLinks();
  const since = new Date(now.getTime() - TOUCH_DAYS * 86_400_000).toISOString();
  const touches = recentTouches(since).filter((t) => exists.has(t.noteId));

  let keep = new Set(notes.map((n) => n.id));
  let truncated = false;
  // The local graph: breadth-first from one note over links in either direction. Links to notes that do not exist
  // come along as ghosts, so "you meant to write this" shows up next to the note.
  const focus = options.focus;
  const reached = new Set<string>();
  if (focus !== undefined) {
    if (!exists.has(focus)) return { nodes: [], edges: [], truncated: false };
    const hops = Math.max(1, Math.min(MAX_HOPS, Math.floor(options.hops ?? 1)));
    const near = new Map<string, string[]>();
    const join = (a: string, b: string): void => void near.set(a, [...(near.get(a) ?? []), b]);
    for (const l of links) {
      join(l.src, l.dst);
      join(l.dst, l.src);
    }
    let frontier = [focus];
    reached.add(focus);
    for (let h = 0; h < hops; h++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const other of near.get(id) ?? []) {
          if (reached.has(other)) continue;
          reached.add(other);
          next.push(other);
        }
      }
      frontier = next;
    }
    keep = new Set([...reached].filter((id) => exists.has(id)));
  } else if (notes.length + agents.length > MAX_GRAPH_NODES) {
    truncated = true;
    const recent = new Set(notes.slice(0, MAX_GRAPH_NODES).map((n) => n.id));
    keep = new Set(recent);
    for (const l of links) {
      if (recent.has(l.src) && exists.has(l.dst)) keep.add(l.dst);
      if (recent.has(l.dst) && exists.has(l.src)) keep.add(l.src);
    }
  }

  const nodes = new Map<string, GraphNode>();
  for (const n of notes) {
    if (!keep.has(n.id)) continue;
    nodes.set(n.id, { id: n.id, title: n.title, kind: "note", updatedAt: n.updatedAt, author: n.author, tags: n.tags, degree: 0 });
  }
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    if (!keep.has(l.src)) continue;
    const dangling = !exists.has(l.dst);
    if (!dangling && !keep.has(l.dst)) continue;
    if (dangling && focus !== undefined && !reached.has(l.dst)) continue;
    const key = `${l.src}>${l.dst}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (dangling && !nodes.has(l.dst)) nodes.set(l.dst, { id: l.dst, title: l.dst, kind: "note", ghost: true, degree: 0 });
    edges.push({ source: l.src, target: l.dst, kind: "link", ...(dangling ? { dangling: true } : {}) });
  }
  const memory = memoryMap(now, noteTagsAll);
  for (const [id, m] of memory) {
    const node = nodes.get(id);
    if (node && !node.ghost) node.memory = m;
  }
  const agentNames = new Set(agents.map((a) => a.name));
  const shownTouches = touches.filter((t) => agentNames.has(t.agent) && keep.has(t.noteId));
  // The whole-vault graph shows every agent; a local graph only the ones that touched a note in view.
  const shownAgents = focus === undefined ? agents : agents.filter((a) => shownTouches.some((t) => t.agent === a.name));
  for (const a of shownAgents) nodes.set(`agent:${a.name}`, { id: `agent:${a.name}`, title: a.name, kind: "agent", degree: 0 });
  for (const t of shownTouches) {
    // A touch by an agent that was deleted, or of a note cut by truncation, is left out.
    edges.push({ source: `agent:${t.agent}`, target: t.noteId, kind: t.kind === "read" ? "agent-read" : "agent-wrote", at: t.at, runId: t.runId });
  }
  for (const e of edges) {
    const a = nodes.get(e.source);
    const b = nodes.get(e.target);
    if (a) a.degree += 1;
    if (b) b.degree += 1;
  }
  return { nodes: [...nodes.values()], edges, truncated };
}
