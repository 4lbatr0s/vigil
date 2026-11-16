import { describe, expect, it } from "vitest";
import { ANSWERS, isDue, newCardState, review, type CardState } from "./srs";

const T0 = new Date("2026-11-17T09:00:00Z");
const days = (n: number, from = T0): Date => new Date(from.getTime() + n * 86_400_000);

describe("srs", () => {
  it("a new card is due right away and has no history", () => {
    const s = newCardState(T0);
    expect(isDue(s, T0)).toBe(true);
    expect(s).toMatchObject({ reps: 0, lapses: 0, lastReview: null });
  });

  it("an answer moves the due date forward, never back, and never leaves it due now", () => {
    for (const a of ANSWERS) {
      const { next } = review(newCardState(T0), a, T0);
      expect(new Date(next.due).getTime(), a).toBeGreaterThan(T0.getTime());
      expect(isDue(next, T0), a).toBe(false);
      expect(next.reps).toBe(1);
    }
  });

  it("easier answers wait longer than harder ones", () => {
    const due = (a: (typeof ANSWERS)[number]): number => new Date(review(newCardState(T0), a, T0).next.due).getTime();
    expect(due("again")).toBeLessThanOrEqual(due("hard"));
    expect(due("hard")).toBeLessThanOrEqual(due("good"));
    expect(due("good")).toBeLessThan(due("easy"));
  });

  it("good answers on time stretch the gap: each wait is longer than the last", () => {
    let s: CardState = newCardState(T0);
    let now = T0;
    const gaps: number[] = [];
    for (let i = 0; i < 5; i++) {
      const out = review(s, "good", now);
      gaps.push(new Date(out.next.due).getTime() - now.getTime());
      s = out.next;
      now = new Date(s.due);
    }
    for (let i = 1; i < gaps.length; i++) expect(gaps[i] as number).toBeGreaterThan(gaps[i - 1] as number);
  });

  it("forgetting a learned card counts a lapse and brings it back sooner than the last wait", () => {
    let s = newCardState(T0);
    let now = T0;
    let lastWait = 0;
    for (let i = 0; i < 3; i++) {
      s = review(s, "good", now).next;
      lastWait = new Date(s.due).getTime() - now.getTime();
      now = new Date(s.due);
    }
    const lapsed = review(s, "again", now).next;
    expect(lapsed.lapses).toBe(s.lapses + 1);
    expect(new Date(lapsed.due).getTime() - now.getTime()).toBeLessThan(lastWait);
  });

  it("is deterministic for the same history, and the state survives a JSON round trip", () => {
    const run = (): CardState => review(review(newCardState(T0), "good", T0).next, "hard", days(3)).next;
    expect(run()).toEqual(run());
    const s = run();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    expect(review(JSON.parse(JSON.stringify(s)) as CardState, "good", days(9)).next.reps).toBe(s.reps + 1);
  });

  it("logs the rating and the days since the last review", () => {
    const first = review(newCardState(T0), "good", T0);
    expect(first.log).toEqual({ rating: 3, elapsedDays: 0 });
    const second = review(first.next, "easy", days(4));
    expect(second.log.rating).toBe(4);
    expect(second.log.elapsedDays).toBeCloseTo(4, 5);
  });
});
