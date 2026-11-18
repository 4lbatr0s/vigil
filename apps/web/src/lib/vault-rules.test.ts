import { describe, expect, it } from "vitest";
import { claudeCodeCommand, vaultRules } from "./vault-rules";

describe("vaultRules", () => {
  it("names the formats and the safety rules", () => {
    const text = vaultRules("http://localhost:3001/api/mcp");
    expect(text).toContain("Never delete or rewrite a note the person wrote");
    expect(text).toContain("Question :: Answer");
    expect(text).toContain("{{c1::the hidden part}}");
    expect(text).toContain("http://localhost:3001/api/mcp");
    expect(text.endsWith("\n")).toBe(true);
  });

  it("leaves the address line out when there is none, without a double blank line", () => {
    const text = vaultRules("");
    expect(text).not.toContain("MCP");
    expect(text).not.toContain("\n\n\n");
  });

  it("gives the Claude Code command", () => {
    expect(claudeCodeCommand("http://x/api/mcp")).toBe("claude mcp add --transport http vigil http://x/api/mcp");
  });
});
