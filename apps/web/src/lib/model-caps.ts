/** What a model can do, as the server reports it (`known: false` means "could not tell"). Mirrors apps/server/src/model-caps.ts. */
export type ModelCaps = { known: boolean; tools: boolean | null; vision: boolean | null; contextTokens: number | null };

/** Below this many tokens a note plus a conversation plus the model's reasoning easily fills the window. */
export const SMALL_CONTEXT_TOKENS = 8192;

/**
 * Plain warnings for the person, only when a limit is known. An agent with tools needs a model that can call them;
 * pictures need a model that can see; a very small window leads to empty answers.
 */
export function capabilityWarnings(need: { tools: boolean; pictures: boolean }, caps: ModelCaps | null): string[] {
  if (!caps) return [];
  const out: string[] = [];
  if (need.tools && caps.tools === false) out.push("This model cannot use tools, so the agent cannot read or write notes with it. Pick another model.");
  if (need.pictures && caps.vision === false) out.push("This model cannot read pictures. Turn off the picture setting or pick another model.");
  if (caps.contextTokens !== null && caps.contextTokens < SMALL_CONTEXT_TOKENS) out.push(`This model reads only ${caps.contextTokens.toLocaleString("en")} tokens at a time, so long notes may get an empty answer.`);
  return out;
}
