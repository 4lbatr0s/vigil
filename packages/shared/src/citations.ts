/** One numbered line of a note given to the model as a source. */
export type Passage = { n: number; noteId: string; title: string; line: number; text: string };

export type Part = { kind: "text"; text: string } | { kind: "cite"; n: number; passage: Passage | null };

export const NOT_COVERED = "Your notes do not cover this";

/** The answer cut into plain text and `[n]` marks; a mark whose number is not one of the given lines has no passage. */
export function splitAnswer(answer: string, passages: Passage[]): Part[] {
  const byN = new Map(passages.map((p) => [p.n, p]));
  const parts: Part[] = [];
  let last = 0;
  for (const m of answer.matchAll(/\[(\d{1,3})\]/g)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ kind: "text", text: answer.slice(last, at) });
    const n = Number(m[1]);
    parts.push({ kind: "cite", n, passage: byN.get(n) ?? null });
    last = at + m[0].length;
  }
  if (last < answer.length) parts.push({ kind: "text", text: answer.slice(last) });
  return parts;
}

export type Verdict = "covered" | "not-covered" | "no-marks" | "bad-marks";

/**
 * How far to trust an answer: "not-covered" when the agent said the notes do not cover it, "bad-marks" when a
 * mark points at a line that was never given, "no-marks" when it states things with no source, else "covered".
 */
export function verdict(answer: string, passages: Passage[]): Verdict {
  if (answer.trim().startsWith(NOT_COVERED)) return "not-covered";
  const cites = splitAnswer(answer, passages).filter((p) => p.kind === "cite");
  if (cites.length === 0) return "no-marks";
  if (cites.some((c) => c.passage === null)) return "bad-marks";
  return "covered";
}

/** The lines the answer points at, each once, in the order they first appear. */
export function usedPassages(answer: string, passages: Passage[]): Passage[] {
  const seen = new Set<number>();
  const out: Passage[] = [];
  for (const p of splitAnswer(answer, passages)) {
    if (p.kind === "cite" && p.passage && !seen.has(p.n)) {
      seen.add(p.n);
      out.push(p.passage);
    }
  }
  return out;
}
