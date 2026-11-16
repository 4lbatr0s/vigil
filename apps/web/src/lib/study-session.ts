import type { Answer, StudyCard } from "./api";

/** One sitting of study: the queue, where you are, and what has been answered. Pure, so it is tested without a browser. */
export type Session = {
  queue: StudyCard[];
  index: number;
  revealed: boolean;
  /** Cards answered at least once this sitting (a card sent back counts once). */
  done: number;
  /** Answers by kind, for the calm summary at the end. */
  answers: Record<Answer, number>;
  /** Card ids already sent back once, so "again" never loops forever. */
  retried: string[];
};

export const startSession = (cards: StudyCard[]): Session => ({ queue: cards, index: 0, revealed: false, done: 0, answers: { again: 0, hard: 0, good: 0, easy: 0 }, retried: [] });

export const current = (s: Session): StudyCard | null => s.queue[s.index] ?? null;
export const isFinished = (s: Session): boolean => s.index >= s.queue.length;
export const reveal = (s: Session): Session => (current(s) && !s.revealed ? { ...s, revealed: true } : s);
export const remaining = (s: Session): number => Math.max(0, s.queue.length - s.index);

/**
 * Moves on after an answer. A card answered "again" comes back once more at the end of the sitting, so a
 * miss is retrieved again before you leave; after that it waits for the scheduler.
 */
export function answer(s: Session, a: Answer): Session {
  const card = current(s);
  if (!card || !s.revealed) return s;
  const again = a === "again" && !s.retried.includes(card.id);
  return {
    ...s,
    queue: again ? [...s.queue, card] : s.queue,
    retried: again ? [...s.retried, card.id] : s.retried,
    index: s.index + 1,
    revealed: false,
    done: s.retried.includes(card.id) ? s.done : s.done + 1,
    answers: { ...s.answers, [a]: s.answers[a] + 1 },
  };
}

/** The key that gives an answer: 1 again, 2 hard, 3 good, 4 easy. */
export const ANSWER_KEYS: Record<string, Answer> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
