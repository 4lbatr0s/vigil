import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { rank } from "../fuzzy";

type Block = {
  label: string;
  hint: string;
  words: string;
  /** Multi-line blocks (table, callout, code): text right below would run into them, so a blank line is added when needed. */
  block?: boolean;
  insert: (state: EditorState, from: number) => { text: string; cursor: number };
};

const plain = (text: string, cursor = text.length): Block["insert"] => () => ({ text, cursor });
/** A divider right under a text line would turn that line into a heading, so it gets a blank line first. */
const divider: Block["insert"] = (state, from) => {
  const n = state.doc.lineAt(from).number;
  const lead = n > 1 && state.doc.line(n - 1).text.trim() !== "" ? "\n" : "";
  return { text: `${lead}---\n`, cursor: lead.length + 4 };
};

export const BLOCKS: Block[] = [
  { label: "Heading 1", hint: "#", words: "h1 title", insert: plain("# ") },
  { label: "Heading 2", hint: "##", words: "h2 section", insert: plain("## ") },
  { label: "Heading 3", hint: "###", words: "h3 subsection", insert: plain("### ") },
  { label: "Bulleted list", hint: "-", words: "ul unordered", insert: plain("- ") },
  { label: "Numbered list", hint: "1.", words: "ol ordered", insert: plain("1. ") },
  { label: "To-do list", hint: "[ ]", words: "task checkbox todo", insert: plain("- [ ] ") },
  { label: "Quote", hint: ">", words: "blockquote", insert: plain("> ") },
  { label: "Callout", hint: "[!note]", words: "note info warning tip", block: true, insert: plain("> [!note] \n> ", 10) },
  { label: "Code block", hint: "```", words: "snippet pre", block: true, insert: plain("```\n\n```", 4) },
  { label: "Table", hint: "| |", words: "grid columns", block: true, insert: plain("| Column | Column |\n| --- | --- |\n|  |  |", 41) },
  { label: "Divider", hint: "---", words: "line rule hr", insert: divider },
];

function inCode(state: EditorState, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "InlineCode") return true;
  }
  return false;
}

/**
 * The `/` menu: type `/` at the start of an empty-so-far line to insert a block (heading, list, to-do,
 * quote, callout, code, table, divider). Never fires inside code or in the middle of a line.
 */
export function completeSlash(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\/[\w-]*$/);
  if (!match) return null;
  const line = context.state.doc.lineAt(match.from);
  if (context.state.doc.sliceString(line.from, match.from).trim() !== "") return null;
  if (inCode(context.state, match.from)) return null;
  const query = context.state.doc.sliceString(match.from + 1, context.pos);
  const options: Completion[] = rank(BLOCKS, query, (b) => `${b.label} ${b.words}`).map((b) => ({
    label: b.label,
    detail: b.hint,
    type: "keyword",
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      const { text, cursor } = b.insert(view.state, from);
      const doc = view.state.doc;
      const n = doc.lineAt(to).number;
      const crowded = b.block === true && n < doc.lines && doc.line(n + 1).text.trim() !== "";
      view.dispatch({ changes: { from, to, insert: crowded ? `${text}\n` : text }, selection: { anchor: from + cursor }, userEvent: "input.complete" });
    },
  }));
  if (options.length === 0) return null;
  return { from: match.from, options, filter: false };
}
