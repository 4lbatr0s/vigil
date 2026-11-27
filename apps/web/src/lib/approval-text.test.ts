import { describe, expect, it } from "vitest";
import { actionText } from "./approval-text";

describe("actionText", () => {
  it("says what each kind of approval would do", () => {
    expect(actionText({ tool: "write_note", currentBody: null })).toBe("creates a note");
    expect(actionText({ tool: "write_note", currentBody: "x" })).toBe("replaces the note");
    expect(actionText({ tool: "append_note", currentBody: "x" })).toBe("adds to the note");
    expect(actionText({ tool: "fetch_url", currentBody: null })).toBe("wants to read a web page");
    expect(actionText({ tool: "call_agent", currentBody: null })).toBe("wants to ask another helper");
  });
});
