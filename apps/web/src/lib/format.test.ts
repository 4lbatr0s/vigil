import { describe, expect, it } from "vitest";
import { runStatusText } from "./format";

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
