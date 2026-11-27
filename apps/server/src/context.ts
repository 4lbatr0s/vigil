import { withoutCards } from "@vigil/shared";
import { backlinks, getNote, noteTagsAll, outgoingLinks } from "./index-db";
import { memoryMap } from "./memory";
import { shakyBlock } from "./misconceptions";
import { relatedIds } from "./semantic";

/**
 * One place that decides what a model is told about a note and about the learner. Every AI feature that works on a
 * note (Card maker, Recall checker, the study tutors) asks for the same named blocks here, in the same order, under one
 * size budget, instead of building its own prompt text. The blocks are data, never instructions: note text and titles
 * are untrusted, so each sits between markers the agents' prompts already treat as data.
 */

/** The blocks, in the order they always appear. */
export const PARTS = ["note", "learner", "shaky", "linked"] as const;
export type ContextPart = (typeof PARTS)[number];

export const DEFAULT_BUDGET_CHARS = 30_000;
const MAX_NOTE_CHARS = 20_000;
const MAX_LINKED = 8;
const CUT_MARK = "\n[the note continues; only the first part is shown]";

export type ContextOptions = {
  noteId: string;
  parts: readonly ContextPart[];
  /** The whole text stays within this many characters. */
  budgetChars?: number;
  /** Leave the note's card lines out (a tutor that sees the answers gives them away). */
  hideCards?: boolean;
};

export type AssembledContext = { text: string; parts: ContextPart[] };

/** `text` cut to at most `max` characters, with a plain marker when something was left out. */
export function fitText(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = Math.max(0, max - CUT_MARK.length);
  return `${text.slice(0, room)}${CUT_MARK}`;
}

function learnerBlock(noteId: string, now: Date): string {
  const m = memoryMap(now, noteTagsAll).get(noteId);
  if (!m) return "";
  const lines: string[] = [];
  if (m.cards > 0) lines.push(m.strength === null ? `${m.cards} ${m.cards === 1 ? "card" : "cards"}, none answered yet` : `${m.cards} ${m.cards === 1 ? "card" : "cards"}, ${m.reviewed} answered, about ${Math.round(m.strength * 100)}% remembered`);
  if (m.recallDue) lines.push("the recall check is due");
  if (m.examDays !== null) lines.push(m.examDays === 0 ? "exam today" : `exam in ${m.examDays} ${m.examDays === 1 ? "day" : "days"}`);
  return lines.length === 0 ? "" : `LEARNER START\n${lines.map((l) => `- ${l}`).join("\n")}\nLEARNER END`;
}

function linkedBlock(noteId: string): string {
  const seen = new Set<string>([noteId]);
  const rows: { id: string; title: string }[] = [];
  const add = (id: string, title: string): void => {
    if (seen.has(id) || rows.length >= MAX_LINKED) return;
    seen.add(id);
    rows.push({ id, title: title.replace(/\s+/g, " ").trim().slice(0, 80) });
  };
  for (const o of outgoingLinks(noteId)) if (!o.ghost) add(o.id, o.title);
  for (const b of backlinks(noteId)) add(b.id, b.title || b.id);
  for (const r of relatedIds(noteId, 4)) add(r.id, getNote(r.id)?.title ?? r.id);
  return rows.length === 0 ? "" : `LINKED START\n${rows.map((r) => `- ${r.title} (id: ${r.id})`).join("\n")}\nLINKED END`;
}

/**
 * The text for a note: the header, then the requested blocks in the fixed order. The small blocks are kept whole and
 * the note itself is cut to what is left of the budget. `null` when the note does not exist.
 */
export function assembleContext(opts: ContextOptions, now: Date = new Date()): AssembledContext | null {
  const note = getNote(opts.noteId);
  if (note === null) return null;
  const want = new Set(opts.parts);
  const budget = opts.budgetChars ?? DEFAULT_BUDGET_CHARS;
  const header = `Note "${note.title}" (id: ${note.id})`;

  const small: string[] = [];
  const used: ContextPart[] = [];
  const blocks: Record<Exclude<ContextPart, "note">, () => string> = {
    learner: () => learnerBlock(note.id, now),
    shaky: () => shakyBlock(note.id).trim(),
    linked: () => linkedBlock(note.id),
  };
  for (const part of PARTS) {
    if (part === "note" || !want.has(part)) continue;
    const block = blocks[part]();
    if (block !== "") {
      small.push(block);
      used.push(part);
    }
  }

  const sections: string[] = [header];
  if (want.has("note")) {
    const wrapper = "NOTE START\n".length + "\nNOTE END".length;
    // Everything except the note itself, with the two line breaks that join the sections.
    const others = header.length + small.reduce((n, b) => n + b.length, 0) + (small.length + 1) * 2 + wrapper;
    const room = Math.max(0, Math.min(MAX_NOTE_CHARS, budget - others));
    const raw = opts.hideCards ? withoutCards(note.body ?? "") : (note.body ?? "");
    sections.push(`NOTE START\n${fitText(raw, room)}\nNOTE END`);
    used.unshift("note");
  }
  sections.push(...small);
  // The header and the note sit on consecutive lines; the other blocks follow after a blank line.
  const [head, ...rest] = sections;
  const text = want.has("note") ? `${head}\n${rest[0]}${rest.length > 1 ? `\n\n${rest.slice(1).join("\n\n")}` : ""}` : sections.join("\n\n");
  return { text, parts: used };
}
