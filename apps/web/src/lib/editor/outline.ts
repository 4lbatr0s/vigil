import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type OutlineItem = { level: number; title: string; from: number };

/** The headings of the note in order, with where each starts, for the outline list. Headings inside code are not headings. */
export function outlineOf(state: EditorState): OutlineItem[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 250) ?? syntaxTree(state);
  const out: OutlineItem[] = [];
  tree.iterate({
    enter(node) {
      const m = /^ATXHeading([1-6])$/.exec(node.name) ?? /^SetextHeading([12])$/.exec(node.name);
      if (!m) return;
      const line = state.doc.lineAt(node.from);
      const title = (node.name.startsWith("ATX") ? line.text.replace(/^\s*#{1,6}\s+/, "").replace(/\s+#+\s*$/, "") : line.text).trim();
      if (title !== "") out.push({ level: Number(m[1]), title, from: line.from });
      return false;
    },
  });
  return out;
}
