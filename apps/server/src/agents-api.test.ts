import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb } from "./index-db";
import { setRunDeps, waitForRuns } from "./runs";
import { start, type RunningServer } from "./server";
import { closeState } from "./state-db";

let root = "";
let running: RunningServer;
let base = "";
const saved = { ...process.env };

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-agents-api-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  let step = 0;
  setRunDeps({
    makeModel: () => ({
      invoke: async () =>
        step++ === 0
          ? new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "write_note", args: { title: "Hello Digest", body: "hi" }, type: "tool_call" }], usage_metadata: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } })
          : new AIMessage({ content: "done", usage_metadata: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } }),
    }),
  });
  running = start({ port: 0 });
  await new Promise<void>((r) => running.server.once("listening", () => r()));
  const a = running.server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});

afterAll(async () => {
  await waitForRuns();
  await running.close();
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

type Json = { data?: any; error?: { code?: string; message?: string } };
async function req(method: string, p: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

describe("agents and runs api", () => {
  it("defines an agent, runs it, shows the log, and undoes it", async () => {
    const put = await req("PUT", "/api/agents/digest", { name: "digest", systemPrompt: "Write a digest.", tools: ["write_notes"], tokenBudget: 500, strict: false });
    expect(put.status).toBe(200);
    expect((await req("GET", "/api/agents")).json.data).toHaveLength(1);
    expect((await req("GET", "/api/agents/digest")).json.data).toMatchObject({ trigger: { kind: "manual" }, tokenBudget: 500 });

    const started = await req("POST", "/api/agents/digest/run");
    expect(started.status).toBe(202);
    expect(started.json.data).toMatchObject({ agent: "digest", status: "running" });
    await waitForRuns();

    const id = started.json.data.id as string;
    const shown = await req("GET", `/api/runs/${id}`);
    expect(shown.json.data.run).toMatchObject({ status: "succeeded", tokensUsed: 20, touched: ["hello-digest"] });
    expect(shown.json.data.events.map((e: { kind: string }) => e.kind)).toContain("note");
    expect((await req("GET", "/api/notes/hello-digest")).json.data).toMatchObject({ author: "agent" });
    expect((await req("GET", "/api/runs?agent=digest")).json.data).toHaveLength(1);

    const undo = await req("POST", `/api/runs/${id}/undo`);
    expect(undo.status).toBe(200);
    expect(undo.json.data.undone).toBe(true);
    expect((await req("GET", "/api/notes/hello-digest")).status).toBe(404);
  });

  it("answers 404 for an unknown agent or run, and 400 for a bad definition", async () => {
    expect((await req("POST", "/api/agents/nope/run")).json.error?.code).toBe("agent-not-found");
    expect((await req("GET", "/api/runs/nope")).status).toBe(404);
    expect((await req("PUT", "/api/agents/Bad Name", { name: "Bad Name", systemPrompt: "x" })).status).toBe(400);
    expect((await req("PUT", "/api/agents/a", { name: "b", systemPrompt: "x" })).json.error?.code).toBe("invalid-body");
    expect((await req("PUT", "/api/agents/a", { name: "a", systemPrompt: "x", tools: ["shell"] })).status).toBe(400);
  });

  it("accepts the legacy string trigger and web_fetch or call_agents with empty lists", async () => {
    const legacy = await req("PUT", "/api/agents/old", { name: "old", systemPrompt: "x", trigger: "manual" });
    expect(legacy.status).toBe(200);
    expect(legacy.json.data).toMatchObject({ trigger: { kind: "manual" } });
    const empty = await req("PUT", "/api/agents/fetcher", { name: "fetcher", systemPrompt: "x", tools: ["web_fetch", "call_agents"] });
    expect(empty.status).toBe(200);
    expect(empty.json.data).toMatchObject({ allowedHosts: [], callable: [] });
  });

  it("validates cron triggers and heartbeat tools at save time", async () => {
    const cron = (expression: string, timezone?: string) => ({ name: "c", systemPrompt: "x", trigger: { kind: "cron", expression, timezone } });
    expect((await req("PUT", "/api/agents/c", cron("not a cron"))).json.error?.code).toBe("invalid-body");
    expect((await req("PUT", "/api/agents/c", cron("0 7 * * *", "Mars/Base"))).json.error?.message).toMatch(/Unknown time zone/);
    expect((await req("PUT", "/api/agents/c", cron("0 7 * * *", "Europe/Istanbul"))).status).toBe(200);
    const beat = { name: "h", systemPrompt: "x", trigger: { kind: "heartbeat", everyMinutes: 30 } };
    expect((await req("PUT", "/api/agents/h", beat)).status).toBe(400);
    expect((await req("PUT", "/api/agents/h", { ...beat, tools: ["read_notes"] })).status).toBe(200);
  });

  it("GET /api/agents/:name/schedule reports the next run", async () => {
    await req("PUT", "/api/agents/c", { name: "c", systemPrompt: "x", trigger: { kind: "cron", expression: "0 7 * * *", timezone: "UTC" } });
    const res = await req("GET", "/api/agents/c/schedule");
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ enabled: true, trigger: { kind: "cron" }, lastStartedAt: null, lastSkipReason: null });
    expect(new Date(res.json.data.nextRunAt as string).getUTCHours()).toBe(7);
    await req("PUT", "/api/agents/m", { name: "m", systemPrompt: "x" });
    expect((await req("GET", "/api/agents/m/schedule")).json.data.nextRunAt).toBeNull();
    expect((await req("GET", "/api/agents/nope/schedule")).status).toBe(404);
  });

  it("lists the templates and creates an agent from one, switched off and unscheduled", async () => {
    const list = await req("GET", "/api/agent-templates");
    expect(list.json.data).toHaveLength(10);
    const made = await req("POST", "/api/agents/from-template/morning-digest", {});
    expect(made.status).toBe(201);
    const template = list.json.data.find((t: { id: string }) => t.id === "morning-digest");
    // strict comes from the owner's newAgentsStrict setting (default on), not from the template.
    expect(made.json.data).toEqual({ ...template.agent, name: "morning-digest", enabled: false, strict: true });
    expect((await req("POST", "/api/agents/from-template/morning-digest", {})).json.error?.code).toBe("agent-exists");
    // Not scheduled: no schedule state, no next run, no runs.
    const schedule = await req("GET", "/api/agents/morning-digest/schedule");
    expect(schedule.json.data).toMatchObject({ enabled: false, nextRunAt: null, lastScheduledFor: null });
    expect((await req("GET", "/api/runs?agent=morning-digest")).json.data).toHaveLength(0);
    const named = await req("POST", "/api/agents/from-template/morning-digest", { name: "my-digest" });
    expect(named.json.data).toMatchObject({ name: "my-digest", enabled: false });
    const bare = await fetch(`${base}/api/agents/from-template/inbox-triager`, { method: "POST" });
    expect(bare.status).toBe(201);
    expect((await req("POST", "/api/agents/from-template/nope", {})).json.error?.code).toBe("template-not-found");
    expect((await req("POST", "/api/agents/from-template/morning-digest", { name: "Bad Name" })).status).toBe(400);
  });

  it("Run now works on a disabled agent", async () => {
    await req("POST", "/api/agents/from-template/weekly-review", {});
    const run = await req("POST", "/api/agents/weekly-review/run");
    expect(run.status).toBe(202);
    await waitForRuns();
  });

  it("GET /api/usage answers without a cap", async () => {
    delete process.env.VIGIL_MONTHLY_TOKEN_CAP;
    const res = await req("GET", "/api/usage");
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ cap: null, level: "ok" });
    expect(typeof res.json.data.tokens).toBe("number");
  });

  it("GET /api/llm/status hides the key and only probes on request", async () => {
    process.env.VIGIL_LLM_API_KEY = "sk-never-leak-this-key-9876";
    process.env.VIGIL_LLM_PROVIDER = "ollama";
    process.env.VIGIL_LLM_BASE_URL = "http://127.0.0.1:1";
    const res = await req("GET", "/api/llm/status");
    expect(res.json.data).toMatchObject({ provider: "ollama", hasKey: true, reachable: null });
    expect(JSON.stringify(res.json)).not.toContain("sk-never-leak-this-key-9876");
    expect((await req("GET", "/api/llm/status?probe=1")).json.data.reachable).toBe(false);
  });

  it("GET /api/runs honours limit (default 50, max 200)", async () => {
    await req("PUT", "/api/agents/lim", { name: "lim", systemPrompt: "x" });
    for (let i = 0; i < 3; i++) {
      await req("POST", "/api/agents/lim/run");
      await waitForRuns();
    }
    expect((await req("GET", "/api/runs?agent=lim")).json.data).toHaveLength(3);
    expect((await req("GET", "/api/runs?agent=lim&limit=2")).json.data).toHaveLength(2);
    for (const bad of ["0", "201", "abc", "1.5"]) {
      expect((await req("GET", `/api/runs?limit=${bad}`)).json.error?.code, bad).toBe("invalid-query");
    }
  });

  it("GET /api/runs/:id?after=<seq> returns only newer events", async () => {
    await req("PUT", "/api/agents/ev", { name: "ev", systemPrompt: "x", tools: ["write_notes"] });
    const started = await req("POST", "/api/agents/ev/run");
    await waitForRuns();
    const id = started.json.data.id as string;
    const all = (await req("GET", `/api/runs/${id}`)).json.data.events as { seq: number }[];
    expect(all.length).toBeGreaterThan(2);
    const second = all[1]?.seq as number;
    const rest = (await req("GET", `/api/runs/${id}?after=${second}`)).json.data.events as { seq: number }[];
    expect(rest.map((e) => e.seq)).toEqual(all.filter((e) => e.seq > second).map((e) => e.seq));
    expect((await req("GET", `/api/runs/${id}?after=999999`)).json.data.events).toEqual([]);
    expect((await req("GET", `/api/runs/${id}?after=-1`)).json.error?.code).toBe("invalid-query");
    expect((await req("GET", `/api/runs/${id}?after=x`)).status).toBe(400);
  });

  it("the schedule of a heartbeat agent reports lastCheckedAt", async () => {
    await req("PUT", "/api/agents/hb", { name: "hb", systemPrompt: "x", tools: ["read_notes"], trigger: { kind: "heartbeat", everyMinutes: 30 } });
    const res = await req("GET", "/api/agents/hb/schedule");
    expect(res.json.data).toMatchObject({ trigger: { kind: "heartbeat" }, lastCheckedAt: null });
  });

  it("GET /api/graph returns nodes, edges and the truncated flag", async () => {
    await req("PUT", "/api/agents/g1", { name: "g1", systemPrompt: "x" });
    const res = await req("GET", "/api/graph");
    expect(res.status).toBe(200);
    expect(res.json.data.truncated).toBe(false);
    expect(res.json.data.nodes.some((n: { id: string; kind: string }) => n.id === "agent:g1" && n.kind === "agent")).toBe(true);
    expect(Array.isArray(res.json.data.edges)).toBe(true);
  });
});
