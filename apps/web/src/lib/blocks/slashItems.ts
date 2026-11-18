import type { Editor, Range } from "@tiptap/core";
import { rank } from "../fuzzy";
import type { ICONS } from "../editor/icons";

export const SLASH_GROUPS = ["Basic", "Lists", "Blocks", "Insert", "Study", "Agents"] as const;
export type SlashGroup = (typeof SLASH_GROUPS)[number];

export type SlashItem = {
  id: string;
  label: string;
  hint: string;
  words: string;
  group: SlashGroup;
  icon: keyof typeof ICONS;
  /** Runs with the typed `/word` already removed; the caret is where the block should go. */
  run: (editor: Editor) => void;
};

export type SlashHandlers = { onImage?: () => void; onAsk?: () => void };

const today = (): string => {
  const d = new Date();
  const two = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

const callout = (kind: string) => (e: Editor): void => {
  e.chain().focus().insertContent({ type: "callout", attrs: { kind, fold: "", title: "" }, content: [{ type: "paragraph" }] }).run();
};

const ITEMS: SlashItem[] = [
  { id: "h1", label: "Heading 1", group: "Basic", icon: "heading1", hint: "#", words: "h1 title", run: (e) => void e.chain().focus().setHeading({ level: 1 }).run() },
  { id: "h2", label: "Heading 2", group: "Basic", icon: "heading2", hint: "##", words: "h2 section", run: (e) => void e.chain().focus().setHeading({ level: 2 }).run() },
  { id: "h3", label: "Heading 3", group: "Basic", icon: "heading3", hint: "###", words: "h3 subsection", run: (e) => void e.chain().focus().setHeading({ level: 3 }).run() },
  { id: "quote", label: "Quote", group: "Basic", icon: "textQuote", hint: ">", words: "blockquote", run: (e) => void e.chain().focus().setBlockquote().run() },
  { id: "divider", label: "Divider", group: "Basic", icon: "minus", hint: "---", words: "line rule hr", run: (e) => void e.chain().focus().setHorizontalRule().run() },
  { id: "bullet", label: "Bulleted list", group: "Lists", icon: "list", hint: "-", words: "ul unordered", run: (e) => void e.chain().focus().toggleBulletList().run() },
  { id: "number", label: "Numbered list", group: "Lists", icon: "listOrdered", hint: "1.", words: "ol ordered", run: (e) => void e.chain().focus().toggleOrderedList().run() },
  { id: "todo", label: "To-do list", group: "Lists", icon: "listTodo", hint: "[ ]", words: "task checkbox todo", run: (e) => void e.chain().focus().toggleTaskList().run() },
  { id: "callout", label: "Callout", group: "Blocks", icon: "info", hint: "[!note]", words: "note info", run: callout("note") },
  { id: "tip", label: "Tip", group: "Blocks", icon: "lightbulb", hint: "[!tip]", words: "callout hint idea", run: callout("tip") },
  { id: "warning", label: "Warning", group: "Blocks", icon: "triangleAlert", hint: "[!warning]", words: "callout caution danger", run: callout("warning") },
  { id: "code", label: "Code block", group: "Blocks", icon: "code", hint: "```", words: "snippet pre", run: (e) => void e.chain().focus().setCodeBlock().run() },
  { id: "table", label: "Table", group: "Blocks", icon: "table", hint: "grid", words: "grid columns rows", run: (e) => void e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { id: "wikilink", label: "Link to a note", group: "Insert", icon: "link", hint: "[[ ]]", words: "wikilink reference note", run: (e) => void e.chain().focus().insertContent("[[").run() },
  { id: "date", label: "Today's date", group: "Insert", icon: "calendar", hint: "date", words: "day time stamp", run: (e) => void e.chain().focus().insertContent(today()).run() },
  { id: "question", label: "Question card", group: "Study", icon: "brain", hint: "Q :: A", words: "flashcard study qa", run: (e) => void e.chain().focus().insertContent(" :: ").run() },
  { id: "cloze", label: "Cloze card", group: "Study", icon: "brain", hint: "{{ }}", words: "flashcard study blank fill", run: (e) => void e.chain().focus().insertContent({ type: "cloze", attrs: { raw: "{{c1::answer}}" } }).run() },
];

/** The blocks the `/` menu offers for what was typed after the slash, in group order. */
export function slashItems(query: string, handlers: SlashHandlers = {}): SlashItem[] {
  const all = [...ITEMS];
  if (handlers.onImage) {
    const pick = handlers.onImage;
    all.push({ id: "image", label: "Image", group: "Insert", icon: "image", hint: "upload", words: "picture photo upload", run: () => pick() });
  }
  if (handlers.onAsk) {
    const ask = handlers.onAsk;
    all.push({ id: "ask", label: "Ask an agent", group: "Agents", icon: "bot", hint: "agent", words: "ai assistant ask", run: () => ask() });
  }
  const found = rank(all, query, (i) => `${i.label} ${i.words}`);
  return query.trim() === "" ? found.sort((a, b) => SLASH_GROUPS.indexOf(a.group) - SLASH_GROUPS.indexOf(b.group)) : found;
}

export type { Range };
