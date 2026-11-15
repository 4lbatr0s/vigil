import { describe, expect, it } from "vitest";
import { extractLinks, rewriteLinks, stripCode } from "./links";

describe("stripCode", () => {
  it("blanks fenced and inline code, keeping length and newlines", () => {
    const body = "a `[[x]]` b\n```js\n[[y]]\n```\nc [[z]]";
    const out = stripCode(body);
    expect(out).toHaveLength(body.length);
    expect(out.split("\n").length).toBe(body.split("\n").length);
    expect(out).toContain("[[z]]");
    expect(out).not.toContain("[[x]]");
    expect(out).not.toContain("[[y]]");
  });
  it("treats an unclosed fence as code to the end", () => {
    expect(stripCode("```\n[[a]]\nmore")).not.toContain("[[a]]");
  });
  it("handles ~~~ fences", () => {
    expect(stripCode("~~~\n[[a]]\n~~~\n[[b]]")).toContain("[[b]]");
    expect(stripCode("~~~\n[[a]]\n~~~\n[[b]]")).not.toContain("[[a]]");
  });
});

describe("extractLinks", () => {
  it("finds wikilinks (with heading and alias) and md links, and ignores urls and anchors", () => {
    const body = "[[Launch plan]] [[Other#Section|alias]] [t](some-note) [t](./dot-note.md) [u](https://x.io) [a](note#frag)";
    expect(extractLinks(body).sort()).toEqual(["dot-note", "launch-plan", "other", "some-note"]);
  });
  it("does not extract links inside code fences or inline code", () => {
    expect(extractLinks("```\n[[In fence]]\n```\n`[[inline]]` [[Real]]")).toEqual(["real"]);
  });
});

describe("rewriteLinks", () => {
  it("rewrites wikilinks (keeping heading and alias) and md links, counts changes", () => {
    const body = "A [[Old title]] B [[old title#Part|see]] C [x](old-title) D [y](./old-title.md) E [[Other]]";
    const out = rewriteLinks(body, "old-title", "new-name", "New name");
    expect(out.body).toBe("A [[New name]] B [[New name#Part|see]] C [x](new-name) D [y](./new-name.md) E [[Other]]");
    expect(out.count).toBe(4);
  });
  it("leaves links in code untouched", () => {
    const body = "```\n[[Old title]]\n```\n`[[Old title]]` and [[Old title]]";
    const out = rewriteLinks(body, "old-title", "n", "N");
    expect(out.body).toBe("```\n[[Old title]]\n```\n`[[Old title]]` and [[N]]");
    expect(out.count).toBe(1);
  });
  it("changes nothing when no link points at the note", () => {
    const out = rewriteLinks("[[Other]] [a](x)", "old-title", "n", "N");
    expect(out).toEqual({ body: "[[Other]] [a](x)", count: 0 });
  });
});
