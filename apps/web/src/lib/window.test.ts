import { describe, expect, it } from "vitest";
import { ROW_HEIGHT, visibleWindow } from "./window";

describe("visibleWindow", () => {
  it("renders about 40 rows or fewer out of 5,000 at any scroll position", () => {
    for (const scrollTop of [0, 1, 4800, 120_000, 5000 * ROW_HEIGHT]) {
      const w = visibleWindow({ total: 5000, scrollTop, viewport: 800 });
      expect(w.end - w.start).toBeLessThanOrEqual(40);
      expect(w.start).toBeGreaterThanOrEqual(0);
      expect(w.end).toBeLessThanOrEqual(5000);
    }
  });
  it("keeps the total scroll height: spacers plus rendered rows equal total rows", () => {
    for (const scrollTop of [0, 777, 90_000, 239_000]) {
      const w = visibleWindow({ total: 5000, scrollTop, viewport: 600 });
      expect(w.padTop + (w.end - w.start) * ROW_HEIGHT + w.padBottom).toBe(5000 * ROW_HEIGHT);
    }
  });
  it("starts at row 0 at the top and covers the viewport", () => {
    const w = visibleWindow({ total: 5000, scrollTop: 0, viewport: 480 });
    expect(w.start).toBe(0);
    expect(w.end).toBeGreaterThanOrEqual(10);
  });
  it("handles few rows and nonsense input", () => {
    expect(visibleWindow({ total: 3, scrollTop: 0, viewport: 600 })).toEqual({ start: 0, end: 3, padTop: 0, padBottom: 0 });
    expect(visibleWindow({ total: 0, scrollTop: -50, viewport: 0 })).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });
});
