import { describe, expect, it } from "vitest";
import { AgentSchema, PermissionSettingsSchema, type Agent } from "@vigil/shared";
import { addHost, agentToForm, describeGrants, exposure, formToAgent, noHostsWarning, riskyCombination } from "./agent-form";

const base = AgentSchema.parse({
  name: "digest",
  systemPrompt: "Write a digest.",
  tools: ["read_notes", "write_notes", "web_fetch"],
  trigger: { kind: "cron", expression: "0 7 * * *", timezone: "UTC" },
  allowedHosts: ["example.com"],
  callable: ["helper"],
  defaultTask: "Go.",
});

describe("agent form", () => {
  it("round-trips: an unedited form gives back the same agent", () => {
    expect(formToAgent(base, agentToForm(base))).toEqual(base);
  });

  it("applies edits and keeps every field the form does not know", () => {
    const form = { ...agentToForm(base), systemPrompt: "New.", tokenBudget: "5000", strict: true, enabled: false, model: " gpt-x " };
    const out = formToAgent(base, form);
    expect(out).toMatchObject({ systemPrompt: "New.", tokenBudget: 5000, strict: true, enabled: false, model: "gpt-x" });
    expect(out.trigger).toEqual(base.trigger);
    expect(out.tools).toEqual(base.tools);
    expect(out.allowedHosts).toEqual(["example.com"]);
    expect(out.callable).toEqual(["helper"]);
    expect(out.defaultTask).toBe("Go.");
  });

  it("leaves an empty model out instead of sending an empty string", () => {
    const withModel = { ...base, model: "m" };
    const out = formToAgent(withModel, { ...agentToForm(withModel), model: "" });
    expect("model" in out).toBe(false);
  });

  it("never sends undefined for known fields; a bad budget becomes NaN so the server rejects it", () => {
    const out = formToAgent(base, { ...agentToForm(base), tokenBudget: "" });
    expect(Number.isNaN(out.tokenBudget)).toBe(true);
    for (const [key, value] of Object.entries(formToAgent(base, agentToForm(base)))) expect(value, key).not.toBeUndefined();
  });
});

describe("describeGrants and riskyCombination", () => {
  it("writes plain lines and marks tools an instance switch turned off", () => {
    const settings = PermissionSettingsSchema.parse({ tools: { web_fetch: false } });
    const lines = describeGrants(base, settings);
    expect(lines.map((l) => [l.tool, l.blocked])).toEqual([["read_notes", false], ["write_notes", false], ["web_fetch", true]]);
    expect(lines[0]?.text).toBe("Can read your notes.");
    expect(lines[2]?.text).toContain("example.com");
  });

  it("says plainly when the web allowlist is empty", () => {
    const empty = AgentSchema.parse({ name: "a", systemPrompt: "x", tools: ["web_fetch"] });
    expect(describeGrants(empty, PermissionSettingsSchema.parse({}))[0]?.text).toContain("no sites are allowed yet");
  });

  it("flags read + fetch without approvals", () => {
    expect(riskyCombination({ tools: ["read_notes", "web_fetch"], strict: false })).toBe(true);
    expect(riskyCombination({ tools: ["read_notes", "web_fetch"], strict: true })).toBe(false);
    expect(riskyCombination({ tools: ["read_notes"], strict: false })).toBe(false);
  });
});

describe("exposure", () => {
  const agent = (tools: Agent["tools"], allowedHosts: string[]) => AgentSchema.parse({ name: "a", systemPrompt: "x", tools, allowedHosts });

  it("lights all three when notes, the web and a site are present", () => {
    const e = exposure(agent(["read_notes", "web_fetch"], ["example.com"]));
    expect(e.all).toBe(true);
    expect(e.lines.map((l) => l.on)).toEqual([true, true, true]);
  });

  it("breaks the chain when any leg is off", () => {
    expect(exposure(agent(["read_notes"], [])).all).toBe(false);
    expect(exposure(agent(["web_fetch"], ["example.com"])).lines[0]?.on).toBe(false);
    expect(exposure(agent(["read_notes", "web_fetch"], [])).all).toBe(false);
  });
});

describe("allowed hosts", () => {
  it("adds normalized hosts and refuses bad input and duplicates", () => {
    expect(addHost(["a.com"], " B.Com ")).toEqual({ ok: true, hosts: ["a.com", "b.com"] });
    expect(addHost([], "https://x.com")).toEqual({ ok: false, message: "Enter a host like example.com, without https:// or a path." });
    expect(addHost(["a.com"], "A.com")).toEqual({ ok: false, message: "a.com is already on the list." });
  });
  it("warns when the web tool has no hosts, and only then", () => {
    expect(noHostsWarning({ tools: ["web_fetch"] }, [])).toBe("This agent can't reach any site until you add a host.");
    expect(noHostsWarning({ tools: ["web_fetch"] }, ["a.com"])).toBeNull();
    expect(noHostsWarning({ tools: ["read_notes"] }, [])).toBeNull();
  });
  it("the form carries the list through a round trip and edits", () => {
    const withHosts = AgentSchema.parse({ name: "s", systemPrompt: "x", tools: ["web_fetch"], allowedHosts: ["example.com"] });
    const form = agentToForm(withHosts);
    expect(formToAgent(withHosts, form)).toEqual(withHosts);
    expect(formToAgent(withHosts, { ...form, allowedHosts: ["example.com", "docs.example.com"] }).allowedHosts).toEqual(["example.com", "docs.example.com"]);
  });
});

import { DEFAULT_TRIGGER_FORM, formToTrigger, triggerToForm } from "./agent-form";

describe("schedule choices", () => {
  it("reads a trigger into plain choices", () => {
    expect(triggerToForm({ kind: "manual" }).kind).toBe("manual");
    expect(triggerToForm({ kind: "heartbeat", everyMinutes: 30 })).toMatchObject({ kind: "changes", minutes: "30" });
    expect(triggerToForm({ kind: "cron", expression: "0 7 * * *" })).toMatchObject({ kind: "daily", time: "07:00" });
    expect(triggerToForm({ kind: "cron", expression: "30 18 * * 5" })).toMatchObject({ kind: "weekly", time: "18:30", day: 5 });
    expect(triggerToForm({ kind: "cron", expression: "30 18 * * 7" })).toMatchObject({ kind: "weekly", day: 0 });
    expect(triggerToForm({ kind: "cron", expression: "*/15 * * * *" })).toMatchObject({ kind: "custom", expression: "*/15 * * * *" });
    expect(triggerToForm({ kind: "cron", expression: "0 25 * * *" }).kind).toBe("custom");
  });

  it("turns choices back into a trigger, keeping the time zone", () => {
    expect(formToTrigger({ ...DEFAULT_TRIGGER_FORM, kind: "daily", time: "07:05" }, "Europe/Istanbul")).toEqual({ ok: true, trigger: { kind: "cron", expression: "5 7 * * *", timezone: "Europe/Istanbul" } });
    expect(formToTrigger({ ...DEFAULT_TRIGGER_FORM, kind: "weekly", time: "18:00", day: 0 })).toEqual({ ok: true, trigger: { kind: "cron", expression: "0 18 * * 0" } });
    expect(formToTrigger({ ...DEFAULT_TRIGGER_FORM, kind: "changes", minutes: "60" })).toEqual({ ok: true, trigger: { kind: "heartbeat", everyMinutes: 60 } });
    expect(formToTrigger(DEFAULT_TRIGGER_FORM)).toEqual({ ok: true, trigger: { kind: "manual" } });
    expect(formToTrigger({ ...DEFAULT_TRIGGER_FORM, kind: "custom", expression: " */15 * * * * " })).toEqual({ ok: true, trigger: { kind: "cron", expression: "*/15 * * * *" } });
  });

  it("says what is wrong", () => {
    expect(formToTrigger({ ...DEFAULT_TRIGGER_FORM, kind: "daily", time: "7" })).toMatchObject({ ok: false, message: expect.stringContaining("time") });
    expect(formToTrigger({ ...DEFAULT_TRIGGER_FORM, kind: "daily", time: "24:00" }).ok).toBe(false);
    expect(formToTrigger({ ...DEFAULT_TRIGGER_FORM, kind: "changes", minutes: "2" }).ok).toBe(false);
    expect(formToTrigger({ ...DEFAULT_TRIGGER_FORM, kind: "custom", expression: "0 7" }).ok).toBe(false);
  });
});
