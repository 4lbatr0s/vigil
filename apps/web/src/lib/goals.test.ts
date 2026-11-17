import { describe, expect, it } from "vitest";
import type { Goal } from "./api";
import { daysLeftText, goalLine, nextGoal } from "./goals";

const g = (over: Partial<Goal> = {}): Goal => ({ kind: "note", value: "bio", day: "2026-12-01", daysLeft: 5, cards: 10, toStudy: 4, unseen: 2, onTrack: true, ...over });

describe("goals text", () => {
  it("words the days", () => {
    expect([-1, 0, 1, 9].map(daysLeftText)).toEqual(["has passed", "is today", "is tomorrow", "is in 9 days"]);
  });
  it("picks the soonest coming exam", () => {
    expect(nextGoal([g({ daysLeft: 9 }), g({ daysLeft: 2, value: "x" }), g({ daysLeft: -3, value: "old" })])?.value).toBe("x");
    expect(nextGoal([g({ daysLeft: -1 })])).toBeNull();
  });
  it("says what to do, never scolds", () => {
    expect(goalLine(g())).toBe("bio is in 5 days. 4 cards to go. You are on pace.");
    expect(goalLine(g({ onTrack: false, kind: "tag", value: "chem" }))).toContain("do a few more new cards");
    expect(goalLine(g({ cards: 0 }))).toContain("no cards yet");
    expect(goalLine(g({ daysLeft: -2 }))).toContain("has passed");
  });
});
