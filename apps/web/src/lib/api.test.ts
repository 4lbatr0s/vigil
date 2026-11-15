import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createChat,
  deleteChat,
  getChat,
  getGraph,
  listChats,
  saveChat,
  streamTurn,
  createFromTemplate,
  decideApproval,
  deleteNote,
  getAgent,
  getBacklinks,
  getLlmStatus,
  getNote,
  getPermissions,
  getRun,
  getSchedule,
  getUsage,
  listAgents,
  listApprovals,
  listNotes,
  listRuns,
  listTemplates,
  putAgent,
  planRenameNote,
  putNote,
  renameNote,
  putPermissions,
  runAgent,
  undoRun,
} from "./api";
import { AgentSchema, PermissionSettingsSchema } from "@vigil/shared";

function stubFetch(payload: unknown, ok = true) {
  const spy = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 400,
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("unwraps the data envelope", async () => {
    const spy = stubFetch({ data: [{ id: "hello", title: "Hello", tags: [], author: "human", updatedAt: "2026-11-14" }] });
    const notes = await listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe("hello");
    expect((spy.mock.calls as unknown as Array<[string]>)[0]?.[0]).toBe("/api/notes?fields=summary");
  });

  it("throws code: message for an error envelope", async () => {
    stubFetch({ error: { code: "note-not-found", message: "Note not found: x" } });
    await expect(getNote("x")).rejects.toThrow("note-not-found: Note not found: x");
  });

  it("sends a PUT body as JSON", async () => {
    const spy = stubFetch({ data: { id: "hello", title: "Hello", body: "b", tags: [], author: "human", updatedAt: "t" } });
    await putNote("hello", { title: "Hello", body: "b" });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/notes/hello");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ title: "Hello", body: "b" });
  });

  it("sends the base updatedAt so the server can detect a conflict", async () => {
    const spy = stubFetch({ data: { id: "hello", title: "Hello", body: "b", tags: [], author: "human", updatedAt: "t2" } });
    await putNote("hello", { title: "Hello", body: "b", baseUpdatedAt: "t1" });
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ baseUpdatedAt: "t1" });
  });

  describe("agents, runs, settings", () => {
    const calls = (spy: ReturnType<typeof stubFetch>) => spy.mock.calls as unknown as Array<[string, RequestInit | undefined]>;

    it("GET endpoints use the right URL and no body", async () => {
      const spy = stubFetch({ data: [] });
      await listAgents();
      await getAgent("digest");
      await getSchedule("digest");
      await listTemplates();
      await getUsage();
      await getLlmStatus();
      await getLlmStatus(true);
      await getPermissions();
      await listRuns();
      await listRuns({ agent: "digest", limit: 20 });
      await getRun("r1");
      await getRun("r1", 7);
      await getBacklinks("a b");
      await listApprovals();
      await listChats();
      await getGraph();
      await getChat("a/b");
      expect(calls(spy).map(([url]) => url)).toEqual([
        "/api/agents",
        "/api/agents/digest",
        "/api/agents/digest/schedule",
        "/api/agent-templates",
        "/api/usage",
        "/api/llm/status",
        "/api/llm/status?probe=1",
        "/api/settings/permissions",
        "/api/runs",
        "/api/runs?agent=digest&limit=20",
        "/api/runs/r1",
        "/api/runs/r1?after=7",
        "/api/notes/a%20b/backlinks",
        "/api/approvals?status=pending",
        "/api/chats",
        "/api/graph",
        "/api/chats/a%2Fb",
      ]);
      expect(calls(spy).every(([, init]) => init === undefined)).toBe(true);
    });

    it("write endpoints use the right method and JSON body", async () => {
      const spy = stubFetch({ data: {} });
      const agent = AgentSchema.parse({ name: "digest", systemPrompt: "x" });
      const settings = PermissionSettingsSchema.parse({});
      await putAgent(agent);
      await runAgent("digest");
      await runAgent("digest", "do it");
      await createFromTemplate("morning-digest");
      await createFromTemplate("morning-digest", "mine");
      await undoRun("r1");
      await putPermissions(settings);
      await planRenameNote("a b", "New title");
      await renameNote("a b", "New title");
      await deleteNote("a b");
      await createChat("helper");
      await saveChat("c 1");
      await deleteChat("c 1");
      await decideApproval("x/y", "approve");
      await decideApproval("x/y", "approve", true);
      const seen = calls(spy).map(([url, init]) => [url, init?.method, init?.body]);
      expect(seen).toEqual([
        ["/api/agents/digest", "PUT", JSON.stringify(agent)],
        ["/api/agents/digest/run", "POST", "{}"],
        ["/api/agents/digest/run", "POST", JSON.stringify({ task: "do it" })],
        ["/api/agents/from-template/morning-digest", "POST", "{}"],
        ["/api/agents/from-template/morning-digest", "POST", JSON.stringify({ name: "mine" })],
        ["/api/runs/r1/undo", "POST", "{}"],
        ["/api/settings/permissions", "PUT", JSON.stringify(settings)],
        ["/api/notes/a%20b/rename?dryRun=1", "POST", JSON.stringify({ title: "New title" })],
        ["/api/notes/a%20b/rename", "POST", JSON.stringify({ title: "New title" })],
        ["/api/notes/a%20b", "DELETE", undefined],
        ["/api/chats", "POST", JSON.stringify({ agent: "helper" })],
        ["/api/chats/c%201/save", "POST", "{}"],
        ["/api/chats/c%201", "DELETE", undefined],
        ["/api/approvals/x%2Fy/decision", "POST", JSON.stringify({ decision: "approve" })],
        ["/api/approvals/x%2Fy/decision", "POST", JSON.stringify({ decision: "approve", force: true })],
      ]);
    });

    it("encodes path segments so an id cannot climb to another route", async () => {
      const spy = stubFetch({ data: {} });
      await runAgent("../runs/r1/undo?");
      await getRun("a/b");
      await getNote("../x");
      expect(calls(spy).map(([url]) => url)).toEqual([
        "/api/agents/..%2Fruns%2Fr1%2Fundo%3F/run",
        "/api/runs/a%2Fb",
        "/api/notes/..%2Fx",
      ]);
    });

    it("throws an ApiError with the code and a plain detail", async () => {
      stubFetch({ error: { code: "undo-conflict", message: "Edited after the agent wrote it" } });
      const err = await undoRun("r1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("undo-conflict");
      expect((err as ApiError).detail).toBe("Edited after the agent wrote it");
    });
  });

  describe("streamTurn", () => {
    it("reads streamed lines in order and sends the message as JSON", async () => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"type":"token","text":"Hi"}\n{"type":"do'));
          c.enqueue(new TextEncoder().encode('ne","run":{}}\n'));
          c.close();
        },
      });
      const spy = vi.fn(async () => ({ ok: true, status: 200, body }));
      vi.stubGlobal("fetch", spy);
      const seen: string[] = [];
      await streamTurn("c1", "hello", new AbortController().signal, (l) => seen.push(l.type));
      expect(seen).toEqual(["token", "done"]);
      const [url, init] = (spy.mock.calls as unknown as Array<[string, RequestInit]>)[0]!;
      expect(url).toBe("/api/chats/c1/messages");
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ text: "hello" }));
    });

    it("turns a refusal before streaming into an ApiError", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, body: null, json: async () => ({ error: { code: "agent-busy", message: "busy now" } }) })));
      const err = await streamTurn("c1", "x", new AbortController().signal, () => undefined).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("agent-busy");
      expect((err as ApiError).detail).toBe("busy now");
    });
  });
});
