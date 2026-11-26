import { slugify } from "@vigil/shared";

/**
 * Sorting the inbox by hand (2026-11-26). Each captured line can become a note of its own, be added to a note, or be
 * deleted. These helpers work on the Inbox note's text; the page saves it with the base time, so a capture that lands
 * in between is never lost.
 */
export type InboxLine = { line: number; text: string };

const TITLE_MAX = 72;

function bodyStart(lines: string[]): number {
  if (lines[0] !== "---") return 0;
  const end = lines.indexOf("---", 1);
  return end === -1 ? 0 : end + 1;
}

export function inboxLines(body: string): InboxLine[] {
  const lines = body.split("\n");
  const out: InboxLine[] = [];
  for (let i = bodyStart(lines); i < lines.length; i += 1) {
    const text = (lines[i] ?? "").replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "").trim();
    if (text !== "") out.push({ line: i, text });
  }
  return out;
}

export function withoutLine(body: string, line: number): string {
  const lines = body.split("\n");
  lines.splice(line, 1);
  return lines.join("\n");
}

export function appendLine(body: string, text: string): string {
  const base = body === "" || body.endsWith("\n") ? body : `${body}\n`;
  return `${base}- ${text}\n`;
}

/** A short line becomes the title; a long one is cut at a word for the title and kept whole as the first paragraph. */
export function noteFromLine(text: string): { id: string; title: string; body: string } {
  if (text.length <= TITLE_MAX) return { id: slugify(text), title: text, body: "" };
  const cut = text.slice(0, TITLE_MAX + 1);
  const title = cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : TITLE_MAX).trim();
  return { id: slugify(title), title, body: `${text}\n` };
}
