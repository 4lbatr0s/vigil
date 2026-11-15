export type LlmStatus = {
  provider: string;
  baseUrl: string;
  model: string | null;
  hasKey: boolean;
  reachable: boolean | null;
};

/**
 * What the server is configured to talk to. Never contains the key, only whether one is set.
 * `reachable` is null unless `probe` is true: then one GET to the user's own model host, any failure gives false.
 * The URL comes from the owner's environment, never from a model or a request.
 */
export async function llmStatus(probe: boolean, env: NodeJS.ProcessEnv = process.env): Promise<LlmStatus> {
  const provider = env.VIGIL_LLM_PROVIDER ?? "openai";
  const baseUrl = env.VIGIL_LLM_BASE_URL ?? (provider === "ollama" ? "http://127.0.0.1:11434" : "https://api.openai.com/v1");
  const key = env.VIGIL_LLM_API_KEY;
  const status: LlmStatus = { provider, baseUrl, model: env.VIGIL_LLM_MODEL || null, hasKey: Boolean(key), reachable: null };
  if (!probe) return status;
  const base = baseUrl.replace(/\/+$/, "");
  try {
    const res =
      provider === "ollama"
        ? await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) })
        : await fetch(`${base}/models`, {
            headers: key ? { authorization: `Bearer ${key}` } : {},
            signal: AbortSignal.timeout(3000),
          });
    status.reachable = res.ok;
  } catch {
    // A refused, timed-out or malformed probe is exactly the "not reachable" answer.
    status.reachable = false;
  }
  return status;
}
