import { extractCards, type Card } from "@vigil/shared";

/** One proposed card as the review panel shows it: the line the owner may edit, and whether it is kept. */
export type Proposal = { key: string; line: string; keep: boolean; duplicate: boolean };

/** The lines of an agent's answer that are cards, as written. The model may wrap them in lists or prose; only card lines count. */
export function proposalsFrom(answer: string, existing: readonly Card[]): Proposal[] {
  const have = new Set(existing.map((c) => c.id));
  const out: Proposal[] = [];
  const seen = new Set<string>();
  for (const raw of answer.split("\n")) {
    const text = raw.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)+/, "").trim();
    const [card] = extractCards(text);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    const duplicate = have.has(card.id);
    out.push({ key: card.id, line: text, keep: !duplicate, duplicate });
  }
  return out;
}

/** Whether an edited line is still exactly one card. */
export const isCardLine = (line: string): boolean => extractCards(line.trim()).length === 1 && !line.includes("\n");

/**
 * The note body with the kept cards added under a `## Cards` heading (created at the end when the note has
 * none). Nothing else in the note changes.
 */
export function appendCards(body: string, lines: readonly string[]): string {
  const add = lines.map((l) => l.trim()).filter((l) => l !== "");
  if (add.length === 0) return body;
  const heading = /^##\s+Cards\s*$/m.exec(body);
  if (!heading) return `${body.replace(/\s+$/, "")}${body.trim() === "" ? "" : "\n\n"}## Cards\n${add.join("\n")}\n`;
  // Insert after the last line of the Cards section: up to the next heading, ignoring trailing blank lines.
  const start = heading.index + heading[0].length;
  const next = /^#{1,6}\s/m.exec(body.slice(start));
  const end = next ? start + next.index : body.length;
  const section = body.slice(start, end).replace(/\s+$/, "");
  const tail = body.slice(end);
  return `${body.slice(0, start)}${section}\n${add.join("\n")}\n${tail === "" ? "" : `\n${tail}`}`;
}
