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
    const put = await req("PUT", "/api/agents/digest", { name: "digest", systemPrompt: "Write a digest.", tools: ["write_notes"], tokenBudget: 500 });
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
});
