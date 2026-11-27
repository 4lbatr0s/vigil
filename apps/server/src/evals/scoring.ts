import { NOT_COVERED, usedPassages, verdict, type Passage } from "@vigil/shared";

/**
 * One question put to "Ask your notes" and what a good answer looks like. `covered`: the notes hold the answer and the
 * reply must cite one of `sources`. `not-covered`: the notes do not hold it and the reply must say so.
 */
export type AskCase = { id: string; question: string; expect: "covered" | "not-covered"; sources?: string[] };

/** What happened: the lines found, the model's answer (`null` when no model was called), and how long it took. */
export type AskOutcome = { caseId: string; passages: Passage[]; answer: string | null; seconds: number; failed?: string };

export type AskVerdict = "covered" | "not-covered" | "no-marks" | "bad-marks" | "empty" | "failed" | "no-call";
export type AskScore = { caseId: string; pass: boolean; verdict: AskVerdict; citedNotes: string[]; seconds: number; reason: string };

/** Judges one outcome by the same citation rules the Ask page uses (`verdict`, from @vigil/shared). */
export function scoreAsk(c: AskCase, o: AskOutcome): AskScore {
  const done = (pass: boolean, v: AskVerdict, reason: string, cited: string[] = []): AskScore => ({ caseId: c.id, pass, verdict: v, citedNotes: cited, seconds: o.seconds, reason });
  if (o.failed !== undefined) return done(false, "failed", o.failed);
  if (o.answer === null) {
    // The notes held no matching line, so the model was never asked: right for a question they do not cover.
    return c.expect === "not-covered" ? done(true, "no-call", "no matching line, so no model call") : done(false, "no-call", "no matching line was found for an answerable question");
  }
  if (o.answer.trim() === "") return done(false, "empty", "empty reply");
  const v = verdict(o.answer, o.passages);
  if (v === "not-covered") return c.expect === "not-covered" ? done(true, v, "refused correctly") : done(false, v, "refused a question the notes cover");
  if (c.expect === "not-covered") return done(false, v, "answered a question the notes do not cover");
  if (v === "no-marks" || v === "bad-marks") return done(false, v, v === "no-marks" ? "no source marks" : "a mark points at a line that was not given");
  const cited = [...new Set(usedPassages(o.answer, o.passages).map((p) => p.noteId))];
  const right = (c.sources ?? []).length === 0 || cited.some((id) => c.sources?.includes(id));
  return right ? done(true, v, "cited a right source", cited) : done(false, v, `cited ${cited.join(", ") || "nothing"}, expected ${(c.sources ?? []).join(" or ")}`, cited);
}

export type AskSummary = { total: number; passed: number; passRate: number; emptyRate: number; badMarksRate: number; failedRate: number; avgSeconds: number };

/** The numbers to compare between models and between versions of the prompt. */
export function summarize(scores: AskScore[]): AskSummary {
  const total = scores.length;
  if (total === 0) return { total: 0, passed: 0, passRate: 0, emptyRate: 0, badMarksRate: 0, failedRate: 0, avgSeconds: 0 };
  const rate = (f: (s: AskScore) => boolean): number => scores.filter(f).length / total;
  return {
    total,
    passed: scores.filter((s) => s.pass).length,
    passRate: rate((s) => s.pass),
    emptyRate: rate((s) => s.verdict === "empty"),
    badMarksRate: rate((s) => s.verdict === "bad-marks"),
    failedRate: rate((s) => s.verdict === "failed"),
    avgSeconds: scores.reduce((n, s) => n + s.seconds, 0) / total,
  };
}

export { NOT_COVERED };
