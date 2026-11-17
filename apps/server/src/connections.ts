import { z } from "zod";
import { slugify } from "@vigil/shared";
import { AppError } from "./errors";
import { decryptSecret, encryptSecret, registerSecret } from "./secrets";
import { deleteConnectionRow, getConnectionRow, getSetting, listConnectionRows, putConnectionRow, putSetting, type ConnectionRow } from "./state-db";

/**
 * Model connections (ADR-0026): the endpoints and keys the owner adds in Settings, plus the one that VIGIL_LLM_*
 * describes. A key is write-only: it is encrypted when saved and never leaves the server in any response.
 */

export const KINDS = ["openai", "anthropic", "ollama"] as const;
export type ConnectionKind = (typeof KINDS)[number];

export const DEFAULT_URLS: Record<ConnectionKind, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  ollama: "http://127.0.0.1:11434",
};

export const ENV_ID = "env";
const MAX_RESPONSE_BYTES = 1_000_000;
const PROBE_TIMEOUT_MS = 8000;

const BaseUrlSchema = z
  .string()
  .trim()
  .max(500)
  .transform((s) => s.replace(/\/+$/, ""))
  .refine((s) => {
    try {
      const u = new URL(s);
      return (u.protocol === "http:" || u.protocol === "https:") && u.username === "" && u.password === "";
    } catch {
      return false;
    }
  }, "Enter an address like https://api.openai.com/v1 or http://localhost:11434 (no user name or password in it)");

export const ConnectionInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(KINDS),
  baseUrl: BaseUrlSchema,
  /** Empty or missing on an update keeps the saved key; a new value replaces it. */
  apiKey: z.string().trim().max(500).optional(),
  clearKey: z.boolean().optional(),
  defaultModel: z.string().trim().max(200).optional(),
});
export type ConnectionInput = z.infer<typeof ConnectionInputSchema>;

export const ProbeInputSchema = z.object({ kind: z.enum(KINDS), baseUrl: BaseUrlSchema, apiKey: z.string().trim().max(500).optional(), connectionId: z.string().max(60).optional() });

/** What the browser may see: everything except the key. */
export type ConnectionView = { id: string; name: string; kind: ConnectionKind; baseUrl: string; hasKey: boolean; defaultModel: string | null; isDefault: boolean; readOnly: boolean };

export type ResolvedConnection = { id: string; name: string; kind: ConnectionKind; baseUrl: string; apiKey: string | undefined; model: string | undefined };

const asKind = (k: string): ConnectionKind => ((KINDS as readonly string[]).includes(k) ? (k as ConnectionKind) : "openai");

/** The connection VIGIL_LLM_* describes, or null when none of those variables is set. */
export function envConnection(env: NodeJS.ProcessEnv = process.env): ResolvedConnection | null {
  if (!env.VIGIL_LLM_PROVIDER && !env.VIGIL_LLM_BASE_URL && !env.VIGIL_LLM_MODEL && !env.VIGIL_LLM_API_KEY) return null;
  const kind = asKind(env.VIGIL_LLM_PROVIDER ?? "openai");
  registerSecret(env.VIGIL_LLM_API_KEY);
  return { id: ENV_ID, name: "Environment (VIGIL_LLM_*)", kind, baseUrl: (env.VIGIL_LLM_BASE_URL ?? DEFAULT_URLS[kind]).replace(/\/+$/, ""), apiKey: env.VIGIL_LLM_API_KEY || undefined, model: env.VIGIL_LLM_MODEL || undefined };
}

export function defaultConnectionId(): string | null {
  const v = getSetting("defaultConnection");
  return typeof v === "string" && v !== "" ? v : null;
}

export function listConnections(env: NodeJS.ProcessEnv = process.env): ConnectionView[] {
  const rows = listConnectionRows();
  const stored = defaultConnectionId();
  const env_ = envConnection(env);
  // The default is the saved choice when it still exists; with none saved, the first added connection, else the environment.
  const effective = stored !== null && (stored === ENV_ID ? env_ !== null : rows.some((r) => r.id === stored)) ? stored : (rows[0]?.id ?? (env_ ? ENV_ID : null));
  const views = rows.map((r): ConnectionView => ({ id: r.id, name: r.name, kind: asKind(r.kind), baseUrl: r.baseUrl, hasKey: r.apiKeyEnc !== null, defaultModel: r.defaultModel, isDefault: r.id === effective, readOnly: false }));
  if (env_) views.unshift({ id: ENV_ID, name: env_.name, kind: env_.kind, baseUrl: env_.baseUrl, hasKey: env_.apiKey !== undefined, defaultModel: env_.model ?? null, isDefault: ENV_ID === effective, readOnly: true });
  return views;
}

function idFromName(name: string): string {
  const id = slugify(name);
  if (id === "" || id === ENV_ID) throw new AppError("invalid-body", "Choose another name for this connection", 400);
  return id;
}

function viewOf(row: ConnectionRow): ConnectionView {
  return { id: row.id, name: row.name, kind: asKind(row.kind), baseUrl: row.baseUrl, hasKey: row.apiKeyEnc !== null, defaultModel: row.defaultModel, isDefault: defaultConnectionId() === row.id, readOnly: false };
}

export function createConnection(input: ConnectionInput, now: Date = new Date()): ConnectionView {
  const id = idFromName(input.name);
  if (getConnectionRow(id)) throw new AppError("connection-exists", `A connection named "${input.name}" already exists`, 409);
  registerSecret(input.apiKey);
  const row: ConnectionRow = { id, name: input.name, kind: input.kind, baseUrl: input.baseUrl, apiKeyEnc: input.apiKey ? encryptSecret(input.apiKey) : null, defaultModel: input.defaultModel || null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  putConnectionRow(row);
  // The first one the owner adds becomes the default, so a new person does not have to find a second switch.
  if (listConnectionRows().length === 1 && defaultConnectionId() === null) putSetting("defaultConnection", id);
  return viewOf(row);
}

export function updateConnection(id: string, input: ConnectionInput, now: Date = new Date()): ConnectionView {
  const old = getConnectionRow(id);
  if (!old) throw new AppError("connection-not-found", `Connection not found: ${id}`, 404);
  registerSecret(input.apiKey);
  const apiKeyEnc = input.clearKey ? null : input.apiKey ? encryptSecret(input.apiKey) : old.apiKeyEnc;
  const row: ConnectionRow = { ...old, name: input.name, kind: input.kind, baseUrl: input.baseUrl, apiKeyEnc, defaultModel: input.defaultModel || null, updatedAt: now.toISOString() };
  putConnectionRow(row);
  return viewOf(row);
}

export function removeConnection(id: string): void {
  if (!deleteConnectionRow(id)) throw new AppError("connection-not-found", `Connection not found: ${id}`, 404);
  if (defaultConnectionId() === id) putSetting("defaultConnection", "");
}

export function setDefaultConnection(id: string, env: NodeJS.ProcessEnv = process.env): void {
  const exists = id === ENV_ID ? envConnection(env) !== null : getConnectionRow(id) !== null;
  if (!exists) throw new AppError("connection-not-found", `Connection not found: ${id}`, 404);
  putSetting("defaultConnection", id);
}

/**
 * The connection a model call should use: the one asked for (an agent's), else the default, else the environment.
 * Throws a plain message when there is none, or when a saved key cannot be read any more.
 */
export function resolveConnection(id?: string, env: NodeJS.ProcessEnv = process.env): ResolvedConnection {
  const wanted = id ?? defaultConnectionId() ?? undefined;
  if (wanted === ENV_ID) {
    const e = envConnection(env);
    if (e) return e;
  } else if (wanted) {
    const row = getConnectionRow(wanted);
    if (row) return fromRow(row);
    if (id) throw new AppError("connection-not-found", `This agent uses a connection that no longer exists: ${id}. Pick another one on the agent page.`, 404);
  }
  const first = listConnectionRows()[0];
  if (first && !id) return fromRow(first);
  const e = envConnection(env);
  if (e) return e;
  throw new AppError("no-connection", "No model is connected yet. Open Settings, Models, and add one.", 409);
}

function fromRow(row: ConnectionRow): ResolvedConnection {
  let apiKey: string | undefined;
  if (row.apiKeyEnc !== null) {
    const plain = decryptSecret(row.apiKeyEnc);
    if (plain === null) throw new AppError("key-unreadable", `The saved key for "${row.name}" cannot be read (the secret key changed or the data was damaged). Enter the key again in Settings.`, 409);
    registerSecret(plain);
    apiKey = plain;
  }
  return { id: row.id, name: row.name, kind: asKind(row.kind), baseUrl: row.baseUrl, apiKey, model: row.defaultModel ?? undefined };
}

/** The key of a saved connection, for a probe the browser started with only the connection id (the key never travels back). */
export function savedKey(id: string): string | undefined {
  const row = getConnectionRow(id);
  return row ? fromRow(row).apiKey : undefined;
}

// ---- Probing: is it reachable, and which models does it offer ----

export type ProbeResult = { ok: boolean; models: string[]; error: string | null };

function headersFor(kind: ConnectionKind, apiKey: string | undefined): Record<string, string> {
  if (kind === "anthropic") return { "anthropic-version": "2023-06-01", ...(apiKey ? { "x-api-key": apiKey } : {}) };
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

function modelsUrl(kind: ConnectionKind, baseUrl: string): string {
  if (kind === "ollama") return `${baseUrl}/api/tags`;
  if (kind === "anthropic") return `${baseUrl}${/\/v1$/.test(baseUrl) ? "" : "/v1"}/models`;
  return `${baseUrl}/models`;
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function parseModels(kind: ConnectionKind, json: unknown): string[] {
  const names: string[] = [];
  const j = json as { data?: { id?: unknown }[]; models?: { name?: unknown; model?: unknown }[] };
  if (kind === "ollama") for (const m of j.models ?? []) names.push(String(m.name ?? m.model ?? ""));
  else for (const m of j.data ?? []) names.push(String(m.id ?? ""));
  return [...new Set(names.filter((n) => n !== ""))].sort((a, b) => a.localeCompare(b));
}

/** One GET to the models list of the endpoint the owner typed. No redirects are followed; the key is never in the result. */
export async function probeConnection(input: { kind: ConnectionKind; baseUrl: string; apiKey?: string | undefined }): Promise<ProbeResult> {
  registerSecret(input.apiKey);
  try {
    const res = await fetch(modelsUrl(input.kind, input.baseUrl), { headers: headersFor(input.kind, input.apiKey), redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (res.status >= 300 && res.status < 400) return { ok: false, models: [], error: "The address answered with a redirect. Use the final address." };
    if (res.status === 401 || res.status === 403) return { ok: false, models: [], error: "The service refused the key (HTTP " + res.status + "). Check that the key is right and allowed to list models." };
    if (!res.ok) return { ok: false, models: [], error: `The service answered HTTP ${res.status}.` };
    const text = await readCapped(res);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, models: [], error: "The address answered, but not with a list of models. Is it the right address?" };
    }
    return { ok: true, models: parseModels(input.kind, json), error: null };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return { ok: false, models: [], error: name === "TimeoutError" ? "No answer within 8 seconds." : "Could not reach that address. Is the service running and the address right?" };
  }
}
