import { describe, expect, it } from "vitest";
import type { Run } from "@vigil/shared";
import { DEFAULT_APPEARANCE, applyAppearance, parseAppearance } from "./appearance";
import { sinceVisit } from "./today";

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
