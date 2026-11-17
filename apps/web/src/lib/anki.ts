/**
 * Reading cards exported from Anki as text (File, Export, "Notes in Plain Text") into Vigil's own card
 * lines. Plain text only: no `.apkg` files, no review history. Nothing here touches a note; the learner
 * reviews the lines before saving.
 */

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Anki fields hold HTML: line breaks become spaces, other tags and common entities go. */
export function plain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?(div|p|li)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** `{{c1::answer::hint}}` becomes Vigil's `{{answer}}`. */
export function clozeToVigil(text: string): string {
  return text.replace(/\{\{c\d+::(.+?)(?:::.*?)?\}\}/g, "{{$1}}");
}

export type ImportResult = { lines: string[]; skipped: number };

const MAX_LINES = 5_000;

/**
 * Tab-separated text to card lines. Understands the header lines Anki and Vigil write (`#notetype column:N`,
 * `#tags column:N`); without them it takes the first two columns as front and back. Rows it cannot use are
 * counted in `skipped`.
 */
export function ankiToCards(text: string): ImportResult {
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  let noteTypeCol = 0;
  let tagsCol = 0;
  const data: string[] = [];
  for (const row of rows) {
    if (row.startsWith("#")) {
      const m = /^#(notetype|tags) column:(\d+)/.exec(row);
      if (m) (m[1] === "notetype" ? (noteTypeCol = Number(m[2])) : (tagsCol = Number(m[2])));
      continue;
    }
    if (row.trim() !== "") data.push(row);
  }
  const lines: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const row of data) {
    if (lines.length >= MAX_LINES) {
      skipped++;
      continue;
    }
    const cols = row.split("\t");
    const type = noteTypeCol > 0 ? (cols[noteTypeCol - 1] ?? "").toLowerCase() : "";
    const fields = cols.filter((_, i) => i + 1 !== noteTypeCol && i + 1 !== tagsCol);
    const cloze = type.includes("cloze") || /\{\{c\d+::/.test(fields[0] ?? "");
    let line = "";
    if (cloze) {
      const text1 = clozeToVigil(plain(fields[0] ?? ""));
      if (/\{\{[^{}]+\}\}/.test(text1)) line = text1;
    } else {
      const front = plain(fields[0] ?? "").replace(/ :: /g, " : ");
      const back = plain(fields[1] ?? "").replace(/ :: /g, " : ");
      if (front !== "" && back !== "") line = `${front} :: ${back}`;
    }
    if (line === "" || seen.has(line)) {
      skipped++;
      continue;
    }
    seen.add(line);
    lines.push(line);
  }
  return { lines, skipped };
}
