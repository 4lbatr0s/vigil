import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, type Agent } from "@vigil/shared";
import { closeDb, getNote as indexGet, reindexNote } from "./index-db";
import type { ModelFactory } from "./llm";
import { setRunDeps, startRun, undoRun, waitForRuns } from "./runs";
import { closeState, createRun, finishRun, getRun, listEvents, listRuns, putAgent } from "./state-db";
import { createNote, getNote, readNoteFile, updateNote } from "./vault";

let root = "";
const saved = { ...process.env };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-call-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
});
afterEach(async () => {
  await waitForRuns();
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const usage = (total: number) => ({ input_tokens: 1, output_tokens: total - 1, total_tokens: total });
const call = (name: string, args: Record<string, unknown>, total = 10, id = `c-${name}`) =>
  new AIMessage({ content: "", tool_calls: [{ id, name, args, type: "tool_call" }], usage_metadata: usage(total) });
const say = (text: string, total = 10) => new AIMessage({ content: text, usage_metadata: usage(total) });

type Seen = { agent: string; toolNames: string[]; maxTokens: number };

/** One model for every agent: each agent plays its own script, found by the `AGENT:<name>` marker in its system prompt. */
function byAgent(scripts: Record<string, AIMessage[]>): { make: ModelFactory; seen: Seen[] } {
  const seen: Seen[] = [];
  const index: Record<string, number> = {};
  const make: ModelFactory = (tools, options) => ({
    invoke: async (messages: BaseMessage[]) => {
      const system = String(messages[0]?.content ?? "");
      const name = Object.keys(scripts).find((n) => system.includes(`AGENT:${n}`)) ?? "";
      seen.push({ agent: name, toolNames: tools.map((t) => t.name), maxTokens: options.maxTokens });
      const script = scripts[name] ?? [];
      const i = index[name] ?? 0;
      index[name] = i + 1;
      const step = script[Math.min(i, script.length - 1)];
      if (!step) throw new Error(`no script for ${name}`);
      return step;
    },
  });
  return { make, seen };
}

const agent = (name: string, over: Partial<Agent> = {}): Agent =>
  AgentSchema.parse({ name, systemPrompt: `AGENT:${name}`, tools: ["read_notes"], tokenBudget: 1000, ...over });

async function go(parent: string, make: ModelFactory) {
  setRunDeps({ makeModel: make });
  const started = startRun(parent);
  await waitForRuns();
  return getRun(started.id)!;
}

const writeCall = (title: string, body: string) => call("write_note", { title, body }, 10, "w1");

describe("call_agent", () => {
  it("runs a callable child: its own run row (trigger call, parent set), its note written, its answer returned", async () => {
    putAgent(agent("parent", { tools: ["call_agents"], callable: ["writer"] }));
    putAgent(agent("writer", { tools: ["write_notes"] }));
    const { make } = byAgent({
      parent: [call("call_agent", { name: "writer", message: "write it" }), say("all done")],
      writer: [writeCall("Child note", "from child"), say("wrote the note")],
    });
    const run = await go("parent", make);
    expect(run.status).toBe("succeeded");
    const children = listRuns("writer");
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ trigger: "call", parentRunId: run.id, status: "succeeded", touched: ["child-note"] });
    expect((await getNote("child-note")).body).toBe("from child");
    expect(run.touched).toContain("child-note"); // the parent shows its children's notes
    const result = listEvents(run.id).find((e) => e.kind === "tool-result" && e.data["tool"] === "call_agent");
    expect(result?.text).toContain("wrote the note");
    expect(result?.data["childRunId"]).toBe(children[0]?.id);
  });

  it("refuses a name that is not callable, without making a child run", async () => {
    putAgent(agent("parent", { tools: ["call_agents"], callable: ["writer"] }));
    putAgent(agent("other"));
    const { make } = byAgent({ parent: [call("call_agent", { name: "other", message: "hi" }), say("ok")] });
    const run = await go("parent", make);
    expect(listEvents(run.id).find((e) => e.kind === "tool-result")?.text).toContain("not in your callable list");
    expect(listRuns("other")).toHaveLength(0);
  });

  it("an agent cannot call itself, and an empty callable list means none", async () => {
    putAgent(agent("parent", { tools: ["call_agents"], callable: ["parent"] }));
    const { make } = byAgent({ parent: [call("call_agent", { name: "parent", message: "me" }), say("ok")] });
    const run = await go("parent", make);
    expect(listEvents(run.id).find((e) => e.kind === "tool-result")?.text).toContain("cannot call itself");
    expect(listRuns("parent")).toHaveLength(1);

    putAgent(agent("lonely", { tools: ["call_agents"], callable: [] }));
    const two = byAgent({ lonely: [call("call_agent", { name: "parent", message: "x" }), say("ok")] });
    const run2 = await go("lonely", two.make);
    expect(listEvents(run2.id).find((e) => e.kind === "tool-result")?.text).toContain("not in your callable list");
  });

  it("the child never gets call_agent, even with the grant; a script that tries is denied in the child's log", async () => {
    putAgent(agent("parent", { tools: ["call_agents"], callable: ["child"] }));
    putAgent(agent("child", { tools: ["read_notes", "call_agents"], callable: ["parent"] }));
    const { make, seen } = byAgent({
      parent: [call("call_agent", { name: "child", message: "go" }), say("done")],
      child: [call("call_agent", { name: "parent", message: "loop" }, 10, "loop"), say("could not")],
    });
    const run = await go("parent", make);
    expect(run.status).toBe("succeeded");
    expect(seen.filter((s) => s.agent === "child").every((s) => !s.toolNames.includes("call_agent"))).toBe(true);
    expect(seen.find((s) => s.agent === "parent")?.toolNames).toContain("call_agent");
    const child = listRuns("child")[0]!;
    expect(listEvents(child.id).some((e) => e.kind === "tool-denied")).toBe(true);
    expect(listRuns("parent")).toHaveLength(1); // no second parent run
  });

  it("the child's budget is inside the parent's, and its tokens count against the parent", async () => {
    putAgent(agent("parent", { tools: ["call_agents"], callable: ["child"], tokenBudget: 100 }));
    putAgent(agent("child", { tokenBudget: 1000 }));
    const { make, seen } = byAgent({
      parent: [call("call_agent", { name: "child", message: "go" }, 10), say("done", 5)],
      child: [say("child answer", 30)],
    });
    const run = await go("parent", make);
    const childSeen = seen.find((s) => s.agent === "child")!;
    expect(childSeen.maxTokens).toBeLessThanOrEqual(90); // parent budget 100 minus the 10 already used
    const child = listRuns("child")[0]!;
    expect(child.tokenBudget).toBe(90);
    expect(run.tokensUsed).toBe(10 + 30 + 5);
  });

  it("with no budget left the call returns an error and makes no child run", async () => {
    putAgent(agent("parent", { tools: ["call_agents"], callable: ["child"], tokenBudget: 100 }));
    putAgent(agent("child"));
    const { make } = byAgent({ parent: [call("call_agent", { name: "child", message: "go" }, 100), say("x", 0)] });
    const run = await go("parent", make);
    // The parent used its whole budget on the call itself, so the run stops before any tool runs.
    expect(run.status).toBe("budget-exceeded");
    expect(listRuns("child")).toHaveLength(0);
  });

  it("a child that used up the remaining budget leaves the parent none for another call", async () => {
    putAgent(agent("parent", { tools: ["call_agents"], callable: ["child"], tokenBudget: 60 }));
    putAgent(agent("child", { tokenBudget: 1000 }));
    const { make } = byAgent({
      parent: [call("call_agent", { name: "child", message: "one" }, 10, "a"), call("call_agent", { name: "child", message: "two" }, 1, "b"), say("end", 1)],
      child: [say("big answer", 49)],
    });
    const run = await go("parent", make);
    expect(listRuns("child")).toHaveLength(1);
    expect(run.tokensUsed).toBeGreaterThanOrEqual(59);
    expect(["succeeded", "budget-exceeded"]).toContain(run.status);
  });

  it("a child of a scoped parent writes only inside the parent's scope", async () => {
    putAgent(agent("parent", { tools: ["call_agents"], callable: ["writer"], writeTags: ["journal"] }));
    putAgent(agent("writer", { tools: ["write_notes"] }));
    const { make } = byAgent({
      parent: [call("call_agent", { name: "writer", message: "w" }), say("ok")],
      writer: [writeCall("Loose", "no tag here"), say("done")],
    });
    await go("parent", make);
    const child = listRuns("writer")[0]!;
    expect(listEvents(child.id).find((e) => e.kind === "tool-result")?.text).toMatch(/^error: .*journal/);
    expect(await readNoteFile("loose")).toBeNull();
  });

  it("a scoped parent cannot call a writing child that may pause for approval, because a paused child would resume without the scope", async () => {
    putAgent(agent("parent", { tools: ["call_agents"], callable: ["pauser"], writeTags: ["journal"] }));
    putAgent(agent("pauser", { tools: ["write_notes", "web_fetch"], approveTools: ["fetch_url"] }));
    const { make } = byAgent({ parent: [call("call_agent", { name: "pauser", message: "w" }), say("ok")] });
    const run = await go("parent", make);
    expect(listEvents(run.id).find((e) => e.kind === "tool-result")?.text).toContain("may pause for approval");
    expect(listRuns("pauser")).toHaveLength(0);
  });

  it("a strict parent or strict child that writes cannot delegate", async () => {
    putAgent(agent("parent", { tools: ["call_agents"], callable: ["writer"], strict: true }));
    putAgent(agent("writer", { tools: ["write_notes"] }));
    const a = byAgent({ parent: [call("call_agent", { name: "writer", message: "w" }), say("ok")] });
    const run = await go("parent", a.make);
    expect(listEvents(run.id).find((e) => e.kind === "tool-result")?.text).toContain("strict agents cannot delegate writes");
    expect(listRuns("writer")).toHaveLength(0);

    putAgent(agent("parent2", { tools: ["call_agents"], callable: ["strict-writer"] }));
    putAgent(agent("strict-writer", { tools: ["write_notes"], strict: true }));
    const b = byAgent({ parent2: [call("call_agent", { name: "strict-writer", message: "w" }), say("ok")] });
    const run2 = await go("parent2", b.make);
    expect(listEvents(run2.id).find((e) => e.kind === "tool-result")?.text).toContain("strict agents cannot delegate writes");

    // A read-only child of a strict parent is fine.
    putAgent(agent("reader", { tools: ["read_notes"] }));
    putAgent(agent("parent3", { tools: ["call_agents"], callable: ["reader"], strict: true }));
    const c = byAgent({ parent3: [call("call_agent", { name: "reader", message: "r" }), say("ok")], reader: [say("read it")] });
    await go("parent3", c.make);
    expect(listRuns("reader")).toHaveLength(1);
  });

  it("a child that already has a run in progress is refused with 'already has a run'", async () => {
    putAgent(agent("parent", { tools: ["call_agents"], callable: ["busy"] }));
    putAgent(agent("busy"));
    createRun("stuck", "busy", 100); // still running
    const { make } = byAgent({ parent: [call("call_agent", { name: "busy", message: "go" }), say("ok")] });
    const run = await go("parent", make);
    expect(listEvents(run.id).find((e) => e.kind === "tool-result")?.text).toContain("already has a run");
    finishRun("stuck", "succeeded", 0, null);
  });

  it("an unknown callable agent name comes back as tool error text", async () => {
    putAgent(agent("parent", { tools: ["call_agents"], callable: ["ghost"] }));
    const { make } = byAgent({ parent: [call("call_agent", { name: "ghost", message: "go" }), say("ok")] });
    const run = await go("parent", make);
    expect(listEvents(run.id).find((e) => e.kind === "tool-result")?.text).toContain("no agent called ghost");
  });
});

describe("undo across a family", () => {
  async function family() {
    putAgent(agent("parent", { tools: ["call_agents", "write_notes"], callable: ["writer"] }));
    putAgent(agent("writer", { tools: ["write_notes"] }));
    const { make } = byAgent({
      parent: [writeCall("Parent note", "p"), call("call_agent", { name: "writer", message: "w" }, 10, "cc"), say("done")],
      writer: [writeCall("Child note", "c"), say("ok")],
    });
    return go("parent", make);
  }

  it("undoing the parent removes the child's note too, and marks every run undone", async () => {
    const run = await family();
    expect(run.touched.sort()).toEqual(["child-note", "parent-note"]);
    const done = await undoRun(run.id);
    expect(done.undone).toBe(true);
    await expect(getNote("child-note")).rejects.toMatchObject({ code: "note-not-found" });
    await expect(getNote("parent-note")).rejects.toMatchObject({ code: "note-not-found" });
    expect(listRuns("writer")[0]?.undone).toBe(true);
    expect(indexGet("child-note")).toBeNull();
  });

  it("a human edit after the child's write blocks the whole undo and changes nothing", async () => {
    const run = await family();
    const edited = await updateNote("child-note", { body: "human edit" });
    reindexNote(edited);
    await expect(undoRun(run.id)).rejects.toMatchObject({ code: "undo-conflict", status: 409 });
    expect((await getNote("parent-note")).body).toBe("p"); // nothing was undone
    expect(getRun(run.id)?.undone).toBe(false);
    expect(listRuns("writer")[0]?.undone).toBe(false);
  });

  it("a child can be undone alone, and the parent's undo then handles the rest", async () => {
    const run = await family();
    const child = listRuns("writer")[0]!;
    await undoRun(child.id);
    await expect(getNote("child-note")).rejects.toMatchObject({ code: "note-not-found" });
    expect((await getNote("parent-note")).body).toBe("p");
    await undoRun(run.id);
    await expect(getNote("parent-note")).rejects.toMatchObject({ code: "note-not-found" });
  });

  it("when the child wrote a note first and the parent wrote it after, undo still returns the original", async () => {
    await createNote({ title: "Shared", body: "original" }).then(reindexNote);
    putAgent(agent("parent", { tools: ["call_agents", "write_notes"], callable: ["writer"] }));
    putAgent(agent("writer", { tools: ["write_notes"] }));
    const { make } = byAgent({
      parent: [call("call_agent", { name: "writer", message: "w" }, 10, "cc"), writeCall("Shared", "parent wrote last"), say("done")],
      writer: [writeCall("Shared", "child wrote first"), say("ok")],
    });
    const run = await go("parent", make);
    expect((await getNote("shared")).body).toBe("parent wrote last");
    await undoRun(run.id);
    expect((await getNote("shared")).body).toBe("original");
  });

  it("when parent and child wrote the same note, undo puts back what existed before both", async () => {
    await createNote({ title: "Shared", body: "original" }).then(reindexNote);
    putAgent(agent("parent", { tools: ["call_agents", "write_notes"], callable: ["writer"] }));
    putAgent(agent("writer", { tools: ["write_notes"] }));
    const { make } = byAgent({
      parent: [writeCall("Shared", "parent wrote"), call("call_agent", { name: "writer", message: "w" }, 10, "cc"), say("done")],
      writer: [writeCall("Shared", "child wrote"), say("ok")],
    });
    const run = await go("parent", make);
    expect((await getNote("shared")).body).toBe("child wrote");
    await undoRun(run.id);
    expect((await getNote("shared")).body).toBe("original");
  });
});
