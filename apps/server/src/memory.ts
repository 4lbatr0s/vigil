import { daysLeft } from "./goals";
import { listCards } from "./index-db";
import { retrievability } from "./srs";
import { allCardStates, listGoals, listRecall } from "./state-db";

/** What a note's memory looks like right now, for the graph. `strength` is `null` until a card has been answered. */
export type NoteMemory = {
  cards: number;
  /** Cards answered at least once. */
  reviewed: number;
  /** Mean chance of recalling the answered cards right now, 0 to 1, rounded to 2 places. */
  strength: number | null;
  /** The recall check for this note is due. */
  recallDue: boolean;
  /** Days to the nearest exam date for this note (a tag date counts when the note has the tag), or null. */
  examDays: number | null;
};

/**
 * One entry per note that has cards or a recall check. Pure reading: card state, recall ladder and exam dates.
 * Tag exam dates are matched by the caller-supplied `tagsOf` so this stays cheap and testable.
 */
export function memoryMap(now: Date, tagsOf: (noteId: string) => string[]): Map<string, NoteMemory> {
  const states = allCardStates();
  const out = new Map<string, NoteMemory>();
  const sums = new Map<string, { sum: number; n: number }>();
  const at = (id: string): NoteMemory => {
    let m = out.get(id);
    if (!m) {
      m = { cards: 0, reviewed: 0, strength: null, recallDue: false, examDays: null };
      out.set(id, m);
    }
    return m;
  };
  for (const c of listCards()) {
    const m = at(c.noteId);
    m.cards++;
    const s = states.get(c.id);
    const r = s ? retrievability(s, now) : null;
    if (r !== null) {
      m.reviewed++;
      const t = sums.get(c.noteId) ?? { sum: 0, n: 0 };
      t.sum += r;
      t.n++;
      sums.set(c.noteId, t);
    }
  }
  for (const [id, t] of sums) at(id).strength = Math.round((t.sum / t.n) * 100) / 100;
  for (const r of listRecall()) if (new Date(r.due).getTime() <= now.getTime()) at(r.noteId).recallDue = true;
  for (const g of listGoals()) {
    const left = daysLeft(g.day, now);
    if (left < 0) continue;
    for (const [id, m] of out) {
      const hit = g.kind === "note" ? g.value === id : tagsOf(id).some((t) => t === g.value || t.startsWith(`${g.value}/`));
      if (hit && (m.examDays === null || left < m.examDays)) m.examDays = left;
    }
  }
  return out;
}
