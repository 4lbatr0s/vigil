import { describe, expect, it } from "vitest";
import { extractCards } from "@vigil/shared";
import { appendCards, isCardLine, proposalsFrom } from "./card-review";

describe("proposalsFrom", () => {
  it("keeps card lines, strips list marks, and ignores prose and repeats", () => {
    const answer = "Here are your cards:\n1. What is ATP? :: Energy\n- The {{nucleus}} holds DNA.\nsome chatter\nWhat is ATP? :: Energy again";
    expect(proposalsFrom(answer, []).map((p) => p.line)).toEqual(["What is ATP? :: Energy", "The {{nucleus}} holds DNA."]);
  });
  it("marks cards the note already has and does not keep them by default", () => {
    const existing = extractCards("What is ATP? :: Energy");
    const [a, b] = proposalsFrom("What is ATP? :: Something else\nNew? :: yes", existing);
    expect(a).toMatchObject({ duplicate: true, keep: false });
    expect(b).toMatchObject({ duplicate: false, keep: true });
  });
});

describe("isCardLine", () => {
  it("accepts one card and refuses text, two lines or nothing", () => {
    expect(isCardLine("Q? :: A")).toBe(true);
    expect(isCardLine("The {{x}} y")).toBe(true);
    expect(isCardLine("just words")).toBe(false);
    expect(isCardLine("Q? :: A\nR? :: B")).toBe(false);
    expect(isCardLine("")).toBe(false);
  });
});

describe("appendCards", () => {
  it("creates a Cards section at the end when there is none", () => {
    expect(appendCards("# Bio\n\nText.", ["Q? :: A"])).toBe("# Bio\n\nText.\n\n## Cards\nQ? :: A\n");
    expect(appendCards("", ["Q? :: A"])).toBe("## Cards\nQ? :: A\n");
  });
  it("adds to the end of an existing Cards section and leaves later sections alone", () => {
    const body = "# Bio\n\n## Cards\nOne? :: 1\n\n## Notes\nmore";
    expect(appendCards(body, ["Two? :: 2"])).toBe("# Bio\n\n## Cards\nOne? :: 1\nTwo? :: 2\n\n## Notes\nmore");
    expect(appendCards("## Cards\nOne? :: 1", ["Two? :: 2", "  "])).toBe("## Cards\nOne? :: 1\nTwo? :: 2\n");
  });
  it("changes nothing when there is nothing to add, and the result parses back as the same cards", () => {
    expect(appendCards("x", [])).toBe("x");
    const out = appendCards("# T\n\n## Cards\nA? :: a", ["B? :: b", "The {{c}} d."]);
    expect(extractCards(out).map((c) => c.front)).toEqual(["A?", "B?", "The […] d."]);
  });
});
