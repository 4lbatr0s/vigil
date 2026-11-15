import { describe, expect, it } from "vitest";
import type { RunEvent } from "@vigil/shared";
import { budgetShare, canUndo, childRunIdOf, lastSeq, mergeEvents, noteIdOf, noteIdsInMessage, preview } from "./run-log";

const ev = (seq: number, kind: RunEvent["kind"] = "model", data: Record<string, unknown> = {}): RunEvent => ({ seq, at: "t", kind, text: `e${seq}`, data });

describe("run log helpers", () => {
  it("appends only unseen events, in order, and returns the same array when nothing is new", () => {
    const a = [ev(1), ev(2)];
    expect(mergeEvents(a, [ev(2), ev(3), ev(4)]).map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(mergeEvents(a, [ev(1), ev(2)])).toBe(a);
    expect(mergeEvents([], [ev(1)]).map((e) => e.seq)).toEqual([1]);
    expect(lastSeq(a)).toBe(2);
    expect(lastSeq([])).toBe(0);
  });

  it("allows undo only for a finished run that touched notes and is not undone", () => {
    expect(canUndo({ touched: ["a"], status: "succeeded", undone: false })).toBe(true);
    expect(canUndo({ touched: [], status: "succeeded", undone: false })).toBe(false);
    expect(canUndo({ touched: ["a"], status: "running", undone: false })).toBe(false);
    expect(canUndo({ touched: ["a"], status: "failed", undone: true })).toBe(false);
  });

  it("finds the note of a note event and the notes named in a conflict message", () => {
    expect(noteIdOf(ev(1, "note", { id: "digest" }))).toBe("digest");
    expect(noteIdOf(ev(1, "model", { id: "digest" }))).toBeNull();
    expect(noteIdOf(ev(1, "note"))).toBeNull();
    expect(noteIdsInMessage("Edited after the agent wrote it, so undo would lose your changes: a-1, b-2")).toEqual(["a-1", "b-2"]);
    expect(noteIdsInMessage("Changed while undoing: x. Run undo again to see what is left.")).toEqual([]);
    expect(noteIdsInMessage("no colon here")).toEqual([]);
  });

  it("finds the child run of a call_agent result", () => {
    expect(childRunIdOf(ev(1, "tool-result", { childRunId: "abc" }))).toBe("abc");
    expect(childRunIdOf(ev(1, "tool-call", { childRunId: "abc" }))).toBeNull();
    expect(childRunIdOf(ev(1, "tool-result", {}))).toBeNull();
  });

  it("computes the budget share and collapses long text", () => {
    expect(budgetShare({ tokensUsed: 50, tokenBudget: 200 })).toBe(0.25);
    expect(budgetShare({ tokensUsed: 500, tokenBudget: 200 })).toBe(1);
    expect(budgetShare({ tokensUsed: 5, tokenBudget: 0 })).toBe(0);
    expect(preview("short")).toEqual({ short: "short", long: false });
    expect(preview("line one\nline two")).toEqual({ short: "line one", long: true });
    expect(preview("x".repeat(300)).short).toHaveLength(161);
  });
});
