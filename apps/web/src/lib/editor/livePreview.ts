import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

/** Only these schemes open from a Cmd/Ctrl+click: a note must not be able to run script. */
export function isSafeUrl(url: string): boolean {
  return /^(https?:|mailto:)/i.test(url.trim());
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  override toDOM(): HTMLElement {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.className = "cm-task";
    box.setAttribute("aria-label", this.checked ? "Done" : "Not done");
    return box;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-bullet";
    el.textContent = "•";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}

const HIDE = Decoration.replace({});
const BULLET = Decoration.replace({ widget: new BulletWidget() });
const WIKILINK = /\[\[([^\]\n]+)\]\]/g;

export type Range2 = { from: number; to: number };

/**
 * All live-preview decorations for `state`, limited to `range` when given (the visible part plus
 * margin). Markup marks are hidden except on lines that hold the selection, so the line being
 * edited shows its raw text. Pure: no view needed.
 */
export function buildDecorations(state: EditorState, range?: Range2): DecorationSet {
  const doc = state.doc;
  const from = Math.max(0, range?.from ?? 0);
  const to = Math.min(doc.length, range?.to ?? doc.length);
  const tree = ensureSyntaxTree(state, to, 100) ?? syntaxTree(state);

  const active = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) active.add(n);
  }
  const lineActive = (pos: number): boolean => active.has(doc.lineAt(pos).number);

  const out: Range<Decoration>[] = [];
  const codeRanges: Range2[] = [];
  const hide = (a: number, b: number): void => {
    if (b > a && !lineActive(a)) out.push(HIDE.range(a, b));
  };
  const lineDeco = (a: number, b: number, cls: string): void => {
    for (let n = doc.lineAt(Math.max(a, from)).number; n <= doc.lineAt(Math.min(b, to)).number; n++) {
      out.push(Decoration.line({ class: cls }).range(doc.line(n).from));
    }
  };

  tree.iterate({
    from,
    to,
    enter(node) {
      const name = node.name;
      const heading = /^ATXHeading([1-6])$/.exec(name) ?? /^SetextHeading([12])$/.exec(name);
      if (heading) {
        lineDeco(node.from, name.startsWith("Setext") ? doc.lineAt(node.from).to : node.to, `cm-h${heading[1]}`);
        return;
      }
      switch (name) {
        case "HeaderMark":
          if (node.node.parent?.name.startsWith("ATX")) {
            const line = doc.lineAt(node.from);
            hide(node.from, Math.min(node.to + 1, line.to));
          }
          return;
        case "StrongEmphasis":
          out.push(Decoration.mark({ class: "cm-strong" }).range(node.from, node.to));
          return;
        case "Emphasis":
          out.push(Decoration.mark({ class: "cm-em" }).range(node.from, node.to));
          return;
        case "Strikethrough":
          out.push(Decoration.mark({ class: "cm-strike" }).range(node.from, node.to));
          return;
        case "EmphasisMark":
        case "StrikethroughMark":
          hide(node.from, node.to);
          return;
        case "InlineCode":
          codeRanges.push({ from: node.from, to: node.to });
          out.push(Decoration.mark({ class: "cm-code" }).range(node.from, node.to));
          return;
        case "CodeMark":
          if (node.node.parent?.name === "InlineCode") hide(node.from, node.to);
          return;
        case "FencedCode":
        case "CodeBlock":
          codeRanges.push({ from: node.from, to: node.to });
          lineDeco(node.from, node.to, "cm-codeblock");
          return;
        case "Link": {
          const marks = node.node.getChildren("LinkMark");
          const url = node.node.getChild("URL");
          // A bracket pair without a (url) is a wikilink or a reference; the wikilink pass handles it.
          if (!url || marks.length < 4) return;
          const [open, close, , last] = marks as [typeof marks[0], typeof marks[0], typeof marks[0], typeof marks[0]];
          out.push(Decoration.mark({ class: "cm-link" }).range(open.to, close.from));
          hide(open.from, open.to);
          hide(close.from, last.to);
          return;
        }
        case "Blockquote":
          lineDeco(node.from, node.to, "cm-quote");
          return;
        case "QuoteMark": {
          const line = doc.lineAt(node.from);
          hide(node.from, Math.min(node.to + 1, line.to));
          return;
        }
        case "ListMark": {
          if (lineActive(node.from)) return;
          const item = node.node.parent;
          const task = item?.getChild("Task");
          if (task) {
            hide(node.from, task.from); // the checkbox stands in for the bullet
          } else if (item?.parent?.name === "BulletList") {
            out.push(BULLET.range(node.from, node.to));
          } else {
            out.push(Decoration.mark({ class: "cm-listnum" }).range(node.from, node.to));
          }
          return;
        }
        case "TaskMarker": {
          if (lineActive(node.from)) return;
          const checked = /[xX]/.test(doc.sliceString(node.from, node.to));
          out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to));
          return;
        }
        default:
      }
    },
  });

  // Wikilinks: a text pass over the range, skipping anything inside code.
  const text = doc.sliceString(from, to);
  for (const m of text.matchAll(WIKILINK)) {
    const a = from + (m.index ?? 0);
    const b = a + m[0].length;
    if (codeRanges.some((c) => a < c.to && b > c.from)) continue;
    out.push(Decoration.mark({ class: "cm-wikilink" }).range(a, b));
    hide(a, a + 2);
    hide(b - 2, b);
  }

  return Decoration.set(out, true);
}

/** The change that flips the task marker at `pos`, or null when `pos` is not on one. */
export function toggleTask(state: EditorState, pos: number): { from: number; to: number; insert: string } | null {
  const node = syntaxTree(state).resolveInner(pos, 1);
  const marker = node.name === "TaskMarker" ? node : node.parent?.name === "TaskMarker" ? node.parent : null;
  if (!marker) return null;
  const done = /[xX]/.test(state.doc.sliceString(marker.from, marker.to));
  return { from: marker.from + 1, to: marker.from + 2, insert: done ? " " : "x" };
}

/** The title of the `[[wikilink]]` under `pos`, or null. Code is not special-cased: callers pass click positions on text. */
export function wikilinkAt(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  for (const m of line.text.matchAll(WIKILINK)) {
    const a = line.from + (m.index ?? 0);
    if (pos >= a && pos <= a + m[0].length) {
      const inCode = syntaxTree(state).resolveInner(pos, 0);
      for (let n: typeof inCode | null = inCode; n; n = n.parent) if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "InlineCode") return null;
      return (m[1] ?? "").trim() || null;
    }
  }
  return null;
}

/** The url of the `[text](url)` link under `pos`, or null. */
export function linkUrlAt(state: EditorState, pos: number): string | null {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 0); n; n = n.parent) {
    if (n.name === "Link") {
      const url = n.getChild("URL");
      return url ? state.doc.sliceString(url.from, url.to) : null;
    }
  }
  return null;
}

class LivePreviewPlugin {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = buildDecorations(view.state, view.viewport);
  }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildDecorations(update.state, update.view.viewport);
    }
  }
}

const theme = EditorView.baseTheme({
  ".cm-h1": { fontSize: "var(--text-h1)", fontWeight: "600", lineHeight: "1.25" },
  ".cm-h2": { fontSize: "var(--text-h2)", fontWeight: "600", lineHeight: "1.3" },
  ".cm-h3": { fontSize: "var(--text-h3)", fontWeight: "600", lineHeight: "1.3" },
  ".cm-h4, .cm-h5, .cm-h6": { fontWeight: "600" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strike": { textDecoration: "line-through", color: "var(--ink-muted)" },
  ".cm-code": { fontFamily: "var(--font-mono)", fontSize: "0.9em", backgroundColor: "var(--surface)" },
  ".cm-codeblock": { fontFamily: "var(--font-mono)", fontSize: "0.9em", backgroundColor: "var(--surface)" },
  ".cm-quote": { borderLeft: "2px solid var(--hairline)", paddingLeft: "var(--space-3)", color: "var(--ink-muted)" },
  ".cm-link": { textDecoration: "underline", textUnderlineOffset: "2px" },
  ".cm-wikilink": { textDecoration: "underline dotted", textUnderlineOffset: "3px", cursor: "pointer" },
  ".cm-bullet": { color: "var(--ink-muted)", display: "inline-block", width: "1.2em" },
  ".cm-listnum": { color: "var(--ink-muted)" },
  ".cm-task": { margin: "0 var(--space-2) 0 0", verticalAlign: "middle", cursor: "pointer" },
});

/**
 * The live-preview extension. Cmd/Ctrl+click opens a wikilink (through `onOpenWikilink`) or a
 * safe link in a new tab; a plain click only places the cursor. Clicking a task checkbox flips it.
 */
export function livePreview(options: { onOpenWikilink?: (title: string) => void } = {}): Extension {
  return [
    ViewPlugin.fromClass(LivePreviewPlugin, { decorations: (v) => v.decorations }),
    theme,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const target = event.target;
        if (target instanceof HTMLElement && target.classList.contains("cm-task")) {
          const change = toggleTask(view.state, view.posAtDOM(target));
          if (change) view.dispatch({ changes: change });
          event.preventDefault();
          return true;
        }
        if (!(event.metaKey || event.ctrlKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const title = wikilinkAt(view.state, pos);
        if (title) {
          options.onOpenWikilink?.(title);
          event.preventDefault();
          return true;
        }
        const url = linkUrlAt(view.state, pos);
        if (url && isSafeUrl(url)) {
          window.open(url.trim(), "_blank", "noopener,noreferrer");
          event.preventDefault();
          return true;
        }
        return false;
      },
    }),
  ];
}
