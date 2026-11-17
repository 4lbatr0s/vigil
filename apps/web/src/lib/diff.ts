export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/**
 * Line diff by longest common subsequence: lines only in `before` are "del", lines only in `after`
 * are "add". `before` null means a new note (every line is added). No dependency.
 * Very long texts fall back to "all removed, all added" rather than build a huge table.
 */
export function diffLines(before: string | null, after: string): DiffLine[] {
  const b = before === null ? [] : splitLines(before);
  const a = splitLines(after);
  if (b.length * a.length > 4_000_000) {
    return [...b.map((text) => ({ kind: "del" as const, text })), ...a.map((text) => ({ kind: "add" as const, text }))];
  }
  // lcs[i][j] = length of the common subsequence of b[i..] and a[j..]
  const lcs: number[][] = Array.from({ length: b.length + 1 }, () => new Array<number>(a.length + 1).fill(0));
  for (let i = b.length - 1; i >= 0; i--) {
    for (let j = a.length - 1; j >= 0; j--) {
      lcs[i]![j] = b[i] === a[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < b.length && j < a.length) {
    if (b[i] === a[j]) {
      out.push({ kind: "same", text: b[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "del", text: b[i++]! });
    } else {
      out.push({ kind: "add", text: a[j++]! });
    }
  }
  while (i < b.length) out.push({ kind: "del", text: b[i++]! });
  while (j < a.length) out.push({ kind: "add", text: a[j++]! });
  return out;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop(); // a trailing newline is not an extra empty line
  return lines;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  return { added: lines.filter((l) => l.kind === "add").length, removed: lines.filter((l) => l.kind === "del").length };
}

export type Segment = { kind: "same"; lines: string[] } | { kind: "change"; id: number; del: string[]; add: string[] };

/** Groups a line diff into untouched stretches and changes (a run of removed and added lines is one change). */
export function segments(lines: DiffLine[]): Segment[] {
  const out: Segment[] = [];
  let id = 0;
  for (const l of lines) {
    const last = out.at(-1);
    if (l.kind === "same") {
      if (last?.kind === "same") last.lines.push(l.text);
      else out.push({ kind: "same", lines: [l.text] });
    } else {
      const change = last?.kind === "change" ? last : (out.push({ kind: "change", id: id++, del: [], add: [] }), out.at(-1) as Extract<Segment, { kind: "change" }>);
      (l.kind === "del" ? change.del : change.add).push(l.text);
    }
  }
  return out;
}

/**
 * `after` with one change put back the way `before` had it and every other change kept. `changeId` is the id
 * from `segments`. A trailing newline in `after` is kept.
 */
export function revertChange(before: string, after: string, changeId: number): string {
  const lines: string[] = [];
  for (const s of segments(diffLines(before, after))) {
    if (s.kind === "same") lines.push(...s.lines);
    else lines.push(...(s.id === changeId ? s.del : s.add));
  }
  const text = lines.join("\n");
  return after.endsWith("\n") && lines.length > 0 ? `${text}\n` : text;
}
