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
