import { describe, expect, it } from "vitest";
import { monthGrid, shiftMonth } from "./calendar";
import { parseDay } from "./daily";

describe("monthGrid", () => {
  it("fills whole weeks, Monday first", () => {
    const weeks = monthGrid(2026, 10); // November 2026 starts on a Sunday
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]![0]!.day).toBe("2026-10-26");
    expect(weeks[0]![6]!.day).toBe("2026-11-01");
    expect(weeks[0]![6]!.inMonth).toBe(true);
    expect(weeks[0]![0]!.inMonth).toBe(false);
    expect(weeks.at(-1)!.at(-1)!.day).toBe("2026-12-06");
  });
  it("supports Sunday first", () => {
    expect(monthGrid(2026, 10, 0)[0]![0]!.day).toBe("2026-11-01");
  });
  it("uses four rows when February fits exactly", () => {
    expect(monthGrid(2027, 1)).toHaveLength(4); // 1 Feb 2027 is a Monday, 28 days
  });
  it("counts every day of the month once", () => {
    const inMonth = monthGrid(2028, 1).flat().filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(29);
  });
});

describe("shiftMonth", () => {
  it("wraps the year both ways", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
});

describe("parseDay", () => {
  it("accepts real days only", () => {
    expect(parseDay("2026-11-17")?.getDate()).toBe(17);
    expect(parseDay("2026-02-30")).toBeNull();
    expect(parseDay("1")).toBeNull();
    expect(parseDay("2026-1-5")).toBeNull();
  });
});
