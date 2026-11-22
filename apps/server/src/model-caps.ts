import type { ResolvedConnection } from "./connections";

/**
 * What a model can do, when the provider says so. `known: false` means "we could not tell", which is not the same as
 * "it cannot": the page only warns when a capability is known to be missing.
 */
export type ModelCaps = { known: boolean; tools: boolean | null; vision: boolean | null; contextTokens: number | null };

export const UNKNOWN_CAPS: ModelCaps = { known: false, tools: null, vision: null, contextTokens: null };

const CACHE_MS = 10 * 60_000;
const TIMEOUT_MS = 4000;
const cache = new Map<string, { at: number; caps: ModelCaps }>();

export function clearCapsCache(): void {
  cache.clear();
}

/** Ollama's `/api/show` answer: a `capabilities` list (newer versions) and `model_info` with `<architecture>.context_length`. */
export function parseOllamaShow(json: unknown): ModelCaps {
  if (typeof json !== "object" || json === null) return { ...UNKNOWN_CAPS };
  const body = json as { capabilities?: unknown; model_info?: unknown };
  const info = typeof body.model_info === "object" && body.model_info !== null ? (body.model_info as Record<string, unknown>) : {};
  const key = Object.keys(info).find((k) => k.endsWith(".context_length"));
  const ctx = key !== undefined && typeof info[key] === "number" ? (info[key] as number) : null;
  if (!Array.isArray(body.capabilities)) return { known: false, tools: null, vision: null, contextTokens: ctx };
  const list = body.capabilities.filter((c): c is string => typeof c === "string");
  return { known: true, tools: list.includes("tools"), vision: list.includes("vision"), contextTokens: ctx };
}

/** The capabilities of `model` on a connection. Only Ollama reports them today; every other provider is "unknown". */
export async function modelCaps(conn: ResolvedConnection, model: string): Promise<ModelCaps> {
  if (conn.kind !== "ollama" || model === "") return { ...UNKNOWN_CAPS };
  const key = `${conn.baseUrl}\n${model}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.caps;
  let caps: ModelCaps = { ...UNKNOWN_CAPS };
  try {
    const res = await fetch(`${conn.baseUrl.replace(/\/+$/, "")}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) caps = parseOllamaShow(await res.json());
  } catch {
    // Ollama not running or too slow: leave it unknown, and do not cache the failure.
    return caps;
  }
  cache.set(key, { at: Date.now(), caps });
  return caps;
}
