import { describe, expect, it } from "vitest";
import { extractCards, extractInlineTags, slugify } from "@vigil/shared";
import { WELCOME_BODY, WELCOME_ID, WELCOME_TITLE } from "./welcome";

describe("welcome note", () => {
  it("has an id that matches its title", () => {
    expect(slugify(WELCOME_TITLE)).toBe(WELCOME_ID);
  });
  it("demonstrates what it teaches: three working cards (two question, one blank), a tag, and no stray card lines", () => {
    const cards = extractCards(WELCOME_BODY);
    expect(cards.map((c) => c.kind)).toEqual(["qa", "qa", "cloze"]);
    expect(extractInlineTags(WELCOME_BODY)).toContain("getting-started");
    // The teaching text mentions the syntax in prose without accidentally making cards of it.
    expect(extractCards(WELCOME_BODY.split("## Cards")[0] ?? "")).toEqual([]);
  });
});
