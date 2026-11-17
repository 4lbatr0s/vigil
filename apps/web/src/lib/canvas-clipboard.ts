import { newId, type BoardNode, type LooseEdge } from "./canvas";

/** Cards and the arrows between them, as copied. Plain data, so a JSON round trip is a safe deep copy. */
export type Clip = { nodes: BoardNode[]; edges: LooseEdge[] };

const copyOf = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The selected cards, and only the arrows that have both ends among them (an arrow to a card left behind is dropped). */
export function copySelection(nodes: readonly BoardNode[], edges: readonly LooseEdge[], ids: readonly string[]): Clip {
  const chosen = new Set(ids);
  return {
    nodes: copyOf(nodes.filter((n) => chosen.has(n.id))),
    edges: copyOf(edges.filter((e) => chosen.has(e.source) && chosen.has(e.target))),
  };
}

/**
 * New cards from a clip: fresh ids (never one in `taken`), moved by `offset`, stacked above `topZ`, with the arrows
 * between them rewired to the new ids. A group keeps its place at the bottom. Locked copies stay locked.
 */
export function pasteClip(clip: Clip, taken: ReadonlySet<string>, offset: { x: number; y: number }, topZ: number): { nodes: BoardNode[]; edges: LooseEdge[] } {
  const used = new Set(taken);
  const ids = new Map<string, string>();
  for (const n of clip.nodes) {
    const id = newId(n.type[0] ?? "n", used);
    used.add(id);
    ids.set(n.id, id);
  }
  let z = topZ;
  const nodes = clip.nodes.map((n): BoardNode => {
    const copy = copyOf(n);
    return { ...copy, id: ids.get(n.id) ?? n.id, position: { x: n.position.x + offset.x, y: n.position.y + offset.y }, zIndex: n.type === "group" ? 0 : ++z };
  });
  const edges = clip.edges.flatMap((e): LooseEdge[] => {
    const source = ids.get(e.source);
    const target = ids.get(e.target);
    if (!source || !target) return [];
    const id = newId("e", used);
    used.add(id);
    return [{ ...copyOf(e), id, source, target }];
  });
  return { nodes, edges };
}

/** The box around some cards, or null when there are none. */
export function boundsOf(nodes: readonly BoardNode[]): { x: number; y: number; width: number; height: number } | null {
  if (nodes.length === 0) return null;
  const x1 = Math.min(...nodes.map((n) => n.position.x));
  const y1 = Math.min(...nodes.map((n) => n.position.y));
  const x2 = Math.max(...nodes.map((n) => n.position.x + n.width));
  const y2 = Math.max(...nodes.map((n) => n.position.y + n.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** A group box around the chosen cards, with room for its name above them. Null when nothing is chosen. */
export function groupAround(nodes: readonly BoardNode[], ids: readonly string[], taken: ReadonlySet<string>, pad = 32): BoardNode | null {
  const chosen = new Set(ids);
  const box = boundsOf(nodes.filter((n) => chosen.has(n.id) && n.type !== "group"));
  if (!box) return null;
  const top = 28;
  return {
    id: newId("g", taken),
    type: "group",
    position: { x: Math.round(box.x - pad), y: Math.round(box.y - pad - top) },
    width: Math.round(box.width + pad * 2),
    height: Math.round(box.height + pad * 2 + top),
    zIndex: 0,
    data: { kind: "group", extra: {} },
  };
}

/**
 * New stacking numbers after bringing some cards to the front or sending them to the back. Groups always stay at the
 * very bottom, so a group never covers its cards. Every card gets a number again (0, 1, 2, ...), in order.
 */
export function restack(nodes: readonly BoardNode[], ids: readonly string[], to: "front" | "back"): Map<string, number> {
  const chosen = new Set(ids);
  const groups = nodes.filter((n) => n.type === "group").sort((a, b) => a.zIndex - b.zIndex);
  const cards = nodes.filter((n) => n.type !== "group").sort((a, b) => a.zIndex - b.zIndex);
  const moved = cards.filter((n) => chosen.has(n.id));
  const stay = cards.filter((n) => !chosen.has(n.id));
  const order = [...groups, ...(to === "front" ? [...stay, ...moved] : [...moved, ...stay])];
  return new Map(order.map((n, i) => [n.id, i]));
}
