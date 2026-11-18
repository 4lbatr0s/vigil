import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { blockExtensions } from "./extensions";
import { deleteUnit, duplicateUnit, moveUnit, unitAt } from "./moves";
import { tidyMarkdown } from "./markdownIo";

const opened: Editor[] = [];
const open = (md: string): Editor => {
  const e = new Editor({ element: document.createElement("div"), extensions: blockExtensions(), content: md, contentType: "markdown" });
  opened.push(e);
  return e;
};
afterEach(() => {
  while (opened.length > 0) opened.pop()?.destroy();
});
const md = (e: Editor): string => tidyMarkdown(e.getMarkdown());
const posOf = (e: Editor, text: string): number => {
  let found = -1;
  e.state.doc.descendants((n, p) => {
    if (found < 0 && n.isText && n.text?.includes(text)) found = p + 1;
  });
  return found;
};

describe("moving blocks", () => {
  it("moves a top-level block to the start and to the end", () => {
    const e = open("one\n\ntwo\n\nthree");
    const u = unitAt(e.state.doc, posOf(e, "three"));
    const tr = e.state.tr;
    expect(u && moveUnit(tr, u, 0)).toBe(true);
    e.view.dispatch(tr);
    expect(md(e)).toBe("three\n\none\n\ntwo\n");
    const u2 = unitAt(e.state.doc, posOf(e, "three"));
    const tr2 = e.state.tr;
    expect(u2 && moveUnit(tr2, u2, 3)).toBe(true);
    e.view.dispatch(tr2);
    expect(md(e)).toBe("one\n\ntwo\n\nthree\n");
  });

  it("moves a list item with its nested items, inside its own list", () => {
    const e = open("- a\n  - a1\n- b\n- c");
    const u = unitAt(e.state.doc, posOf(e, "a"));
    expect(u?.node.childCount).toBe(2);
    const tr = e.state.tr;
    expect(u && moveUnit(tr, u, 3)).toBe(true);
    e.view.dispatch(tr);
    expect(md(e)).toBe("- b\n- c\n- a\n  - a1\n");
  });

  it("does nothing when the block would stay where it is", () => {
    const e = open("one\n\ntwo");
    const u = unitAt(e.state.doc, posOf(e, "one"));
    const tr = e.state.tr;
    expect(u && moveUnit(tr, u, 0)).toBe(false);
    expect(u && moveUnit(tr, u, 1)).toBe(false);
  });

  it("treats a whole table or callout as one block", () => {
    const e = open("intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> [!note] hi\n> body");
    const table = unitAt(e.state.doc, posOf(e, "1"));
    expect(table?.node.type.name).toBe("table");
    const callout = unitAt(e.state.doc, posOf(e, "body"));
    expect(callout?.node.type.name).toBe("callout");
  });

  it("duplicates and deletes, keeping a paragraph when the note would be empty", () => {
    const e = open("only");
    const u = unitAt(e.state.doc, posOf(e, "only"));
    const tr = e.state.tr;
    if (u) duplicateUnit(tr, u);
    e.view.dispatch(tr);
    expect(md(e)).toBe("only\n\nonly\n");
    const one = open("alone");
    const v = unitAt(one.state.doc, posOf(one, "alone"));
    const tr2 = one.state.tr;
    if (v) deleteUnit(tr2, v);
    one.view.dispatch(tr2);
    expect(one.state.doc.childCount).toBe(1);
    expect(md(one)).toBe("");
  });
});
