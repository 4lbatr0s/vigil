import { SIZES, noteFile, type BoardEdge, type BoardNode, type CanvasFile, type FileEdge, type FileNode } from "./canvas";

/** Places and sizes only: pure functions that give cards a tidy position. No DOM, so they are easy to test. */
export type Rect = { x: number; y: number; width: number; height: number };
export type LayoutItem = { id: string; parent: string | null; width: number; height: number };

const GAP_X = 90;
const GAP_Y = 28;

/**
 * A tree laid out left to right: each depth is a column, leaves are stacked top to bottom, and a parent sits level
 * with the middle of its children. An item whose parent is not in the list, or that would make a loop, is a root.
 * Positions are relative to (0, 0), the top left of the whole tree.
 */
export function treeLayout(items: readonly LayoutItem[], gapX = GAP_X, gapY = GAP_Y): Map<string, { x: number; y: number }> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const kids = new Map<string, LayoutItem[]>();
  const roots: LayoutItem[] = [];
  for (const item of items) {
    const parent = item.parent !== null && item.parent !== item.id ? item.parent : null;
    if (parent !== null && byId.has(parent)) kids.set(parent, [...(kids.get(parent) ?? []), item]);
    else roots.push(item);
  }

  // Items reachable from a root are placed; anything left over is in a loop, so it becomes a root too.
  const reach = new Set<string>();
  const walk = (id: string): void => {
    if (reach.has(id)) return;
    reach.add(id);
    for (const k of kids.get(id) ?? []) walk(k.id);
  };
  roots.forEach((r) => walk(r.id));
  for (const item of items) {
    if (!reach.has(item.id)) {
      roots.push(item);
      walk(item.id);
    }
  }

  const depth = new Map<string, number>();
  const measure = (id: string, d: number, seen: Set<string>): void => {
    if (seen.has(id)) return;
    seen.add(id);
    depth.set(id, d);
    for (const k of kids.get(id) ?? []) measure(k.id, d + 1, seen);
  };
  const seenDepth = new Set<string>();
  roots.forEach((r) => measure(r.id, 0, seenDepth));

  const columnWidth: number[] = [];
  for (const [id, d] of depth) columnWidth[d] = Math.max(columnWidth[d] ?? 0, byId.get(id)?.width ?? 0);
  const columnX: number[] = [];
  columnWidth.reduce((x, w, d) => ((columnX[d] = x), x + w + gapX), 0);

  const out = new Map<string, { x: number; y: number }>();
  const lastBottom: number[] = [];
  let cursor = 0;
  const visiting = new Set<string>();
  const place = (item: LayoutItem): number => {
    visiting.add(item.id);
    const d = depth.get(item.id) ?? 0;
    const children = (kids.get(item.id) ?? []).filter((k) => !out.has(k.id) && !visiting.has(k.id));
    let y: number;
    if (children.length === 0) {
      y = Math.max(cursor, (lastBottom[d] ?? -Infinity) + gapY);
    } else {
      const centers = children.map(place);
      const mid = (Math.min(...centers) + Math.max(...centers)) / 2;
      y = Math.max(mid - item.height / 2, (lastBottom[d] ?? -Infinity) + gapY);
    }
    out.set(item.id, { x: columnX[d] ?? 0, y: Math.round(y) });
    lastBottom[d] = y + item.height;
    cursor = Math.max(cursor, y + item.height + gapY);
    visiting.delete(item.id);
    return y + item.height / 2;
  };
  roots.forEach(place);
  return out;
}

/** Cards in rows, left to right, as square as it can be; every cell is as big as the biggest card. */
export function gridLayout(items: readonly { id: string; width: number; height: number }[], gap = 32): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (items.length === 0) return out;
  const columns = Math.ceil(Math.sqrt(items.length));
  const cellW = Math.max(...items.map((i) => i.width));
  const cellH = Math.max(...items.map((i) => i.height));
  items.forEach((item, i) => out.set(item.id, { x: (i % columns) * (cellW + gap), y: Math.floor(i / columns) * (cellH + gap) }));
  return out;
}

/** The chosen cards tidied in place: the new layout keeps the top left corner of where they were. */
export function tidy(nodes: readonly BoardNode[], edges: readonly Pick<BoardEdge, "source" | "target">[], mode: "tree" | "grid"): Map<string, { x: number; y: number }> {
  const cards = nodes.filter((n) => n.type !== "group");
  if (cards.length === 0) return new Map();
  const ids = new Set(cards.map((n) => n.id));
  const parentOf = new Map<string, string>();
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target) && !parentOf.has(e.target)) parentOf.set(e.target, e.source);
  const placed =
    mode === "tree"
      ? treeLayout(cards.map((n) => ({ id: n.id, parent: parentOf.get(n.id) ?? null, width: n.width, height: n.height })))
      : gridLayout(cards.map((n) => ({ id: n.id, width: n.width, height: n.height })));
  const left = Math.min(...cards.map((n) => n.position.x));
  const top = Math.min(...cards.map((n) => n.position.y));
  return new Map([...placed].map(([id, p]) => [id, { x: Math.round(p.x + left), y: Math.round(p.y + top) }]));
}

const overlaps = (a: Rect, b: Rect, margin = 8): boolean => a.x < b.x + b.width + margin && b.x < a.x + a.width + margin && a.y < b.y + b.height + margin && b.y < a.y + a.height + margin;

/**
 * Where a new card goes next to `from`: a child to its right, a sibling below it. If something is already there it
 * moves down until the place is free.
 */
export function relativeSpot(from: Rect, kind: "child" | "sibling", others: readonly Rect[], size: { width: number; height: number }): { x: number; y: number } {
  let x = kind === "child" ? from.x + from.width + GAP_X : from.x;
  let y = kind === "child" ? from.y : from.y + from.height + GAP_Y;
  for (let i = 0; i < 200 && others.some((o) => overlaps({ x, y, ...size }, o)); i++) y += size.height + GAP_Y;
  x = Math.round(x);
  return { x, y: Math.round(y) };
}

// ---- a note's headings as a map ----

export type OutlineItem = { level: number; title: string; lines: string[]; parent: number | null };

const MAX_LINES = 6;
const MAX_ITEMS = 60;

/** The headings of a note with the first lines under each, and which heading each one belongs to. Code blocks are skipped. */
export function parseOutline(body: string, maxItems = MAX_ITEMS): OutlineItem[] {
  const items: OutlineItem[] = [];
  const stack: { level: number; index: number }[] = [];
  let fence = false;
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      if (items.length >= maxItems) break;
      const level = h[1]?.length ?? 1;
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
      items.push({ level, title: h[2] ?? "", lines: [], parent: stack[stack.length - 1]?.index ?? null });
      stack.push({ level, index: items.length - 1 });
    } else if (line.trim() !== "" && items.length > 0) {
      const mine = items[items.length - 1];
      if (mine && mine.lines.length < MAX_LINES) mine.lines.push(line.trim().slice(0, 90));
    }
  }
  return items;
}

/**
 * A board from one note: the note itself on the left, one text card per heading, an arrow from each heading's parent
 * (the note for top headings). Fits study guides: levels, steps and ladders show up as a map you can rearrange.
 */
export function outlineToBoard(noteId: string, body: string): CanvasFile {
  const items = parseOutline(body);
  const root = SIZES.file;
  const layoutItems = [
    { id: "root", parent: null, width: root.width, height: root.height },
    ...items.map((it, i) => ({ id: `h${i}`, parent: it.parent === null ? "root" : `h${it.parent}`, width: 280, height: Math.max(64, 44 + 22 * it.lines.length) })),
  ];
  const at = treeLayout(layoutItems);
  const pos = (id: string): { x: number; y: number } => at.get(id) ?? { x: 0, y: 0 };
  const nodes: FileNode[] = [{ id: "root", type: "file", ...pos("root"), width: root.width, height: root.height, file: noteFile(noteId), color: "2" }];
  const edges: FileEdge[] = [];
  items.forEach((it, i) => {
    const size = layoutItems[i + 1];
    nodes.push({ id: `h${i}`, type: "text", ...pos(`h${i}`), width: size?.width ?? 280, height: size?.height ?? 80, text: [`${"#".repeat(Math.min(it.level, 3))} ${it.title}`, ...it.lines].join("\n") });
    edges.push({ id: `e${i}`, fromNode: it.parent === null ? "root" : `h${it.parent}`, toNode: `h${i}`, fromSide: "right", toSide: "left" });
  });
  return { nodes, edges };
}

// ---- starter boards ----

/** Boards to begin from: a path of steps with checklists, or a topic with branches. */
export function starterBoard(kind: "path" | "mindmap"): CanvasFile {
  if (kind === "path") {
    const steps = ["## 1. Foundations\n- [ ] First topic\n- [ ] Second topic", "## 2. Practice\n- [ ] A small project\n- [ ] A self-test", "## 3. Go deeper\n- [ ] A harder topic\n- [ ] Write it up", "## 4. Done when\n- [ ] You can explain it without notes"];
    const nodes: FileNode[] = steps.map((text, i) => ({ id: `s${i}`, type: "text", x: i * 340, y: 0, width: 280, height: 150, text, ...(i === steps.length - 1 ? { color: "4" } : {}) }));
    const edges: FileEdge[] = steps.slice(1).map((_, i) => ({ id: `e${i}`, fromNode: `s${i}`, toNode: `s${i + 1}`, fromSide: "right", toSide: "left" }));
    return { nodes, edges };
  }
  const branches = ["## Idea 1", "## Idea 2", "## Idea 3", "## Idea 4"];
  const centre: FileNode = { id: "c", type: "text", x: 0, y: 0, width: 260, height: 90, text: "# Topic", color: "2" };
  const items = branches.map((text, i): FileNode => ({ id: `b${i}`, type: "text", x: 0, y: 0, width: 240, height: 70, text }));
  const at = treeLayout([{ id: "c", parent: null, width: 260, height: 90 }, ...items.map((b) => ({ id: b.id, parent: "c", width: b.width, height: b.height }))]);
  const place = (n: FileNode): FileNode => ({ ...n, x: at.get(n.id)?.x ?? 0, y: at.get(n.id)?.y ?? 0 });
  return { nodes: [place(centre), ...items.map(place)], edges: items.map((b, i): FileEdge => ({ id: `e${i}`, fromNode: "c", toNode: b.id, fromSide: "right", toSide: "left" })) };
}
