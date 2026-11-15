import { describe, expect, it } from "vitest";
import { AgentSchema, PermissionSettingsSchema } from "@vigil/shared";
import { agentToForm, describeGrants, formToAgent, riskyCombination } from "./agent-form";

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
