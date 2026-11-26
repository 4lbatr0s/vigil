import { describe, expect, it } from "vitest";
import type { Run } from "@vigil/shared";
import { DEFAULT_APPEARANCE, applyAppearance, parseAppearance } from "./appearance";
import { dateLine, firstSteps, inboxItems, sinceVisit } from "./today";

const run = (id: string, startedAt: string, over: Partial<Run> = {}): Run => ({ id, agent: "digest", status: "succeeded", startedAt, finishedAt: null, tokensUsed: 0, tokenBudget: 1, error: null, trigger: "cron", parentRunId: null, touched: [], undone: false, ...over }) as Run;

describe("sinceVisit", () => {
  const now = new Date("2026-11-17T10:00:00Z");
  it("keeps runs after the last visit, newest first, and leaves out chat turns", () => {
    const runs = [run("a", "2026-11-17T07:00:00Z"), run("b", "2026-11-16T07:00:00Z"), run("c", "2026-11-17T08:00:00Z", { trigger: "chat" }), run("d", "2026-11-17T09:00:00Z", { status: "running" })];
    expect(sinceVisit(runs, "2026-11-17T00:00:00Z", now).map((r) => r.id)).toEqual(["d", "a"]);
  });
  it("shows the last 24 hours when there was no visit yet", () => {
    const runs = [run("recent", "2026-11-16T12:00:00Z"), run("old", "2026-11-15T12:00:00Z")];
    expect(sinceVisit(runs, null, now).map((r) => r.id)).toEqual(["recent"]);
  });
});

describe("appearance", () => {
  it("keeps valid choices and falls back for anything else", () => {
    expect(parseAppearance(JSON.stringify({ theme: "dark", size: "large" }))).toEqual({ theme: "dark", size: "large" });
    expect(parseAppearance(JSON.stringify({ theme: "pink", size: 3 }))).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("not json")).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });
  it("sets and clears the theme attribute and the prose size", () => {
    const root = document.createElement("html");
    applyAppearance({ theme: "light", size: "large" }, root);
    expect(root.getAttribute("data-theme")).toBe("light");
    expect(root.style.getPropertyValue("--text-prose")).toBe("19px");
    applyAppearance({ theme: "system", size: "medium" }, root);
    expect(root.hasAttribute("data-theme")).toBe(false);
    expect(root.style.getPropertyValue("--text-prose")).toBe("");
  });
});

describe("Today page helpers", () => {
  it("counts the items waiting in the Inbox note: each non-empty line once, list markers or not", () => {
    expect(inboxItems("")).toBe(0);
    expect(inboxItems("- Look up Born-Haber\n\n- [ ] Lab deadline\nA loose thought\n   \n")).toBe(3);
    expect(inboxItems("---\ntags: [inbox]\n---\n- one\n")).toBe(1);
  });

  it("names the day in plain words", () => {
    expect(dateLine(new Date(2026, 10, 26))).toBe("Thursday, 26 November");
  });
});

describe("first steps on an empty vault", () => {
  const none = { notes: [], cards: 0, linked: false };
  it("lists three steps in order, none done, for a new vault", () => {
    expect(firstSteps(none).map((s) => [s.key, s.done])).toEqual([
      ["write", false],
      ["card", false],
      ["link", false],
    ]);
  });
  it("the Inbox note alone does not count as a first note; any other note does", () => {
    expect(firstSteps({ ...none, notes: [{ id: "inbox" }] })[0]?.done).toBe(false);
    expect(firstSteps({ ...none, notes: [{ id: "inbox" }, { id: "cells" }] })[0]?.done).toBe(true);
  });
  it("ticks the card and link steps from the counts", () => {
    const steps = firstSteps({ notes: [{ id: "cells" }], cards: 2, linked: true });
    expect(steps.every((s) => s.done)).toBe(true);
  });
});
