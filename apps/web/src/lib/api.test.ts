import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createFromTemplate,
  getAgent,
  getLlmStatus,
  getNote,
  getPermissions,
  getRun,
  getSchedule,
  getUsage,
  listAgents,
  listNotes,
  listRuns,
  listTemplates,
  putAgent,
  putNote,
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
    stubFetch({ data: [{ id: "hello", title: "Hello", body: "", updatedAt: "2026-11-14" }] });
    const notes = await listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0]?.id).toBe("hello");
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
      const seen = calls(spy).map(([url, init]) => [url, init?.method, init?.body]);
      expect(seen).toEqual([
        ["/api/agents/digest", "PUT", JSON.stringify(agent)],
        ["/api/agents/digest/run", "POST", "{}"],
        ["/api/agents/digest/run", "POST", JSON.stringify({ task: "do it" })],
        ["/api/agents/from-template/morning-digest", "POST", "{}"],
        ["/api/agents/from-template/morning-digest", "POST", JSON.stringify({ name: "mine" })],
        ["/api/runs/r1/undo", "POST", "{}"],
        ["/api/settings/permissions", "PUT", JSON.stringify(settings)],
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
});
