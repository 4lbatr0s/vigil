import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render";

describe("renderMarkdown", () => {
  it("renders headings", () => {
    expect(renderMarkdown("# Hi")).toContain("<h1>");
  });

  it("strips script tags", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script");
  });

  it("preserves wikilink-style plain text", () => {
    expect(renderMarkdown("[[Some Note]]")).toContain("[[Some Note]]");
  });
});
