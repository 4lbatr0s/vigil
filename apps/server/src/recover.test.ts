import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { emptyCheckpoint } from "@langchain/langgraph";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, type Agent } from "@vigil/shared";
import { RECOVERED_EVENT, runAgent } from "./agent-runtime";
import { closeCheckpoints, getCheckpointer } from "./checkpoints";
import { closeDb } from "./index-db";
import { withNoteLock } from "./lock";
import type { ModelFactory } from "./llm";
import { recoverRuns, resumeRun, setRunDeps, startRun, waitForRuns } from "./runs";
import { addEvent, closeState, createApproval, createRun, decideApproval, getRun, listEvents, markInterruptedRuns, pendingForRun, putAgent } from "./state-db";
import { createNote, getNote } from "./vault";

let root = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-recover-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
});
afterEach(async () => {
  await waitForRuns();
  closeDb();
  closeCheckpoints();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const usage = (total: number) => ({ input_tokens: 1, output_tokens: total - 1, total_tokens: total });
const say = (text: string) => new AIMessage({ content: text, usage_metadata: usage(10) });
const appendCall = () =>
  new AIMessage({ content: "", tool_calls: [{ id: "ap1", name: "append_note", args: { title: "Log", text: "more" }, type: "tool_call" }], usage_metadata: usage(10) });

const logger = (over: Partial<Agent> = {}): Agent => AgentSchema.parse({ name: "logger", systemPrompt: "x", tools: ["read_notes", "write_notes"], tokenBudget: 1000, ...over });

const lastText = (messages: BaseMessage[]): string => {
  const last = messages.at(-1);
  return ToolMessage.isInstance(last) ? String(last.content) : "";
};

/** First call appends; after a tool answer it finishes and says what it saw. */
function model(): { make: ModelFactory; inputs: BaseMessage[][] } {
  const inputs: BaseMessage[][] = [];
  const make: ModelFactory = () => ({
    invoke: async (messages) => {
      inputs.push([...messages]);
      const tool = lastText(messages);
      return tool === "" ? appendCall() : say(`saw: ${tool}`);
    },
  });
  return { make, inputs };
}

const hasCheckpoint = async (id: string) => (await getCheckpointer().getTuple({ configurable: { thread_id: id } })) !== undefined;

async function until(check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timed out");
}

/** A checkpoint row for a run, so the eligibility rules can be tested one at a time. */
async function fakeCheckpoint(id: string): Promise<void> {
  await getCheckpointer().put({ configurable: { thread_id: id, checkpoint_ns: "" } }, emptyCheckpoint(), { source: "input", step: -1, parents: {} });
}

describe("continuing a run after a restart (ADR-0034)", () => {
  it("never runs a cut-off write again: the agent is told it may have happened, the run succeeds, the checkpoint goes", async () => {
    await createNote({ title: "Log", body: "start" });
    putAgent(logger());
    const m = model();
    setRunDeps({ makeModel: m.make });
    // The note lock is held, so the append blocks inside the tools node: the "crash" happens there.
    let release: () => void = () => undefined;
    const held = withNoteLock(() => new Promise<void>((r) => (release = r)));
    createRun("cut", "logger", 1000);
    const zombie = runAgent({ agent: logger(), task: "log it", runId: "cut", makeModel: m.make, checkpoint: true });
    await until(() => hasCheckpoint("cut"));
    await until(async () => m.inputs.length === 1);

    // The restart: the run row still says running.
    expect(await recoverRuns()).toEqual(["cut"]);
    expect(markInterruptedRuns(["cut"])).toBe(0);
    await until(async () => getRun("cut")?.status !== "running");

    const run = getRun("cut")!;
    expect(run.status).toBe("succeeded");
    expect(run.tokensUsed).toBeGreaterThan(10); // continued from the stored count
    expect(m.inputs.at(-1)?.map((x) => String(x.content)).join("\n")).toContain("the server restarted while this call was running");
    expect((await getNote("log")).body).toBe("start"); // the cut-off append did not run again
    expect(listEvents("cut").some((e) => e.text.startsWith(RECOVERED_EVENT))).toBe(true);
    expect(await hasCheckpoint("cut")).toBe(false);

    release();
    await held;
    await zombie;
  });

  it("continues a run only once", async () => {
    putAgent(logger());
    createRun("again", "logger", 1000);
    await fakeCheckpoint("again");
    addEvent("again", "stop", RECOVERED_EVENT);
    expect(await recoverRuns()).toEqual([]);
    expect(markInterruptedRuns()).toBe(1);
    expect(getRun("again")?.status).toBe("interrupted");
  });

  it("leaves child, chat and MCP runs, runs with approvals, switched-off agents and runs with no checkpoint to be marked interrupted", async () => {
    putAgent(logger());
    putAgent(logger({ name: "off", enabled: false }));
    createRun("parent", "logger", 1000);
    createRun("child", "logger", 1000, "call", "parent");
    createRun("chat", "logger", 1000, "chat");
    createRun("mcp", "logger", 1000, "mcp");
    createRun("approval", "logger", 1000);
    createApproval({ id: "a1", runId: "approval", toolCallId: "t1", tool: "write_note", args: {}, baseUpdatedAt: null });
    createRun("disabled", "off", 1000);
    createRun("bare", "logger", 1000);
    for (const id of ["child", "chat", "mcp", "approval", "disabled"]) await fakeCheckpoint(id);
    // "parent" has a checkpoint too, so exactly one run continues.
    await fakeCheckpoint("parent");
    putAgent(logger());
    setRunDeps({ makeModel: model().make });
    expect(await recoverRuns()).toEqual(["parent"]);
    expect(markInterruptedRuns(["parent"])).toBe(6);
    for (const id of ["child", "chat", "mcp", "approval", "disabled", "bare"]) expect(getRun(id)?.status).toBe("interrupted");
  });

  it("deletes the checkpoint of a finished strict run", async () => {
    putAgent(logger({ strict: true }));
    const write = new AIMessage({ content: "", tool_calls: [{ id: "w1", name: "write_note", args: { title: "S", body: "s" }, type: "tool_call" }], usage_metadata: usage(10) });
    let i = 0;
    setRunDeps({ makeModel: () => ({ invoke: async () => (i++ === 0 ? write : say("done")) }) });
    const run = startRun("logger");
    await waitForRuns();
    expect(await hasCheckpoint(run.id)).toBe(true); // waiting for approval keeps it
    decideApproval(pendingForRun(run.id)[0]!.id, "approve");
    resumeRun(run.id);
    await waitForRuns();
    expect(getRun(run.id)?.status).toBe("succeeded");
    expect(await hasCheckpoint(run.id)).toBe(false);
  });
});
