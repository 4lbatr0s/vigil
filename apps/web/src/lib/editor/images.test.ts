import { describe, expect, it } from "vitest";
import { attachmentSrc, imageMarkdown, imageProblem, MAX_IMAGE_BYTES } from "./images";

describe("images", () => {
  it("writes a relative markdown image and reads it back to the served address", () => {
    expect(imageMarkdown("0123456789abcdef.png")).toBe("![](attachments/0123456789abcdef.png)");
    expect(imageMarkdown("0123456789abcdef.png", "a [b]")).toBe("![a b](attachments/0123456789abcdef.png)");
    expect(attachmentSrc("attachments/0123456789abcdef.png")).toBe("/api/attachments/0123456789abcdef.png");
  });
  it("only trusts links shaped like our own files", () => {
    for (const bad of ["https://evil.test/x.png", "attachments/../state.db", "attachments/x.png", "/api/attachments/0123456789abcdef.png", "attachments/0123456789abcdef.svg", "javascript:alert(1)"]) {
      expect(attachmentSrc(bad)).toBeNull();
    }
  });
  it("says why a file cannot be added", () => {
    expect(imageProblem({ type: "image/png", size: 10 })).toBeNull();
    expect(imageProblem({ type: "image/svg+xml", size: 10 })).toContain("PNG");
    expect(imageProblem({ type: "image/png", size: MAX_IMAGE_BYTES + 1 })).toContain("5 MB");
  });
});
