import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addEvent, closeState, createRun, finishRun } from "./state-db";
import { runTrace } from "./trace";

let root = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-trace-"));
  process.env.STATE_DB_PATH = path.join(root, "state.db");
});

afterEach(async () => {
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const lines = (text: string) => text.trimEnd().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);

describe("runTrace", () => {
  it("gives one JSON line for the run, then one per event, then the child runs and their events", () => {
    createRun("p", "parent", 1000);
    addEvent("p", "prompt", "system prompt", { config: "abcd1234" });
    createRun("c", "child", 500, "call", "p");
    addEvent("c", "model", "child answer", {});
    finishRun("c", "succeeded", 40, null);
    addEvent("p", "tool-result", "child said ok", { tool: "call_agent" });
    finishRun("p", "succeeded", 90, null);

    const out = lines(runTrace("p")!);
    expect(out[0]).toMatchObject({ type: "run", runId: "p", agent: "parent", status: "succeeded", tokensUsed: 90, config: "abcd1234" });
    expect(out.slice(1, 3).map((l) => [l["type"], l["runId"], l["kind"]])).toEqual([
      ["event", "p", "prompt"],
      ["event", "p", "tool-result"],
    ]);
    expect(out[3]).toMatchObject({ type: "run", runId: "c", parentRunId: "p", agent: "child" });
    expect(out[4]).toMatchObject({ type: "event", runId: "c", kind: "model", text: "child answer" });
  });

  it("returns null for a run that does not exist", () => {
    expect(runTrace("nope")).toBeNull();
  });

  it("redacts a key that reached an event", () => {
    createRun("k", "a", 1000);
    addEvent("k", "model", "oops sk-abcdefghijklmnop1234", {});
    expect(runTrace("k")).not.toContain("abcdefghijklmnop");
  });
});
