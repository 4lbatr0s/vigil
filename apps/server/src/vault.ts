import { existsSync, mkdirSync } from "node:fs";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import type { Note } from "@vigil/shared";
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

/** Lowercase, dash-separated, [a-z0-9-] only, max 80 chars. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

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

function nowIso(): string {
  return new Date().toISOString();
}

function serialize(note: Note): string {
  // gray-matter writes "---\n<yaml>---\n\n" + content.
  return matter.stringify("", {
    id: note.id,
    title: note.title,
    updatedAt: note.updatedAt,
  }) + note.body;
}

function parse(raw: string, fallbackId: string): Note {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  return {
    id: typeof data["id"] === "string" ? data["id"] : fallbackId,
    title: typeof data["title"] === "string" ? data["title"] : "",
    body: parsed.content.replace(/^\n/, ""),
    updatedAt: typeof data["updatedAt"] === "string" ? data["updatedAt"] : new Date(0).toISOString(),
  };
}

function ensureVaultDir(): string {
  const dir = vaultDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export async function createNote(input: { title: string; body: string }): Promise<Note> {
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
    updatedAt: nowIso(),
  };
  await writeFile(file, serialize(note), "utf8");
  return note;
}

export async function getNote(id: string): Promise<Note> {
  const file = notePath(id);
  if (!existsSync(file)) {
    throw new AppError("note-not-found", `Note not found: ${id}`, 404);
  }
  return parse(await readFile(file, "utf8"), id);
}

export async function updateNote(
  id: string,
  input: { title?: string; body: string },
): Promise<Note> {
  const file = notePath(id);
  if (!existsSync(file)) {
    throw new AppError("note-not-found", `Note not found: ${id}`, 404);
  }
  const existing = parse(await readFile(file, "utf8"), id);
  const note: Note = {
    id,
    title: input.title ?? existing.title,
    body: input.body,
    updatedAt: nowIso(),
  };
  await writeFile(file, serialize(note), "utf8");
  return note;
}

export async function listNotes(): Promise<Note[]> {
  const dir = vaultDir();
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const notes: Note[] = [];
  for (const file of files) {
    const id = file.slice(0, -3);
    const raw = await readFile(path.join(dir, file), "utf8");
    notes.push(parse(raw, id));
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
