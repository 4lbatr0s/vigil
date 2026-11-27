import { AgentSchema } from "@vigil/shared";
import { describe, expect, it } from "vitest";
import { configVersion } from "./harness-config";

const base = AgentSchema.parse({ name: "a", systemPrompt: "Do it.", tools: ["read_notes", "write_notes"] });

describe("configVersion", () => {
  it("is eight hex characters and the same for the same setup", () => {
    expect(configVersion(base)).toMatch(/^[0-9a-f]{8}$/);
    expect(configVersion({ ...base })).toBe(configVersion(base));
  });

  it("ignores the order of tools and the fields that do not change a run", () => {
    expect(configVersion({ ...base, tools: ["write_notes", "read_notes"] })).toBe(configVersion(base));
    expect(configVersion({ ...base, description: "other", defaultTask: "Go." })).toBe(configVersion(base));
  });

  it("changes when the prompt, a tool, the budget or strict mode changes", () => {
    const v = configVersion(base);
    expect(configVersion({ ...base, systemPrompt: "Do it better." })).not.toBe(v);
    expect(configVersion({ ...base, tools: ["read_notes"] })).not.toBe(v);
    expect(configVersion({ ...base, tokenBudget: base.tokenBudget + 1 })).not.toBe(v);
    expect(configVersion({ ...base, strict: !base.strict })).not.toBe(v);
  });
});
