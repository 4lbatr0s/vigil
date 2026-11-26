import { describe, expect, it } from "vitest";
import { plainSnippet } from "./snippet";

describe("plainSnippet", () => {
  it("drops list, heading and quote markers and keeps the words of links", () => {
    expect(plainSnippet("- Read chapter 4 on [[enthalpy-and-heat]]")).toBe("Read chapter 4 on enthalpy-and-heat");
    expect(plainSnippet("## Key ideas")).toBe("Key ideas");
    expect(plainSnippet("> See [[Heat|the heat note]] and [a page](https://x.org)")).toBe("See the heat note and a page");
    expect(plainSnippet("1. [ ] **Bold** and `code`")).toBe("Bold and code");
  });
});
