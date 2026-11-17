import { z } from "zod";
import { AppError } from "./errors";
import { noteTagsAll, cardsForNote, listCards, type IndexedCard } from "./index-db";
import { DEFAULT_RETENTION, isDue } from "./srs";
import { allCardStates, listGoals, type GoalRow } from "./state-db";

/**
 * Exam dates (ADR-0019). A date for a note or a tag makes the cards in it come due before that day.
 * Two rules, both from how spacing works (Cepeda 2008: the best gap is a share of the time left):
 * ask for higher retention as the day gets close, and never let a card's next review land after it.
 */

export const GoalBodySchema = z.object({
  kind: z.enum(["note", "tag"]),
  value: z.string().trim().min(1).max(200),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** `2026-11-17` as the start of that local day, or null when it is not a real day. */
export function dayStart(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

export function validGoalDay(day: string): Date {
  const date = dayStart(day);
  if (!date) throw new AppError("invalid-body", "day must be a real date like 2026-11-17", 400);
  return date;
}

/** Whole calendar days from today to the exam day (0 on the day itself, negative once it has passed). */
export function daysLeft(day: string, now: Date): number {
  const exam = dayStart(day);
  if (!exam) return -1;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((exam.getTime() - today.getTime()) / 86_400_000);
}

/** The retention to ask the scheduler for: gentle far out, firmer in the last weeks. */
export function retentionFor(left: number): number {
  if (left < 0) return DEFAULT_RETENTION;
  if (left <= 7) return 0.95;
  if (left <= 21) return 0.92;
  if (left <= 60) return 0.9;
  return 0.85;
}

/**
 * The latest a review may be scheduled for: the middle of the day before the exam, but never sooner than
 * a few hours from now (so the evening before an exam is not already overdue).
 */
export function latestReview(day: string, now: Date): Date | null {
  const exam = dayStart(day);
  if (!exam || daysLeft(day, now) < 0) return null;
  const eve = new Date(exam.getTime() - 12 * 3_600_000);
  const soonest = new Date(now.getTime() + 3 * 3_600_000);
  return eve.getTime() > soonest.getTime() ? eve : soonest;
}

/** The ISO due date, pulled in when it would fall after the exam. */
export function capDue(due: string, day: string, now: Date): string {
  const latest = latestReview(day, now);
  return latest && new Date(due).getTime() > latest.getTime() ? latest.toISOString() : due;
}

/** The nearest coming exam that covers this note (by note id, or by one of its tags), or null. */
export function goalFor(noteId: string, now: Date, goals: GoalRow[] = listGoals()): GoalRow | null {
  const tags = new Set(noteTagsAll(noteId));
  let best: GoalRow | null = null;
  for (const g of goals) {
    if (daysLeft(g.day, now) < 0) continue;
    const covers = g.kind === "note" ? g.value === noteId : tags.has(g.value) || [...tags].some((t) => t.startsWith(`${g.value}/`));
    if (covers && (!best || g.day < best.day)) best = g;
  }
  return best;
}

export type GoalStatus = GoalRow & {
  daysLeft: number;
  cards: number;
  /** Waiting right now (due or never seen, up to nothing hidden). */
  toStudy: number;
  /** Cards nobody has answered yet. */
  unseen: number;
  /** True when learning the unseen cards at the new-card pace still fits before the day. */
  onTrack: boolean;
};

const cardsInScope = (g: GoalRow): IndexedCard[] => {
  if (g.kind === "note") return cardsForNote(g.value);
  return listCards().filter((c) => {
    const tags = noteTagsAll(c.noteId);
    return tags.includes(g.value) || tags.some((t) => t.startsWith(`${g.value}/`));
  });
};

/** One status per exam date, soonest first. `newPerDay` is the pace new cards are offered at. */
export function goalStatuses(now: Date, newPerDay: number): GoalStatus[] {
  const states = allCardStates();
  return listGoals().map((g) => {
    const left = daysLeft(g.day, now);
    const cards = cardsInScope(g);
    let unseen = 0;
    let waiting = 0;
    for (const c of cards) {
      const s = states.get(c.id);
      if (!s) unseen++;
      else if (isDue(s, now)) waiting++;
    }
    const sessionsLeft = Math.max(1, left);
    return { ...g, daysLeft: left, cards: cards.length, toStudy: waiting + unseen, unseen, onTrack: left < 0 ? true : Math.ceil(unseen / sessionsLeft) <= newPerDay };
  });
}
