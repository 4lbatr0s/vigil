import { describe, expect, it } from "vitest";
import { checkItems } from "./recall-feedback";

describe("checkItems", () => {
  it("reads the bullets under Check", () => {
    const text = "Remembered:\n- ATP\n\nMissed:\n- the nucleus\n\nCheck:\n- You wrote the nucleus makes ATP; the note says \"The mitochondria makes ATP\".\n- Mixed up DNA and RNA.\n";
    expect(checkItems(text)).toEqual(['You wrote the nucleus makes ATP; the note says "The mitochondria makes ATP".', "Mixed up DNA and RNA."]);
  });

  it("is empty for None, or when there is no Check part", () => {
    expect(checkItems("Remembered:\n- a\n\nMissed:\n- b\n\nCheck: None")).toEqual([]);
    expect(checkItems("Check:\nNone")).toEqual([]);
    expect(checkItems("Remembered:\n- a")).toEqual([]);
  });

  it("copes with bold headings and stops at the next section", () => {
    expect(checkItems("**Check:**\n* Wrong year\n\n**Missed:**\n* x")).toEqual(["Wrong year"]);
    expect(checkItems("Check:\n- one\nMissed:\n- two")).toEqual(["one"]);
  });

  it("takes at most five", () => {
    expect(checkItems("Check:\n" + Array.from({ length: 9 }, (_, i) => `- item ${i}`).join("\n"))).toHaveLength(5);
  });
});
