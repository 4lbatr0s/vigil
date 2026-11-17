import { describe, expect, it } from "vitest";
import { alignBoxes, distributeBoxes, matchedSize, snapToObjects, type Box } from "./canvas-guides";

const box = (id: string, x: number, y: number, width = 100, height = 50): Box => ({ id, x, y, width, height });
const boxes = [box("a", 0, 0), box("b", 300, 40, 60, 80), box("c", 120, 200, 200, 30)];

describe("alignBoxes", () => {
  it("lines up left, right and centre edges of the whole selection", () => {
    expect(alignBoxes(boxes, "left").get("c")).toEqual({ x: 0, y: 200 });
    expect(alignBoxes(boxes, "right").get("a")).toEqual({ x: 260, y: 0 });
    expect(alignBoxes(boxes, "center").get("b")).toEqual({ x: 150, y: 40 });
  });

  it("lines up top, bottom and middle", () => {
    expect(alignBoxes(boxes, "top").get("c")).toEqual({ x: 120, y: 0 });
    expect(alignBoxes(boxes, "bottom").get("a")).toEqual({ x: 0, y: 180 });
    expect(alignBoxes(boxes, "middle").get("a")?.y).toBe(90);
  });

  it("does nothing for fewer than two cards", () => {
    expect(alignBoxes([box("a", 0, 0)], "left").size).toBe(0);
  });
});

describe("distributeBoxes", () => {
  it("makes the gaps equal and leaves the first and last in place", () => {
    const row = [box("a", 0, 0), box("b", 110, 0), box("c", 500, 0)];
    const out = distributeBoxes(row, "horizontal");
    expect(out.get("a")?.x).toBe(0);
    expect(out.get("c")?.x).toBe(500);
    expect(out.get("b")?.x).toBe(250);
  });

  it("works top to bottom and in any order of input", () => {
    const col = [box("c", 0, 600), box("a", 0, 0), box("b", 0, 70)];
    const out = distributeBoxes(col, "vertical");
    expect(out.get("b")?.y).toBe(300);
  });

  it("needs three cards", () => {
    expect(distributeBoxes([box("a", 0, 0), box("b", 5, 5)], "horizontal").size).toBe(0);
  });
});

describe("matchedSize", () => {
  it("gives the biggest width or height", () => {
    expect(matchedSize(boxes, "width")).toBe(200);
    expect(matchedSize(boxes, "height")).toBe(80);
    expect(matchedSize([], "width")).toBe(0);
  });
});

describe("snapToObjects", () => {
  const other = [{ x: 200, y: 100, width: 100, height: 60 }];

  it("snaps an edge to a near edge and gives the guide line", () => {
    const s = snapToObjects({ x: 205, y: 400, width: 80, height: 40 }, other, 8);
    expect(s.dx).toBe(-5);
    expect(s.vertical).toBe(200);
    expect(s.dy).toBe(0);
    expect(s.horizontal).toBeNull();
  });

  it("snaps centre to centre on both axes", () => {
    const s = snapToObjects({ x: 253, y: 128, width: 0, height: 0 }, other, 8);
    expect(s.dx).toBe(-3);
    expect(s.dy).toBe(2);
    expect(s.vertical).toBe(250);
    expect(s.horizontal).toBe(130);
  });

  it("does not snap when farther than the threshold", () => {
    const s = snapToObjects({ x: 500, y: 500, width: 50, height: 50 }, other, 8);
    expect(s).toEqual({ dx: 0, dy: 0, vertical: null, horizontal: null });
  });

  it("takes the closest match when two are in range", () => {
    const two = [...other, { x: 207, y: 0, width: 10, height: 10 }];
    expect(snapToObjects({ x: 205, y: 400, width: 5, height: 5 }, two, 8).vertical).toBe(207);
  });
});
