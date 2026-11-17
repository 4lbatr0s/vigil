import { describe, expect, it } from "vitest";
import { shareLine } from "./share";

const q = (s: string) => new URLSearchParams(s);

describe("shareLine", () => {
  it("joins text, title and a web link", () => {
    expect(shareLine(q("text=Read%20later&title=A%20paper&url=https%3A%2F%2Fexample.com%2Fp"))).toBe("Read later — A paper — https://example.com/p");
  });
  it("does not repeat a link that is already in the text, or a title that is", () => {
    expect(shareLine(q("text=See%20https%3A%2F%2Fexample.com%2Fp%20now&title=See&url=https%3A%2F%2Fexample.com%2Fp"))).toBe("See https://example.com/p now");
  });
  it("drops a url that is not http(s), collapses spaces and is empty when nothing came", () => {
    expect(shareLine(q("text=a%0A%20%20b&url=javascript%3Aalert(1)"))).toBe("a b");
    expect(shareLine(q(""))).toBe("");
  });
  it("is capped", () => {
    expect(shareLine(q(`text=${"x".repeat(5000)}`)).length).toBeLessThanOrEqual(1500);
  });
});
