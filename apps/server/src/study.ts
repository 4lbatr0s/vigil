import { AppError } from "./errors";
import { cardsForNote, listCards, type IndexedCard } from "./index-db";
import { ANSWERS, isDue, newCardState, review, type Answer, type CardState } from "./srs";
import { allCardStates, getCardState, reviewCountsByNote, reviewCountsForNote, reviewCountsSince, saveReview, undoLastReview } from "./state-db";

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

/** Reviews needed before a recall rate is shown: a handful of answers says nothing. */
export const MIN_REVIEWS_FOR_RATE = 8;

export type DeckStats = { noteId: string; cards: number; due: number; new: number; reviews: number; recall: number | null };

/**
 * One row per note that has cards: how many, how many are waiting, and the share of answers that were not
 * "again" (a plain recall rate, `null` until there are enough answers). Notes with something waiting first.
 */
export function deckStats(now: Date): DeckStats[] {
  const states = allCardStates();
  const counts = reviewCountsByNote();
  const byNote = new Map<string, DeckStats>();
  for (const c of listCards()) {
    const row = byNote.get(c.noteId) ?? { noteId: c.noteId, cards: 0, due: 0, new: 0, reviews: 0, recall: null };
    row.cards++;
    const s = states.get(c.id);
    if (!s) row.new++;
    else if (isDue(s, now)) row.due++;
    byNote.set(c.noteId, row);
  }
  for (const row of byNote.values()) {
    const n = counts.get(row.noteId);
    row.reviews = n?.total ?? 0;
    row.recall = n && n.total >= MIN_REVIEWS_FOR_RATE ? Math.round(((n.total - n.again) / n.total) * 100) : null;
  }
  return [...byNote.values()].sort((a, b) => b.due + b.new - (a.due + a.new) || a.noteId.localeCompare(b.noteId));
}

/** Takes back the last answer; the card is due again as it was. */
export function undoAnswer(): string {
  const id = undoLastReview();
  if (id === null) throw new AppError("nothing-to-undo", "There is no answer to take back.", 409);
  return id;
}
