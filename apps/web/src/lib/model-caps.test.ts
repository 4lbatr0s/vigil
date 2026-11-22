import { describe, expect, it } from "vitest";
import { capabilityWarnings, type ModelCaps } from "./model-caps";

const caps = (over: Partial<ModelCaps>): ModelCaps => ({ known: true, tools: true, vision: true, contextTokens: 32768, ...over });

describe("capabilityWarnings", () => {
  it("says nothing when the model is fine or nothing is known", () => {
    expect(capabilityWarnings({ tools: true, pictures: true }, caps({}))).toEqual([]);
    expect(capabilityWarnings({ tools: true, pictures: true }, caps({ known: false, tools: null, vision: null, contextTokens: null }))).toEqual([]);
    expect(capabilityWarnings({ tools: true, pictures: true }, null)).toEqual([]);
  });

  it("warns when an agent with tools has a model that cannot call them", () => {
    expect(capabilityWarnings({ tools: true, pictures: false }, caps({ tools: false }))).toHaveLength(1);
    expect(capabilityWarnings({ tools: false, pictures: false }, caps({ tools: false }))).toEqual([]);
  });

  it("warns about pictures only when pictures are in use", () => {
    expect(capabilityWarnings({ tools: false, pictures: true }, caps({ vision: false }))[0]).toContain("pictures");
    expect(capabilityWarnings({ tools: false, pictures: false }, caps({ vision: false }))).toEqual([]);
  });

  it("warns about a very small context window", () => {
    expect(capabilityWarnings({ tools: false, pictures: false }, caps({ contextTokens: 4096 }))[0]).toContain("4,096");
  });
});
