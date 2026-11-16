import { AppError } from "./errors";
import { cardsForNote, listCards, type IndexedCard } from "./index-db";
import { ANSWERS, isDue, newCardState, review, type Answer, type CardState } from "./srs";
import { allCardStates, getCardState, reviewCountsForNote, reviewCountsSince, saveReview } from "./state-db";

/** New cards offered per request beyond the ones already due, so a big note never buries the day. */
export const NEW_PER_SESSION = 10;

export type StudyCard = IndexedCard & { isNew: boolean; due: string | null };

/**
 * The cards to study now: reviews that are due first (oldest due date first), then up to `newLimit` cards
 * nobody has answered yet. `noteId` limits it to one note.
 */
export function dueCards(now: Date, opts: { limit?: number; newLimit?: number; noteId?: string } = {}): StudyCard[] {
  const states = allCardStates();
  const cards = opts.noteId ? cardsForNote(opts.noteId) : listCards();
  const reviews: StudyCard[] = [];
  const fresh: StudyCard[] = [];
  for (const c of cards) {
    const s = states.get(c.id);
    if (!s) fresh.push({ ...c, isNew: true, due: null });
    else if (isDue(s, now)) reviews.push({ ...c, isNew: false, due: s.due });
  }
  reviews.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  return [...reviews, ...fresh.slice(0, opts.newLimit ?? NEW_PER_SESSION)].slice(0, opts.limit ?? 50);
}

/** Records an answer. The same card text in two notes is one card; the answer counts for the note that was shown. */
export function answerCard(cardId: string, answer: string, now: Date): { next: CardState; due: string } {
  if (!(ANSWERS as readonly string[]).includes(answer)) throw new AppError("invalid-body", "answer must be again, hard, good or easy", 400);
  const card = listCards().find((c) => c.id === cardId);
  if (!card) throw new AppError("card-not-found", `Card not found: ${cardId}`, 404);
  const state = getCardState(cardId) ?? newCardState(now);
  const { next, log } = review(state, answer as Answer, now);
  saveReview(cardId, card.noteId, next, log, now);
  return { next, due: next.due };
}

export type StudyStats = { total: number; due: number; new: number; reviewedToday: number; againToday: number };

export function studyStats(now: Date, noteId?: string): StudyStats {
  const states = allCardStates();
  const cards = noteId ? cardsForNote(noteId) : listCards();
  let due = 0;
  let fresh = 0;
  for (const c of cards) {
    const s = states.get(c.id);
    if (!s) fresh++;
    else if (isDue(s, now)) due++;
  }
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const today = reviewCountsSince(dayStart.toISOString());
  return { total: cards.length, due, new: fresh, reviewedToday: today.total, againToday: today.again };
}

/** Lifetime answers for a note and the share that was "again" (a plain count, not a score). */
export function noteReviewCounts(noteId: string): { total: number; again: number } {
  return reviewCountsForNote(noteId);
}
