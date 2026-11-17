import { describe, expect, it } from "vitest";
import type { Passage } from "./api";
import { splitAnswer, usedPassages, verdict } from "./citations";

const passages: Passage[] = [
  { n: 1, noteId: "a", title: "A", line: 3, text: "One." },
  { n: 2, noteId: "b", title: "B", line: 1, text: "Two." },
];

describe("citations", () => {
  it("cuts an answer into text and marks", () => {
    expect(splitAnswer("Yes [1]. Also [2][1] done", passages).map((p) => (p.kind === "text" ? p.text : `#${p.n}`))).toEqual(["Yes ", "#1", ". Also ", "#2", "#1", " done"]);
  });

  it("finds the lines used, once each, in order", () => {
    expect(usedPassages("x [2] y [1] z [2]", passages).map((p) => p.n)).toEqual([2, 1]);
  });

  it("judges an answer", () => {
    expect(verdict("Entropy is disorder [1].", passages)).toBe("covered");
    expect(verdict("Entropy is disorder.", passages)).toBe("no-marks");
    expect(verdict("Entropy is disorder [7].", passages)).toBe("bad-marks");
    expect(verdict("Your notes do not cover this.", passages)).toBe("not-covered");
  });
});
