import { describe, expect, it } from "vitest";
import { runStatusText, runTriggerText } from "./format";

describe("runStatusText", () => {
  it("names every run status in plain words", () => {
    expect(runStatusText("succeeded")).toBe("Finished");
    expect(runStatusText("failed")).toBe("Failed");
    expect(runStatusText("running")).toBe("Running");
    expect(runStatusText("waiting-approval")).toBe("Waiting for you");
    expect(runStatusText("budget-exceeded")).toBe("Stopped at its token limit");
    expect(runStatusText("step-limit")).toBe("Stopped at its step limit");
    expect(runStatusText("interrupted")).toBe("Interrupted");
    expect(runStatusText("skipped")).toBe("Skipped");
  });
});

describe("runTriggerText", () => {
  it("says what started a run", () => {
    expect(runTriggerText("manual")).toBe("You started it");
    expect(runTriggerText("cron")).toBe("Its schedule");
    expect(runTriggerText("heartbeat")).toBe("A note changed");
    expect(runTriggerText("chat")).toBe("A chat");
    expect(runTriggerText("call")).toBe("Another helper");
    expect(runTriggerText("mcp")).toBe("An outside tool (MCP)");
  });
});
