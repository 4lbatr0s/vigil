import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, type Agent } from "@vigil/shared";
import { accessFromEnv } from "./access";
import { closeCheckpoints } from "./checkpoints";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import type { ModelFactory } from "./llm";
import { setRunDeps, waitForRuns } from "./runs";
import { closeState, getRun, listChatMessages, listRuns, pendingForRun, putAgent } from "./state-db";
import { getNote } from "./vault";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-chat-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  server = createServer(createHandler(accessFromEnv()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  putAgent(chatAgent());
});
afterEach(async () => {
  await waitForRuns();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  closeDb();
  closeCheckpoints();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const chatAgent = (over: Partial<Agent> = {}): Agent => AgentSchema.parse({ name: "helper", systemPrompt: "You help.", tools: ["read_notes"], tokenBudget: 1000, strict: false, ...over });
const usage = (total: number) => ({ input_tokens: 1, output_tokens: total - 1, total_tokens: total });
const say = (text: string) => new AIMessage({ content: text, usage_metadata: usage(10) });

function scripted(script: AIMessage[]): { make: ModelFactory; inputs: BaseMessage[][] } {
  const inputs: BaseMessage[][] = [];
  let i = 0;
  return {
    inputs,
    make: () => ({
      invoke: async (messages) => {
        inputs.push([...messages]);
        return script[Math.min(i++, script.length - 1)] as AIMessage;
      },
    }),
  };
}

type Line = { type: string; [k: string]: unknown };

async function turn(chatId: string, text: string): Promise<{ status: number; lines: Line[]; json?: any }> {
  const res = await fetch(`${base}/api/chats/${chatId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  const body = await res.text();
  if (res.headers.get("content-type")?.includes("ndjson")) {
    return { status: res.status, lines: body.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line) };
  }
  return { status: res.status, lines: [], json: JSON.parse(body) };
}

async function newChat(agent = "helper"): Promise<string> {
  const res = await fetch(`${base}/api/chats`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent }) });
  return ((await res.json()) as { data: { id: string } }).data.id;
}

describe("chat turns", () => {
  it("persists both messages and the stream ends with done", async () => {
    const m = scripted([say("Hello there")]);
    setRunDeps({ makeModel: m.make });
    const id = await newChat();
    const t = await turn(id, "Hi");
    expect(t.status).toBe(200);
    expect(t.lines.map((l) => l.type)).toEqual(["token", "done"]);
    expect(t.lines[0]).toMatchObject({ type: "token", text: "Hello there" });
    const msgs = listChatMessages(id);
    expect(msgs.map((x) => [x.role, x.content])).toEqual([["user", "Hi"], ["assistant", "Hello there"]]);
    const run = (t.lines[1] as unknown as { run: { id: string; trigger: string; status: string } }).run;
    expect(run).toMatchObject({ trigger: "chat", status: "succeeded" });
    expect(getRun(run.id)?.tokensUsed).toBe(10);
    const thread = (await (await fetch(`${base}/api/chats/${id}`)).json()) as { data: { thread: { title: string }; messages: unknown[] } };
    expect(thread.data.thread.title).toBe("Hi");
    expect(thread.data.messages).toHaveLength(2);
  });

  it("the second turn sees the first: the model gets the earlier messages, and the system prompt only once", async () => {
    const m = scripted([say("first answer"), say("second answer")]);
    setRunDeps({ makeModel: m.make });
    const id = await newChat();
    await turn(id, "My name is Ada.");
    await turn(id, "What is my name?");
    const second = m.inputs[1] ?? [];
    const texts = second.map((x) => String(x.content));
    expect(texts).toContain("My name is Ada.");
    expect(texts).toContain("first answer");
    expect(texts.at(-1)).toBe("What is my name?");
    expect(second.filter((x) => SystemMessage.isInstance(x))).toHaveLength(1);
    expect(second.filter((x) => HumanMessage.isInstance(x))).toHaveLength(2);
  });

  it("a model that can stream shows the answer piece by piece, and the stored reply is the whole text", async () => {
    let invoked = 0;
    setRunDeps({
      makeModel: () => ({
        invoke: async () => {
          invoked++;
          return say("unused");
        },
        stream: async () =>
          (async function* () {
            for (const piece of ["Hel", "lo ", "there"]) yield new AIMessageChunk({ content: piece });
            yield new AIMessageChunk({ content: "", usage_metadata: usage(12) });
          })(),
      }),
    });
    const id = await newChat();
    const t = await turn(id, "Hi");
    expect(t.lines.map((l) => l.type)).toEqual(["delta", "delta", "delta", "done"]);
    expect(t.lines.filter((l) => l.type === "delta").map((l) => l.text)).toEqual(["Hel", "lo ", "there"]);
    expect(invoked).toBe(0);
    expect(listChatMessages(id).map((x) => x.content)).toEqual(["Hi", "Hello there"]);
    const run = (t.lines.at(-1) as unknown as { run: { id: string } }).run;
    expect(getRun(run.id)?.tokensUsed).toBe(12);
  });

  it("a long conversation sends only the newest turns to the model, while the stored chat stays whole", async () => {
    const m = scripted([say("one"), say("two"), say("three"), say("four")]);
    setRunDeps({ makeModel: m.make });
    const id = await newChat();
    for (const w of ["first", "second", "third"]) {
      expect((await turn(id, `${w} ${"a".repeat(19_000)}`)).status).toBe(200);
    }
    expect((await turn(id, "fourth, short")).status).toBe(200);
    const sent = (m.inputs[3] ?? []).map((x) => String(x.content));
    expect(sent.some((t) => t.startsWith("first"))).toBe(false);
    expect(sent.some((t) => t.startsWith("third"))).toBe(true);
    expect(sent.at(-1)).toBe("fourth, short");
    expect((m.inputs[3] ?? []).filter((x) => SystemMessage.isInstance(x))).toHaveLength(1);
    expect(listChatMessages(id)).toHaveLength(8);
  });

  it("a server restart between turns keeps the context", async () => {
    const m = scripted([say("noted"), say("you said blue")]);
    setRunDeps({ makeModel: m.make });
    const id = await newChat();
    await turn(id, "My favourite colour is blue.");
    closeCheckpoints();
    closeState(); // restart: every handle closed and reopened from disk
    await turn(id, "What is it?");
    const texts = (m.inputs[1] ?? []).map((x) => String(x.content));
    expect(texts).toContain("My favourite colour is blue.");
    expect(listChatMessages(id)).toHaveLength(4);
  });

  it("closing the connection cancels the turn: run failed with error cancelled, an error message stored", async () => {
    let release!: () => void;
    const hang = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const modelCalled = new Promise<void>((r) => (started = r));
    setRunDeps({
      makeModel: () => ({
        invoke: async () => {
          started();
          await hang;
          return say("too late");
        },
      }),
    });
    const id = await newChat();
    const ac = new AbortController();
    const pending = fetch(`${base}/api/chats/${id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "slow one" }), signal: ac.signal }).catch(() => null);
    await modelCalled;
    ac.abort();
    await pending;
    for (let i = 0; i < 60 && listRuns("helper")[0]?.status === "running"; i++) await new Promise((r) => setTimeout(r, 50));
    const run = listRuns("helper")[0]!;
    expect(run).toMatchObject({ status: "failed", error: "cancelled", trigger: "chat" });
    expect(listChatMessages(id).map((m) => m.role)).toEqual(["user", "error"]);
    release();
  });

  it("a failing model gives an error line and a stored error message, and never leaks the key", async () => {
    process.env.VIGIL_LLM_API_KEY = "sk-super-secret-key-1234567890";
    setRunDeps({
      makeModel: () => ({
        invoke: async () => {
          throw new Error("401 Unauthorized for key sk-super-secret-key-1234567890");
        },
      }),
    });
    const id = await newChat();
    const t = await turn(id, "hello");
    expect(t.lines.at(-1)?.type).toBe("error");
    const all = JSON.stringify(t.lines) + JSON.stringify(listChatMessages(id));
    expect(all).not.toContain("sk-super-secret-key-1234567890");
    expect(listChatMessages(id).map((m) => m.role)).toEqual(["user", "error"]);
    expect(getRun(listRuns("helper")[0]!.id)?.status).toBe("failed");
  });

  it("a strict chat agent that wants to write ends the stream with an approval line; the reply lands after the decision", async () => {
    putAgent(chatAgent({ tools: ["write_notes"], strict: true }));
    const writeCall = new AIMessage({ content: "", tool_calls: [{ id: "x", name: "write_note", args: { title: "From chat", body: "b" }, type: "tool_call" }], usage_metadata: usage(10) });
    const m = scripted([writeCall, say("Saved it.")]);
    setRunDeps({ makeModel: m.make });
    const id = await newChat();
    const t = await turn(id, "please write a note");
    expect(t.lines.at(-1)?.type).toBe("approval");
    const run = listRuns("helper")[0]!;
    expect(run.status).toBe("waiting-approval");
    const pending = pendingForRun(run.id);
    expect(t.lines.at(-1)).toMatchObject({ approvalId: pending[0]?.id });
    expect(listChatMessages(id).map((x) => x.role)).toEqual(["user"]);
    await fetch(`${base}/api/approvals/${pending[0]!.id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approve" }) });
    await waitForRuns();
    expect((await getNote("from-chat")).body).toBe("b");
    expect(listChatMessages(id).map((x) => [x.role, x.content])).toEqual([["user", "please write a note"], ["assistant", "Saved it."]]);
  });

  it("refuses before streaming: unknown chat, empty text, busy agent", async () => {
    setRunDeps({ makeModel: scripted([say("ok")]).make });
    expect((await turn("missing", "hi")).json.error.code).toBe("chat-not-found");
    const id = await newChat();
    expect((await turn(id, "   ")).json.error.code).toBe("invalid-body");
    expect((await turn(id, "x".repeat(20_001))).json.error.code).toBe("invalid-body");
    const { createRun } = await import("./state-db");
    createRun("busy-run", "helper", 100);
    expect((await turn(id, "hi")).json.error.code).toBe("agent-busy");
    expect(listChatMessages(id)).toHaveLength(0); // nothing stored for a refused turn
  });
});

describe("chat management", () => {
  it("lists, deletes (and forgets the conversation), and saves a transcript as a note", async () => {
    setRunDeps({ makeModel: scripted([say("an answer")]).make });
    const id = await newChat();
    await turn(id, "A question");
    const list = (await (await fetch(`${base}/api/chats`)).json()) as { data: Array<{ id: string }> };
    expect(list.data.map((c) => c.id)).toEqual([id]);

    const saved = (await (await fetch(`${base}/api/chats/${id}/save`, { method: "POST" })).json()) as { data: { id: string; title: string } };
    expect(saved.data).toEqual({ id: "chat-a-question", title: "Chat A question" });
    const note = await getNote("chat-a-question");
    expect(note.author).toBe("human");
    expect(note.body).toContain("**You**\n\nA question");
    expect(note.body).toContain("**helper**\n\nan answer");
    const again = (await (await fetch(`${base}/api/chats/${id}/save`, { method: "POST" })).json()) as { data: { id: string } };
    expect(again.data.id).toBe("chat-a-question-2");

    expect((await fetch(`${base}/api/chats/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${base}/api/chats/${id}`)).status).toBe(404);
    expect((await fetch(`${base}/api/chats/${id}`, { method: "DELETE" })).status).toBe(404);
    // A new chat with the same agent starts fresh (the old checkpoint is gone, a system prompt is sent again).
    const m = scripted([say("fresh")]);
    setRunDeps({ makeModel: m.make });
    const id2 = await newChat();
    await turn(id2, "hello again");
    expect((m.inputs[0] ?? []).some((x) => SystemMessage.isInstance(x))).toBe(true);
  });

  it("a chat needs a real agent", async () => {
    const res = await fetch(`${base}/api/chats`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent: "nobody" }) });
    expect(res.status).toBe(404);
  });
});

/** Tool calls in `messages` that no tool message answers. Providers reject a request that holds one. */
function unansweredCalls(messages: BaseMessage[]): string[] {
  const answered = new Set(messages.filter((m): m is ToolMessage => ToolMessage.isInstance(m)).map((m) => m.tool_call_id));
  return messages.filter((m): m is AIMessage => AIMessage.isInstance(m)).flatMap((m) => (m.tool_calls ?? []).map((c) => c.id ?? "")).filter((id) => !answered.has(id));
}

describe("a chat turn that stops in the middle of a tool round", () => {
  it("leaves no unanswered tool call for the next turn (budget used up)", async () => {
    putAgent(chatAgent({ tokenBudget: 100 }));
    const askTool = new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "list_notes", args: {}, type: "tool_call" }], usage_metadata: usage(150) });
    const m = scripted([askTool, say("second answer")]);
    setRunDeps({ makeModel: m.make });
    const id = await newChat();
    await turn(id, "first question");
    expect(m.inputs).toHaveLength(1);
    await turn(id, "second question");
    expect(m.inputs).toHaveLength(2);
    expect(unansweredCalls(m.inputs[1] ?? [])).toEqual([]);
  });
});
