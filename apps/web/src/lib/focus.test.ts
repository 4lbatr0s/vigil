import { describe, expect, it } from "vitest";
import type { Goal, RecallItem, StuckCard } from "./api";
import { startHere } from "./focus";

const goal = (over: Partial<Goal>): Goal => ({ kind: "note", value: "bio", day: "2026-11-20", daysLeft: 3, cards: 10, toStudy: 4, unseen: 2, onTrack: true, ...over });
const recall = (noteId: string): RecallItem => ({ noteId, step: 0, due: "2026-11-17T00:00:00.000Z", lastResult: null, isDue: true }) as RecallItem;
const stuck: StuckCard = { id: "c", noteId: "bio", front: "Q?", lapses: 4 };
const base = { goals: [], recallDue: [], studyDue: 0, newOffered: 0, stuck: [], pendingApprovals: 0, titles: new Map([["bio", "Biology"]]) };

describe("startHere", () => {
  it("is empty when there is nothing to do", () => {
    expect(startHere(base)).toEqual([]);
  });

  it("puts a near exam first and does not repeat the plain card line", () => {
    const f = startHere({ ...base, goals: [goal({})], studyDue: 5, recallDue: [recall("bio")] });
    expect(f.map((x) => x.key)).toEqual(["exam", "recall"]);
    expect(f[0]?.text).toBe("Biology is in 3 days and 4 cards are still to study.");
    expect(f[0]?.href).toBe("/study?note=bio");
  });

  it("ignores an exam that is far away, passed or has nothing left", () => {
    expect(startHere({ ...base, goals: [goal({ daysLeft: 20 }), goal({ daysLeft: -1 }), goal({ toStudy: 0 })] })).toEqual([]);
  });

  it("orders approvals, recall, cards, slipping and keeps three", () => {
    const f = startHere({ ...base, pendingApprovals: 2, recallDue: [recall("bio"), recall("x")], studyDue: 3, newOffered: 2, stuck: [stuck] });
    expect(f.map((x) => x.key)).toEqual(["approvals", "recall", "cards"]);
    expect(f[1]?.text).toBe("A recall check is due: Biology and 1 more.");
    expect(f[2]?.text).toBe("5 cards are ready to review.");
  });

  it("speaks of one thing in the singular", () => {
    const f = startHere({ ...base, stuck: [stuck], pendingApprovals: 1 });
    expect(f.map((x) => x.text)).toEqual(["1 change is waiting for your yes.", "1 card keeps slipping: reword or split it."]);
  });

  it("suggests making cards for a note written lately, after the more pressing things", () => {
    const quiet = { goals: [], recallDue: [], studyDue: 0, newOffered: 0, stuck: [], pendingApprovals: 0, titles: new Map() };
    const r = startHere({ ...quiet, uncarded: [{ id: "cells", title: "Cells" }] });
    expect(r).toEqual([{ key: "uncarded", text: 'You wrote "Cells" recently and it has no study cards yet.', href: "/notes?note=cells", label: "Make cards" }]);
    expect(startHere({ ...quiet, pendingApprovals: 2, uncarded: [{ id: "cells", title: "Cells" }] }).map((f) => f.key)).toEqual(["approvals", "uncarded"]);
  });
});
