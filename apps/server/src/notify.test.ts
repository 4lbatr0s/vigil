import { describe, expect, it, vi } from "vitest";
import type { Run } from "@vigil/shared";
import { notifyEvent, notifyRun, webhookUrl } from "./notify";

const run = (over: Partial<Run> = {}): Run => ({
  id: "r1", agent: "digest", status: "succeeded", trigger: "cron", parentRunId: null,
  startedAt: "2026-11-24T07:00:00Z", finishedAt: "2026-11-24T07:01:00Z", tokensUsed: 120, tokenBudget: 1000,
  error: null, touched: ["digest"], undone: false, ...over,
});

describe("notifyEvent", () => {
  it("speaks for approvals, failures and finished scheduled runs only", () => {
    expect(notifyEvent(run({ status: "waiting-approval", trigger: "chat" }))).toBe("approval");
    expect(notifyEvent(run({ status: "failed", error: "boom", trigger: "manual" }))).toBe("failed");
    expect(notifyEvent(run({ status: "budget-exceeded" }))).toBe("failed");
    expect(notifyEvent(run({ trigger: "heartbeat" }))).toBe("finished");
    expect(notifyEvent(run({ trigger: "manual" }))).toBeNull();
    expect(notifyEvent(run({ trigger: "chat" }))).toBeNull();
    expect(notifyEvent(run({ status: "failed", error: "cancelled" }))).toBeNull();
    expect(notifyEvent(run({ status: "failed", error: "x", parentRunId: "p" }))).toBeNull();
  });
});

describe("webhookUrl", () => {
  it("accepts only http and https addresses", () => {
    expect(webhookUrl({ VIGIL_WEBHOOK_URL: "https://ntfy.example/topic" })?.hostname).toBe("ntfy.example");
    for (const bad of [undefined, "", "  ", "not a url", "file:///etc/passwd", "ftp://x"]) expect(webhookUrl({ VIGIL_WEBHOOK_URL: bad })).toBeNull();
  });
});

describe("notifyRun", () => {
  it("posts one JSON body with the run facts and no note text", async () => {
    const send = vi.fn(async () => ({ ok: true }) as Response);
    const sent = await notifyRun(run({ status: "failed", error: "token budget of 1000 used up" }), { VIGIL_WEBHOOK_URL: "https://h.example/x" }, send as unknown as typeof fetch);
    expect(sent).toBe(true);
    const [url, init] = send.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("https://h.example/x");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as { event: string; text: string; run: Record<string, unknown> };
    expect(body.event).toBe("failed");
    expect(body.text).toBe("Vigil: agent digest did not finish: token budget of 1000 used up");
    expect(Object.keys(body.run).sort()).toEqual(["agent", "error", "id", "status", "tokensUsed", "trigger"]);
  });

  it("does nothing without a webhook or without an event, and never throws", async () => {
    const send = vi.fn(async () => ({ ok: true }) as Response);
    expect(await notifyRun(run(), {}, send as unknown as typeof fetch)).toBe(false);
    expect(await notifyRun(run({ trigger: "manual" }), { VIGIL_WEBHOOK_URL: "https://h.example/x" }, send as unknown as typeof fetch)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    const boom = vi.fn(async () => { throw new Error("connect refused"); });
    expect(await notifyRun(run(), { VIGIL_WEBHOOK_URL: "https://h.example/x" }, boom as unknown as typeof fetch)).toBe(false);
  });
});
