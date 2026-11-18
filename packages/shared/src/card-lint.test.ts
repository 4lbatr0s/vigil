import { describe, expect, it } from "vitest";
import { groundingHint, lintCard } from "./index";

const qa = (front: string, back: string) => lintCard({ kind: "qa", front, back }).map((h) => h.code);

describe("lintCard", () => {
  it("accepts a short question with one fact", () => {
    expect(qa("What does FSRS schedule?", "Card reviews")).toEqual([]);
  });
  it("flags long answers", () => {
    expect(qa("Why?", Array.from({ length: 30 }, (_, i) => `w${i}`).join(" "))).toContain("long-answer");
  });
  it("flags lists", () => {
    expect(qa("Which colours?", "red, green and blue")).toContain("list");
    expect(qa("Steps?", "1. wash 2. dry")).toContain("list");
    expect(qa("Why two?", "one and two")).not.toContain("list");
  });
  it("flags yes and no answers", () => {
    expect(qa("Is it?", "Yes, because")).toContain("yes-no");
    expect(qa("Is it?", "Nobody knows")).not.toContain("yes-no");
  });
  it("flags a front that is not a question", () => {
    expect(qa("Capital of France", "Paris")).toEqual(["not-a-question"]);
  });
  it("flags several blanks in a cloze, and not one", () => {
    expect(lintCard({ kind: "cloze", front: "[…] and […]", back: "a and b" }).map((h) => h.code)).toEqual(["many-blanks"]);
    expect(lintCard({ kind: "cloze", front: "The […] is big", back: "The sun is big" })).toEqual([]);
  });
});

describe("groundingHint", () => {
  const note = "Mitochondria produce ATP through cellular respiration. The Calvin cycle happens in the stroma.";
  it("passes an answer made of words from the note, ignoring endings", () => {
    expect(groundingHint({ back: "Mitochondria produces ATP" }, note)).toBeNull();
    expect(groundingHint({ back: "In the stroma" }, note)).toBeNull();
  });
  it("flags an answer that brings its own facts", () => {
    expect(groundingHint({ back: "The nucleus stores chromosomes and ribosomes" }, note)?.code).toBe("not-in-note");
  });
  it("cannot judge a very short answer, so it passes", () => {
    expect(groundingHint({ back: "ATP" }, note)).toBeNull();
    expect(groundingHint({ back: "No" }, note)).toBeNull();
  });
});
