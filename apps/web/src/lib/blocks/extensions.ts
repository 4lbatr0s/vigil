import { Node, type Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
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

export function blockExtensions(): Extensions {
  return [StarterKit, Markdown, Table, TableRow, TableHeader, TableCell, TaskList, TaskItem.configure({ nested: true }), Image, Wikilink, Cloze, Callout];
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
