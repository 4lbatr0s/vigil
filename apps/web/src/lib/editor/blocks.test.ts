import { describe, expect, it } from "vitest";
import { EditorState, type ChangeSpec } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { blockIndexAt, blocksOf, deleteBlock, duplicateBlock, moveBlock, turnInto, type TurnInto } from "./blocks";

const make = (doc: string): EditorState => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
const apply = (state: EditorState, changes: ChangeSpec): string => state.update({ changes }).state.doc.toString();

const DOC = ["# Title", "", "First paragraph", "with two lines.", "", "- one", "  - nested", "- two", "- three", "", "```ts", "const a = 1;", "", "// a blank line inside", "```", "", "> quoted", "", "Last paragraph"].join("\n");

describe("blocksOf", () => {
  it("finds headings, paragraphs, list items with their children, code and quotes", () => {
    const s = make(DOC);
    const kinds = blocksOf(s).map((b) => `${b.kind}:${b.type}:${s.doc.sliceString(b.from, b.to).split("\n")[0]}`);
    expect(kinds).toEqual([
      "block:ATXHeading1:# Title",
      "block:Paragraph:First paragraph",
      "list:ListItem:- one",
      "list:ListItem:- two",
      "list:ListItem:- three",
      "block:FencedCode:```ts",
      "block:Blockquote:> quoted",
      "block:Paragraph:Last paragraph",
    ]);
    const one = blocksOf(s)[2];
    expect(s.doc.sliceString(one?.from ?? 0, one?.to ?? 0)).toBe("- one\n  - nested");
  });

  it("keeps a code block with blank lines inside as one block", () => {
    const s = make(DOC);
    const code = blocksOf(s).find((b) => b.type === "FencedCode");
    expect(s.doc.sliceString(code?.from ?? 0, code?.to ?? 0)).toContain("// a blank line inside");
  });

  it("finds the block under a position, and none on a blank line", () => {
    const s = make(DOC);
    const blocks = blocksOf(s);
    expect(blockIndexAt(blocks, DOC.indexOf("two lines"))).toBe(1);
    expect(blockIndexAt(blocks, DOC.indexOf("\n\nFirst") + 1)).toBe(-1);
  });
});

describe("moveBlock", () => {
  it("moves a paragraph after a later block and back again without changing anything else", () => {
    const s = make(DOC);
    const blocks = blocksOf(s);
    const moved = apply(s, moveBlock(s, blocks, 1, 7, true));
    expect(moved.endsWith("Last paragraph\n\nFirst paragraph\nwith two lines.")).toBe(true);
    const s2 = make(moved);
    const b2 = blocksOf(s2);
    const back = apply(s2, moveBlock(s2, b2, b2.length - 1, 1, false));
    expect(back).toBe(DOC.replace(/\n\n$/, ""));
  });

  it("keeps the same text: only the order of blocks changes", () => {
    const s = make(DOC);
    const blocks = blocksOf(s);
    const out = apply(s, moveBlock(s, blocks, 5, 0, false));
    const words = (t: string) => t.split(/\s+/).filter(Boolean).sort().join(" ");
    expect(words(out)).toBe(words(DOC));
    expect(out.startsWith("```ts\nconst a = 1;")).toBe(true);
  });

  it("moves a list item with its nested items and stays tight in the list", () => {
    const s = make(DOC);
    const blocks = blocksOf(s);
    const out = apply(s, moveBlock(s, blocks, 2, 4, true));
    expect(out).toContain("- two\n- three\n- one\n  - nested");
  });

  it("does nothing when the block would stay where it is", () => {
    const s = make(DOC);
    const blocks = blocksOf(s);
    expect(moveBlock(s, blocks, 1, 1, true)).toEqual([]);
    expect(moveBlock(s, blocks, 1, 2, false)).toEqual([]);
    expect(moveBlock(s, blocks, 2, 1, true)).toEqual([]);
  });

  it("moves the last block of a note to the top", () => {
    const s = make("one\n\ntwo\n\nthree");
    const blocks = blocksOf(s);
    expect(apply(s, moveBlock(s, blocks, 2, 0, false))).toBe("three\n\none\n\ntwo");
  });
});

describe("duplicateBlock and deleteBlock", () => {
  it("copies a block below itself", () => {
    const s = make("one\n\ntwo");
    expect(apply(s, duplicateBlock(s, blocksOf(s)[0]!))).toBe("one\n\none\n\ntwo");
    const l = make("- a\n- b");
    expect(apply(l, duplicateBlock(l, blocksOf(l)[0]!))).toBe("- a\n- a\n- b");
  });

  it("removes a block and one blank line, also at the start and the end", () => {
    const s = make("one\n\ntwo\n\nthree");
    expect(apply(s, deleteBlock(s, blocksOf(s)[1]!))).toBe("one\n\nthree");
    expect(apply(s, deleteBlock(s, blocksOf(s)[0]!))).toBe("two\n\nthree");
    expect(apply(s, deleteBlock(s, blocksOf(s)[2]!))).toBe("one\n\ntwo");
  });
});

describe("turnInto", () => {
  const turn = (doc: string, index: number, kind: TurnInto): string => {
    const s = make(doc);
    return apply(s, turnInto(s, blocksOf(s)[index]!, kind));
  };

  it("makes a paragraph a heading, a list, a quote or a callout and keeps the words", () => {
    expect(turn("Some words", 0, "h2")).toBe("## Some words");
    expect(turn("a\nb", 0, "bullet")).toBe("- a\n- b");
    expect(turn("a\nb", 0, "number")).toBe("1. a\n2. b");
    expect(turn("a\nb", 0, "todo")).toBe("- [ ] a\n- [ ] b");
    expect(turn("a\nb", 0, "quote")).toBe("> a\n> b");
    expect(turn("a\nb", 0, "callout")).toBe("> [!note] a\n> b");
    expect(turn("a\nb", 0, "code")).toBe("```\na\nb\n```");
  });

  it("swaps one marker for another without doubling it", () => {
    expect(turn("# Heading", 0, "bullet")).toBe("- Heading");
    expect(turn("> [!tip] Remember", 0, "text")).toBe("Remember");
    expect(turn("- [x] done", 0, "h1")).toBe("# done");
  });

  it("changes only the line of a list item and leaves its nested items", () => {
    expect(turn("- one\n  - nested", 0, "todo")).toBe("- [ ] one\n  - nested");
    expect(turn("- one\n  - nested", 0, "h2")).toBe("## one\n  - nested");
  });

  it("turns a code block back into text by dropping the fences", () => {
    expect(turn("```ts\nconst a = 1;\n```", 0, "text")).toBe("const a = 1;");
    expect(turn("```ts\nconst a = 1;\n```", 0, "quote")).toBe("> const a = 1;");
  });
});
