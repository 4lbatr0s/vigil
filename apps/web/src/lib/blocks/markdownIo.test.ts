import { describe, expect, it } from "vitest";
import { roundTrips, throughEditor } from "./markdownIo";
import { normalize } from "./extensions";

const SAFE: Record<string, string> = {
  headings: "# One\n\n## Two\n\n### Three\n\nText under it.",
  "nested lists": "- a\n  - b\n    - c\n- d\n\n1. one\n2. two\n   1. inner",
  tasks: "- [ ] open\n- [x] done\n  - [ ] nested",
  "table with alignment": "| Name | Role |\n| --- | ---: |\n| Ada | Engineer |\n| Grace | Admiral |",
  "table with an escaped pipe": "| a | b |\n| --- | --- |\n| x \\| y | z |",
  "code with blank lines and hashes": "```ts\n# not a heading\n\n- not a list\nconst a = 1;\n```",
  callout: "> [!note] Title\n> Body line\n>\n> Second paragraph",
  "folded callout": "> [!tip]- Hidden\n> Inside",
  quote: "> a quote\n> on two lines",
  "wikilinks, tags and cloze": "See [[Other note]] and [[Other|shown]] with #tag and {{c1::hidden}} words.",
  "emphasis and links": "**bold** *italic* ~~gone~~ `code` [text](https://example.com)",
  image: "![alt text](/api/images/a.png)",
  divider: "Above\n\n---\n\nBelow",
};

describe("round trip through the block editor", () => {
  for (const [name, md] of Object.entries(SAFE)) {
    it(`keeps ${name}`, () => {
      expect(normalize(throughEditor(md))).toBe(normalize(md));
      expect(roundTrips(md)).toBe(true);
    });
  }

  it("writes wikilinks and cloze exactly as typed, not escaped", () => {
    expect(throughEditor("a [[B|c]] {{c2::d}}")).toBe("a [[B|c]] {{c2::d}}");
  });

  it("keeps code exactly, including blank lines and indentation", () => {
    const md = "```py\ndef f():\n\n    return 1\n```";
    expect(throughEditor(md)).toBe(md);
  });

  it("sends notes with syntax it cannot keep to the plain markdown editor", () => {
    expect(roundTrips("Text with a note[^1].\n\n[^1]: The note.")).toBe(false);
    expect(roundTrips("<!-- hidden comment -->\n\nText")).toBe(false);
    expect(roundTrips("<div class=\"x\">raw html</div>")).toBe(false);
  });

  it("is not fooled by a changed word", () => {
    expect(normalize("one\n\ntwo")).not.toBe(normalize("one\n\ntree"));
    expect(normalize("```\na\n\nb\n```")).not.toBe(normalize("```\na\nb\n```"));
  });
});
