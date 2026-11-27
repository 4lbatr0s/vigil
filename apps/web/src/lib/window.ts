export type Window = { start: number; end: number; padTop: number; padBottom: number };

/** Number of rows above which the note list renders only what is on screen. */
export const VIRTUALIZE_ABOVE = 300;
export const ROW_HEIGHT = 56;

/**
 * Which rows to render for a scroll position: the visible ones plus `overscan` on each side, with
 * spacer heights standing in for the rest so the scrollbar stays honest. Fixed row height.
 */
export function visibleWindow(opts: { total: number; scrollTop: number; viewport: number; rowHeight?: number; overscan?: number }): Window {
  const rowHeight = opts.rowHeight ?? ROW_HEIGHT;
  const overscan = opts.overscan ?? 6;
  const first = Math.floor(Math.max(0, opts.scrollTop) / rowHeight);
  const count = Math.ceil(Math.max(0, opts.viewport) / rowHeight) + 1;
  const start = Math.max(0, Math.min(opts.total, first - overscan));
  const end = Math.max(start, Math.min(opts.total, first + count + overscan));
  return { start, end, padTop: start * rowHeight, padBottom: (opts.total - end) * rowHeight };
}
