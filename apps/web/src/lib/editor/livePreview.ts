import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range } from "@codemirror/state";
import { attachmentSrc } from "./images";
import { ICONS, calloutLook, iconElement } from "./icons";
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

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }
  override toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.src = this.src;
    img.alt = this.alt;
    img.className = "cm-image";
    img.loading = "lazy";
    return img;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The bar above a fenced code block: the language on the left and a Copy button on the right. */
class CodeHeadWidget extends WidgetType {
  constructor(readonly lang: string) {
    super();
  }
  override eq(other: CodeHeadWidget): boolean {
    return other.lang === this.lang;
  }
  override toDOM(): HTMLElement {
    const bar = document.createElement("span");
    bar.className = "cm-codehead";
    const label = document.createElement("span");
    label.className = "cm-codelang";
    label.textContent = this.lang || "text";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-copy";
    button.setAttribute("aria-label", "Copy the code");
    const text = document.createElement("span");
    text.className = "cm-copy-text";
    text.textContent = "Copy";
    button.append(iconElement(ICONS.copy, 14), text);
    bar.append(label, button);
    return bar;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/** The first words of a callout (`> [!tip]`): an icon and a plain label instead of the raw marker. */
class CalloutHeadWidget extends WidgetType {
  constructor(readonly type: string) {
    super();
  }
  override eq(other: CalloutHeadWidget): boolean {
    return other.type === this.type;
  }
  override toDOM(): HTMLElement {
    const look = calloutLook(this.type);
    const el = document.createElement("span");
    el.className = "cm-calloutname";
    const label = document.createElement("span");
    label.textContent = look.label;
    el.append(iconElement(look.icon, 16), label);
    return el;
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

class RuleWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = "cm-rule";
    el.setAttribute("aria-hidden", "true");
    return el;
  }
}

const HIDE = Decoration.replace({});
const RULE = Decoration.replace({ widget: new RuleWidget() });
const CALLOUT = /^>\s*\[!([A-Za-z]+)\]/;
/** The marker of a callout's first line, with an optional fold sign: `> [!tip]`, `> [!tip]-`. */
const CALLOUT_HEAD = /^>\s*\[!([A-Za-z]+)\][+-]?/;
const BULLET = Decoration.replace({ widget: new BulletWidget() });
const WIKILINK = /\[\[([^\]\n]+)\]\]/g;
const CLOZE = /\{\{([^{}\n]+)\}\}/g;
const INLINE_TAG = /(^|[\s(])#([a-zA-Z][\w-]*(?:\/[\w-]+)*)/gm;

export type Range2 = { from: number; to: number };

/**
 * All live-preview decorations for `state`, limited to `range` when given (the visible part plus
 * margin). Markup marks are hidden except on lines that hold the selection, so the line being
 * edited shows its raw text. Pure: no view needed. When `title` is given, a first-line `# title` that
 * repeats it is hidden (the page shows the title already) until the editor has focus with the cursor on that line
 * (`focused` is false while it has not, so a freshly opened note, whose cursor sits at the start, shows no duplicate).
 */
export function buildDecorations(state: EditorState, range?: Range2, title?: string, focused = true): DecorationSet {
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
        case "CodeBlock": {
          codeRanges.push({ from: node.from, to: node.to });
          lineDeco(node.from, node.to, "cm-codeblock");
          if (name === "FencedCode") {
            const open = doc.lineAt(node.from);
            const last = doc.lineAt(node.to);
            const info = node.node.getChild("CodeInfo");
            const lang = info ? doc.sliceString(info.from, info.to).trim() : "";
            if (open.from >= from) {
              out.push(Decoration.line({ class: "cm-codeblock-first" }).range(open.from));
              if (!lineActive(open.from)) {
                out.push(Decoration.line({ class: "cm-codehead-line" }).range(open.from));
                out.push(Decoration.replace({ widget: new CodeHeadWidget(lang) }).range(open.from, open.to));
              }
            }
            const closed = node.node.getChildren("CodeMark").length >= 2 && last.number !== open.number;
            if (closed && last.to <= to) {
              out.push(Decoration.line({ class: "cm-codeblock-last" }).range(last.from));
              if (!lineActive(last.from)) {
                out.push(Decoration.line({ class: "cm-codefoot-line" }).range(last.from));
                if (last.to > last.from) out.push(HIDE.range(last.from, last.to));
              }
            }
          }
          return;
        }
        case "Image": {
          // Our own pictures (`![](attachments/<name>)`) show as pictures until the cursor is on the line.
          const url = node.node.getChild("URL");
          const src = url ? attachmentSrc(doc.sliceString(url.from, url.to)) : null;
          if (src && !lineActive(node.from)) {
            const alt = /^!\[([^\]]*)\]/.exec(doc.sliceString(node.from, node.to))?.[1] ?? "";
            out.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(node.from, node.to));
          }
          return false;
        }
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
        case "Blockquote": {
          const callout = CALLOUT.exec(doc.lineAt(node.from).text);
          if (callout) {
            const type = (callout[1] as string).toLowerCase();
            lineDeco(node.from, node.to, `cm-callout cm-callout-${type} cm-tone-${calloutLook(type).tone}`);
            const first = doc.lineAt(node.from);
            const last = doc.lineAt(node.to);
            if (first.from >= from) out.push(Decoration.line({ class: "cm-callout-first" }).range(first.from));
            if (last.to <= to) out.push(Decoration.line({ class: "cm-callout-last" }).range(last.from));
            const head = CALLOUT_HEAD.exec(first.text);
            if (head && first.from >= from) {
              const end = first.from + head[0].length;
              if (!lineActive(first.from)) out.push(Decoration.replace({ widget: new CalloutHeadWidget(head[1] as string) }).range(first.from, end));
              if (end < first.to) out.push(Decoration.mark({ class: "cm-callout-title" }).range(end, first.to));
            }
          } else {
            lineDeco(node.from, node.to, "cm-quote");
          }
          return;
        }
        case "HorizontalRule":
          if (!lineActive(node.from)) out.push(RULE.range(node.from, node.to));
          return;
        case "Table":
          lineDeco(node.from, node.to, "cm-table");
          return;
        case "TableHeader":
          lineDeco(node.from, node.to, "cm-table-head");
          return;
        case "TableDelimiter":
          // The `| --- | --- |` row is a direct child of the table; the pipes inside rows are not.
          if (node.node.parent?.name === "Table") lineDeco(node.from, node.to, "cm-table-rule");
          return;
        case "QuoteMark": {
          const line = doc.lineAt(node.from);
          // On a callout's first line the icon widget stands in for the whole marker.
          if (node.from === line.from && CALLOUT_HEAD.test(line.text)) return;
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
          const done = /[xX]/.test(doc.sliceString(node.from, node.to));
          const lineEnd = doc.lineAt(node.from).to;
          if (done && node.to < lineEnd) out.push(Decoration.mark({ class: "cm-task-done" }).range(node.to, lineEnd));
          if (lineActive(node.from)) return;
          const checked = done;
          out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to));
          return;
        }
        default:
      }
    },
  });

  if (title !== undefined && title.trim() !== "") {
    const first = doc.line(1);
    const m = /^#\s+(.*?)\s*#*\s*$/.exec(first.text);
    if (m && (m[1] as string).trim().toLowerCase() === title.trim().toLowerCase() && !(focused && lineActive(first.from)) && first.from >= from && first.from <= to) {
      // Drop what was decided for that line and hide all of it instead.
      for (let i = out.length - 1; i >= 0; i--) {
        const d = out[i] as Range<Decoration>;
        if (d.from >= first.from && d.to <= first.to) out.splice(i, 1);
      }
      if (first.to > first.from) out.push(HIDE.range(first.from, first.to));
      out.push(Decoration.line({ class: "cm-title-line" }).range(first.from));
    }
  }

  // Wikilinks and #tags: a text pass over the range, skipping anything inside code.
  const text = doc.sliceString(from, to);
  for (const m of text.matchAll(CLOZE)) {
    const a = from + (m.index ?? 0);
    const b = a + m[0].length;
    if (codeRanges.some((c) => a < c.to && b > c.from)) continue;
    out.push(Decoration.mark({ class: "cm-cloze" }).range(a + 2, b - 2));
    hide(a, a + 2);
    hide(b - 2, b);
  }
  for (const m of text.matchAll(INLINE_TAG)) {
    const a = from + (m.index ?? 0) + (m[1] ?? "").length;
    const b = a + (m[2] ?? "").length + 1;
    if (codeRanges.some((c) => a < c.to && b > c.from)) continue;
    out.push(Decoration.mark({ class: "cm-tag" }).range(a, b));
  }
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

/** The syntax tree up to `pos`, parsed to completion if the incremental parser has not got there yet (it is time-boxed, so under load it can lag). */
function treeAt(state: EditorState, pos: number): ReturnType<typeof syntaxTree> {
  return ensureSyntaxTree(state, Math.min(state.doc.length, pos + 1), 200) ?? syntaxTree(state);
}

/** The change that flips the task marker at `pos`, or null when `pos` is not on one. */
export function toggleTask(state: EditorState, pos: number): { from: number; to: number; insert: string } | null {
  const node = treeAt(state, pos).resolveInner(pos, 1);
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
      const inCode = treeAt(state, pos).resolveInner(pos, 0);
      for (let n: typeof inCode | null = inCode; n; n = n.parent) if (n.name === "FencedCode" || n.name === "CodeBlock" || n.name === "InlineCode") return null;
      return (m[1] ?? "").trim() || null;
    }
  }
  return null;
}

/** The url of the `[text](url)` link under `pos`, or null. */
export function linkUrlAt(state: EditorState, pos: number): string | null {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = treeAt(state, pos).resolveInner(pos, 0); n; n = n.parent) {
    if (n.name === "Link") {
      const url = n.getChild("URL");
      return url ? state.doc.sliceString(url.from, url.to) : null;
    }
  }
  return null;
}

/** The language and text of the fenced code block that holds `pos` (for the Copy button), or null. */
export function fencedCodeAt(state: EditorState, pos: number): { lang: string; code: string } | null {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = treeAt(state, pos).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === "FencedCode") {
      const info = n.getChild("CodeInfo");
      const text = n.getChild("CodeText");
      return { lang: info ? state.doc.sliceString(info.from, info.to).trim() : "", code: text ? state.doc.sliceString(text.from, text.to) : "" };
    }
  }
  return null;
}

function flash(button: HTMLElement, message: string): void {
  const label = button.querySelector(".cm-copy-text");
  if (!label) return;
  const before = label.textContent;
  label.textContent = message;
  setTimeout(() => (label.textContent = before), 1400);
}

function pluginFor(getTitle: () => string | undefined) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view.state, view.viewport, getTitle(), view.hasFocus);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
          this.decorations = buildDecorations(update.state, update.view.viewport, getTitle(), update.view.hasFocus);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

const theme = EditorView.baseTheme({
  ".cm-h1": { fontSize: "var(--text-h1)", fontWeight: "600", lineHeight: "1.2", paddingTop: "1.1em", paddingBottom: "0.15em" },
  ".cm-h2": { fontSize: "var(--text-h2)", fontWeight: "600", lineHeight: "1.25", paddingTop: "0.95em", paddingBottom: "0.1em" },
  ".cm-h3": { fontSize: "var(--text-h3)", fontWeight: "600", lineHeight: "1.3", paddingTop: "0.8em" },
  ".cm-h4, .cm-h5, .cm-h6": { fontWeight: "600", paddingTop: "0.6em" },
  ".cm-line.cm-h1:first-child, .cm-line.cm-h2:first-child, .cm-line.cm-h3:first-child": { paddingTop: "0" },
  ".cm-title-line": { height: "0", padding: "0 !important", overflow: "hidden", lineHeight: "0" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-image": { display: "block", maxWidth: "100%", maxHeight: "480px", margin: "var(--space-3) 0", borderRadius: "var(--radius)" },
  ".cm-strike": { textDecoration: "line-through", color: "var(--ink-muted)" },
  ".cm-code": { fontFamily: "var(--font-mono)", fontSize: "0.86em", backgroundColor: "var(--surface-hover)", borderRadius: "4px", padding: "1px 5px" },
  ".cm-codeblock": { fontFamily: "var(--font-mono)", fontSize: "0.86em", lineHeight: "1.6", backgroundColor: "var(--surface)", borderLeft: "1px solid var(--hairline)", borderRight: "1px solid var(--hairline)", padding: "0 var(--space-4)" },
  ".cm-codeblock-first": { borderTop: "1px solid var(--hairline)", borderTopLeftRadius: "var(--radius)", borderTopRightRadius: "var(--radius)", marginTop: "var(--space-2)" },
  ".cm-codeblock-last": { borderBottom: "1px solid var(--hairline)", borderBottomLeftRadius: "var(--radius)", borderBottomRightRadius: "var(--radius)", marginBottom: "var(--space-2)" },
  ".cm-codehead-line": { backgroundColor: "color-mix(in srgb, var(--ink) 5%, var(--surface))", color: "var(--ink-muted)", fontFamily: "var(--font-chrome)", fontSize: "var(--text-label)", lineHeight: "2" },
  // inline-flex, not flex: CodeMirror ends a line that holds only a widget with a line break, and a block here would double the height.
  ".cm-codehead": { display: "inline-flex", alignItems: "center", justifyContent: "space-between", width: "calc(100% - 2px)", verticalAlign: "top" },
  ".cm-codelang": { textTransform: "lowercase", letterSpacing: "0.02em" },
  ".cm-copy": { display: "inline-flex", alignItems: "center", gap: "6px", padding: "2px 8px", border: "1px solid transparent", borderRadius: "var(--radius)", background: "transparent", color: "var(--ink-muted)", font: "inherit", cursor: "pointer" },
  ".cm-copy:hover, .cm-copy:focus-visible": { backgroundColor: "var(--surface-hover)", color: "var(--ink)" },
  ".cm-codefoot-line": { height: "6px", lineHeight: "6px", overflow: "hidden", padding: "0" },
  ".cm-quote": { borderLeft: "3px solid var(--hairline)", paddingLeft: "var(--space-4)", color: "var(--ink-muted)" },
  ".cm-cloze": { backgroundColor: "var(--surface-hover)", borderBottom: "1px dashed var(--ink-muted)", borderRadius: "4px", padding: "0 2px" },
  ".cm-tag": { color: "var(--ink-muted)", fontFamily: "var(--font-chrome)", fontSize: "0.85em", backgroundColor: "var(--surface-hover)", borderRadius: "999px", padding: "1px 8px" },
  ".cm-tone-note": { "--tone": "var(--canvas-5)" },
  ".cm-tone-tip, .cm-tone-ok": { "--tone": "var(--canvas-4)" },
  ".cm-tone-warn": { "--tone": "var(--canvas-2)" },
  ".cm-tone-danger": { "--tone": "var(--canvas-1)" },
  ".cm-callout": { borderLeft: "3px solid var(--tone, var(--ink-muted))", paddingLeft: "var(--space-4)", paddingRight: "var(--space-4)", backgroundColor: "color-mix(in srgb, var(--tone, var(--ink-muted)) 9%, var(--surface))" },
  ".cm-callout-first": { paddingTop: "var(--space-2)", borderTopRightRadius: "var(--radius)", marginTop: "var(--space-2)" },
  ".cm-callout-last": { paddingBottom: "var(--space-2)", borderBottomRightRadius: "var(--radius)", marginBottom: "var(--space-2)" },
  ".cm-calloutname": { display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-chrome)", fontSize: "0.9em", fontWeight: "600", color: "var(--tone, var(--ink))", marginRight: "var(--space-2)" },
  ".cm-calloutname svg": { flex: "none" },
  ".cm-callout-title": { fontWeight: "600" },
  ".cm-rule": { display: "inline-block", width: "100%", height: "0", verticalAlign: "middle", borderTop: "1px solid var(--hairline)" },
  ".cm-table": { fontFamily: "var(--font-mono)", fontSize: "0.88em", backgroundColor: "var(--surface)", whiteSpace: "pre" },
  ".cm-table-head": { fontWeight: "600" },
  ".cm-table-rule": { color: "var(--ink-muted)" },
  ".cm-link": { color: "var(--code-fn)", textDecoration: "underline", textUnderlineOffset: "3px", textDecorationThickness: "1px" },
  ".cm-wikilink": { color: "var(--ink)", backgroundColor: "var(--surface-hover)", borderBottom: "1px solid var(--ink-muted)", borderRadius: "3px", padding: "0 3px", cursor: "pointer" },
  ".cm-bullet": { color: "var(--ink-muted)", display: "inline-block", width: "1.2em" },
  ".cm-listnum": { color: "var(--ink-muted)" },
  ".cm-task": { width: "1.05em", height: "1.05em", margin: "0 var(--space-2) 0 0", verticalAlign: "-0.1em", cursor: "pointer", accentColor: "var(--canvas-4)" },
  ".cm-task-done": { textDecoration: "line-through", color: "var(--ink-muted)" },
});

/**
 * The live-preview extension. Cmd/Ctrl+click opens a wikilink (through `onOpenWikilink`) or a
 * safe link in a new tab; a plain click only places the cursor. Clicking a task checkbox flips it.
 */
export function livePreview(options: { onOpenWikilink?: (title: string) => void; getTitle?: () => string | undefined } = {}): Extension {
  return [
    pluginFor(() => options.getTitle?.()),
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
        const copy = target instanceof HTMLElement ? target.closest<HTMLElement>(".cm-copy") : null;
        if (copy) {
          const hit = fencedCodeAt(view.state, view.posAtDOM(copy));
          if (hit) {
            navigator.clipboard.writeText(hit.code).then(
              () => flash(copy, "Copied"),
              () => flash(copy, "Could not copy"),
            );
          }
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
