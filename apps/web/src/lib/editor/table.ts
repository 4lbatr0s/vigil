import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, TransactionSpec } from "@codemirror/state";

/**
 * Markdown tables, edited from the keyboard: Tab and Shift+Tab move between cells, the columns are lined up as you go,
 * and Tab in the last cell adds a row. Only the table's own text changes, and the words in the cells are never altered.
 */
export type Align = "left" | "right" | "center" | "none";
export type Table = { rows: string[][]; aligns: Align[] };

/** Splits a row at the pipes that are not escaped (`\|`); the outer pipes are optional. */
export function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  return body.split(/(?<!\\)\|/).map((c) => c.trim());
}

const DELIMITER = /^\s*:?-{1,}:?\s*$/;

/** The table in these lines (header, delimiter row, body rows), or null when it is not one. */
export function parseTable(lines: readonly string[]): Table | null {
  if (lines.length < 2) return null;
  const delimiter = splitRow(lines[1] ?? "");
  if (delimiter.length === 0 || !delimiter.every((c) => DELIMITER.test(c))) return null;
  const aligns = delimiter.map((c): Align => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : "none"));
  const width = Math.max(aligns.length, splitRow(lines[0] ?? "").length);
  const fix = (cells: string[]): string[] => Array.from({ length: width }, (_, i) => cells[i] ?? "");
  const rows = [fix(splitRow(lines[0] ?? "")), ...lines.slice(2).map((l) => fix(splitRow(l)))];
  return { rows, aligns: Array.from({ length: width }, (_, i) => aligns[i] ?? "none") };
}

const pad = (text: string, width: number, align: Align): string => {
  const gap = Math.max(0, width - text.length);
  if (align === "right") return " ".repeat(gap) + text;
  if (align === "center") return " ".repeat(Math.floor(gap / 2)) + text + " ".repeat(Math.ceil(gap / 2));
  return text + " ".repeat(gap);
};

/** The table as aligned text: every column as wide as its widest cell (at least three). */
export function formatTable(t: Table): { text: string; widths: number[] } {
  const widths = t.aligns.map((_, c) => Math.max(3, ...t.rows.map((r) => (r[c] ?? "").length)));
  const row = (cells: string[]): string => `| ${cells.map((cell, c) => pad(cell, widths[c] ?? 3, t.aligns[c] ?? "none")).join(" | ")} |`.replace(/\s+$/, "");
  const rule = `| ${t.aligns.map((a, c) => { const w = widths[c] ?? 3; return a === "center" ? `:${"-".repeat(w - 2)}:` : a === "right" ? `${"-".repeat(w - 1)}:` : a === "left" ? `:${"-".repeat(w - 1)}` : "-".repeat(w); }).join(" | ")} |`;
  const [head, ...body] = t.rows;
  return { text: [row(head ?? []), rule, ...body.map(row)].join("\n"), widths };
}

/** Where cell (row, col) of a formatted table begins, as an offset from the table's start. `row` 0 is the header; the rule row is skipped. */
function cellStart(text: string, widths: readonly number[], row: number, col: number): number {
  const lines = text.split("\n");
  const lineIndex = row === 0 ? 0 : row + 1;
  const before = lines.slice(0, lineIndex).reduce((n, l) => n + l.length + 1, 0);
  return before + 2 + widths.slice(0, col).reduce((n, w) => n + w + 3, 0);
}

function tableNodeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, pos + 1), 200) ?? syntaxTree(state);
  for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "Table") return { from: n.from, to: n.to };
  }
  return null;
}

/** The cell the caret is in, as (row, col) with row 0 the header; null on the rule row or outside a table. */
export function cellAt(state: EditorState, pos: number): { row: number; col: number } | null {
  const table = tableNodeAt(state, pos);
  if (!table) return null;
  const line = state.doc.lineAt(pos);
  const index = line.number - state.doc.lineAt(table.from).number;
  if (index === 1) return null;
  const upTo = state.doc.sliceString(line.from, Math.max(line.from, pos));
  const lead = line.text.trimStart().startsWith("|") ? 1 : 0;
  const pipes = (upTo.match(/(?<!\\)\|/g) ?? []).length;
  return { row: index === 0 ? 0 : index - 1, col: Math.max(0, pipes - lead) };
}

/**
 * The Tab (`dir` 1) or Shift+Tab (-1) change inside a table: the table lined up again, with the next or previous cell
 * selected. Tab in the very last cell adds a row. Null when the caret is not in a table (so Tab does its other jobs).
 */
export function tabInTable(state: EditorState, pos: number, dir: 1 | -1): TransactionSpec | null {
  const node = tableNodeAt(state, pos);
  const at = cellAt(state, pos);
  if (!node || !at) return null;
  const table = parseTable(state.doc.sliceString(node.from, node.to).split("\n"));
  if (!table) return null;
  const cols = table.aligns.length;
  let row = at.row;
  let col = Math.min(at.col, cols - 1) + dir;
  if (col >= cols) {
    col = 0;
    row += 1;
  } else if (col < 0) {
    col = cols - 1;
    row -= 1;
  }
  if (row < 0) return null;
  if (row >= table.rows.length) table.rows.push(Array.from({ length: cols }, () => ""));
  const { text, widths } = formatTable(table);
  const start = node.from + cellStart(text, widths, row, col);
  const length = (table.rows[row]?.[col] ?? "").length;
  return { changes: { from: node.from, to: node.to, insert: text }, selection: { anchor: start, head: start + length }, userEvent: "input" };
}
