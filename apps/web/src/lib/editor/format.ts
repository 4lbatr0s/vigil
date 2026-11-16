import { EditorSelection, type EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Markdown formatting as pure transaction builders (`state` in, a change out), so every rule is tested
 * without a browser. The `*Command` wrappers at the bottom are what keys and the toolbar call.
 */

/** Wraps the selection in `mark` (`**`, `*`, `` ` ``, `~~`), or removes the wrapper when it is already there. */
export function toggleInlineSpec(state: EditorState, mark: string): TransactionSpec {
  const doc = state.doc;
  let { from, to } = state.selection.main;
  // A triple click selects the line and its newline; the marks belong around the text, not the whitespace.
  while (from < to && /\s/.test(doc.sliceString(from, from + 1))) from++;
  while (to > from && /\s/.test(doc.sliceString(to - 1, to))) to--;
  const len = mark.length;
  // A single `*` next to another `*` is part of bold, not italic.
  const exact = (a: number, b: number): boolean => doc.sliceString(a, b) === mark && (mark !== "*" || (doc.sliceString(a - 1, a) !== "*" && doc.sliceString(b, b + 1) !== "*"));
  if (from === to) {
    if (exact(from - len, from) && exact(to, to + len)) {
      return { changes: [{ from: from - len, to: from }, { from: to, to: to + len }], selection: EditorSelection.cursor(from - len) };
    }
    return { changes: { from, insert: mark + mark }, selection: EditorSelection.cursor(from + len) };
  }
  if (exact(from - len, from) && exact(to, to + len)) {
    return { changes: [{ from: from - len, to: from }, { from: to, to: to + len }], selection: EditorSelection.range(from - len, to - len) };
  }
  const selected = doc.sliceString(from, to);
  if (selected.length > 2 * len && selected.startsWith(mark) && selected.endsWith(mark) && (mark !== "*" || (!selected.startsWith("**") && !selected.endsWith("**")))) {
    return { changes: { from, to, insert: selected.slice(len, -len) }, selection: EditorSelection.range(from, to - 2 * len) };
  }
  return { changes: [{ from, insert: mark }, { from: to, insert: mark }], selection: EditorSelection.range(from + len, to + len) };
}

/** `[text](url)` around the selection with `url` selected, ready to type over. */
export function insertLinkSpec(state: EditorState): TransactionSpec {
  const { from, to } = state.selection.main;
  const text = state.doc.sliceString(from, to);
  const url = "https://";
  const insert = `[${text}](${url})`;
  const urlFrom = from + text.length + 3;
  return { changes: { from, to, insert }, selection: EditorSelection.range(urlFrom, urlFrom + url.length) };
}

/**
 * Hides the selection as a fill-in-the-blank, `{{like this}}`, which makes the line a study card; the same
 * again takes the braces off. With nothing selected it inserts an empty pair with the cursor inside.
 */
export function toggleClozeSpec(state: EditorState): TransactionSpec {
  const doc = state.doc;
  let { from, to } = state.selection.main;
  while (from < to && /\s/.test(doc.sliceString(from, from + 1))) from++;
  while (to > from && /\s/.test(doc.sliceString(to - 1, to))) to--;
  const wrapped = doc.sliceString(from - 2, from) === "{{" && doc.sliceString(to, to + 2) === "}}";
  if (wrapped) return { changes: [{ from: from - 2, to: from }, { from: to, to: to + 2 }], selection: EditorSelection.range(from - 2, to - 2) };
  if (from === to) return { changes: { from, insert: "{{}}" }, selection: EditorSelection.cursor(from + 2) };
  return { changes: [{ from, insert: "{{" }, { from: to, insert: "}}" }], selection: EditorSelection.range(from + 2, to + 2) };
}

const HEADING = /^(#{1,6})\s+/;
const LIST_PREFIX = /^(\s*)(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/;

function selectedLines(state: EditorState): { from: number; to: number; number: number; text: string }[] {
  const { from, to } = state.selection.main;
  const out = [];
  for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
    const line = state.doc.line(n);
    out.push({ from: line.from, to: line.to, number: n, text: line.text });
  }
  return out;
}

/** Makes the selected lines heading `level`; the same level again turns it off. */
export function setHeadingSpec(state: EditorState, level: 1 | 2 | 3): TransactionSpec {
  const lines = selectedLines(state);
  const allSame = lines.every((l) => HEADING.exec(l.text)?.[1]?.length === level);
  const changes = lines.map((l) => {
    const m = HEADING.exec(l.text);
    const rest = m ? l.text.slice(m[0].length) : l.text;
    return { from: l.from, to: l.to, insert: allSame ? rest : `${"#".repeat(level)} ${rest}` };
  });
  return { changes };
}

export type LineKind = "quote" | "bullet" | "number" | "task";
const PREFIX: Record<LineKind, (i: number) => string> = {
  quote: () => "> ",
  bullet: () => "- ",
  number: (i) => `${i + 1}. `,
  task: () => "- [ ] ",
};
const HAS: Record<LineKind, RegExp> = {
  quote: /^\s*> /,
  bullet: /^\s*[-*+] (?!\[[ xX]\] )/,
  number: /^\s*\d+[.)] /,
  task: /^\s*[-*+] \[[ xX]\] /,
};

/** Turns the selected lines into a quote or a bullet, numbered or to-do list; if they already are one, back to plain text. */
export function toggleLineSpec(state: EditorState, kind: LineKind): TransactionSpec {
  const lines = selectedLines(state).filter((l, _i, all) => l.text.trim() !== "" || all.length === 1);
  const allHave = lines.length > 0 && lines.every((l) => HAS[kind].test(l.text));
  let i = 0;
  const changes = lines.map((l) => {
    const m = LIST_PREFIX.exec(l.text);
    const indent = m?.[1] ?? /^\s*/.exec(l.text)?.[0] ?? "";
    const rest = m ? l.text.slice(m[0].length) : l.text.slice(indent.length);
    return { from: l.from, to: l.to, insert: allHave ? indent + rest : indent + PREFIX[kind](i++) + rest };
  });
  return { changes };
}

/** Indents or outdents the current list item by its marker width; null when the line is not a list item (Tab then does its normal job). */
export function indentListSpec(state: EditorState, dir: 1 | -1): TransactionSpec | null {
  const line = state.doc.lineAt(state.selection.main.head);
  const m = /^(\s*)([-*+] (?:\[[ xX]\] )?|\d+[.)] )/.exec(line.text);
  if (!m) return null;
  const width = (m[2] ?? "").startsWith("-") || (m[2] ?? "").startsWith("*") || (m[2] ?? "").startsWith("+") ? 2 : 3;
  if (dir === 1) return { changes: { from: line.from, insert: " ".repeat(width) } };
  const lead = (m[1] ?? "").length;
  if (lead === 0) return null;
  const remove = Math.min(width, lead);
  return { changes: { from: line.from, to: line.from + remove } };
}

export type Command = (view: EditorView) => boolean;
const run = (spec: (s: EditorState) => TransactionSpec | null): Command => (view) => {
  const out = spec(view.state);
  if (!out) return false;
  view.dispatch({ ...out, scrollIntoView: true, userEvent: "input.format" });
  return true;
};

export const boldCommand = run((s) => toggleInlineSpec(s, "**"));
export const italicCommand = run((s) => toggleInlineSpec(s, "*"));
export const strikeCommand = run((s) => toggleInlineSpec(s, "~~"));
export const codeCommand = run((s) => toggleInlineSpec(s, "`"));
export const linkCommand = run(insertLinkSpec);
export const clozeCommand = run(toggleClozeSpec);
export const headingCommand = (level: 1 | 2 | 3): Command => run((s) => setHeadingSpec(s, level));
export const lineCommand = (kind: LineKind): Command => run((s) => toggleLineSpec(s, kind));
export const indentCommand: Command = run((s) => indentListSpec(s, 1));
export const outdentCommand: Command = run((s) => indentListSpec(s, -1));
