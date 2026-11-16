import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { completeSlash } from "./slash";

function ctx(doc: string, pos = doc.length): CompletionContext {
  return new CompletionContext(EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] }), pos, false);
}
const labels = (doc: string, pos?: number) => completeSlash(ctx(doc, pos))?.options.map((o) => o.label) ?? null;

describe("completeSlash", () => {
  it("fires at the start of a line, also when indented, and offers every block for a bare slash", () => {
    expect(labels("/")).toHaveLength(11);
    expect(labels("text\n  /")).toHaveLength(11);
  });
  it("does not fire mid-line, in code, or without a slash", () => {
    expect(labels("a /h")).toBeNull();
    expect(labels("http://x")).toBeNull();
    expect(labels("```\n/h\n```", 7)).toBeNull();
    expect(labels("plain")).toBeNull();
  });
  it("filters by name and by alias", () => {
    expect(labels("/head")?.slice(0, 3)).toEqual(["Heading 1", "Heading 2", "Heading 3"]);
    expect(labels("/checkbox")).toEqual(["To-do list"]);
    expect(labels("/zzz")).toBeNull();
  });
  it("adds a blank line after a block when text follows right below it", () => {
    const apply = (doc: string, label: string): string => {
      const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
      const r = completeSlash(new CompletionContext(s, doc.indexOf("/") + 4, false));
      const opt = r?.options.find((o) => o.label === label);
      let out = doc;
      const view = { state: s, dispatch: (spec: { changes: { from: number; to: number; insert: string } }) => (out = doc.slice(0, spec.changes.from) + spec.changes.insert + doc.slice(spec.changes.to)) };
      (opt?.apply as (v: unknown, c: unknown, f: number, t: number) => void)(view, opt, r?.from ?? 0, doc.indexOf("/") + 4);
      return out;
    };
    expect(apply("/tab\nEnd.", "Table")).toBe("| Column | Column |\n| --- | --- |\n|  |  |\n\nEnd.");
    expect(apply("/tab\n\nEnd.", "Table")).toBe("| Column | Column |\n| --- | --- |\n|  |  |\n\nEnd.");
    expect(apply("/tab", "Table")).toBe("| Column | Column |\n| --- | --- |\n|  |  |");
  });
  it("replaces the slash and the typed word", () => {
    const r = completeSlash(ctx("one\n/hea"));
    expect(r?.from).toBe(4);
  });
});
