import { slugify } from "@vigil/shared";

const TIME = /^\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}\s+-->\s+(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3}.*$/;

/**
 * Plain text from a pasted or uploaded lecture transcript or article. Caption files (.srt, .vtt) lose their cue
 * numbers, time lines and tags, and repeated lines (captions often say the same thing twice) are kept once.
 */
export function cleanSource(raw: string): string {
  const out: string[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    const t = line.trim();
    if (/^WEBVTT\b/.test(t) || /^(NOTE|STYLE|REGION)\b/.test(t) || TIME.test(t) || /^\d+$/.test(t)) continue;
    const text = t.replace(/<[^>]+>/g, "").trim();
    if (text === "") {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    const last = out.filter((l) => l !== "").at(-1);
    if (last === text) {
      // A repeat (captions often say a line twice): keep it once, and do not leave the blank line before it either.
      while (out[out.length - 1] === "") out.pop();
      continue;
    }
    out.push(text);
  }
  while (out[out.length - 1] === "") out.pop();
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** The note a source becomes: titled "Source: ...", tagged #source, with where it came from at the top. */
export function sourceNote(title: string, text: string, origin: string): { id: string; title: string; body: string; tags: string[] } {
  const clean = title.trim() === "" ? "Untitled" : title.trim().slice(0, 120);
  const noteTitle = `Source: ${clean}`;
  const from = origin.trim() === "" ? "" : `From: ${origin.trim()}\n\n`;
  return { id: slugify(noteTitle), title: noteTitle, body: `${from}${cleanSource(text)}\n`, tags: ["source"] };
}
