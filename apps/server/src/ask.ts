import { z } from "zod";
import { getNote, searchNotesAny } from "./index-db";

/**
 * "Ask your notes": find the lines of the notes that bear on a question, hand only those to a no-tool agent,
 * and let it answer with [n] marks that point at those lines. The server sends the numbered lines back too, so
 * the reader can see the exact line behind every claim. With no matching line the agent is never asked
 * (the answer is "your notes do not cover this"), so it cannot make something up.
 */

export const AskBodySchema = z.object({ question: z.string().trim().min(3).max(500) });

export type Passage = { n: number; noteId: string; title: string; line: number; text: string };

const MAX_NOTES = 8;
export const MAX_PASSAGES = 10;
const MAX_LINE = 400;

/** Common words that match nearly every note; they do not help find anything. */
const STOP = new Set(
  "a an the is are was were be been am do does did of to in on at for with and or but not no what which who whom whose when where why how this that these those it its i me my you your we our they them their from by as about into than then so if can could would should will just".split(" "),
);

export function questionWords(question: string): string[] {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));
  return [...new Set(words)];
}

/** The best lines for a question, best first, numbered from 1. Empty when no note shares a word with it. */
export function findPassages(question: string): Passage[] {
  const words = questionWords(question);
  if (words.length === 0) return [];
  const out: (Omit<Passage, "n"> & { score: number })[] = [];
  for (const id of searchNotesAny(words, MAX_NOTES)) {
    const note = getNote(id);
    if (note === null) continue;
    const lines = (note.body ?? "").split("\n");
    lines.forEach((raw, i) => {
      const text = raw.trim();
      if (text.length < 3 || /^#{1,6}\s*$/.test(text)) return;
      const lower = text.toLowerCase();
      const score = words.filter((w) => lower.includes(w)).length;
      if (score > 0) out.push({ noteId: id, title: note.title, line: i + 1, text: text.slice(0, MAX_LINE), score });
    });
  }
  return out
    .sort((a, b) => b.score - a.score || a.noteId.localeCompare(b.noteId) || a.line - b.line)
    .slice(0, MAX_PASSAGES)
    .map((p, i) => ({ n: i + 1, noteId: p.noteId, title: p.title, line: p.line, text: p.text }));
}

/** The task for the Note asker agent: the question, then the numbered lines it may use. */
export function askTask(question: string, passages: Passage[]): string {
  const lines = passages.map((p) => `[${p.n}] (${p.title}) ${p.text}`).join("\n");
  return `Answer this question from my notes.\n\nQUESTION START\n${question}\nQUESTION END\n\nLINES START\n${lines}\nLINES END`;
}
