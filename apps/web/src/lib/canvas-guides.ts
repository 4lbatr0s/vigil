import type { Rect } from "./canvas-layout";

/** Aligning, spreading and snapping cards. Pure: boxes in, new places out. */
export type Box = Rect & { id: string };
export type AlignHow = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Every chosen card lined up on the same edge or centre line (of the whole selection). Needs two or more. */
export function alignBoxes(boxes: readonly Box[], how: AlignHow): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (boxes.length < 2) return out;
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  for (const b of boxes) {
    const x = how === "left" ? left : how === "right" ? right - b.width : how === "center" ? (left + right) / 2 - b.width / 2 : b.x;
    const y = how === "top" ? top : how === "bottom" ? bottom - b.height : how === "middle" ? (top + bottom) / 2 - b.height / 2 : b.y;
    out.set(b.id, { x: Math.round(x), y: Math.round(y) });
  }
  return out;
}

/** The gaps between neighbouring cards made equal, the first and last staying where they are. Needs three or more. */
export function distributeBoxes(boxes: readonly Box[], axis: "horizontal" | "vertical"): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (boxes.length < 3) return out;
  const h = axis === "horizontal";
  const sorted = [...boxes].sort((a, b) => (h ? a.x - b.x : a.y - b.y));
  const start = h ? sorted[0]?.x ?? 0 : sorted[0]?.y ?? 0;
  const last = sorted[sorted.length - 1];
  const end = last ? (h ? last.x + last.width : last.y + last.height) : 0;
  const sizes = sorted.reduce((sum, b) => sum + (h ? b.width : b.height), 0);
  const gap = (end - start - sizes) / (sorted.length - 1);
  let at = start;
  for (const b of sorted) {
    out.set(b.id, h ? { x: Math.round(at), y: b.y } : { x: b.x, y: Math.round(at) });
    at += (h ? b.width : b.height) + gap;
  }
  return out;
}

/** The biggest width or height among the chosen cards, for making them all the same. */
export function matchedSize(boxes: readonly Box[], dim: "width" | "height"): number {
  return boxes.length === 0 ? 0 : Math.max(...boxes.map((b) => b[dim]));
}

export type Snap = { dx: number; dy: number; vertical: number | null; horizontal: number | null };

/**
 * How far to nudge a card being dragged so an edge or centre line meets one of the other cards, and the guide
 * lines to draw. Only the closest match on each axis counts, and only within `threshold` (in board units).
 */
export function snapToObjects(moving: Rect, others: readonly Rect[], threshold: number): Snap {
  const xs = [moving.x, moving.x + moving.width / 2, moving.x + moving.width];
  const ys = [moving.y, moving.y + moving.height / 2, moving.y + moving.height];
  let bestX: { d: number; line: number } | null = null;
  let bestY: { d: number; line: number } | null = null;
  for (const o of others) {
    for (const line of [o.x, o.x + o.width / 2, o.x + o.width]) {
      for (const x of xs) {
        const d = line - x;
        if (Math.abs(d) <= threshold && (bestX === null || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, line };
      }
    }
    for (const line of [o.y, o.y + o.height / 2, o.y + o.height]) {
      for (const y of ys) {
        const d = line - y;
        if (Math.abs(d) <= threshold && (bestY === null || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, line };
      }
    }
  }
  return { dx: bestX?.d ?? 0, dy: bestY?.d ?? 0, vertical: bestX?.line ?? null, horizontal: bestY?.line ?? null };
}
