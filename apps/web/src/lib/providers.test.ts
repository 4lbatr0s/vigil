import { describe, expect, it } from "vitest";
import { PRESETS, missingForTest, presetById, suggestName } from "./providers";

describe("providers", () => {
  it("covers local servers, the big hosted ones and a custom endpoint, each with an address except custom", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["ollama", "lmstudio", "openai", "anthropic", "deepseek", "openrouter", "groq", "custom"]);
    for (const p of PRESETS) expect(p.id === "custom" || /^https?:\/\//.test(p.baseUrl)).toBe(true);
    expect(presetById("anthropic")?.kind).toBe("anthropic");
    expect(presetById("deepseek")?.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(presetById("ollama")?.needsKey).toBe(false);
  });

  it("suggests a short unique name", () => {
    const ollama = presetById("ollama")!;
    expect(suggestName(ollama, [])).toBe("Ollama");
    expect(suggestName(ollama, ["ollama"])).toBe("Ollama 2");
    expect(suggestName(ollama, ["Ollama", "Ollama 2"])).toBe("Ollama 3");
  });

  it("says what is missing before a test", () => {
    const openai = presetById("openai");
    expect(missingForTest(openai, "", "k", false)).toMatch(/address/);
    expect(missingForTest(openai, "https://x", "", false)).toMatch(/key/);
    expect(missingForTest(openai, "https://x", "", true)).toBeNull();
    expect(missingForTest(presetById("ollama"), "http://127.0.0.1:11434", "", false)).toBeNull();
  });
});
