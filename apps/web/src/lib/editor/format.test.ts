import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { indentListSpec, insertLinkSpec, setHeadingSpec, toggleInlineSpec, toggleLineSpec } from "./format";

/** Applies a spec to a doc written with `|` for the cursor or `[..]` for the selection; returns the result the same way. */
function apply(doc: string, spec: (s: EditorState) => TransactionSpec | null): string {
  const open = doc.indexOf("[");
  const close = doc.indexOf("]");
  const pipe = doc.indexOf("|");
  let text: string;
  let sel: EditorSelection;
  if (open >= 0 && close > open) {
    text = doc.slice(0, open) + doc.slice(open + 1, close) + doc.slice(close + 1);
    sel = EditorSelection.single(open, close - 1);
  } else {
    text = doc.replace("|", "");
    sel = EditorSelection.single(pipe);
  }
  const s = EditorState.create({ doc: text, selection: sel });
  const out = spec(s);
  if (!out) return doc;
  const next = s.update(out).state;
  const r = next.selection.main;
  const t = next.doc.toString();
  return r.empty ? `${t.slice(0, r.from)}|${t.slice(r.from)}` : `${t.slice(0, r.from)}[${t.slice(r.from, r.to)}]${t.slice(r.to)}`;
}

describe("toggleInlineSpec", () => {
  const bold = (d: string) => apply(d, (s) => toggleInlineSpec(s, "**"));
  const italic = (d: string) => apply(d, (s) => toggleInlineSpec(s, "*"));
  it("wraps a selection and keeps it selected", () => {
    expect(bold("a [word] b")).toBe("a **[word]** b");
  });
  it("unwraps when the selection sits inside the marks, or includes them", () => {
    expect(bold("a **[word]** b")).toBe("a [word] b");
    expect(bold("a [**word**] b")).toBe("a [word] b");
  });
  it("inserts a pair at an empty cursor and removes an empty pair", () => {
    expect(bold("a | b")).toBe("a **|** b");
    expect(bold("a **|** b")).toBe("a | b");
  });
  it("italic inside bold adds one star pair instead of eating the bold", () => {
    expect(italic("**[x]**")).toBe("***[x]***");
    expect(italic("a *[x]* b")).toBe("a [x] b");
  });
  it("works for code and strikethrough marks", () => {
    expect(apply("[x]", (s) => toggleInlineSpec(s, "`"))).toBe("`[x]`");
    expect(apply("[x]", (s) => toggleInlineSpec(s, "~~"))).toBe("~~[x]~~");
  });
});

describe("toggleInlineSpec and whitespace", () => {
  it("keeps the marks off the newline a triple click selects", () => {
    const s = EditorState.create({ doc: "line one\nline two", selection: EditorSelection.single(0, 9) });
    expect(s.update(toggleInlineSpec(s, "**")).state.doc.toString()).toBe("**line one**\nline two");
    const spaced = EditorState.create({ doc: "a  word  b", selection: EditorSelection.single(1, 9) });
    expect(spaced.update(toggleInlineSpec(spaced, "*")).state.doc.toString()).toBe("a  *word*  b");
  });
});

describe("link and heading", () => {
  it("wraps the selection as a link with the url selected", () => {
    expect(apply("see [docs] now", insertLinkSpec)).toBe("see [docs]([https://]) now");
  });
  it("sets, switches and clears heading levels", () => {
    expect(apply("title|", (s) => setHeadingSpec(s, 2))).toBe("## title|");
    expect(apply("## title|", (s) => setHeadingSpec(s, 2))).toBe("title|");
    expect(apply("# title|", (s) => setHeadingSpec(s, 3))).toBe("### title|");
  });
});

describe("toggleLineSpec", () => {
  it("makes lines a bulleted, numbered or to-do list and a quote, and turns them off again", () => {
    expect(apply("[a\nb]", (s) => toggleLineSpec(s, "bullet"))).toBe("[- a\n- b]");
    expect(apply("[a\nb]", (s) => toggleLineSpec(s, "number"))).toBe("[1. a\n2. b]");
    expect(apply("[a\nb]", (s) => toggleLineSpec(s, "task"))).toBe("[- [ ] a\n- [ ] b]");
    expect(apply("[- a\n- b]", (s) => toggleLineSpec(s, "bullet"))).toBe("[a\nb]");
    expect(apply("x|", (s) => toggleLineSpec(s, "quote"))).toBe("> x|");
  });
  it("switches a list kind and keeps indentation", () => {
    expect(apply("  - a|", (s) => toggleLineSpec(s, "number"))).toBe("  1. a|");
    // A to-do marker contains brackets, so this case builds its state by hand instead of using `apply`.
    const s = EditorState.create({ doc: "- [x] a", selection: EditorSelection.cursor(7) });
    expect(s.update(toggleLineSpec(s, "bullet")).state.doc.toString()).toBe("- a");
  });
});

describe("indentListSpec", () => {
  it("indents and outdents list items by their marker width, and leaves other lines alone", () => {
    expect(apply("- a|", (s) => indentListSpec(s, 1))).toBe("  - a|");
    expect(apply("1. a|", (s) => indentListSpec(s, 1))).toBe("   1. a|");
    expect(apply("  - a|", (s) => indentListSpec(s, -1))).toBe("- a|");
    expect(indentListSpec(EditorState.create({ doc: "plain", selection: EditorSelection.cursor(2) }), 1)).toBeNull();
    expect(indentListSpec(EditorState.create({ doc: "- a", selection: EditorSelection.cursor(2) }), -1)).toBeNull();
  });
});
