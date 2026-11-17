import { dailyNote } from "./daily";

export type CalendarCell = { day: string; date: number; inMonth: boolean };

/**
 * The weeks to draw for a month: full rows of 7 days, Monday first by default, with the days of the
 * neighbouring months that fill the first and last row (`inMonth` false). `month` is 0 to 11.
 */
export function monthGrid(year: number, month: number, weekStart: 0 | 1 = 1): CalendarCell[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((lead + days) / 7) * 7;
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(year, month, 1 - lead + i);
    const cell = { day: dailyNote(d).id, date: d.getDate(), inMonth: d.getMonth() === month };
    if (i % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1]!.push(cell);
  }
  return weeks;
}

/** The month `delta` months from the given one, wrapping the year. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
