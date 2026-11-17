import { describe, expect, it } from "vitest";
import { linkFromPaste } from "./paste";

describe("linkFromPaste", () => {
  it("makes a link from selected words and a pasted web address", () => {
    expect(linkFromPaste("the docs", "https://example.com/a?b=1")).toBe("[the docs](https://example.com/a?b=1)");
    expect(linkFromPaste("x", "  http://example.com  ")).toBe("[x](http://example.com)");
  });
  it("leaves other pastes alone", () => {
    expect(linkFromPaste("", "https://example.com")).toBeNull();
    expect(linkFromPaste("words", "not a link")).toBeNull();
    expect(linkFromPaste("a\nb", "https://example.com")).toBeNull();
    expect(linkFromPaste("words", "javascript:alert(1)")).toBeNull();
    expect(linkFromPaste("words", "https://a.com https://b.com")).toBeNull();
  });
  it("drops square brackets from the selected words so the link stays valid", () => {
    expect(linkFromPaste("a [b]", "https://example.com")).toBe("[a b](https://example.com)");
  });
});
