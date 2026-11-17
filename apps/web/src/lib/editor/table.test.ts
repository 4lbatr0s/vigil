import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { cellAt, formatTable, parseTable, splitRow, tabInTable } from "./table";

const make = (doc: string): EditorState => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
const TABLE = ["| Name | Role |", "| --- | ---: |", "| Ada | Engineer |", "| Grace | Admiral |"].join("\n");

describe("splitRow and parseTable", () => {
  it("splits at pipes that are not escaped and trims the cells", () => {
    expect(splitRow("| a | b\\|c | d |")).toEqual(["a", "b\\|c", "d"]);
    expect(splitRow("a | b")).toEqual(["a", "b"]);
  });

  it("reads rows and alignments from the rule row", () => {
    const t = parseTable(["| A | B | C | D |", "| :-- | :-: | --: | --- |", "| 1 | 2 | 3 | 4 |"]);
    expect(t?.aligns).toEqual(["left", "center", "right", "none"]);
    expect(t?.rows).toEqual([["A", "B", "C", "D"], ["1", "2", "3", "4"]]);
  });

  it("is not a table without a rule row", () => {
    expect(parseTable(["| a | b |", "| c | d |"])).toBeNull();
    expect(parseTable(["just text"])).toBeNull();
  });
});

describe("formatTable", () => {
  it("lines the columns up and keeps the alignment marks", () => {
    const t = parseTable(TABLE.split("\n"));
    expect(formatTable(t!).text).toBe(["| Name  |     Role |", "| ----- | -------: |", "| Ada   | Engineer |", "| Grace |  Admiral |"].join("\n"));
  });

  it("formats an already tidy table to the same text (idempotent)", () => {
    const once = formatTable(parseTable(TABLE.split("\n"))!).text;
    expect(formatTable(parseTable(once.split("\n"))!).text).toBe(once);
  });

  it("never changes the words in the cells", () => {
    const t = parseTable(["| a  b | c |", "| --- | --- |", "| 1  2 | x\\|y |"]);
    expect(formatTable(t!).text).toContain("a  b");
    expect(formatTable(t!).text).toContain("x\\|y");
  });
});

describe("cellAt and tabInTable", () => {
  const apply = (state: EditorState, spec: ReturnType<typeof tabInTable>): { doc: string; from: number; to: number } => {
    const next = state.update(spec!).state;
    return { doc: next.doc.toString(), from: next.selection.main.from, to: next.selection.main.to };
  };

  it("knows the cell under the caret and none on the rule row or outside", () => {
    const s = make(TABLE);
    expect(cellAt(s, TABLE.indexOf("Ada"))).toEqual({ row: 1, col: 0 });
    expect(cellAt(s, TABLE.indexOf("Admiral"))).toEqual({ row: 2, col: 1 });
    expect(cellAt(s, TABLE.indexOf("---"))).toBeNull();
    expect(cellAt(make("plain text"), 3)).toBeNull();
  });

  it("Tab goes to the next cell, selects its text and lines the table up", () => {
    const s = make(TABLE);
    const r = apply(s, tabInTable(s, TABLE.indexOf("Ada"), 1));
    expect(r.doc.split("\n")[2]).toBe("| Ada   | Engineer |");
    expect(r.doc.slice(r.from, r.to)).toBe("Engineer");
  });

  it("Tab at the end of a row goes to the first cell of the next row", () => {
    const s = make(TABLE);
    const r = apply(s, tabInTable(s, TABLE.indexOf("Engineer"), 1));
    expect(r.doc.slice(r.from, r.to)).toBe("Grace");
  });

  it("Tab in the last cell adds a row", () => {
    const s = make(TABLE);
    const r = apply(s, tabInTable(s, TABLE.indexOf("Admiral"), 1));
    expect(r.doc.split("\n")).toHaveLength(5);
    expect(r.doc.split("\n")[4]).toBe("|       |          |");
    expect(r.from).toBe(r.to);
  });

  it("Shift+Tab goes back, and not past the first cell", () => {
    const s = make(TABLE);
    const r = apply(s, tabInTable(s, TABLE.indexOf("Engineer"), -1));
    expect(r.doc.slice(r.from, r.to)).toBe("Ada");
    expect(tabInTable(s, TABLE.indexOf("Name"), -1)).toBeNull();
  });

  it("does nothing outside a table", () => {
    expect(tabInTable(make("text\n\nmore"), 2, 1)).toBeNull();
  });
});
