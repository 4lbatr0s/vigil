export type ProviderKind = "openai" | "anthropic" | "ollama";

export type ProviderPreset = {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** One short line shown on the card. */
  blurb: string;
  needsKey: boolean;
  /** Where the person finds a key, in words (no link is opened for them). */
  keyHint: string;
};

/** The services most people use. Every one except "Custom" is a fixed address; the person can still edit it. */
export const PRESETS: readonly ProviderPreset[] = [
  { id: "ollama", label: "Ollama (on this computer)", kind: "ollama", baseUrl: "http://127.0.0.1:11434", blurb: "Run models locally. No key, nothing leaves your machine.", needsKey: false, keyHint: "" },
  { id: "lmstudio", label: "LM Studio / llama.cpp", kind: "openai", baseUrl: "http://127.0.0.1:1234/v1", blurb: "A local server that speaks the OpenAI API.", needsKey: false, keyHint: "" },
  { id: "openai", label: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", blurb: "GPT models.", needsKey: true, keyHint: "Create a key in your OpenAI account under API keys." },
  { id: "anthropic", label: "Anthropic (Claude)", kind: "anthropic", baseUrl: "https://api.anthropic.com", blurb: "Claude models.", needsKey: true, keyHint: "Create a key in the Anthropic Console under API keys." },
  { id: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", blurb: "DeepSeek models, OpenAI-compatible.", needsKey: true, keyHint: "Create a key in the DeepSeek platform under API keys." },
  { id: "openrouter", label: "OpenRouter", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", blurb: "One key for many providers' models.", needsKey: true, keyHint: "Create a key in your OpenRouter account under Keys." },
  { id: "groq", label: "Groq", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", blurb: "Fast hosted open models.", needsKey: true, keyHint: "Create a key in the Groq console under API Keys." },
  { id: "custom", label: "Custom (OpenAI-compatible)", kind: "openai", baseUrl: "", blurb: "Any other endpoint that speaks the OpenAI chat API.", needsKey: false, keyHint: "Paste the key if the service needs one." },
];

export const presetById = (id: string): ProviderPreset | undefined => PRESETS.find((p) => p.id === id);

/** A plain name for a new connection: the preset's own label without its parentheses, made unique among `taken`. */
export function suggestName(preset: ProviderPreset, taken: readonly string[]): string {
  const base = preset.label.replace(/\s*\(.*\)\s*$/, "").trim();
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n++) if (!lower.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
  return base;
}

/** What to tell the person before they press Test: what is missing. Null when the form can be tested. */
export function missingForTest(preset: ProviderPreset | undefined, baseUrl: string, apiKey: string, hasSavedKey: boolean): string | null {
  if (baseUrl.trim() === "") return "Enter the address of the service.";
  if (preset?.needsKey && apiKey.trim() === "" && !hasSavedKey) return "This service needs an API key.";
  return null;
}
