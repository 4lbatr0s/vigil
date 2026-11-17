import { DEFAULT_URLS, probeConnection, resolveConnection, type ResolvedConnection } from "./connections";

export type LlmStatus = {
  provider: string;
  baseUrl: string;
  model: string | null;
  hasKey: boolean;
  reachable: boolean | null;
  /** The connection in use: a saved one, the environment, or none yet. */
  connection: { id: string; name: string } | null;
};

/**
 * What the server will talk to by default. Never contains the key, only whether one is set.
 * `reachable` is null unless `probe` is true: then one GET to the owner's own model host, any failure gives false.
 * The address comes from the owner (Settings or the environment), never from a model or a request.
 */
export async function llmStatus(probe: boolean, env: NodeJS.ProcessEnv = process.env): Promise<LlmStatus> {
  let conn: ResolvedConnection | null = null;
  try {
    conn = resolveConnection(undefined, env);
  } catch {
    // Nothing is connected yet (or a saved key cannot be read): the status says so with an empty answer instead of an error.
    conn = null;
  }
  if (!conn) return { provider: "openai", baseUrl: DEFAULT_URLS.openai, model: null, hasKey: false, reachable: probe ? false : null, connection: null };
  const status: LlmStatus = { provider: conn.kind, baseUrl: conn.baseUrl, model: conn.model ?? null, hasKey: conn.apiKey !== undefined, reachable: null, connection: { id: conn.id, name: conn.name } };
  if (probe) status.reachable = (await probeConnection({ kind: conn.kind, baseUrl: conn.baseUrl, apiKey: conn.apiKey })).ok;
  return status;
}
