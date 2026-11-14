import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { createServer } from "node:http";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, type Agent } from "@vigil/shared";
import { runAgent } from "./agent-runtime";
import { truncate, MAX_TOOL_OUTPUT } from "./agent-tools";
import { closeDb, getNote as indexGet, reindexNote } from "./index-db";
import { modelFactoryFromEnv, redact, type ModelFactory } from "./llm";
import { setRunDeps, startRun, undoRun, waitForRuns } from "./runs";
import { closeState, createRun, getRun, listEvents, listSnapshots, putAgent } from "./state-db";
import { createNote, getNote, updateNote } from "./vault";

let root = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-agents-"));
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

const usage = (total: number) => ({ input_tokens: Math.floor(total / 2), output_tokens: total - Math.floor(total / 2), total_tokens: total });

function call(name: string, args: Record<string, unknown>, total = 20, id = `c-${name}`): AIMessage {
  return new AIMessage({ content: "", tool_calls: [{ id, name, args, type: "tool_call" }], usage_metadata: usage(total) });
}
function say(text: string, total = 20): AIMessage {
  return new AIMessage({ content: text, usage_metadata: usage(total) });
}

type Seen = { messages: BaseMessage[]; maxTokens: number; toolNames: string[] };

/** A model that plays a fixed script. A function entry decides from the messages it is shown. */
function scripted(script: (AIMessage | ((m: BaseMessage[]) => AIMessage))[]): { make: ModelFactory; seen: Seen[] } {
  const seen: Seen[] = [];
  let i = 0;
  const make: ModelFactory = (tools, options) => ({
    invoke: async (messages) => {
      seen.push({ messages: [...messages], maxTokens: options.maxTokens, toolNames: tools.map((t) => t.name) });
      const step = script[Math.min(i++, script.length - 1)];
      if (!step) throw new Error("empty script");
      return typeof step === "function" ? step(messages) : step;
    },
  });
  return { make, seen };
}

function agent(over: Partial<Agent> = {}): Agent {
  return AgentSchema.parse({
    name: "morning-digest",
    systemPrompt: "Write a digest of yesterday's notes.",
    tools: ["read_notes", "write_notes"],
    tokenBudget: 1000,
    ...over,
  });
}

async function seedNote(title: string, body: string): Promise<void> {
  reindexNote(await createNote({ title, body }));
}

async function run(a: Agent, make: ModelFactory, task?: string) {
  putAgent(a);
  setRunDeps({ makeModel: make });
  const started = startRun(a.name, task);
  await waitForRuns();
  return getRun(started.id)!;
}

describe("agent runtime", () => {
  it("runs the digest flow: read, write, snapshot, run log, author agent", async () => {
    await seedNote("Monday", "Shipped the vault.");
    const { make } = scripted([
      call("list_notes", {}),
      call("read_note", { id: "monday" }),
      call("write_note", { title: "Digest", body: "# Digest\n\nShipped the vault." }),
      say("Done."),
    ]);
    const finished = await run(agent(), make);
    expect(finished).toMatchObject({ status: "succeeded", tokensUsed: 80, touched: ["digest"], error: null });
    const note = await getNote("digest");
    expect(note).toMatchObject({ author: "agent", body: "# Digest\n\nShipped the vault." });
    expect(indexGet("digest")?.author).toBe("agent");
    const kinds = listEvents(finished.id).map((e) => e.kind);
    expect(kinds).toEqual(["prompt", "model", "tool-call", "tool-result", "model", "tool-call", "tool-result", "model", "tool-call", "note", "tool-result", "model", "stop"]);
    expect(listSnapshots(finished.id)).toMatchObject([{ noteId: "digest", existed: false }]);
  });

  it("answers a denied tool with a tool message instead of failing the run", async () => {
    const { make, seen } = scripted([call("write_note", { title: "X", body: "y" }, 20, "call-9"), say("ok")]);
    const finished = await run(agent({ tools: ["read_notes"] }), make);
    expect(finished.status).toBe("succeeded");
    expect(listEvents(finished.id).some((e) => e.kind === "tool-denied")).toBe(true);
    const reply = seen[1]?.messages.find((m): m is ToolMessage => ToolMessage.isInstance(m));
    expect(reply?.tool_call_id).toBe("call-9");
    await expect(getNote("x")).rejects.toMatchObject({ code: "note-not-found" });
    expect(seen[0]?.toolNames).toEqual(["list_notes", "read_note", "search_notes"]);
  });

  it("stops before running tools once the budget is used up", async () => {
    const { make, seen } = scripted([call("write_note", { title: "Late", body: "x" }, 150)]);
    const finished = await run(agent({ tokenBudget: 100 }), make);
    expect(finished).toMatchObject({ status: "budget-exceeded", tokensUsed: 150 });
    await expect(getNote("late")).rejects.toMatchObject({ code: "note-not-found" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.maxTokens).toBe(100);
  });

  it("passes only the remaining budget to each model call", async () => {
    const { make, seen } = scripted([call("list_notes", {}, 30), say("done", 10)]);
    await run(agent({ tokenBudget: 100 }), make);
    expect(seen.map((s) => s.maxTokens)).toEqual([100, 70]);
  });

  it("estimates usage when the provider reports none", async () => {
    const { make } = scripted([new AIMessage({ content: "a".repeat(400) })]);
    const finished = await run(agent(), make);
    expect(finished.tokensUsed).toBeGreaterThan(100);
  });

  it("stops a loop at the step limit", async () => {
    const { make } = scripted([() => call("list_notes", {}, 1)]);
    const finished = await run(agent({ tokenBudget: 100_000 }), make);
    expect(finished.status).toBe("step-limit");
  });

  it("records a failing model as a failed run with the key redacted", async () => {
    process.env.VIGIL_LLM_API_KEY = "sk-secretsecretsecret1234";
    const make: ModelFactory = () => ({
      invoke: async () => {
        throw new Error("401 bad key sk-secretsecretsecret1234");
      },
    });
    const finished = await run(agent(), make);
    expect(finished.status).toBe("failed");
    expect(finished.error).not.toContain("secretsecret");
    expect(JSON.stringify(listEvents(finished.id))).not.toContain("secretsecret");
  });

  it("allows one run per agent at a time", async () => {
    putAgent(agent());
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    setRunDeps({ makeModel: () => ({ invoke: async () => (await gate, say("ok")) }) });
    startRun("morning-digest");
    expect(() => startRun("morning-digest")).toThrowError(/already has a run/);
    release();
    await waitForRuns();
    expect(startRun("morning-digest").status).toBe("running");
  });

  it("caps long tool output", async () => {
    expect(truncate("x".repeat(MAX_TOOL_OUTPUT + 50))).toContain("[truncated: 50 more characters]");
    expect(redact("key sk-abcdefabcdefabcdef and Bearer abcdefghijkl")).toBe("key [redacted] and Bearer [redacted]");
  });
});

describe("undo", () => {
  async function writeAs(runId: string, title: string, body: string): Promise<void> {
    const { make } = scripted([call("write_note", { title, body }), say("ok")]);
    putAgent(agent({ name: runId }));
    setRunDeps({ makeModel: make });
    startRun(runId);
    await waitForRuns();
  }

  it("removes a note the run created", async () => {
    await writeAs("a1", "Fresh", "new");
    const r = (await import("./state-db")).listRuns("a1")[0]!;
    const undone = await undoRun(r.id);
    expect(undone.undone).toBe(true);
    await expect(getNote("fresh")).rejects.toMatchObject({ code: "note-not-found" });
    expect(indexGet("fresh")).toBeNull();
    await expect(undoRun(r.id)).rejects.toMatchObject({ code: "already-undone" });
  });

  it("restores the earlier text of a note the run changed", async () => {
    await seedNote("Plan", "original");
    await writeAs("a2", "Plan", "rewritten by agent");
    expect((await getNote("plan")).body).toBe("rewritten by agent");
    await undoRun((await import("./state-db")).listRuns("a2")[0]!.id);
    expect(await getNote("plan")).toMatchObject({ body: "original", author: "human" });
    expect(indexGet("plan")?.body).toBe("original");
  });

  it("refuses, changing nothing, when a human edited the note afterwards", async () => {
    await seedNote("Plan", "original");
    await writeAs("a3", "Plan", "by agent");
    await updateNote("plan", { body: "human edit" });
    const later = new Date(Date.now() + 5000);
    await utimes(path.join(process.env.VAULT_DIR!, "plan.md"), later, later);
    await expect(undoRun((await import("./state-db")).listRuns("a3")[0]!.id)).rejects.toMatchObject({ code: "undo-conflict", status: 409 });
    expect((await getNote("plan")).body).toBe("human edit");
  });

  it("refuses to undo a run that is still going", async () => {
    putAgent(agent());
    createRun("live", "morning-digest", 100);
    await expect(undoRun("live")).rejects.toMatchObject({ code: "run-active" });
  });
});

describe("provider adapter", () => {
  it("talks chat completions to an OpenAI-compatible base URL and reads tool calls and usage", async () => {
    const requests: { url: string; auth: string | undefined; body: { model: string; max_tokens?: number; tools?: unknown[] } }[] = [];
    let n = 0;
    const server = createServer((req, res) => {
      let text = "";
      req.on("data", (c: Buffer) => (text += c.toString()));
      req.on("end", () => {
        requests.push({ url: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(text) as never });
        const message =
          n++ === 0
            ? { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "list_notes", arguments: "{}" } }] }
            : { role: "assistant", content: "All quiet." };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 1, model: "stub", choices: [{ index: 0, message, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const env = { ...process.env, VIGIL_LLM_PROVIDER: "openai", VIGIL_LLM_BASE_URL: `http://127.0.0.1:${port}/v1`, VIGIL_LLM_API_KEY: "test-key-123456", VIGIL_LLM_MODEL: "stub-model" };
      putAgent(agent());
      const created = createRun("real-1", "morning-digest", 1000);
      const outcome = await runAgent({ agent: agent(), task: "go", runId: created.id, makeModel: modelFactoryFromEnv(env) });
      expect(outcome).toMatchObject({ status: "succeeded", tokensUsed: 84 });
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ url: "/v1/chat/completions", auth: "Bearer test-key-123456" });
      expect(requests[0]?.body.model).toBe("stub-model");
      expect(requests[0]?.body.tools?.length).toBe(4);
      expect(JSON.stringify(listEvents(created.id))).not.toContain("test-key-123456");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("refuses to build a model without a model name", () => {
    expect(() => modelFactoryFromEnv({ VIGIL_LLM_PROVIDER: "openai" } as NodeJS.ProcessEnv)([], { model: undefined, maxTokens: 10 })).toThrow(/No model configured/);
  });
});

