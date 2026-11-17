import { daysLeft, goalStatuses } from "./goals";
import { listNotes } from "./index-db";
import { dueRecall } from "./recall";
import { deckStats, stuckCards, studySettings, studyStats } from "./study";
import { listRecall } from "./state-db";

const MAX_NOTES = 25;
const MAX_STUCK = 8;

/**
 * What Vigil knows about the learner's memory, as plain text an agent can read: totals, exam dates, notes with
 * cards (due, new, recall rate), cards that keep slipping, and the recall-check ladder. Read-only, built from
 * the state db, never from card answers. `noteId` narrows every section to one note.
 */
export function learnerReport(now: Date, noteId?: string): string {
  const titles = new Map(listNotes().map((n) => [n.id, n.title]));
  const name = (id: string): string => `${id} (${titles.get(id) ?? "untitled"})`;
  const lines: string[] = [];

  const stats = studyStats(now, noteId);
  lines.push(`Today: ${stats.due} cards due, ${stats.new} new, ${stats.reviewedToday} answered today (${stats.againToday} of them "again").`);

  const goals = goalStatuses(now, studySettings().newPerDay).filter((g) => !noteId || (g.kind === "note" && g.value === noteId));
  if (goals.length > 0) {
    lines.push("", "Exam dates:");
    for (const g of goals) {
      const left = daysLeft(g.day, now);
      const when = left < 0 ? "passed" : left === 0 ? "today" : `${left} days left`;
      lines.push(`- ${g.kind} ${g.value}: ${g.day} (${when}), ${g.cards} cards, ${g.toStudy} to study, ${g.onTrack ? "on track" : "behind"}`);
    }
  }

  const decks = deckStats(now).filter((d) => !noteId || d.noteId === noteId);
  if (decks.length > 0) {
    lines.push("", "Notes with cards (cards, due, new, recall rate once there are enough answers):");
    for (const d of decks.slice(0, MAX_NOTES)) {
      lines.push(`- ${name(d.noteId)}: ${d.cards} cards, ${d.due} due, ${d.new} new, recall ${d.recall === null ? "not enough answers yet" : `${d.recall}%`}`);
    }
    if (decks.length > MAX_NOTES) lines.push(`- ${decks.length - MAX_NOTES} more notes not shown`);
  }

  const stuck = stuckCards(3, MAX_STUCK).filter((c) => !noteId || c.noteId === noteId);
  if (stuck.length > 0) {
    lines.push("", "Cards that keep slipping (forgotten again and again):");
    for (const c of stuck) lines.push(`- ${name(c.noteId)}: "${c.front}" forgotten ${c.lapses} times`);
  }

  const due = new Set(dueRecall(now).map((r) => r.noteId));
  const recall = listRecall().filter((r) => !noteId || r.noteId === noteId);
  if (recall.length > 0) {
    lines.push("", "Recall checks (rung 0 to 3, last self-rating):");
    for (const r of recall.slice(0, MAX_NOTES)) {
      lines.push(`- ${name(r.noteId)}: rung ${r.step}, last ${r.lastResult ?? "none yet"}, ${due.has(r.noteId) ? "due now" : `next ${r.due.slice(0, 10)}`}`);
    }
  }

  if (lines.length === 1 && stats.due + stats.new + stats.reviewedToday === 0) lines.push("", "No cards or recall checks yet.");
  return lines.join("\n");
}
