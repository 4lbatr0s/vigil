import { Node, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { attachmentSrc } from "../editor/images";
import { ICONS, calloutLook, iconElement } from "../editor/icons";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { TaskList, TaskItem } from "@tiptap/extension-list";

/**
 * `[[Note]]` and `[[Note|shown text]]` as one small inline piece: the text of the note it points to, and what to show.
 * It is written back exactly as it was typed.
 */
export const Wikilink = Node.create({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { target: { default: "" }, label: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "a[data-wikilink]", getAttrs: (el) => ({ target: el.getAttribute("data-wikilink") ?? "", label: el.textContent ?? "" }) }];
  },
  renderHTML({ node }) {
    return ["a", { "data-wikilink": String(node.attrs.target), class: "wikilink" }, String(node.attrs.label || node.attrs.target)];
  },
  markdownTokenizer: {
    name: "wikilink",
    level: "inline",
    start: (src: string) => src.indexOf("[["),
    tokenize: (src: string) => {
      const m = /^\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/.exec(src);
      if (!m) return undefined;
      return { type: "wikilink", raw: m[0], target: m[1] ?? "", label: m[2] ?? "" };
    },
  },
  parseMarkdown: (token) => ({ type: "wikilink", attrs: { target: token.target as string, label: (token.label as string) ?? "" } }),
  renderMarkdown: (node) => {
    const target = String(node.attrs?.target ?? "");
    const label = String(node.attrs?.label ?? "");
    return label === "" ? `[[${target}]]` : `[[${target}|${label}]]`;
  },
});

/** `{{c1::hidden}}` study blanks, kept as written. */
export const Cloze = Node.create({
  name: "cloze",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { raw: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-cloze]", getAttrs: (el) => ({ raw: el.getAttribute("data-cloze") ?? "" }) }];
  },
  renderHTML({ node }) {
    const raw = String(node.attrs.raw);
    const shown = /^\{\{c\d+::(.*?)(?:::.*)?\}\}$/.exec(raw)?.[1] ?? raw;
    return ["span", { "data-cloze": raw, class: "cloze" }, shown];
  },
  markdownTokenizer: {
    name: "cloze",
    level: "inline",
    start: (src: string) => src.indexOf("{{c"),
    tokenize: (src: string) => {
      const m = /^\{\{c\d+::.+?\}\}/.exec(src);
      return m ? { type: "cloze", raw: m[0] } : undefined;
    },
  },
  parseMarkdown: (token) => ({ type: "cloze", attrs: { raw: token.raw as string } }),
  renderMarkdown: (node) => String(node.attrs?.raw ?? ""),
});


/**
 * `> [!note] Title` and the quoted lines under it: a coloured box with an icon. `kind` is what follows `[!`, `fold`
 * is the `+` or `-` after it. Written back as the same quote.
 */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { kind: { default: "note" }, fold: { default: "" }, title: { default: "" } };
  },
  addNodeView() {
    return ({ node: first, editor, getPos }) => {
      const dom = document.createElement("div");
      const head = document.createElement("div");
      head.className = "callout-head";
      head.contentEditable = "false";
      const fold = document.createElement("button");
      fold.type = "button";
      fold.className = "callout-fold";
      fold.setAttribute("aria-label", "Show or hide");
      fold.append(iconElement(ICONS.chevronRight, 14));
      const icon = document.createElement("span");
      icon.className = "callout-icon";
      const title = document.createElement("input");
      title.className = "callout-title";
      title.spellcheck = true;
      const body = document.createElement("div");
      body.className = "callout-body";
      head.append(fold, icon, title);
      dom.append(head, body);
      let kind = "";
      const paint = (attrs: { kind: string; fold: string; title: string }): void => {
        const look = calloutLook(attrs.kind);
        if (kind !== attrs.kind) {
          icon.replaceChildren(iconElement(look.icon, 16));
          kind = attrs.kind;
        }
        dom.className = `callout callout-${look.tone}`;
        dom.dataset.callout = attrs.kind;
        title.placeholder = look.label;
        if (document.activeElement !== title) title.value = attrs.title;
        fold.hidden = attrs.fold === "";
        if (attrs.fold === "-" && !dom.dataset.touched) dom.classList.add("closed");
        else if (dom.dataset.touched === "closed") dom.classList.add("closed");
      };
      let current = first.attrs as { kind: string; fold: string; title: string };
      paint(current);
      fold.addEventListener("click", () => {
        const closed = dom.classList.toggle("closed");
        dom.dataset.touched = closed ? "closed" : "open";
      });
      title.addEventListener("input", () => {
        const pos = typeof getPos === "function" ? getPos() : undefined;
        if (pos === undefined) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current, title: title.value }));
      });
      title.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === "ArrowDown") {
          e.preventDefault();
          editor.commands.focus();
        }
      });
      return {
        dom,
        contentDOM: body,
        update: (next) => {
          if (next.type.name !== "callout") return false;
          current = next.attrs as { kind: string; fold: string; title: string };
          paint(current);
          return true;
        },
        stopEvent: (event) => event.target instanceof window.Node && head.contains(event.target),
        ignoreMutation: (m) => head.contains(m.target),
      };
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout]", getAttrs: (el) => ({ kind: el.getAttribute("data-callout") ?? "note" }) }];
  },
  renderHTML({ node }) {
    return ["div", { "data-callout": String(node.attrs.kind), class: "callout" }, 0];
  },
  markdownTokenizer: {
    name: "callout",
    level: "block",
    start: (src: string) => src.search(/^> ?\[!/m),
    tokenize: (src: string, _tokens: unknown, lexer: { blockTokens: (s: string) => unknown[] }) => {
      const head = /^> ?\[!([A-Za-z]+)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)/.exec(src);
      if (!head) return undefined;
      let raw = head[0];
      const body: string[] = [];
      for (const line of src.slice(raw.length).split("\n")) {
        if (!/^>/.test(line)) break;
        raw += `${line}\n`;
        body.push(line.replace(/^> ?/, ""));
      }
      const text = body.join("\n");
      return { type: "callout", raw: raw.replace(/\n$/, src.endsWith(raw) ? "" : "\n"), kind: (head[1] ?? "note").toLowerCase(), fold: head[2] ?? "", title: head[3] ?? "", tokens: lexer.blockTokens(text) };
    },
  },
  parseMarkdown: (token, helpers) => ({
    type: "callout",
    attrs: { kind: token.kind as string, fold: token.fold as string, title: token.title as string },
    content: helpers.parseChildren((token.tokens ?? []) as never),
  }),
  renderMarkdown: (node, helpers) => {
    const a = node.attrs ?? {};
    const head = `> [!${String(a.kind ?? "note")}]${String(a.fold ?? "")}${a.title ? ` ${String(a.title)}` : ""}`;
    const body = helpers.renderChildren(node.content ?? [], "\n\n");
    const quoted = body === "" ? [] : body.split("\n").map((l) => (l === "" ? ">" : `> ${l}`));
    return [head, ...quoted].join("\n");
  },
});

/** A picture whose file lives in the vault: the markdown keeps the relative path, the page shows it from the server. */
const VaultImage = Image.extend({
  renderHTML({ HTMLAttributes }) {
    const src = typeof HTMLAttributes.src === "string" ? (attachmentSrc(HTMLAttributes.src) ?? HTMLAttributes.src) : "";
    return ["img", { ...HTMLAttributes, src, loading: "lazy" }];
  },
});

const lowlight = createLowlight(common);

/** Everything the note editor and its markdown gate agree on. The same list builds the hidden editor in tests. */
export function blockExtensions(): Extensions {
  return [
    StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: false } }),
    CodeBlockLowlight.configure({ lowlight }),
    Markdown,
    Table,
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    VaultImage,
    Wikilink,
    Cloze,
    Callout,
  ];
}

/**
 * The text with only the differences that do not change what it says removed: blank-line runs, trailing spaces, table
 * padding, bullet style. Added escapes are not ignored. Code blocks are compared exactly, character for character.
 */
export function normalize(md: string): string {
  const out: string[] = [];
  let fence = false;
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      out.push(raw.trimEnd());
      continue;
    }
    if (fence) {
      out.push(raw);
      continue;
    }
    let l = raw.replace(/\s+$/, "");
    if (/^\s*\|.*\|\s*$/.test(l)) l = l.replace(/\s*\|\s*/g, "|").replace(/-{2,}/g, "-");
    l = l.replace(/^(\s*)[*+] /, "$1- ");
    // Blank lines between blocks: keep none, so a run and a single one compare equal; inside code they stay (above).
    if (l !== "" || fence) out.push(l);
  }
  return out.join("\n").trim();
}
