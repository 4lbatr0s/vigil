import { z } from "zod";
import { AppError } from "./errors";
import { cardsForNote, listCards, type IndexedCard } from "./index-db";
import { ANSWERS, DEFAULT_RETENTION, isDue, newCardState, review, type Answer, type CardState } from "./srs";
import { capDue, goalFor, retentionFor, daysLeft } from "./goals";
import { allCardStates, getSetting, listGoals, putSetting, type GoalRow, getCardState, reviewCountsByNote, reviewCountsForNote, reviewCountsSince, reviewTimesSince, saveReview, undoLastReview } from "./state-db";

export type StudySettings = { newPerDay: number; retention: number };

/** The owner's pace: how many new cards to offer, and how well the scheduler should aim for you to remember. */
export function studySettings(): StudySettings {
  const n = getSetting("study.newPerDay");
  const r = getSetting("study.retention");
  return {
    newPerDay: typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 50 ? n : NEW_PER_SESSION,
    retention: typeof r === "number" && r >= 0.8 && r <= 0.95 ? r : DEFAULT_RETENTION,
  };
}

export const StudySettingsSchema = z.object({ newPerDay: z.number().int().min(0).max(50), retention: z.number().min(0.8).max(0.95) });

export function saveStudySettings(next: StudySettings): StudySettings {
  putSetting("study.newPerDay", next.newPerDay);
  putSetting("study.retention", next.retention);
  return studySettings();
}

/** New cards offered per request beyond the ones already due, so a big note never buries the day. */
export const NEW_PER_SESSION = 10;

/** `lapses` is how many times the card was forgotten after being learned; many means it needs rewriting. */
export type StudyCard = IndexedCard & { isNew: boolean; due: string | null; lapses: number };

/**
 * Takes turns between notes while keeping each note's own order, so a session mixes topics instead of
 * running through one note at a time. Mixed practice helps most when items are easy to confuse
 * (Brunmair and Richter 2019; Firth et al. 2021). One note, or one card, comes back unchanged.
 */
export function spreadByNote<T extends { noteId: string }>(cards: T[]): T[] {
  const queues = new Map<string, T[]>();
  for (const c of cards) (queues.get(c.noteId) ?? queues.set(c.noteId, []).get(c.noteId)!).push(c);
  if (queues.size < 2) return cards;
  const out: T[] = [];
  const lists = [...queues.values()];
  for (let i = 0; out.length < cards.length; i++) for (const q of lists) if (i < q.length) out.push(q[i]!);
  return out;
}

/**
 * The cards to study now: reviews that are due first (oldest due date first), then up to `newLimit` cards
 * nobody has answered yet. `noteId` limits it to one note.
 */
export function dueCards(now: Date, opts: { limit?: number; newLimit?: number; noteId?: string } = {}): StudyCard[] {
  const states = allCardStates();
  const cards = opts.noteId ? cardsForNote(opts.noteId) : listCards();
  const goals = listGoals();
  const reviews: StudyCard[] = [];
  const fresh: StudyCard[] = [];
  for (const c of cards) {
    const s = states.get(c.id);
    if (!s) {
      fresh.push({ ...c, isNew: true, due: null, lapses: 0 });
      continue;
    }
    // An exam date can pull a card's review in; it never pushes one out.
    const goal = goals.length > 0 ? goalFor(c.noteId, now, goals) : null;
    const due = goal ? capDue(s.due, goal.day, now) : s.due;
    if (new Date(due).getTime() <= now.getTime()) reviews.push({ ...c, isNew: false, due, lapses: s.lapses });
  }
  reviews.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  return [...spreadByNote(reviews), ...spreadByNote(fresh.slice(0, opts.newLimit ?? studySettings().newPerDay))].slice(0, opts.limit ?? 50);
}

/** Records an answer. The same card text in two notes is one card; the answer counts for the note that was shown. */
export function answerCard(cardId: string, answer: string, now: Date): { next: CardState; due: string } {
  if (!(ANSWERS as readonly string[]).includes(answer)) throw new AppError("invalid-body", "answer must be again, hard, good or easy", 400);
  const card = listCards().find((c) => c.id === cardId);
  if (!card) throw new AppError("card-not-found", `Card not found: ${cardId}`, 404);
  const state = getCardState(cardId) ?? newCardState(now);
  const goal = goalFor(card.noteId, now);
  const { next, log } = review(state, answer as Answer, now, Math.max(studySettings().retention, goal ? retentionFor(daysLeft(goal.day, now)) : 0));
  if (goal) next.due = capDue(next.due, goal.day, now);
  saveReview(cardId, card.noteId, next, log, now);
  return { next, due: next.due };
}

/** Due now, counting an exam date that pulls the review in. */
function dueWithGoals(noteId: string, s: CardState, now: Date, goals: GoalRow[]): boolean {
  const goal = goals.length > 0 ? goalFor(noteId, now, goals) : null;
  return isDue(goal ? { ...s, due: capDue(s.due, goal.day, now) } : s, now);
}

/** `newOffered` is how many of the unseen cards a session offers (the new-cards-per-day setting). */
export type StudyStats = { total: number; due: number; new: number; newOffered: number; reviewedToday: number; againToday: number };

export function studyStats(now: Date, noteId?: string): StudyStats {
  const states = allCardStates();
  const cards = noteId ? cardsForNote(noteId) : listCards();
  const goals = listGoals();
  let due = 0;
  let fresh = 0;
  for (const c of cards) {
    const s = states.get(c.id);
    if (!s) fresh++;
    else if (dueWithGoals(c.noteId, s, now, goals)) due++;
  }
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const today = reviewCountsSince(dayStart.toISOString());
  return { total: cards.length, due, new: fresh, newOffered: Math.min(fresh, studySettings().newPerDay), reviewedToday: today.total, againToday: today.again };
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
  const goals = listGoals();
  for (const c of listCards()) {
    const row = byNote.get(c.noteId) ?? { noteId: c.noteId, cards: 0, due: 0, new: 0, reviews: 0, recall: null };
    row.cards++;
    const s = states.get(c.id);
    if (!s) row.new++;
    else if (dueWithGoals(c.noteId, s, now, goals)) row.due++;
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

export type DayCount = { day: string; count: number };

const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Answers per local day for the last `days` days (oldest first, today last), zeros included. */
export function studyHistory(now: Date, days = 14): DayCount[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const counts = new Map<string, number>();
  for (const t of reviewTimesSince(start.toISOString())) {
    const k = localDay(new Date(t));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: DayCount[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const k = localDay(d);
    out.push({ day: k, count: counts.get(k) ?? 0 });
  }
  return out;
}

export type ForecastDay = { day: string; count: number };

/**
 * Reviews coming due per local day for the next `days` days (today first). Cards already due, and cards
 * an exam date pulls in, count for today. Cards never answered are not part of the forecast.
 */
export function studyForecast(now: Date, days = 14): ForecastDay[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const goals = listGoals();
  const counts = new Map<string, number>();
  const cards = listCards();
  const states = allCardStates();
  for (const c of cards) {
    const s = states.get(c.id);
    if (!s) continue;
    const goal = goals.length > 0 ? goalFor(c.noteId, now, goals) : null;
    const due = new Date(goal ? capDue(s.due, goal.day, now) : s.due);
    const k = due.getTime() <= now.getTime() ? localDay(now) : localDay(due);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: ForecastDay[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push({ day: localDay(d), count: counts.get(localDay(d)) ?? 0 });
  }
  return out;
}

export type StuckCard = { id: string; noteId: string; front: string; lapses: number };

/** Cards forgotten at least `min` times after being learned, worst first: the ones to reword or split. */
export function stuckCards(min = 3, limit = 10): StuckCard[] {
  const states = allCardStates();
  const out: StuckCard[] = [];
  for (const c of listCards()) {
    const s = states.get(c.id);
    if (s && s.lapses >= min) out.push({ id: c.id, noteId: c.noteId, front: c.front, lapses: s.lapses });
  }
  return out.sort((a, b) => b.lapses - a.lapses).slice(0, limit);
}
