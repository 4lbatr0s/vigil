import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { ChangeSpec, EditorState } from "@codemirror/state";

/**
 * Blocks of a note, for the drag handle and the block menu: a paragraph, a heading, a code block, a quote, a
 * table, a divider, or one top-level list item with everything nested under it. A block is whole lines, from the
 * start of its first line to the end of its last. Everything here only reads the syntax tree and returns changes; the
 * note on disk changes only when the editor applies them.
 */
export type Block = { from: number; to: number; startLine: number; endLine: number; kind: "list" | "block"; type: string };

export function blocksOf(state: EditorState): Block[] {
  const doc = state.doc;
  const tree = ensureSyntaxTree(state, doc.length, 250) ?? syntaxTree(state);
  const out: Block[] = [];
  const add = (node: { from: number; to: number; name: string }, kind: Block["kind"]): void => {
    const first = doc.lineAt(node.from);
    const last = doc.lineAt(Math.max(node.from, node.to - 1));
    out.push({ from: first.from, to: last.to, startLine: first.number, endLine: last.number, kind, type: node.name });
  };
  const cursor = tree.topNode.cursor();
  if (!cursor.firstChild()) return out;
  do {
    if (cursor.name === "BulletList" || cursor.name === "OrderedList") {
      for (let item = cursor.node.firstChild; item; item = item.nextSibling) if (item.name === "ListItem") add(item, "list");
    } else {
      add(cursor.node, "block");
    }
  } while (cursor.nextSibling());
  return out;
}

/** The block that holds `pos`, or null on a blank line between blocks. */
export function blockIndexAt(blocks: readonly Block[], pos: number): number {
  return blocks.findIndex((b) => pos >= b.from && pos <= b.to);
}

const isBlank = (state: EditorState, line: number): boolean => line >= 1 && line <= state.doc.lines && state.doc.line(line).text.trim() === "";

/** The text to take out so the block leaves no extra blank line: its own lines and one blank line beside it. */
function removal(state: EditorState, b: Block): { from: number; to: number } {
  const doc = state.doc;
  if (b.endLine < doc.lines) {
    // A blank line after the block goes with it; so does the line break.
    const to = isBlank(state, b.endLine + 1) ? doc.line(b.endLine + 1).to + 1 : doc.line(b.endLine).to + 1;
    return { from: b.from, to: Math.min(doc.length, to) };
  }
  // The block ends the note: take the line break before it (and a blank line before that) instead.
  const lead = isBlank(state, b.startLine - 1) ? doc.line(b.startLine - 1).from : b.from;
  return { from: Math.max(0, lead - 1), to: doc.length };
}

/**
 * Moves block `index` to just before or after block `target`. List items stay tight with list neighbours; other
 * blocks get one blank line around them, as markdown wants. Returns no changes when the block would not move.
 */
export function moveBlock(state: EditorState, blocks: readonly Block[], index: number, target: number, after: boolean): ChangeSpec[] {
  const a = blocks[index];
  const b = blocks[target];
  if (!a || !b || index === target) return [];
  if (after ? target === index - 1 : target === index + 1) return [];
  const text = state.doc.sliceString(a.from, a.to);
  const gap = a.kind === "list" && b.kind === "list" ? "" : "\n";
  const cut = removal(state, a);
  const insert = after ? { at: b.to, text: `\n${gap}${text}` } : { at: b.from, text: `${text}\n${gap}` };
  return [{ from: cut.from, to: cut.to }, { from: insert.at, insert: insert.text }];
}

/** A copy of the block right below it. */
export function duplicateBlock(state: EditorState, b: Block): ChangeSpec {
  const text = state.doc.sliceString(b.from, b.to);
  return { from: b.to, insert: `\n${b.kind === "list" ? "" : "\n"}${text}` };
}

/** The block taken out, with one blank line beside it. */
export function deleteBlock(state: EditorState, b: Block): ChangeSpec {
  return removal(state, b);
}

export type TurnInto = "text" | "h1" | "h2" | "h3" | "bullet" | "number" | "todo" | "quote" | "callout" | "code";

const MARKER = /^(\s*)(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?(?:\[![A-Za-z]+\][+-]?\s*)?)/;

/** A line without its block marker (heading hashes, bullet, number, task box, quote mark or callout marker). */
const bare = (line: string): string => line.replace(MARKER, "$1");

/**
 * The change that gives a block another kind: the old marker comes off, the new one goes on. A code block turns
 * back into text by dropping its fences. Only markers change; the words stay exactly as they are.
 */
export function turnInto(state: EditorState, b: Block, kind: TurnInto): ChangeSpec {
  const raw = state.doc.sliceString(b.from, b.to);
  let lines = raw.split("\n");
  if (b.type === "FencedCode" && lines.length >= 2) {
    const closed = /^\s*(```|~~~)/.test(lines[lines.length - 1] ?? "");
    lines = lines.slice(1, closed ? -1 : undefined);
    if (kind === "code") return { from: b.from, to: b.to, insert: raw };
  } else if (b.kind === "list") {
    // Only the item's own line changes; what is nested under it keeps its indentation.
    const [first = "", ...rest] = lines;
    return { from: b.from, to: b.to, insert: [markFirst(bare(first), kind), ...rest].join("\n") };
  } else {
    lines = lines.map(bare);
  }
  let out: string[];
  switch (kind) {
    case "text":
      out = lines;
      break;
    case "h1":
    case "h2":
    case "h3":
      out = [`${"#".repeat(Number(kind[1]))} ${lines.join(" ").trim()}`];
      break;
    case "bullet":
      out = lines.map((l) => `- ${l.trim()}`);
      break;
    case "number":
      out = lines.map((l, i) => `${i + 1}. ${l.trim()}`);
      break;
    case "todo":
      out = lines.map((l) => `- [ ] ${l.trim()}`);
      break;
    case "quote":
      out = lines.map((l) => `> ${l}`.trimEnd());
      break;
    case "callout":
      out = [`> [!note] ${lines[0]?.trim() ?? ""}`.trimEnd(), ...lines.slice(1).map((l) => `> ${l}`.trimEnd())];
      break;
    case "code":
      out = ["```", ...lines, "```"];
      break;
  }
  return { from: b.from, to: b.to, insert: out.join("\n") };
}

function markFirst(text: string, kind: TurnInto): string {
  const indent = /^\s*/.exec(text)?.[0] ?? "";
  const body = text.trim();
  switch (kind) {
    case "text":
      return `${indent}${body}`;
    case "h1":
    case "h2":
    case "h3":
      return `${"#".repeat(Number(kind[1]))} ${body}`;
    case "bullet":
      return `${indent}- ${body}`;
    case "number":
      return `${indent}1. ${body}`;
    case "todo":
      return `${indent}- [ ] ${body}`;
    case "quote":
      return `> ${body}`;
    case "callout":
      return `> [!note] ${body}`;
    case "code":
      return `\`\`\`\n${body}\n\`\`\``;
  }
}

/**
 * Where the moved block starts after `moveBlock`'s changes are applied (for putting the caret back in it).
 * `changes` is the change set built from `moveBlock`'s result against the same state.
 */
export function movedBlockStart(blocks: readonly Block[], index: number, target: number, after: boolean, changes: { mapPos(pos: number, assoc?: number): number }): number {
  const a = blocks[index];
  const b = blocks[target];
  if (!a || !b) return 0;
  const gap = a.kind === "list" && b.kind === "list" ? 0 : 1;
  return after ? changes.mapPos(b.to, -1) + 1 + gap : changes.mapPos(b.from, -1);
}
