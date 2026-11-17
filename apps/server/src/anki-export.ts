import { cardsForNote, listCards, noteTagsAll } from "./index-db";

/**
 * Cards as tab-separated text that Anki's importer reads (ADR-0017: nothing is locked in). One row per card:
 * note type, the two fields, tags. A cloze card becomes Anki's `{{c1::text}}`. Written for the text importer
 * of Anki 2.1.54 and later (`#notetype column`); I did not run it through Anki itself.
 */

const field = (text: string): string => text.replace(/[\t\r]+/g, " ").replace(/\n/g, "<br>").trim();
const tag = (t: string): string => t.replace(/[^\p{L}\p{N}_/-]+/gu, "_");

export function exportTsv(noteId?: string): string {
  const cards = noteId ? cardsForNote(noteId) : listCards();
  const lines = ["#separator:tab", "#html:true", "#notetype column:1", "#tags column:4"];
  for (const c of cards) {
    const tags = [...new Set(noteTagsAll(c.noteId).map(tag)), `vigil_${tag(c.noteId)}`].join(" ");
    if (c.kind === "cloze") {
      // The stored back is the full sentence; rebuild the braces from the front's blanks.
      const parts = c.front.split("[…]");
      const hidden = c.back.length > 0 ? hiddenParts(c.front, c.back) : [];
      const text = parts.map((p, i) => (i < hidden.length ? `${p}{{c1::${hidden[i]}}}` : p)).join("");
      lines.push(["Cloze", field(text), "", tags].join("\t"));
    } else {
      lines.push(["Basic", field(c.front), field(c.back), tags].join("\t"));
    }
  }
  return lines.join("\n") + "\n";
}

/** The pieces of `back` that fill each `[…]` in `front` (the front is the back with those pieces blanked). */
function hiddenParts(front: string, back: string): string[] {
  const pieces = front.split("[…]");
  const out: string[] = [];
  let pos = 0;
  for (let i = 0; i < pieces.length - 1; i++) {
    const before = pieces[i] ?? "";
    const after = pieces[i + 1] ?? "";
    const start = pos + before.length;
    const end = after === "" ? back.length : back.indexOf(after, start);
    if (end < start) return [];
    out.push(back.slice(start, end));
    pos = end;
  }
  return out;
}
