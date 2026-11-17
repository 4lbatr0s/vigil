import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "./errors";
import { insertMisconception, listMisconceptions, resolveMisconception, type MisconceptionRow } from "./state-db";

/**
 * Things the learner got wrong in a recall check (ADR-0023). The learner picks which ones to keep; they are shown
 * before the next check on that note, steer the card maker, and are crossed off by the learner, never by an agent.
 */

export const MAX_OPEN_PER_NOTE = 20;
export const MAX_TEXT = 300;

export const AddBodySchema = z.object({
  noteId: z.string().min(1).max(200),
  texts: z.array(z.string().trim().min(3).max(MAX_TEXT)).min(1).max(5),
});

const norm = (t: string): string => t.toLowerCase().replace(/\s+/g, " ").trim();

/** Adds the new ones (a repeat of an open one is skipped) and returns what was added. The oldest open ones make room past the cap. */
export function addMisconceptions(noteId: string, texts: string[], now: Date): MisconceptionRow[] {
  const open = listMisconceptions(noteId);
  const seen = new Set(open.map((m) => norm(m.text)));
  const added: MisconceptionRow[] = [];
  for (const text of texts) {
    const key = norm(text);
    if (seen.has(key)) continue;
    seen.add(key);
    const row = { id: randomUUID(), noteId, text: text.trim(), createdAt: now.toISOString() };
    insertMisconception(row);
    added.push(row);
  }
  const all = listMisconceptions(noteId); // newest first
  for (const old of all.slice(MAX_OPEN_PER_NOTE)) resolveMisconception(old.id, now);
  return added;
}

export function resolveOne(id: string, now: Date): void {
  if (!resolveMisconception(id, now)) throw new AppError("misconception-not-found", "That item is not open", 404);
}

/** The lines the card maker sees: only what the learner kept, quoted as data. */
export function shakyBlock(noteId: string): string {
  const open = listMisconceptions(noteId).slice(0, 8);
  return open.length === 0 ? "" : `\n\nSHAKY START\n${open.map((m) => `- ${m.text}`).join("\n")}\nSHAKY END`;
}
