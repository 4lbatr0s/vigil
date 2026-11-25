import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, type Agent } from "@vigil/shared";
import { accessFromEnv } from "./access";
import { closeCheckpoints } from "./checkpoints";
import { createHandler } from "./http";
import { closeDb, getNote as indexGet, reindexNote } from "./index-db";
import type { ModelFactory } from "./llm";
import { REJECTED_TEXT } from "./agent-runtime";
import { resumeDecidedRuns, resumeRun, setRunDeps, startRun, waitForRuns } from "./runs";
import { approvalsForRun, closeState, decideApproval, getRun, listApprovals, listEvents, listSnapshots, markInterruptedRuns, pendingForRun, putAgent } from "./state-db";
import { createNote, getNote, updateNote } from "./vault";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-approve-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  server = createServer(createHandler(accessFromEnv()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterEach(async () => {
  await waitForRuns();
  await new Promise<void>((r) => server.close(() => r()));
  closeDb();
  closeCheckpoints();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const usage = (total: number) => ({ input_tokens: 1, output_tokens: total - 1, total_tokens: total });
const writeCall = (title: string, body: string, id: string, total = 10) =>
  new AIMessage({ content: "", tool_calls: [{ id, name: "write_note", args: { title, body }, type: "tool_call" }], usage_metadata: usage(total) });
const two = (a: [string, string, string], b: [string, string, string]) =>
  new AIMessage({
    content: "",
    tool_calls: [
      { id: a[2], name: "write_note", args: { title: a[0], body: a[1] }, type: "tool_call" },
      { id: b[2], name: "write_note", args: { title: b[0], body: b[1] }, type: "tool_call" },
    ],
    usage_metadata: usage(10),
  });
const say = (text: string, total = 10) => new AIMessage({ content: text, usage_metadata: usage(total) });

function scripted(script: AIMessage[]): { make: ModelFactory; inputs: BaseMessage[][] } {
  const inputs: BaseMessage[][] = [];
  let i = 0;
  const make: ModelFactory = () => ({
    invoke: async (messages) => {
      inputs.push([...messages]);
      return script[Math.min(i++, script.length - 1)] as AIMessage;
    },
  });
  return { make, inputs };
}

const strictAgent = (over: Partial<Agent> = {}): Agent => AgentSchema.parse({ name: "triager", systemPrompt: "x", tools: ["read_notes", "write_notes"], strict: true, tokenBudget: 1000, ...over });

async function startStrict(script: AIMessage[], over: Partial<Agent> = {}) {
  putAgent(strictAgent(over));
  const s = scripted(script);
  setRunDeps({ makeModel: s.make });
  const run = startRun("triager");
  await waitForRuns();
  return { runId: run.id, ...s };
}

async function call(method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${p}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

describe("strict mode", () => {
  it("a strict agent's write waits: run is waiting-approval, the note does not exist, one pending approval with the args", async () => {
    const { runId } = await startStrict([writeCall("Filed", "body text", "w1"), say("done")]);
    expect(getRun(runId)?.status).toBe("waiting-approval");
    expect(getRun(runId)?.finishedAt).toBeNull();
    await expect(getNote("filed")).rejects.toMatchObject({ code: "note-not-found" });
    const pending = pendingForRun(runId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ tool: "write_note", toolCallId: expect.stringMatching(/^vg-/), args: { title: "Filed", body: "body text" }, baseUpdatedAt: null, status: "pending" });
  });

  it("approve: the run resumes and succeeds, the note exists as an agent write with a snapshot", async () => {
    const { runId } = await startStrict([writeCall("Filed", "body text", "w1"), say("done")]);
    const id = pendingForRun(runId)[0]!.id;
    const res = await call("POST", `/api/approvals/${id}/decision`, { decision: "approve" });
    expect(res.status).toBe(200);
    expect(res.json.data.runResumed).toBe(true);
    await waitForRuns();
    expect(getRun(runId)?.status).toBe("succeeded");
    expect(await getNote("filed")).toMatchObject({ body: "body text", author: "agent", agentName: "triager" });
    expect(listSnapshots(runId)).toHaveLength(1);
    expect(getRun(runId)?.finishedAt).not.toBeNull();
  });

  it("reject: the run succeeds without the note, and the model sees the rejection text", async () => {
    const { runId, inputs } = await startStrict([writeCall("Nope", "x", "w1"), say("ok, skipped")]);
    await call("POST", `/api/approvals/${pendingForRun(runId)[0]!.id}/decision`, { decision: "reject" });
    await waitForRuns();
    expect(getRun(runId)?.status).toBe("succeeded");
    await expect(getNote("nope")).rejects.toMatchObject({ code: "note-not-found" });
    const lastInput = inputs.at(-1) ?? [];
    const tool = lastInput.find((m) => ToolMessage.isInstance(m)) as ToolMessage;
    expect(String(tool.content)).toBe(REJECTED_TEXT);
    expect(listEvents(runId).some((e) => e.kind === "tool-denied")).toBe(true);
  });

  it("two writes in one reply: two approvals, one approved and one rejected, and the run waits for both", async () => {
    const { runId } = await startStrict([two(["Yes", "y", "a"], ["No", "n", "b"]), say("done")]);
    const [first, second] = pendingForRun(runId);
    expect(pendingForRun(runId)).toHaveLength(2);
    const r1 = await call("POST", `/api/approvals/${first!.id}/decision`, { decision: "approve" });
    expect(r1.json.data.runResumed).toBe(false); // one still pending
    expect(getRun(runId)?.status).toBe("waiting-approval");
    const r2 = await call("POST", `/api/approvals/${second!.id}/decision`, { decision: "reject" });
    expect(r2.json.data.runResumed).toBe(true);
    await waitForRuns();
    expect(getRun(runId)?.status).toBe("succeeded");
    expect((await getNote("yes")).body).toBe("y");
    await expect(getNote("no")).rejects.toMatchObject({ code: "note-not-found" });
  });

  it("a restart while waiting keeps the run waiting (not interrupted); approving afterwards completes it", async () => {
    const { runId } = await startStrict([writeCall("Survive", "s", "w1"), say("done")]);
    // Simulate a restart: close every handle, then do what index.ts does at start.
    closeCheckpoints();
    closeState();
    expect(markInterruptedRuns()).toBe(0);
    expect(getRun(runId)?.status).toBe("waiting-approval");
    expect(resumeDecidedRuns()).toBe(0); // still undecided: stays waiting
    expect(decideApproval(pendingForRun(runId)[0]!.id, "approve")).toBe(true);
    // A crash between the decision and the resume: the next start picks it up.
    closeCheckpoints();
    closeState();
    expect(resumeDecidedRuns()).toBe(1);
    await waitForRuns();
    expect(getRun(runId)?.status).toBe("succeeded");
    expect((await getNote("survive")).body).toBe("s");
  });

  it("read-only calls in a strict agent never create approvals", async () => {
    const readCall = new AIMessage({ content: "", tool_calls: [{ id: "r1", name: "list_notes", args: {}, type: "tool_call" }], usage_metadata: usage(10) });
    putAgent(strictAgent());
    const s = scripted([readCall, say("all read")]);
    setRunDeps({ makeModel: s.make });
    const run = startRun("triager");
    await waitForRuns();
    expect(getRun(run.id)?.status).toBe("succeeded");
    expect(listApprovals()).toHaveLength(0);
  });

  it("token accounting continues from the stored tokensUsed after a resume", async () => {
    const { runId } = await startStrict([writeCall("T", "t", "w1", 40), say("done", 25)]);
    expect(getRun(runId)?.tokensUsed).toBe(40);
    await call("POST", `/api/approvals/${pendingForRun(runId)[0]!.id}/decision`, { decision: "approve" });
    await waitForRuns();
    expect(getRun(runId)?.tokensUsed).toBe(65);
  });

  it("an approval cannot be decided twice", async () => {
    const { runId } = await startStrict([writeCall("Once", "o", "w1"), say("done")]);
    const id = pendingForRun(runId)[0]!.id;
    expect((await call("POST", `/api/approvals/${id}/decision`, { decision: "approve" })).status).toBe(200);
    const again = await call("POST", `/api/approvals/${id}/decision`, { decision: "reject" });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe("approval-decided");
    expect(decideApproval(id, "reject")).toBe(false);
    await waitForRuns();
    expect((await call("POST", "/api/approvals/nope/decision", { decision: "approve" })).json.error.code).toBe("approval-not-found");
    expect((await call("POST", `/api/approvals/${id}/decision`, { decision: "maybe" })).json.error.code).toBe("invalid-body");
  });

  it("the write runs exactly once across the interrupt and the resume", async () => {
    const { runId } = await startStrict([writeCall("Once only", "x", "w1"), say("done")]);
    await call("POST", `/api/approvals/${pendingForRun(runId)[0]!.id}/decision`, { decision: "approve" });
    await waitForRuns();
    const events = listEvents(runId);
    expect(events.filter((e) => e.kind === "note")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "tool-call" && e.data["tool"] === "write_note")).toHaveLength(1);
    expect(approvalsForRun(runId)).toHaveLength(1); // the approve node re-running on resume made no second row
  });

  it("model-supplied tool call ids cannot collide: two writes with the same id get separate approvals and separate decisions", async () => {
    const dup = new AIMessage({
      content: "",
      tool_calls: [
        { id: "same", name: "write_note", args: { title: "First", body: "1" }, type: "tool_call" },
        { id: "same", name: "write_note", args: { title: "Second", body: "2" }, type: "tool_call" },
      ],
      usage_metadata: usage(10),
    });
    const { runId } = await startStrict([dup, say("done")]);
    const pending = pendingForRun(runId);
    expect(pending).toHaveLength(2);
    expect(new Set(pending.map((a) => a.toolCallId)).size).toBe(2);
    expect(pending.every((a) => a.toolCallId !== "same")).toBe(true);
    const first = pending.find((a) => a.args["title"] === "First")!;
    const second = pending.find((a) => a.args["title"] === "Second")!;
    await call("POST", `/api/approvals/${first.id}/decision`, { decision: "approve" });
    await call("POST", `/api/approvals/${second.id}/decision`, { decision: "reject" });
    await waitForRuns();
    expect((await getNote("first")).body).toBe("1");
    await expect(getNote("second")).rejects.toMatchObject({ code: "note-not-found" });
  });

  it("the same model id in two different rounds gets two separate approvals", async () => {
    const { runId } = await startStrict([writeCall("Round one", "1", "reused"), writeCall("Round two", "2", "reused"), say("done")]);
    await call("POST", `/api/approvals/${pendingForRun(runId)[0]!.id}/decision`, { decision: "approve" });
    await waitForRuns();
    expect(getRun(runId)?.status).toBe("waiting-approval"); // round two now waits on its own approval
    const second = pendingForRun(runId);
    expect(second).toHaveLength(1);
    expect(second[0]?.args["title"]).toBe("Round two");
    await call("POST", `/api/approvals/${second[0]!.id}/decision`, { decision: "reject" });
    await waitForRuns();
    expect((await getNote("round-one")).body).toBe("1");
    await expect(getNote("round-two")).rejects.toMatchObject({ code: "note-not-found" });
  });

  it("a write call with no id is refused, never executed", async () => {
    const noId = new AIMessage({ content: "", tool_calls: [{ name: "write_note", args: { title: "Idless", body: "x" }, type: "tool_call" } as never], usage_metadata: usage(10) });
    const { runId } = await startStrict([noId, say("done")]);
    // The runtime gave it an id, so it is an ordinary pending write that still needs approval.
    expect(pendingForRun(runId)).toHaveLength(1);
    await expect(getNote("idless")).rejects.toMatchObject({ code: "note-not-found" });
  });

  it("resume refuses a run that is not waiting, or one with writes still pending", async () => {
    const { runId } = await startStrict([writeCall("P", "p", "w1"), say("done")]);
    expect(() => resumeRun(runId)).toThrowError(/still waiting/);
    expect(() => resumeRun("missing")).toThrowError(/not found/i);
  });

  it("switching approvals off while a run waits does not turn a rejected write into an executed one", async () => {
    const { runId } = await startStrict([writeCall("Blocked", "b", "w1"), say("done")]);
    putAgent(strictAgent({ strict: false }));
    await call("POST", `/api/approvals/${pendingForRun(runId)[0]!.id}/decision`, { decision: "reject" });
    await waitForRuns();
    await expect(getNote("blocked")).rejects.toMatchObject({ code: "note-not-found" });
  });

  it("a non-strict agent writes at once and never creates approvals", async () => {
    putAgent(strictAgent({ strict: false }));
    const s = scripted([writeCall("Direct", "d", "w1"), say("done")]);
    setRunDeps({ makeModel: s.make });
    const run = startRun("triager");
    await waitForRuns();
    expect(getRun(run.id)?.status).toBe("succeeded");
    expect((await getNote("direct")).author).toBe("agent");
    expect(listApprovals()).toHaveLength(0);
  });

  it("a waiting agent is busy: a second run of it is refused", async () => {
    await startStrict([writeCall("Busy", "b", "w1"), say("done")]);
    expect(() => startRun("triager")).toThrowError(/already has a run/);
  });
});

describe("stale approvals and the approvals API", () => {
  it("approving a write whose note changed answers 409 approval-stale; force applies it; reject never needs force", async () => {
    reindexNote(await createNote({ title: "Doc", body: "v1" }));
    const { runId } = await startStrict([writeCall("Doc", "agent version", "w1"), say("done")]);
    const approval = pendingForRun(runId)[0]!;
    expect(approval.baseUpdatedAt).not.toBeNull();
    reindexNote(await updateNote("doc", { body: "human edit meanwhile" }));
    const list = await call("GET", "/api/approvals?status=pending");
    expect(list.json.data[0]).toMatchObject({ agent: "triager", noteId: "doc", title: "Doc", currentBody: "human edit meanwhile", proposedBody: "agent version", stale: true });
    const stale = await call("POST", `/api/approvals/${approval.id}/decision`, { decision: "approve" });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe("approval-stale");
    expect(listApprovals("pending")).toHaveLength(1); // still pending
    const forced = await call("POST", `/api/approvals/${approval.id}/decision`, { decision: "approve", force: true });
    expect(forced.status).toBe(200);
    await waitForRuns();
    expect((await getNote("doc")).body).toBe("agent version");
    expect(listSnapshots(runId)).toHaveLength(1); // the human's text was snapshotted first, so undo can bring it back
    expect(indexGet("doc")?.body).toBe("agent version");
  });

  it("a note that appeared after the proposal also counts as stale, and rejecting needs no force", async () => {
    const { runId } = await startStrict([writeCall("Late", "agent", "w1"), say("done")]);
    reindexNote(await createNote({ title: "Late", body: "human got there first" }));
    const id = pendingForRun(runId)[0]!.id;
    expect((await call("POST", `/api/approvals/${id}/decision`, { decision: "approve" })).json.error.code).toBe("approval-stale");
    expect((await call("POST", `/api/approvals/${id}/decision`, { decision: "reject" })).status).toBe(200);
    await waitForRuns();
    expect((await getNote("late")).body).toBe("human got there first");
  });

  it("lists by status and rejects a bad status filter", async () => {
    const { runId } = await startStrict([writeCall("L", "l", "w1"), say("done")]);
    expect((await call("GET", "/api/approvals")).json.data).toHaveLength(1);
    expect((await call("GET", "/api/approvals?status=approved")).json.data).toHaveLength(0);
    expect((await call("GET", "/api/approvals?status=zzz")).json.error.code).toBe("invalid-query");
    await call("POST", `/api/approvals/${pendingForRun(runId)[0]!.id}/decision`, { decision: "reject" });
    await waitForRuns();
    expect((await call("GET", "/api/approvals?status=rejected")).json.data).toHaveLength(1);
  });
});

describe("append_note", () => {
  const appendCall = (title: string, text: string, id: string) =>
    new AIMessage({ content: "", tool_calls: [{ id, name: "append_note", args: { title, text }, type: "tool_call" }], usage_metadata: usage(10) });

  it("a strict agent's append waits, and the Approvals list shows the old body plus the new text", async () => {
    await createNote({ title: "Log", body: "first entry" });
    const { runId } = await startStrict([appendCall("Log", "second entry", "a1"), say("done")]);
    expect(getRun(runId)?.status).toBe("waiting-approval");
    expect((await getNote("log")).body).toBe("first entry");
    const item = (await call("GET", "/api/approvals")).json.data[0];
    expect(item).toMatchObject({ tool: "append_note", title: "Log", currentBody: "first entry", proposedBody: "first entry\n\nsecond entry" });
  });

  it("approving it appends to the note, keeps the old text, and the run snapshot lets undo restore the note", async () => {
    await createNote({ title: "Log", body: "first entry" });
    const { runId } = await startStrict([appendCall("Log", "second entry", "a1"), say("done")]);
    const approval = pendingForRun(runId)[0];
    expect((await call("POST", `/api/approvals/${approval?.id}/decision`, { decision: "approve" })).status).toBe(200);
    await waitForRuns();
    expect((await getNote("log")).body).toBe("first entry\n\nsecond entry");
    expect(listSnapshots(runId)).toMatchObject([{ noteId: "log", existed: true }]);
  });

  it("creates the note when it does not exist", async () => {
    const { runId } = await startStrict([appendCall("Fresh", "hello", "a1"), say("done")]);
    expect((await call("GET", "/api/approvals")).json.data[0]).toMatchObject({ currentBody: null, proposedBody: "hello" });
    await call("POST", `/api/approvals/${pendingForRun(runId)[0]?.id}/decision`, { decision: "approve" });
    await waitForRuns();
    expect((await getNote("fresh")).body).toBe("hello");
  });
});

describe("approval for other tools", () => {
  const fetchCall = (url: string, id: string) => new AIMessage({ content: "", tool_calls: [{ id, name: "fetch_url", args: { url }, type: "tool_call" }], usage_metadata: usage(10) });
  const agentWithFetch = (over: Partial<Agent> = {}) => strictAgent({ strict: false, tools: ["read_notes", "web_fetch"], allowedHosts: ["example.com"], approveTools: ["fetch_url"], ...over });

  async function startWith(a: Agent, script: AIMessage[]) {
    putAgent(a);
    const s = scripted(script);
    setRunDeps({ makeModel: s.make });
    const run = startRun(a.name);
    await waitForRuns();
    return { runId: run.id, ...s };
  }

  it("a fetch waits for approval when the agent asks for it, and the list shows the address", async () => {
    const { runId } = await startWith(agentWithFetch(), [fetchCall("https://example.com/page", "f1"), say("done")]);
    expect(getRun(runId)?.status).toBe("waiting-approval");
    expect(listEvents(runId).some((e) => e.kind === "tool-result")).toBe(false);
    const item = (await call("GET", "/api/approvals")).json.data[0];
    expect(item).toMatchObject({ tool: "fetch_url", target: "https://example.com/page", stale: false });
  });

  it("rejecting it gives the agent the rejected text and nothing is fetched", async () => {
    const { runId, inputs } = await startWith(agentWithFetch(), [fetchCall("https://example.com/page", "f1"), say("done")]);
    await call("POST", `/api/approvals/${pendingForRun(runId)[0]?.id}/decision`, { decision: "reject" });
    await waitForRuns();
    expect(getRun(runId)?.status).toBe("succeeded");
    const reply = inputs.at(-1)?.filter((m): m is ToolMessage => ToolMessage.isInstance(m)).at(-1);
    expect(String(reply?.content)).toBe(REJECTED_TEXT);
  });

  it("approving it runs the tool", async () => {
    const { runId } = await startWith(agentWithFetch({ allowedHosts: [] }), [fetchCall("https://example.com/page", "f1"), say("done")]);
    await call("POST", `/api/approvals/${pendingForRun(runId)[0]?.id}/decision`, { decision: "approve" });
    await waitForRuns();
    expect(listEvents(runId).some((e) => e.kind === "tool-result")).toBe(true);
  });

  it("a rejected fetch never runs, even when the owner switches the approval off while it waits", async () => {
    const a = agentWithFetch({ allowedHosts: [] });
    const { runId, inputs } = await startWith(a, [fetchCall("https://example.com/page", "f1"), say("done")]);
    putAgent({ ...a, approveTools: undefined });
    await call("POST", `/api/approvals/${pendingForRun(runId)[0]?.id}/decision`, { decision: "reject" });
    await waitForRuns();
    expect(listEvents(runId).filter((e) => e.kind === "tool-call")).toHaveLength(0);
    const reply = inputs.at(-1)?.filter((m): m is ToolMessage => ToolMessage.isInstance(m)).at(-1);
    expect(String(reply?.content)).toBe(REJECTED_TEXT);
  });

  it("without approveTools a fetch runs at once, even for a strict agent with no write tool", async () => {
    const { runId } = await startWith(agentWithFetch({ approveTools: undefined, strict: true }), [fetchCall("https://example.com/page", "f1"), say("done")]);
    expect(getRun(runId)?.status).toBe("succeeded");
  });
});
