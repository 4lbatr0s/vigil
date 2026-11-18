import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { resolveConnection, type ResolvedConnection } from "./connections";
import { getSetting, putSetting } from "./state-db";

/**
 * Meaning search. Each note gets one vector from an embedding model the owner chose; a question or a note is then
 * matched by closeness of meaning, and combined with the word search. Off until a model name is set. Vectors live in
 * the (disposable) index database, keyed by the note's content hash, so a changed note is simply embedded again.
 * Nothing here can change a note.
 */

const SETTING = "embedModel";
const MAX_CHARS = 2000;
const BATCH = 16;
const TIMEOUT_MS = 60_000;

export type Vec = Float32Array;

export const embedModel = (): string | null => {
  const v = getSetting(SETTING);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
export const setEmbedModel = (model: string | null): void => putSetting(SETTING, model === null ? "" : model.trim());

/** The text that stands for a note: its title and the start of its body. */
export const noteText = (title: string, body: string): string => `${title}\n\n${body}`.slice(0, MAX_CHARS);

export const textHash = (model: string, text: string): string => createHash("sha256").update(`${model}\n${text}`).digest("hex");

/** Closeness of two vectors, -1 to 1. Vectors of different length, or a zero vector, are 0 apart. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/**
 * Merges ranked id lists (best first) into one: an id near the top of several lists beats one top of a single list.
 * Reciprocal rank fusion, the usual way to combine word and meaning search without tuning scores.
 */
export function fuse(lists: readonly (readonly string[])[], limit: number, k = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([id]) => id);
}

/** Asks the connection's embedding endpoint for one vector per text. Ollama and OpenAI-style servers only. */
export async function embedTexts(texts: string[], model: string, conn: ResolvedConnection = resolveConnection()): Promise<Vec[]> {
  if (conn.kind === "anthropic") throw new Error("Anthropic has no embedding model. Use an Ollama or OpenAI connection for meaning search.");
  const ollama = conn.kind === "ollama";
  const url = ollama ? `${conn.baseUrl}/api/embed` : `${conn.baseUrl.replace(/\/v1$/, "")}/v1/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(conn.apiKey ? { authorization: `Bearer ${conn.apiKey}` } : {}) },
    body: JSON.stringify({ model, input: texts }),
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`The embedding model answered ${res.status}. Check the model name "${model}" is installed.`);
  const json = (await res.json()) as { embeddings?: number[][]; data?: { embedding: number[] }[] };
  const rows = ollama ? json.embeddings : json.data?.map((d) => d.embedding);
  if (!rows || rows.length !== texts.length) throw new Error("The embedding model gave an unexpected answer.");
  return rows.map((r) => Float32Array.from(r));
}

// ---- storage ----

const toBlob = (v: Vec): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Buffer): Vec => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

export function ensureVectorTable(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS note_vectors (note_id TEXT PRIMARY KEY, hash TEXT NOT NULL, model TEXT NOT NULL, vec BLOB NOT NULL)");
}

export function saveVector(db: Database.Database, id: string, hash: string, model: string, vec: Vec): void {
  ensureVectorTable(db);
  db.prepare("INSERT INTO note_vectors (note_id, hash, model, vec) VALUES (?, ?, ?, ?) ON CONFLICT(note_id) DO UPDATE SET hash = excluded.hash, model = excluded.model, vec = excluded.vec").run(id, hash, model, toBlob(vec));
}

export function loadVectors(db: Database.Database, model: string): Map<string, { hash: string; vec: Vec }> {
  ensureVectorTable(db);
  const rows = db.prepare("SELECT note_id, hash, vec FROM note_vectors WHERE model = ?").all(model) as { note_id: string; hash: string; vec: Buffer }[];
  return new Map(rows.map((r) => [r.note_id, { hash: r.hash, vec: fromBlob(r.vec) }]));
}

export function dropVectors(db: Database.Database, keep: ReadonlySet<string>): void {
  ensureVectorTable(db);
  const ids = (db.prepare("SELECT note_id FROM note_vectors").all() as { note_id: string }[]).map((r) => r.note_id).filter((id) => !keep.has(id));
  const del = db.prepare("DELETE FROM note_vectors WHERE note_id = ?");
  for (const id of ids) del.run(id);
}

/** The ids closest in meaning to `query`, best first, each with its closeness. Nothing below `floor`. */
export function nearest(vectors: ReadonlyMap<string, { vec: Vec }>, query: Vec, limit: number, exclude?: string, floor = 0.2): { id: string; score: number }[] {
  const out: { id: string; score: number }[] = [];
  for (const [id, v] of vectors) {
    if (id === exclude) continue;
    const score = cosine(query, v.vec);
    if (score >= floor) out.push({ id, score });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}

export { BATCH as EMBED_BATCH };
