import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { buildDecorations, isSafeUrl, linkUrlAt, toggleTask, wikilinkAt } from "./livePreview";

const DOC = ["# Title", "", "Some **bold** and [a link](https://example.com) and [[Other note]].", "", "- [ ] open task", "- [x] done task", "- plain item", "", "```", "[[Inside code]]", "```"].join("\n");

function state(doc: string, cursor = doc.length): EditorState {
  return EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [markdown({ base: markdownLanguage })] });
}

type Item = { from: number; to: number; replace: boolean; cls?: string };
function items(s: EditorState, range?: { from: number; to: number }): Item[] {
  const out: Item[] = [];
  buildDecorations(s, range).between(0, s.doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string };
    out.push({ from, to, replace: (value as unknown as { point: boolean }).point === true, cls: spec.class });
  });
  return out;
}
const textOf = (s: EditorState, i: Item) => s.doc.sliceString(i.from, i.to);
const replaced = (s: EditorState) => items(s).filter((i) => i.replace && i.to > i.from).map((i) => textOf(s, i));

describe("buildDecorations", () => {
  it("hides markup marks away from the cursor", () => {
    const s = state(DOC, DOC.length); // cursor in the code fence at the end
    const hidden = replaced(s);
    expect(hidden).toContain("# "); // heading mark and its space
    expect(hidden.filter((t) => t === "**")).toHaveLength(2);
    expect(hidden).toContain("["); // link open bracket
    expect(hidden).toContain("](https://example.com)");
    expect(hidden).toContain("[["); // wikilink brackets
    expect(hidden).toContain("]]");
  });

  it("keeps every mark on the line that holds the cursor", () => {
    const at = DOC.indexOf("bold"); // inside line 3
    const s = state(DOC, at);
    const hidden = replaced(s);
    expect(hidden).toContain("# "); // the heading line is not active, still hidden
    expect(hidden).not.toContain("**");
    expect(hidden).not.toContain("](https://example.com)");
    expect(hidden).not.toContain("[[");
    const onTitle = replaced(state(DOC, 3));
    expect(onTitle).not.toContain("# ");
  });

  it("treats every line of a multi-line selection as active", () => {
    const s = EditorState.create({ doc: DOC, selection: EditorSelection.range(0, DOC.indexOf("bold")), extensions: [markdown({ base: markdownLanguage })] });
    const hidden = replaced(s);
    expect(hidden).not.toContain("# ");
    expect(hidden).not.toContain("**");
  });

  it("styles headings with line decorations, and bold, link, wikilink and code with marks", () => {
    const s = state(DOC);
    const cls = items(s).map((i) => i.cls);
    expect(cls).toContain("cm-h1");
    expect(cls).toContain("cm-strong");
    expect(cls).toContain("cm-link");
    expect(cls).toContain("cm-wikilink");
    expect(cls.filter((c) => c === "cm-codeblock")).toHaveLength(3);
  });

  it("decorates a wikilink in prose but not one inside a code block", () => {
    const s = state(DOC);
    const wiki = items(s).filter((i) => i.cls === "cm-wikilink").map((i) => textOf(s, i));
    expect(wiki).toEqual(["[[Other note]]"]);
  });

  it("draws bullets and checkboxes in place of list and task marks (away from the cursor)", () => {
    const s = state(DOC, 0);
    const widgets = items(s).filter((i) => i.replace);
    const texts = widgets.map((i) => textOf(s, i));
    expect(texts).toContain("[ ]");
    expect(texts).toContain("[x]");
    expect(texts.filter((t) => t === "-").length).toBeGreaterThanOrEqual(1); // plain bullet widget
    // the cursor line shows the raw task marker
    const onTask = state(DOC, DOC.indexOf("open task"));
    expect(items(onTask).filter((i) => i.replace).map((i) => textOf(onTask, i))).not.toContain("[ ]");
  });

  it("only builds the requested range", () => {
    const s = state(DOC, 0);
    const first = DOC.indexOf("\n") + 1;
    const partial = items(s, { from: 0, to: first });
    expect(partial.every((i) => i.from < first)).toBe(true);
  });

  it("builds a 20,000 character document inside 50 ms (best of 5, so a busy machine does not flake)", () => {
    const para = "A **bold** line with [[Note]] and `code` and [x](https://a.io).\n";
    const big = `# Big\n\n${para.repeat(Math.ceil(20_000 / para.length))}`;
    const s = state(big, 0);
    const best = (fn: () => void): number => {
      let min = Infinity;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        fn();
        min = Math.min(min, performance.now() - t0);
      }
      return min;
    };
    expect(best(() => buildDecorations(s))).toBeLessThan(50);
    expect(best(() => buildDecorations(s, { from: 0, to: 2000 }))).toBeLessThan(50);
  });
});

describe("toggleTask", () => {
  it("flips an open task to done and back", () => {
    const s = state(DOC);
    const open = DOC.indexOf("[ ]");
    const change = toggleTask(s, open + 1);
    expect(change).toEqual({ from: open + 1, to: open + 2, insert: "x" });
    const after = s.update({ changes: change ?? undefined }).state;
    expect(after.doc.toString()).toContain("- [x] open task");
    const done = DOC.indexOf("[x]");
    expect(toggleTask(s, done)).toEqual({ from: done + 1, to: done + 2, insert: " " });
  });
  it("answers null away from a marker", () => {
    expect(toggleTask(state(DOC), 2)).toBeNull();
  });
});

describe("click helpers", () => {
  it("finds a wikilink title under a position, and not inside code", () => {
    const s = state(DOC);
    expect(wikilinkAt(s, DOC.indexOf("Other") + 2)).toBe("Other note");
    expect(wikilinkAt(s, DOC.indexOf("Inside") + 2)).toBeNull();
    expect(wikilinkAt(s, 2)).toBeNull();
  });
  it("finds a link url and only opens safe schemes", () => {
    const s = state(DOC);
    expect(linkUrlAt(s, DOC.indexOf("a link") + 1)).toBe("https://example.com");
    expect(linkUrlAt(s, 2)).toBeNull();
    expect(isSafeUrl("https://x.io")).toBe(true);
    expect(isSafeUrl("mailto:a@b.c")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,x")).toBe(false);
  });
});
