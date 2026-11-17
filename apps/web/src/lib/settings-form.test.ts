import { describe, expect, it } from "vitest";
import { PermissionSettingsSchema } from "@vigil/shared";
import { bannerFor, fieldOfError, formToSettings, messageOfError, settingsToForm } from "./settings-form";

const llm = (over: Partial<Parameters<typeof bannerFor>[0] & object> = {}) => ({ provider: "openai", baseUrl: "u", model: "m", hasKey: true, reachable: null, connection: { id: "a", name: "A" }, ...over });
const usage = (level: "ok" | "warn" | "over") => ({ month: "2026-11", tokens: 90, cap: 100, level });

describe("settings form", () => {
  it("round-trips", () => {
    const s = PermissionSettingsSchema.parse({ tools: { web_fetch: false }, maxTokenBudget: 1234, retentionDays: 0 });
    expect(formToSettings(settingsToForm(s))).toEqual(s);
  });
  it("turns blank or bad numbers into NaN so the server answers", () => {
    const f = { ...settingsToForm(PermissionSettingsSchema.parse({})), maxTokenBudget: "", retentionDays: "abc" };
    const out = formToSettings(f);
    expect(Number.isNaN(out.maxTokenBudget)).toBe(true);
    expect(Number.isNaN(out.retentionDays)).toBe(true);
  });
  it("finds the field and message of a server error", () => {
    const d = "Invalid settings: retentionDays: 0 (keep forever) or at least 7 days";
    expect(fieldOfError(d)).toBe("retentionDays");
    expect(messageOfError(d)).toBe("0 (keep forever) or at least 7 days");
    expect(fieldOfError("Invalid settings: bad shape")).toBeNull();
    expect(messageOfError("Invalid settings: bad shape")).toBe("bad shape");
  });
});

describe("bannerFor", () => {
  it("is quiet when all is well", () => {
    expect(bannerFor(llm(), usage("ok"))).toBeNull();
    expect(bannerFor(null, null)).toBeNull();
  });
  it("warns when no model or no key (openai)", () => {
    expect(bannerFor(llm({ model: null }), null)?.href).toBe("/settings#models");
    expect(bannerFor(llm({ hasKey: false }), null)?.text).toMatch(/No AI model/);
    expect(bannerFor(llm({ provider: "ollama", hasKey: false }), null)).toBeNull();
  });
  it("warns when nothing is connected, and needs no key for a server on this machine or network", () => {
    expect(bannerFor(llm({ connection: null }), null)?.text).toMatch(/No AI model/);
    expect(bannerFor(llm({ provider: "openai", baseUrl: "http://127.0.0.1:1234/v1", hasKey: false }), null)).toBeNull();
    expect(bannerFor(llm({ provider: "openai", baseUrl: "http://192.168.1.20:8000/v1", hasKey: false }), null)).toBeNull();
    expect(bannerFor(llm({ provider: "openai", baseUrl: "https://api.openai.com/v1", hasKey: false }), null)?.text).toMatch(/No AI model/);
  });
  it("shows usage warnings, model trouble first", () => {
    expect(bannerFor(llm(), usage("warn"))?.text).toMatch(/80%/);
    expect(bannerFor(llm(), usage("over"))?.text).toMatch(/Agents still run/);
    expect(bannerFor(llm({ model: null }), usage("over"))?.text).toMatch(/No AI model/);
  });
});
