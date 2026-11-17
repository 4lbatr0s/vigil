import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { slugify, type Author, type Note } from "@vigil/shared";
import { AppError } from "./errors";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
/** vigil/ — repo root, three levels up from apps/server/src. */
export const REPO_ROOT = path.resolve(MODULE_DIR, "../../..");

/** Vault directory. Env override wins so tests and dev can point elsewhere. */
export function vaultDir(): string {
  const configured = process.env.VAULT_DIR;
  return configured ? path.resolve(configured) : path.join(REPO_ROOT, "vault");
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export { slugify };

/** Throws 400 for anything that is not an already-slugified id. */
export function validateId(id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new AppError("invalid-id", `Invalid note id: ${JSON.stringify(id)}`, 400);
  }
  return id;
}

function notePath(id: string): string {
  return path.join(vaultDir(), `${validateId(id)}.md`);
}

/** `# Heading` on the first heading line, used when the file has no frontmatter title. */
function firstHeading(body: string): string | null {
  const match = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(body);
  return match?.[1]?.trim() || null;
}

function parseTags(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  return raw.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim());
}

/** Frontmatter holds id, title, tags and author. Recency is the file's mtime, never stored. */
function serialize(note: Note): string {
  const data: Record<string, unknown> = { id: note.id, title: note.title };
  if (note.tags.length > 0) data["tags"] = note.tags;
  if (note.author === "agent") data["author"] = "agent";
  if (note.author === "agent" && note.agentName) data["agent"] = note.agentName;
  // gray-matter writes "---\n<yaml>---\n" for an empty body.
  return matter.stringify("", data) + note.body;
}

/** Files written by hand or by Obsidian may have no frontmatter: fall back to heading, then id. */
function parse(raw: string, fallbackId: string, mtime: Date): Note {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const body = parsed.content.replace(/^\n/, "");
  const title =
    typeof data["title"] === "string" && data["title"].trim()
      ? data["title"]
      : (firstHeading(body) ?? fallbackId);
  return {
    id: typeof data["id"] === "string" ? data["id"] : fallbackId,
    title,
    body,
    tags: parseTags(data["tags"]),
    author: data["author"] === "agent" ? "agent" : "human",
    ...(typeof data["agent"] === "string" && data["agent"].trim() ? { agentName: data["agent"] } : {}),
    updatedAt: mtime.toISOString(),
  };
}

function ensureVaultDir(): string {
  const dir = vaultDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write to a temp file and rename it into place, so a crash never leaves a half-written note.
 * The temp name ends in `.tmp`, never `.md`, so the watcher and `listNotes` ignore it.
 */
async function writeAtomic(file: string, content: string): Promise<Date> {
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => undefined); // best-effort cleanup; the original error is rethrown
    throw err;
  }
  return (await stat(file)).mtime;
}

/** The note body inside raw file text (frontmatter removed), for showing what an older copy said. */
export function bodyOfRaw(raw: string, id: string): string {
  return parse(raw, id, new Date(0)).body;
}

async function readNote(file: string, id: string): Promise<Note> {
  const [raw, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
  return parse(raw, id, info.mtime);
}

export type WriteOptions = {
  /** Who is writing. The API writes as a human; the agent runtime passes "agent". */
  author?: Author;
  /** Refuse with 409 when the file changed since the caller read it (its `updatedAt`). */
  expectedUpdatedAt?: string;
  /** The writing agent's name; only meaningful with `author: "agent"`. */
  agentName?: string;
};

export async function createNote(
  input: { title: string; body: string; tags?: string[] },
  options: WriteOptions = {},
): Promise<Note> {
  const id = validateId(slugify(input.title));
  const file = notePath(id);
  if (existsSync(file)) {
    throw new AppError("note-exists", `Note already exists: ${id}`, 409);
  }
  ensureVaultDir();
  const note: Note = {
    id,
    title: input.title,
    body: input.body,
    tags: input.tags ?? [],
    author: options.author ?? "human",
    agentName: options.agentName,
    updatedAt: "",
  };
  const mtime = await writeAtomic(file, serialize(note));
  return { ...note, updatedAt: mtime.toISOString() };
}

export async function getNote(id: string): Promise<Note> {
  const file = notePath(id);
  if (!existsSync(file)) {
    throw new AppError("note-not-found", `Note not found: ${id}`, 404);
  }
  return readNote(file, id);
}

export async function updateNote(
  id: string,
  input: { title?: string; body: string; tags?: string[] },
  options: WriteOptions = {},
): Promise<Note> {
  const file = notePath(id);
  if (!existsSync(file)) {
    throw new AppError("note-not-found", `Note not found: ${id}`, 404);
  }
  const existing = await readNote(file, id);
  if (options.expectedUpdatedAt !== undefined && options.expectedUpdatedAt !== existing.updatedAt) {
    throw new AppError(
      "note-conflict",
      `Note ${id} changed since you opened it (now ${existing.updatedAt}). Reload before saving.`,
      409,
    );
  }
  const note: Note = {
    id,
    title: input.title ?? existing.title,
    body: input.body,
    tags: input.tags ?? existing.tags,
    author: options.author ?? "human",
    agentName: options.agentName,
    updatedAt: "",
  };
  const mtime = await writeAtomic(file, serialize(note));
  return { ...note, updatedAt: mtime.toISOString() };
}

export async function listNotes(): Promise<Note[]> {
  const dir = vaultDir();
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const notes: Note[] = [];
  for (const file of files) {
    notes.push(await readNote(path.join(dir, file), file.slice(0, -3)));
  }
  return notes.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

export async function deleteNote(id: string): Promise<void> {
  const file = notePath(id);
  if (!existsSync(file)) {
    throw new AppError("note-not-found", `Note not found: ${id}`, 404);
  }
  await unlink(file);
}

/** Raw file text of a note, or null when it does not exist. Used for snapshots. */
export async function readNoteFile(id: string): Promise<string | null> {
  const file = notePath(id);
  return existsSync(file) ? readFile(file, "utf8") : null;
}

/** Put raw file text back (undo). Atomic, like every other write. */
export async function restoreNoteFile(id: string, raw: string): Promise<Note> {
  const file = notePath(id);
  ensureVaultDir();
  await writeAtomic(file, raw);
  return readNote(file, id);
}

/** Rewrite a note's body, keeping its title, tags and provenance as they are. */
export async function replaceBody(id: string, body: string): Promise<Note> {
  const file = notePath(id);
  const existing = await readNote(file, id);
  const mtime = await writeAtomic(file, serialize({ ...existing, body }));
  return { ...existing, body, updatedAt: mtime.toISOString() };
}

/**
 * Move a note to a new id and title: the new file is written first (atomic), then the old one is
 * removed, so a failure part-way never loses the note. Tags and provenance carry over.
 */
export async function moveNote(oldId: string, newId: string, title: string, body: string): Promise<Note> {
  const oldFile = notePath(oldId);
  const newFile = notePath(newId);
  if (oldId !== newId && existsSync(newFile)) throw new AppError("note-exists", `Note already exists: ${newId}`, 409);
  const existing = await readNote(oldFile, oldId);
  const note: Note = { ...existing, id: newId, title, body };
  const mtime = await writeAtomic(newFile, serialize(note));
  if (oldId !== newId) await unlink(oldFile);
  return { ...note, updatedAt: mtime.toISOString() };
}
