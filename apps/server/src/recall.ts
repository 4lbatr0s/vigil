import { z } from "zod";
import { AppError } from "./errors";
import { getRecall, listRecall, saveRecall, type RecallRow } from "./state-db";

/**
 * Note recall checks (ADR-0020). Cards test single facts; this tests whether you can bring a whole note back
 * to mind. Judgments of learning made right after studying are inflated by familiarity and more accurate
 * after a delay (Koriat and Bjork 2006), so the first check comes a day later. The ladder is fixed and small
 * (days): FSRS stays for cards.
 */
export const LADDER_DAYS = [1, 3, 7, 21] as const;

export const RESULTS = ["most", "some", "little"] as const;
export type RecallResult = (typeof RESULTS)[number];

export const ResultBodySchema = z.object({ result: z.enum(RESULTS) });

const addDays = (now: Date, days: number): string => new Date(now.getTime() + days * 86_400_000).toISOString();

/** A note joins the ladder at its first step. */
export function enroll(noteId: string, now: Date): RecallRow {
  const existing = getRecall(noteId);
  if (existing) return existing;
  const row = { noteId, step: 0, due: addDays(now, LADDER_DAYS[0]), lastResult: null };
  saveRecall(row, now);
  return row;
}

/** Where a note goes after a check: on with most, same rung again with some, back a rung with little. */
export function nextRung(step: number, result: RecallResult): number {
  const last = LADDER_DAYS.length - 1;
  if (result === "most") return Math.min(last, step + 1);
  if (result === "little") return Math.max(0, step - 1);
  return Math.min(last, Math.max(0, step));
}

export function recordResult(noteId: string, result: RecallResult, now: Date): RecallRow {
  const row = getRecall(noteId);
  if (!row) throw new AppError("recall-not-found", `Recall checks are not on for ${noteId}`, 404);
  const step = nextRung(row.step, result);
  // A good result on the last rung waits longer again instead of repeating the same gap.
  const days = result === "most" && row.step >= LADDER_DAYS.length - 1 ? (LADDER_DAYS.at(-1) ?? 21) * 2 : LADDER_DAYS[step]!;
  const next = { noteId, step, due: addDays(now, days), lastResult: result };
  saveRecall(next, now);
  return next;
}

export function dueRecall(now: Date): RecallRow[] {
  return listRecall().filter((r) => new Date(r.due).getTime() <= now.getTime());
}
