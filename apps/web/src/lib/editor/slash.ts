import { startCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { rank } from "../fuzzy";

/** The groups the menu shows, in this order. */
export const GROUPS = ["Basic", "Lists", "Blocks", "Insert", "Study", "Agents"] as const;
type Group = (typeof GROUPS)[number];

type Block = {
  label: string;
  hint: string;
  words: string;
  group: Group;
  /** The icon, by the name in `icons.ts`. */
  icon: string;
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

const today = (): string => {
  const d = new Date();
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

export const BLOCKS: Block[] = [
  { label: "Heading 1", group: "Basic", icon: "heading1", hint: "#", words: "h1 title", insert: plain("# ") },
  { label: "Heading 2", group: "Basic", icon: "heading2", hint: "##", words: "h2 section", insert: plain("## ") },
  { label: "Heading 3", group: "Basic", icon: "heading3", hint: "###", words: "h3 subsection", insert: plain("### ") },
  { label: "Bulleted list", group: "Lists", icon: "list", hint: "-", words: "ul unordered", insert: plain("- ") },
  { label: "Numbered list", group: "Lists", icon: "listOrdered", hint: "1.", words: "ol ordered", insert: plain("1. ") },
  { label: "To-do list", group: "Lists", icon: "listTodo", hint: "[ ]", words: "task checkbox todo", insert: plain("- [ ] ") },
  { label: "Quote", group: "Basic", icon: "textQuote", hint: ">", words: "blockquote", insert: plain("> ") },
  { label: "Callout", group: "Blocks", icon: "info", hint: "[!note]", words: "note info warning tip", block: true, insert: plain("> [!note] \n> ", 10) },
  { label: "Code block", group: "Blocks", icon: "code", hint: "```", words: "snippet pre", block: true, insert: plain("```\n\n```", 4) },
  { label: "Table", group: "Blocks", icon: "table", hint: "| |", words: "grid columns", block: true, insert: plain("| Column | Column |\n| --- | --- |\n|  |  |", 41) },
  { label: "Question card", group: "Study", icon: "brain", hint: "Q :: A", words: "flashcard study qa", insert: plain(" :: ", 0) },
  { label: "Cloze card", group: "Study", icon: "brain", hint: "{{ }}", words: "flashcard study blank fill", insert: plain("{{}}", 2) },
  { label: "Divider", group: "Basic", icon: "minus", hint: "---", words: "line rule hr", insert: divider },
  { label: "Tip", group: "Blocks", icon: "info", hint: "[!tip]", words: "callout hint idea", block: true, insert: plain("> [!tip] \n> ", 9) },
  { label: "Warning", group: "Blocks", icon: "info", hint: "[!warning]", words: "callout caution danger", block: true, insert: plain("> [!warning] \n> ", 14) },
  { label: "Link to a note", group: "Insert", icon: "link", hint: "[[ ]]", words: "wikilink reference note", insert: (_s, _f) => ({ text: "[[", cursor: 2 }) },
  { label: "Today's date", group: "Insert", icon: "calendar", hint: "date", words: "day time stamp", insert: () => ({ text: today(), cursor: today().length }) },
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
export function completeSlash(context: CompletionContext, onAsk?: () => void, handlers: { onImage?: () => void } = {}): CompletionResult | null {
  const match = context.matchBefore(/\/[\w-]*$/);
  if (!match) return null;
  const line = context.state.doc.lineAt(match.from);
  if (context.state.doc.sliceString(line.from, match.from).trim() !== "") return null;
  if (inCode(context.state, match.from)) return null;
  const query = context.state.doc.sliceString(match.from + 1, context.pos);
  const options: Completion[] = rank(BLOCKS, query, (b) => `${b.label} ${b.words}`).map((b) => ({
    label: b.label,
    detail: b.hint,
    type: b.icon,
    section: { name: b.group, rank: GROUPS.indexOf(b.group) },
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      const { text, cursor } = b.insert(view.state, from);
      const doc = view.state.doc;
      const n = doc.lineAt(to).number;
      const crowded = b.block === true && n < doc.lines && doc.line(n + 1).text.trim() !== "";
      view.dispatch({ changes: { from, to, insert: crowded ? `${text}\n` : text }, selection: { anchor: from + cursor }, userEvent: "input.complete" });
      if (b.label === "Link to a note") startCompletion(view);
    },
  }));
  // "Image" opens the file chooser, so it is offered only when the page can handle that.
  if (handlers.onImage && rank([{ label: "Image", words: "picture photo upload" }], query, (b) => `${b.label} ${b.words}`).length > 0) {
    options.push({
      label: "Image",
      detail: "upload",
      type: "image",
      section: { name: "Insert", rank: GROUPS.indexOf("Insert") },
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        view.dispatch({ changes: { from, to, insert: "" }, userEvent: "input.complete" });
        handlers.onImage?.();
      },
    });
  }
  // "Ask an agent" is not a block: it removes the slash text and opens the ask dialog.
  if (onAsk && rank([{ label: "Ask an agent", words: "ai assistant ask" }], query, (b) => `${b.label} ${b.words}`).length > 0) {
    options.push({
      label: "Ask an agent",
      detail: "agent",
      type: "bot",
      section: { name: "Agents", rank: GROUPS.indexOf("Agents") },
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        view.dispatch({ changes: { from, to, insert: "" }, userEvent: "input.complete" });
        onAsk();
      },
    });
  }
  if (options.length === 0) return null;
  return { from: match.from, options, filter: false };
}
