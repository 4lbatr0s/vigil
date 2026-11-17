import { describe, expect, it } from "vitest";
import { extractCards } from "@vigil/shared";
import { ankiToCards, clozeToVigil, plain } from "./anki";

describe("anki import", () => {
  it("cleans html fields", () => {
    expect(plain("A<br>B &amp; <b>C</b>&nbsp;D")).toBe("A B & C D");
  });
  it("turns Anki cloze into Vigil braces and drops hints", () => {
    expect(clozeToVigil("The {{c1::nucleus::organelle}} holds {{c2::DNA}}.")).toBe("The {{nucleus}} holds {{DNA}}.");
  });
  it("reads Basic and Cloze rows with Anki header lines", () => {
    const text = ["#separator:tab", "#html:true", "#notetype column:1", "#tags column:4", "Basic\tCapital of France?\tParis\tgeo", "Cloze\tThe {{c1::sun}} is a star\t\tastro"].join("\n");
    const { lines, skipped } = ankiToCards(text);
    expect(lines).toEqual(["Capital of France? :: Paris", "The {{sun}} is a star"]);
    expect(skipped).toBe(0);
  });
  it("without headers takes the first two columns", () => {
    expect(ankiToCards("Q one\tA one\nQ two\tA two\n").lines).toEqual(["Q one :: A one", "Q two :: A two"]);
  });
  it("skips empty, duplicate and one-sided rows, and counts them", () => {
    const { lines, skipped } = ankiToCards("Q\tA\nQ\tA\nOnly front\t\n\t\n");
    expect(lines).toEqual(["Q :: A"]);
    expect(skipped).toBe(2); // the blank row is not a card and is not counted
  });
  it("keeps a literal separator out of the fields so each line stays one card", () => {
    expect(ankiToCards("a :: b\tc :: d").lines).toEqual(["a : b :: c : d"]);
  });
  it("every imported line is a card Vigil can read", () => {
    const { lines } = ankiToCards("Basic\tWhy?\tBecause\nCloze\tThe {{c1::moon}} orbits\t\n".replace(/^/, "#notetype column:1\n"));
    expect(extractCards(lines.join("\n\n")).map((c) => c.kind)).toEqual(["qa", "cloze"]);
  });
});
