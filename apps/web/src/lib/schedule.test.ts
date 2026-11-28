import { describe, expect, it } from "vitest";
import { describeTrigger, describeTriggerSentence, lastRunByAgent, statusDot } from "./schedule";
import { agoText, describeCheck, formatStamp } from "./format";
import type { Run } from "@vigil/shared";

const cron = (expression: string) => ({ kind: "cron" as const, expression });
const run = (agent: string, status: Run["status"]): Run => ({
  id: agent + status, agent, status, trigger: "manual", parentRunId: null, startedAt: "2026-11-15T07:00:00Z",
  finishedAt: null, tokensUsed: 0, tokenBudget: 1, error: null, touched: [], undone: false,
});

describe("describeTrigger", () => {
  it("reads common schedules in words", () => {
    expect(describeTrigger({ kind: "manual" })).toBe("when you start it");
    expect(describeTrigger(cron("0 7 * * *"))).toBe("daily 07:00");
    expect(describeTrigger(cron("0 18 * * 5"))).toBe("Fridays 18:00");
    expect(describeTrigger(cron("0 9 * * 7"))).toBe("Sundays 09:00");
    expect(describeTrigger(cron("* * * * *"))).toBe("every minute");
    expect(describeTrigger(cron("*/15 * * * *"))).toBe("every 15 min");
    expect(describeTrigger({ kind: "heartbeat", everyMinutes: 30 })).toBe("every 30 min if notes changed");
  });
  it("falls back to the raw expression", () => {
    expect(describeTrigger(cron("0 7 1 * *"))).toBe("0 7 1 * *");
    expect(describeTrigger(cron("0 7-9 * * *"))).toBe("0 7-9 * * *");
    expect(describeTrigger(cron("bad"))).toBe("bad");
  });
  it("makes sentences", () => {
    expect(describeTriggerSentence(cron("0 7 * * *"))).toBe("Runs daily at 07:00.");
    expect(describeTriggerSentence(cron("0 18 * * 5"))).toBe("Runs on Fridays at 18:00.");
    expect(describeTriggerSentence({ kind: "manual" })).toBe("Runs only when you start it.");
  });
});

describe("statusDot and lastRunByAgent", () => {
  it("picks the dot", () => {
    expect(statusDot({ enabled: true }, undefined)).toBe("idle");
    expect(statusDot({ enabled: true }, run("a", "running"))).toBe("running");
    expect(statusDot({ enabled: false }, run("a", "running"))).toBe("running");
    expect(statusDot({ enabled: true }, run("a", "succeeded"))).toBe("ok");
    expect(statusDot({ enabled: false }, run("a", "succeeded"))).toBe("idle");
    for (const s of ["failed", "budget-exceeded", "step-limit"] as const) expect(statusDot({ enabled: true }, run("a", s))).toBe("err");
    expect(statusDot({ enabled: true }, run("a", "interrupted"))).toBe("idle");
  });
  it("keeps the newest run per agent", () => {
    const m = lastRunByAgent([run("a", "failed"), run("b", "succeeded"), run("a", "succeeded")]);
    expect(m.get("a")?.status).toBe("failed");
    expect(m.get("b")?.status).toBe("succeeded");
  });
});

describe("formatStamp", () => {
  it("is short, and says never for nothing", () => {
    expect(formatStamp(null)).toBe("never");
    expect(formatStamp("garbage")).toBe("never");
    const now = new Date("2026-11-15T12:00:00");
    expect(formatStamp("2026-11-15T07:05:00", now)).toBe("15 Nov 07:05");
    expect(formatStamp("2025-01-02T07:05:00", now)).toBe("2 Jan 2025 07:05");
  });
});

describe("agoText and describeCheck", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  it("reads relative times", () => {
    expect(agoText(null, now)).toBe("never");
    expect(agoText("2026-11-15T11:59:40Z", now)).toBe("just now");
    expect(agoText("2026-11-15T11:56:00Z", now)).toBe("4 min ago");
    expect(agoText("2026-11-15T09:00:00Z", now)).toBe("3 h ago");
    expect(agoText("2026-11-12T12:00:00Z", now)).toBe("3 days ago");
  });
  it("describes a heartbeat check", () => {
    expect(describeCheck("2026-11-15T11:56:00Z", "unchanged", now)).toBe("Checked 4 min ago, unchanged");
    expect(describeCheck("2026-11-15T11:56:00Z", null, now)).toBe("Checked 4 min ago");
    expect(describeCheck(null, null, now)).toBe("Not checked yet");
  });
});
