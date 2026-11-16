import { createEmptyCard, fsrs, Rating, type Card as FsrsCard, type Grade, type State } from "ts-fsrs";

/**
 * Spaced review scheduling (ADR-0017), a thin wrapper over FSRS so the rest of the server deals in plain,
 * JSON-friendly values and an injected clock. Nothing here touches the disk.
 */

/** What is stored per card: FSRS's memory state, with dates as ISO text. */
export type CardState = {
  due: string;
  stability: number;
  difficulty: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  /** FSRS state: 0 new, 1 learning, 2 review, 3 relearning. */
  state: number;
  lastReview: string | null;
};

export type Answer = "again" | "hard" | "good" | "easy";
export const ANSWERS: readonly Answer[] = ["again", "hard", "good", "easy"];
const GRADE: Record<Answer, Grade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };

// Fuzz is off so a review lands on the same day for the same history (tests, and a calmer schedule to explain).
const scheduler = fsrs({ enable_fuzz: false });

const fromFsrs = (c: FsrsCard): CardState => ({
  due: c.due.toISOString(),
  stability: c.stability,
  difficulty: c.difficulty,
  scheduledDays: c.scheduled_days,
  learningSteps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state as number,
  lastReview: c.last_review ? c.last_review.toISOString() : null,
});

const toFsrs = (s: CardState): FsrsCard => ({
  due: new Date(s.due),
  stability: s.stability,
  difficulty: s.difficulty,
  scheduled_days: s.scheduledDays,
  learning_steps: s.learningSteps,
  reps: s.reps,
  lapses: s.lapses,
  state: s.state as State,
  ...(s.lastReview ? { last_review: new Date(s.lastReview) } : {}),
});

/** A card nobody has reviewed yet: due right now. */
export function newCardState(now: Date): CardState {
  return fromFsrs(createEmptyCard(now));
}

/** The state after answering, and the review as it should be logged. */
export function review(state: CardState, answer: Answer, now: Date): { next: CardState; log: { rating: number; elapsedDays: number } } {
  const { card, log } = scheduler.next(toFsrs(state), now, GRADE[answer]);
  const elapsedDays = state.lastReview ? Math.max(0, (now.getTime() - new Date(state.lastReview).getTime()) / 86_400_000) : 0;
  return { next: fromFsrs(card), log: { rating: log.rating as number, elapsedDays } };
}

export const isDue = (state: CardState, now: Date): boolean => new Date(state.due).getTime() <= now.getTime();
