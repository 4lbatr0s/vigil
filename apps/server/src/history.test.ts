import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { repairDangling, trimHistory } from "./history";

const turn = (n: number, pad = 100) => [new HumanMessage(`q${n} ${"x".repeat(pad)}`), new AIMessage(`a${n} ${"y".repeat(pad)}`)];

describe("trimHistory", () => {
  it("returns the same array when everything fits", () => {
    const m = [new SystemMessage("s"), ...turn(1), ...turn(2)];
    expect(trimHistory(m, 10_000)).toBe(m);
  });

  it("keeps the system message and the newest turns, drops the oldest whole turns", () => {
    const m = [new SystemMessage("sys"), ...turn(1), ...turn(2), ...turn(3), ...turn(4)];
    const out = trimHistory(m, 450);
    expect(out[0]).toBe(m[0]);
    const texts = out.slice(1).map((x) => String(x.content).slice(0, 2));
    expect(texts).toEqual(["q3", "a3", "q4", "a4"]);
  });

  it("never starts on an assistant or tool message", () => {
    const call = new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "read_note", args: {} }] });
    const m = [
      new SystemMessage("sys"),
      new HumanMessage("q1"),
      call,
      new ToolMessage({ content: "z".repeat(300), tool_call_id: "c1" }),
      new AIMessage("a1"),
      new HumanMessage("q2"),
      new AIMessage("a2"),
    ];
    const out = trimHistory(m, 200);
    expect(out[1]?._getType()).toBe("human");
    expect(out.some((x) => x._getType() === "tool")).toBe(false);
  });

  it("keeps the current turn even when it alone is over budget", () => {
    const m = [new SystemMessage("sys"), ...turn(1), new HumanMessage("big " + "x".repeat(5000))];
    const out = trimHistory(m, 100);
    expect(out).toHaveLength(2);
    expect(String(out[1]?.content)).toMatch(/^big/);
  });

  it("works without a system message", () => {
    const m = [...turn(1), ...turn(2), ...turn(3)];
    const out = trimHistory(m, 250);
    expect(out[0]?._getType()).toBe("human");
    expect(String(out[0]?.content).slice(0, 2)).toBe("q3");
  });
});

describe("repairDangling", () => {
  const ask = (...ids: string[]) => new AIMessage({ content: "", tool_calls: ids.map((id) => ({ id, name: "list_notes", args: {}, type: "tool_call" as const })) });

  it("returns the same array when every call is answered", () => {
    const m = [new HumanMessage("q"), ask("a"), new ToolMessage({ content: "ok", tool_call_id: "a" }), new AIMessage("done")];
    expect(repairDangling(m)).toBe(m);
  });

  it("answers an unanswered call right after the message that asked, and keeps real answers", () => {
    const m = [new HumanMessage("q"), ask("a", "b"), new ToolMessage({ content: "ok", tool_call_id: "a" }), new HumanMessage("next")];
    const fixed = repairDangling(m);
    expect(fixed.map((x) => x._getType())).toEqual(["human", "ai", "tool", "tool", "human"]);
    expect((fixed[2] as ToolMessage).tool_call_id).toBe("b");
    expect(String(fixed[2]?.content)).toContain("not run");
    expect((fixed[3] as ToolMessage).tool_call_id).toBe("a");
  });
});
