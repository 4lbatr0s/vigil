/**
 * Todo item 44: the synthetic tool answers (`repairDangling`, `notRun`, `RESTART_ANSWER`) against a fake Chat Completions
 * endpoint that is strict the way OpenAI and DeepSeek are. It refuses with HTTP 400 when:
 * - an assistant message with `tool_calls` is not followed, before any other message, by one tool answer per call id;
 * - a tool message answers no call of the assistant message before it;
 * - an assistant tool call that came with `reasoning_content` (DeepSeek's thinking mode) is sent back without it.
 * This checks the structure only. Whether the live DeepSeek API accepts the same requests is todo item 26.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { AgentSchema } from "@vigil/shared";
import { runAgent } from "./agent-runtime";
import { closeCheckpoints, getCheckpointer } from "./checkpoints";
import { RESTART_ANSWER, repairDangling } from "./history";
import { closeDb } from "./index-db";
import { modelFactoryFromEnv } from "./llm";
import { withNoteLock } from "./lock";
import { recoverRuns, setRunDeps, waitForRuns } from "./runs";
import { closeState, createRun, getRun, putAgent } from "./state-db";
import { createNote, getNote } from "./vault";

type WireCall = { id: string; function?: { name: string; arguments: string } };
type WireMessage = { role: string; content?: unknown; tool_calls?: WireCall[]; tool_call_id?: string; reasoning_content?: string };

/** Vigil gives each tool call its own id, so a call is known again by its name and arguments. */
const callKey = (c: WireCall): string => `${c.function?.name ?? ""}:${c.function?.arguments ?? ""}`;

/** The first rule a request breaks, or null. `thoughts` maps a tool call (`callKey`) to the reasoning that came with it. */
function orderProblem(messages: WireMessage[], thoughts: ReadonlyMap<string, string>): string | null {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === "tool") return `message ${i}: a tool message that answers no call before it (${m.tool_call_id ?? "no id"})`;
    if (m.role !== "assistant" || !m.tool_calls?.length) continue;
    for (const c of m.tool_calls) {
      const thought = thoughts.get(callKey(c));
      if (thought !== undefined && m.reasoning_content !== thought) return `message ${i}: reasoning_content missing for tool call ${c.id}`;
    }
    const open = new Set(m.tool_calls.map((c) => c.id));
    let j = i + 1;
    for (; j < messages.length && messages[j]!.role === "tool"; j++) {
      const id = messages[j]!.tool_call_id ?? "";
      if (!open.delete(id)) return `message ${j}: a tool message that answers no call before it (${id})`;
    }
    if (open.size > 0) return `message ${i}: tool call ${[...open].join(", ")} has no answer before the next message`;
    i = j - 1;
  }
  return null;
}

type Reply = { content: string; reasoning?: string; call?: { id: string; name: string; args: Record<string, unknown> } };

/** A strict fake endpoint. `next` gives each reply; every request is kept with the problem found in it. */
async function strictEndpoint(next: (messages: WireMessage[]) => Reply | Promise<Reply>): Promise<{ url: string; requests: { messages: WireMessage[]; problem: string | null }[]; close: () => Promise<void> }> {
  const thoughts = new Map<string, string>();
  const requests: { messages: WireMessage[]; problem: string | null }[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      void (async () => {
        const messages = (JSON.parse(raw) as { messages: WireMessage[] }).messages;
        const problem = orderProblem(messages, thoughts);
        requests.push({ messages, problem });
        if (problem) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: problem, type: "invalid_request_error" } }));
          return;
        }
        const r = await next(messages);
        if (r.call && r.reasoning) thoughts.set(callKey({ id: r.call.id, function: { name: r.call.name, arguments: JSON.stringify(r.call.args) } }), r.reasoning);
        const message = { role: "assistant", content: r.content, ...(r.reasoning ? { reasoning_content: r.reasoning } : {}), ...(r.call ? { tool_calls: [{ id: r.call.id, type: "function", function: { name: r.call.name, arguments: JSON.stringify(r.call.args) } }] } : {}) };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "strict", choices: [{ index: 0, finish_reason: r.call ? "tool_calls" : "stop", message }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      })();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  return { url, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}

const modelAt = (url: string) => modelFactoryFromEnv({ VIGIL_LLM_PROVIDER: "openai", VIGIL_LLM_BASE_URL: url, VIGIL_LLM_MODEL: "strict", VIGIL_LLM_API_KEY: "not-a-key" })([], { model: undefined, maxTokens: 100 });

let root = "";
const saved = { ...process.env };
let endpoint: Awaited<ReturnType<typeof strictEndpoint>> | null = null;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-order-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
});
afterEach(async () => {
  await waitForRuns();
  await endpoint?.close();
  endpoint = null;
  closeDb();
  closeCheckpoints();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const twoCalls = () => new AIMessage({ content: "", tool_calls: [{ id: "a", name: "read_note", args: { id: "x" }, type: "tool_call" }, { id: "b", name: "append_note", args: { title: "x", text: "y" }, type: "tool_call" }] });

describe("the strict rules", () => {
  const call = { id: "x", function: { name: "append_note", arguments: "{}" } };
  it("refuse a tool message with no call, an answer after another message, and a call sent back without its reasoning", () => {
    expect(orderProblem([{ role: "user" }, { role: "tool", tool_call_id: "x" }], new Map())).toMatch(/answers no call/);
    expect(orderProblem([{ role: "assistant", tool_calls: [call] }, { role: "user" }, { role: "tool", tool_call_id: "x" }], new Map())).toMatch(/has no answer/);
    expect(orderProblem([{ role: "assistant", tool_calls: [call] }, { role: "tool", tool_call_id: "x" }], new Map([["append_note:{}", "why"]]))).toMatch(/reasoning_content missing/);
    expect(orderProblem([{ role: "assistant", tool_calls: [call], reasoning_content: "why" }, { role: "tool", tool_call_id: "x" }, { role: "user" }], new Map([["append_note:{}", "why"]]))).toBeNull();
  });
});

describe("synthetic tool answers against a strict endpoint", () => {
  it("the fake is strict: a call with no answer is refused with HTTP 400", async () => {
    endpoint = await strictEndpoint(() => ({ content: "ok" }));
    const dangling = [new SystemMessage("s"), new HumanMessage("go"), twoCalls(), new ToolMessage({ content: "read", tool_call_id: "a", name: "read_note" })];
    await expect(modelAt(endpoint.url).invoke(dangling)).rejects.toThrow(/has no answer/);
  });

  it("accepts what repairDangling makes: a stopped turn, and a stopped turn followed by the next user message", async () => {
    endpoint = await strictEndpoint(() => ({ content: "ok" }));
    const model = modelAt(endpoint.url);
    const stopped = [new SystemMessage("s"), new HumanMessage("go"), twoCalls(), new ToolMessage({ content: "read", tool_call_id: "a", name: "read_note" })];
    await model.invoke(repairDangling(stopped));
    await model.invoke(repairDangling([...stopped, new HumanMessage("and now?")]));
    // notRun's shape: every call answered, some with "error: not run, ...".
    await model.invoke([...stopped, new ToolMessage({ content: "error: not run, token budget used up", tool_call_id: "b", name: "append_note" })]);
    expect(endpoint.requests.map((r) => r.problem)).toEqual([null, null, null]);
  });

  it("a run continued after a restart sends the restart answer in an order the endpoint accepts, with the reasoning kept", async () => {
    await createNote({ title: "Log", body: "start" });
    let calls = 0;
    endpoint = await strictEndpoint(() => {
      calls += 1;
      return calls === 1 ? { content: "", reasoning: "I should append.", call: { id: "ap1", name: "append_note", args: { title: "Log", text: "more" } } } : { content: "checked the note" };
    });
    const agent = AgentSchema.parse({ name: "logger", systemPrompt: "x", tools: ["read_notes", "write_notes"], tokenBudget: 1000 });
    const make = modelFactoryFromEnv({ VIGIL_LLM_PROVIDER: "openai", VIGIL_LLM_BASE_URL: endpoint.url, VIGIL_LLM_MODEL: "strict", VIGIL_LLM_API_KEY: "not-a-key" });
    setRunDeps({ makeModel: make });
    putAgent(agent);
    // The note lock is held, so the append blocks inside the tools node: the "crash" happens there.
    let release: () => void = () => undefined;
    const held = withNoteLock(() => new Promise<void>((r) => (release = r)));
    createRun("cut", "logger", 1000);
    const zombie = runAgent({ agent, task: "log it", runId: "cut", makeModel: make, checkpoint: true });
    for (let i = 0; i < 200 && !(await getCheckpointer().getTuple({ configurable: { thread_id: "cut" } })); i++) await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; i < 200 && calls < 1; i++) await new Promise((r) => setTimeout(r, 10));

    expect(await recoverRuns()).toEqual(["cut"]);
    for (let i = 0; i < 200 && getRun("cut")?.status === "running"; i++) await new Promise((r) => setTimeout(r, 10));

    expect(getRun("cut")?.status).toBe("succeeded");
    const last = endpoint.requests.at(-1)!;
    expect(last.problem).toBeNull();
    expect(last.messages.some((m) => m.role === "tool" && String(m.content).startsWith(RESTART_ANSWER.slice(0, 40)))).toBe(true);
    expect(last.messages.find((m) => m.role === "assistant" && m.tool_calls?.length)?.reasoning_content).toBe("I should append.");
    expect((await getNote("log")).body).toBe("start");
    release();
    await held;
    await zombie;
  });
});
