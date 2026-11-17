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

describe("renderMarkdown sanitising", () => {
  it("strips event-handler attributes", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("strips javascript: links", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });
});

describe("renderMarkdown vault images", () => {
  it("points a vault image at the API", () => {
    expect(renderMarkdown("![shot](attachments/0123456789abcdef.png)")).toContain('src="/api/attachments/0123456789abcdef.png"');
  });
  it("leaves other image links alone", () => {
    const html = renderMarkdown("![x](attachments/../../etc/passwd)");
    expect(html).not.toContain("/api/attachments/");
  });
});
