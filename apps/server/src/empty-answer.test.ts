import { describe, expect, it } from "vitest";
import { noEmptyAnswer } from "./runs";
describe("noEmptyAnswer", () => {
  const base = { tokensUsed: 5, error: null } as const;
  const agent = (tools: string[]) => ({ tools }) as never;
  it("fails an empty reply from an agent with no tools", () => {
    expect(noEmptyAnswer(agent([]), { ...base, status: "succeeded", finalText: "  " })).toMatchObject({ status: "failed", error: expect.stringContaining("empty reply") });
    expect(noEmptyAnswer(agent([]), { ...base, status: "succeeded" }).status).toBe("failed");
  });
  it("leaves real answers, tool agents and other outcomes alone", () => {
    expect(noEmptyAnswer(agent([]), { ...base, status: "succeeded", finalText: "ok" }).status).toBe("succeeded");
    expect(noEmptyAnswer(agent(["read_notes"]), { ...base, status: "succeeded", finalText: "" }).status).toBe("succeeded");
    expect(noEmptyAnswer(agent([]), { ...base, status: "failed", error: "x" }).status).toBe("failed");
  });
});
