import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { rank } from "../fuzzy";
import { completeSlash } from "./slash";

const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode"]);

function inCode(state: EditorState, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (CODE.has(n.name)) return true;
  }
  return false;
}

/** The change that inserts `title` and its closing brackets, skipping brackets that are already there. */
export function wikilinkInsert(state: EditorState, from: number, to: number, title: string): { changes: { from: number; to: number; insert: string }; selection: { anchor: number } } {
  const hasClose = state.doc.sliceString(to, to + 2) === "]]";
  const insert = hasClose ? title : `${title}]]`;
  return { changes: { from, to: hasClose ? to : to, insert }, selection: { anchor: from + title.length + 2 } };
}

/**
 * Completion source for `[[`: offers note titles, best match first. Only fires right after `[[`,
 * never inside code. Pure given the titles, so it is tested without a browser.
 */
export function completeWikilink(context: CompletionContext, titles: string[]): CompletionResult | null {
  const match = context.matchBefore(/\[\[[^\]\n]*$/);
  if (!match) return null;
  if (inCode(context.state, context.pos)) return null;
  const from = match.from + 2;
  const query = context.state.doc.sliceString(from, context.pos);
  const unique = [...new Set(titles.filter((t) => t.trim() !== ""))];
  const options: Completion[] = rank(unique, query, (t) => t)
    .slice(0, 30)
    .map((title) => ({
      label: title,
      type: "text",
      apply: (view: EditorView, _completion: Completion, start: number, end: number) => {
        view.dispatch(wikilinkInsert(view.state, start, end, title));
      },
    }));
  if (options.length === 0) return null;
  return { from, options, filter: false };
}

/** The autocompletion extension: `[[` offers note titles (read each time it opens), `/` at a line start offers blocks. */
export function wikilinkCompletion(getTitles: () => string[]): Extension {
  return autocompletion({ override: [(context) => completeWikilink(context, getTitles()), completeSlash], icons: false, defaultKeymap: true });
}
