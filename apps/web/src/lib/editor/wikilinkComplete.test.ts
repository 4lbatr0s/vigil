import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { completeWikilink, wikilinkInsert } from "./wikilinkComplete";

const TITLES = ["Launch plan", "Morning digest", "Plan B", "Digest archive"];

function ctx(doc: string, pos = doc.length): CompletionContext {
  return new CompletionContext(EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] }), pos, false);
}
const labels = (doc: string, pos?: number) => completeWikilink(ctx(doc, pos), TITLES)?.options.map((o) => o.label) ?? null;

describe("completeWikilink", () => {
  it("fires only right after [[", () => {
    expect(labels("plain text")).toBeNull();
    expect(labels("one [ bracket")).toBeNull();
    expect(labels("[[Launch plan]] done")).toBeNull(); // cursor after the closed link
    expect(labels("see [[")).toHaveLength(4); // all titles offered
  });

  it("filters and orders by fuzzy score: prefix, then word start, then substring", () => {
    expect(labels("see [[plan")).toEqual(["Plan B", "Launch plan"]);
    expect(labels("see [[dig")).toEqual(["Digest archive", "Morning digest"]);
    expect(labels("see [[zzz")).toBeNull();
  });

  it("starts the replaced range after the brackets", () => {
    const result = completeWikilink(ctx("see [[pla"), TITLES);
    expect(result?.from).toBe("see [[".length);
    expect(result?.filter).toBe(false);
  });

  it("does not fire inside inline code or a fenced block", () => {
    expect(labels("text `code [[pl`")).toBeNull();
    const fenced = "```\n[[pl";
    expect(labels(fenced)).toBeNull();
    // An unclosed backtick is not code in Markdown, so completion still works there.
    expect(labels("`x [[pl")).not.toBeNull();
  });

  it("returns null when no titles exist", () => {
    expect(completeWikilink(ctx("see [["), [])).toBeNull();
  });
});

describe("wikilinkInsert", () => {
  const st = (doc: string) => EditorState.create({ doc });
  it("adds the closing brackets and puts the cursor after them", () => {
    const doc = "see [[pla";
    const from = "see [[".length;
    const out = wikilinkInsert(st(doc), from, doc.length, "Plan B");
    expect(out.changes).toEqual({ from, to: doc.length, insert: "Plan B]]" });
    expect(out.selection.anchor).toBe(from + "Plan B".length + 2);
  });
  it("does not double brackets that are already there", () => {
    const doc = "see [[pla]] more";
    const from = "see [[".length;
    const out = wikilinkInsert(st(doc), from, from + 3, "Plan B");
    expect(out.changes.insert).toBe("Plan B");
    const after = st(doc).update({ changes: out.changes }).state.doc.toString();
    expect(after).toBe("see [[Plan B]] more");
  });
});
