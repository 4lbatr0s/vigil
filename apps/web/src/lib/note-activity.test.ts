import { describe, expect, it } from "vitest";
import type { Run } from "@vigil/shared";
import { askMessage, stashDraft, takeDraft } from "./chat-draft";
import { runsForNote, undoableRun } from "./note-activity";

const run = (id: string, over: Partial<Run> = {}): Run => ({ id, agent: "digest", status: "succeeded", startedAt: "2026-11-16T07:00:00Z", finishedAt: null, tokensUsed: 0, tokenBudget: 1, error: null, trigger: "manual", parentRunId: null, touched: ["a"], undone: false, ...over }) as Run;

describe("note activity", () => {
  it("lists the runs that touched a note, newest first", () => {
    const runs = [run("1", { startedAt: "2026-11-14T07:00:00Z" }), run("2", { touched: ["b"] }), run("3", { startedAt: "2026-11-16T07:00:00Z" })];
    expect(runsForNote(runs, "a").map((r) => r.id)).toEqual(["3", "1"]);
  });
  it("picks the newest undoable run of the writing agent only", () => {
    const runs = [run("old", { startedAt: "2026-11-10T07:00:00Z" }), run("undone", { startedAt: "2026-11-16T09:00:00Z", undone: true }), run("other", { agent: "inbox", startedAt: "2026-11-16T10:00:00Z" }), run("live", { status: "running", startedAt: "2026-11-16T11:00:00Z" })];
    expect(undoableRun(runs, "a", "digest")?.id).toBe("old");
    expect(undoableRun(runs, "a", undefined)).toBeNull();
    expect(undoableRun(runs, "zzz", "digest")).toBeNull();
  });
});

describe("ask an agent", () => {
  it("builds a message with the note, the quoted selection and the instruction", () => {
    expect(askMessage({ noteId: "budget", title: "Budget", selection: "line one\nline two", instruction: " Summarise this. " })).toBe(
      'About my note "Budget" (id: budget).\n\nThe part I mean:\n> line one\n> line two\n\nSummarise this.',
    );
    expect(askMessage({ noteId: "budget", title: "Budget", selection: "  ", instruction: "Tidy it" })).toBe('About my note "Budget" (id: budget).\n\nTidy it');
  });
  it("caps a huge selection", () => {
    const msg = askMessage({ noteId: "a", title: "A", selection: "x".repeat(9000), instruction: "q" });
    expect(msg.length).toBeLessThan(4200);
    expect(msg).toContain("…");
  });
  it("hands a draft over once", () => {
    stashDraft("t1", "hello");
    expect(takeDraft("t1")).toBe("hello");
    expect(takeDraft("t1")).toBeNull();
    expect(takeDraft("never")).toBeNull();
  });
});
