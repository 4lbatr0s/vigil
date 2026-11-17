/**
 * JSON Canvas 1.0 (jsoncanvas.org) as the board edits it. The file format is the source of truth: a card keeps any
 * field this app does not know (`extra`), so a canvas that Obsidian wrote or will read again is not damaged.
 */

export type CanvasSide = "top" | "right" | "bottom" | "left";
export type CardKind = "text" | "file" | "link" | "group";

export type FileNode = { id: string; type: CardKind; x: number; y: number; width: number; height: number; color?: string; [k: string]: unknown };
export type FileEdge = { id: string; fromNode: string; toNode: string; fromSide?: CanvasSide; toSide?: CanvasSide; fromEnd?: "none" | "arrow"; toEnd?: "none" | "arrow"; color?: string; label?: string; [k: string]: unknown };
export type CanvasFile = { nodes?: FileNode[]; edges?: FileEdge[]; [k: string]: unknown };

export const SIZES: Record<CardKind, { width: number; height: number }> = {
  text: { width: 260, height: 120 },
  file: { width: 300, height: 180 },
  link: { width: 260, height: 90 },
  group: { width: 520, height: 360 },
};

/** The six preset colors of the format; each is a token (`--canvas-1` to `--canvas-6`) in app.css. */
export const PRESETS = ["1", "2", "3", "4", "5", "6"] as const;
export const PRESET_NAMES: Record<string, string> = { "1": "Red", "2": "Orange", "3": "Yellow", "4": "Green", "5": "Cyan", "6": "Purple" };

/** A CSS color for a card or arrow: a preset becomes its token, a hex value is used as given, anything else is none. */
export function cssColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (/^[1-6]$/.test(color)) return `var(--canvas-${color})`;
  return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : undefined;
}

/** The note a `file` card points at: `bio.md` or `notes/bio.md` gives `bio`; anything that is not a note gives null. */
export function noteIdOf(file: string): string | null {
  const m = /(?:^|\/)([a-z0-9][a-z0-9-]*)\.md$/.exec(file);
  return m?.[1] ?? null;
}

/** The pasted picture a `file` card points at (`attachments/<16 hex>.png` and so on), or null. */
export function imageNameOf(file: string): string | null {
  return /(?:^|\/)attachments\/([a-f0-9]{16}\.(?:png|jpg|gif|webp))$/.exec(file)?.[1] ?? null;
}

export const noteFile = (noteId: string): string => `${noteId}.md`;

export function newId(prefix: string, taken: ReadonlySet<string>): string {
  for (let i = 0; i < 20; i++) {
    const id = `${prefix}${Math.random().toString(16).slice(2, 10)}`;
    if (!taken.has(id)) return id;
  }
  return `${prefix}${Date.now().toString(16)}`;
}

/** What the board keeps per card besides its place: the data the card shows, and the fields to write back untouched. */
export type CardData = { kind: CardKind; text?: string; file?: string; subpath?: string; url?: string; label?: string; color?: string; extra: Record<string, unknown> };
export type BoardNode = { id: string; type: CardKind; position: { x: number; y: number }; width: number; height: number; zIndex: number; data: CardData; draggable?: boolean; deletable?: boolean };

/** A locked card cannot be moved or deleted. The format has no lock, so it is a Vigil field that other apps keep and ignore. */
export const LOCK_FIELD = "vigilLock";
export const isLocked = (n: { data: CardData }): boolean => n.data.extra[LOCK_FIELD] === true;
/** The board properties a lock turns off (none when unlocked, so an unlocked card carries no extra fields). */
export const lockProps = (locked: boolean): { draggable?: false; deletable?: false } => (locked ? { draggable: false, deletable: false } : {});
export type BoardEdge = { id: string; source: string; target: string; sourceHandle: CanvasSide; targetHandle: CanvasSide; label?: string; data: { color?: string; fromEnd: "none" | "arrow"; toEnd: "none" | "arrow"; extra: Record<string, unknown> } };

const NODE_KNOWN = new Set(["id", "type", "x", "y", "width", "height", "color", "text", "file", "subpath", "url", "label"]);
const EDGE_KNOWN = new Set(["id", "fromNode", "toNode", "fromSide", "toSide", "fromEnd", "toEnd", "color", "label"]);

const rest = (o: Record<string, unknown>, known: Set<string>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([k]) => !known.has(k)));

/** The array order of a canvas is its stacking order (first is at the bottom); the board uses it as `zIndex`. */
export function toBoard(file: CanvasFile): { nodes: BoardNode[]; edges: BoardEdge[] } {
  const nodes = (file.nodes ?? []).map((n, i): BoardNode => ({
    ...lockProps(n[LOCK_FIELD] === true),
    id: n.id,
    type: n.type,
    position: { x: n.x, y: n.y },
    width: n.width,
    height: n.height,
    zIndex: i,
    data: {
      kind: n.type,
      ...(typeof n.text === "string" ? { text: n.text } : {}),
      ...(typeof n.file === "string" ? { file: n.file } : {}),
      ...(typeof n.subpath === "string" ? { subpath: n.subpath } : {}),
      ...(typeof n.url === "string" ? { url: n.url } : {}),
      ...(typeof n.label === "string" ? { label: n.label } : {}),
      ...(n.color ? { color: n.color } : {}),
      extra: rest(n, NODE_KNOWN),
    },
  }));
  const edges = (file.edges ?? []).map((e): BoardEdge => ({
    id: e.id,
    source: e.fromNode,
    target: e.toNode,
    sourceHandle: e.fromSide ?? "right",
    targetHandle: e.toSide ?? "left",
    ...(e.label ? { label: e.label } : {}),
    data: { ...(e.color ? { color: e.color } : {}), fromEnd: e.fromEnd ?? "none", toEnd: e.toEnd ?? "arrow", extra: rest(e, EDGE_KNOWN) },
  }));
  return { nodes, edges };
}

const round = (n: number): number => Math.round(n);

/** An arrow as the board holds it: one the user just drew has no `data` yet and no explicit sides. */
export type LooseEdge = Omit<BoardEdge, "data" | "sourceHandle" | "targetHandle"> & { sourceHandle?: string | null; targetHandle?: string | null; data?: BoardEdge["data"] };

const SIDES = new Set(["top", "right", "bottom", "left"]);
const side = (s: string | null | undefined, fallback: CanvasSide): CanvasSide => (s && SIDES.has(s) ? (s as CanvasSide) : fallback);

/** Back to the file. Groups are written first and the rest in their stacking order, so a group never covers its cards. */
export function toFile(nodes: readonly BoardNode[], edges: readonly LooseEdge[]): CanvasFile {
  const ordered = [...nodes].sort((a, b) => Number(b.type === "group") - Number(a.type === "group") || a.zIndex - b.zIndex);
  return {
    nodes: ordered.map((n): FileNode => {
      const d = n.data;
      return {
        ...d.extra,
        id: n.id,
        type: n.type,
        x: round(n.position.x),
        y: round(n.position.y),
        width: Math.max(1, round(n.width)),
        height: Math.max(1, round(n.height)),
        ...(d.color ? { color: d.color } : {}),
        ...(n.type === "text" ? { text: d.text ?? "" } : {}),
        ...(n.type === "file" ? { file: d.file ?? "", ...(d.subpath ? { subpath: d.subpath } : {}) } : {}),
        ...(n.type === "link" ? { url: d.url ?? "" } : {}),
        ...(n.type === "group" && d.label ? { label: d.label } : {}),
      };
    }),
    edges: edges.map((e): FileEdge => ({
      ...(e.data?.extra ?? {}),
      id: e.id,
      fromNode: e.source,
      toNode: e.target,
      fromSide: side(e.sourceHandle, "right"),
      toSide: side(e.targetHandle, "left"),
      ...(e.data && e.data.fromEnd !== "none" ? { fromEnd: e.data.fromEnd } : {}),
      ...(e.data && e.data.toEnd !== "arrow" ? { toEnd: e.data.toEnd } : {}),
      ...(e.data?.color ? { color: e.data.color } : {}),
      ...(e.label ? { label: e.label } : {}),
    })),
  };
}

/** A copy of the board's cards for undo; a card's data is plain, so JSON is a safe deep copy. */
export const snapshot = (nodes: readonly BoardNode[], edges: readonly LooseEdge[]): string => JSON.stringify(toFile(nodes, edges));

/** Undo and redo over snapshots (strings), capped. `push` after a change; `undo` and `redo` return the text to show or null. */
export class History {
  private past: string[] = [];
  private future: string[] = [];
  constructor(
    private current: string,
    private readonly max = 100,
  ) {}

  push(next: string): void {
    if (next === this.current) return;
    this.past.push(this.current);
    if (this.past.length > this.max) this.past.shift();
    this.current = next;
    this.future = [];
  }

  undo(): string | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): string | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.current);
    this.current = next;
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
}

/** The first lines of a note, as plain text, for a card; headings and list marks stay, blank lines go. */
export function excerpt(body: string, maxLines = 6, maxChars = 280): string {
  const lines = body.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  return lines.slice(0, maxLines).join("\n").slice(0, maxChars);
}

/**
 * A board for one note and the notes around it: the note in the middle, its neighbours on a ring, an arrow from the
 * middle to each. `links` are the neighbours' ids; at most `max` are used (the ring gets crowded).
 */
export function ringBoard(centerId: string, links: readonly string[], max = 12): CanvasFile {
  const ids = [...new Set(links.filter((l) => l !== centerId))].slice(0, max);
  const c = SIZES.file;
  const radius = Math.max(380, Math.round((ids.length * (c.width + 40)) / (2 * Math.PI)));
  const nodes: FileNode[] = [{ id: "center", type: "file", x: -Math.round(c.width / 2), y: -Math.round(c.height / 2), width: c.width, height: c.height, file: noteFile(centerId), color: "2" }];
  const edges: FileEdge[] = [];
  ids.forEach((id, i) => {
    const angle = (i / Math.max(1, ids.length)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.round(Math.cos(angle) * radius - c.width / 2);
    const y = Math.round(Math.sin(angle) * radius - c.height / 2);
    nodes.push({ id: `n${i}`, type: "file", x, y, width: c.width, height: c.height, file: noteFile(id) });
    const horizontal = Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle));
    edges.push({ id: `e${i}`, fromNode: "center", toNode: `n${i}`, fromSide: horizontal ? (Math.cos(angle) > 0 ? "right" : "left") : Math.sin(angle) > 0 ? "bottom" : "top", toSide: horizontal ? (Math.cos(angle) > 0 ? "left" : "right") : Math.sin(angle) > 0 ? "top" : "bottom" });
  });
  return { nodes, edges };
}

/** Checklist items in a card's text: how many are ticked out of how many. Null when there are none. */
export function checklistProgress(text: string): { done: number; total: number } | null {
  let done = 0;
  let total = 0;
  for (const m of text.matchAll(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/gm)) {
    total += 1;
    if (m[1] !== " ") done += 1;
  }
  return total === 0 ? null : { done, total };
}

/** Ticks or unticks the nth checklist item (0-based, in reading order) and gives the new text; unchanged if there is no such item. */
export function toggleTask(text: string, index: number): string {
  let seen = -1;
  return text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/gm, (all, open: string, mark: string, close: string) => {
    seen += 1;
    return seen === index ? `${open}${mark === " " ? "x" : " "}${close}` : all;
  });
}
