import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { outlineOf } from "./outline";

const make = (doc: string): EditorState => EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });

describe("outlineOf", () => {
  it("lists headings with level and place, skipping code", () => {
    const doc = "# One\n\ntext\n\n## Two ##\n\n```\n# not a heading\n```\n\nThree\n=====\n";
    const out = outlineOf(make(doc));
    expect(out.map((h) => [h.level, h.title])).toEqual([[1, "One"], [2, "Two"], [1, "Three"]]);
    expect(out[1]?.from).toBe(doc.indexOf("## Two"));
  });
  it("is empty for a note without headings", () => {
    expect(outlineOf(make("just words"))).toEqual([]);
  });
});
