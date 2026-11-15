import { describe, expect, it } from "vitest";
import type { ChatLine, ChatMessage } from "./api";
import { applyLine, emptyLive, lastIsUser, speakerOf } from "./chat-view";

describe("applyLine", () => {
  it("accumulates tokens and tool calls, and ignores tool results", () => {
    const lines: ChatLine[] = [
      { type: "tool", name: "read_note", status: "call" },
      { type: "tool", name: "read_note", status: "result" },
      { type: "token", text: "First part" },
      { type: "token", text: "Second part" },
    ];
    const live = lines.reduce(applyLine, emptyLive());
    expect(live.tools).toEqual(["read_note"]);
    expect(live.text).toBe("First part\n\nSecond part");
    expect(live.done).toBe(false);
  });
  it("marks approval, error and done", () => {
    expect(applyLine(emptyLive(), { type: "approval", approvalId: "a" }).waitingForApproval).toBe(true);
    expect(applyLine(emptyLive(), { type: "error", message: "boom" }).error).toBe("boom");
    expect(applyLine(emptyLive(), { type: "done", run: {} as never }).done).toBe(true);
  });
});

describe("helpers", () => {
  const msg = (role: ChatMessage["role"]): ChatMessage => ({ seq: 1, role, content: "x", runId: null, createdAt: "t" });
  it("names speakers", () => {
    expect(speakerOf("user", "helper")).toBe("You");
    expect(speakerOf("assistant", "helper")).toBe("helper");
    expect(speakerOf("error", "helper")).toBe("Error");
  });
  it("sees a thread whose last message is the user's", () => {
    expect(lastIsUser([msg("user")])).toBe(true);
    expect(lastIsUser([msg("user"), msg("assistant")])).toBe(false);
    expect(lastIsUser([])).toBe(false);
  });
});
