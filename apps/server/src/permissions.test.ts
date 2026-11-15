import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, PermissionSettingsSchema } from "@vigil/shared";
import type { ModelFactory } from "./llm";
import { effectiveBudget, effectiveGrants, getPermissions, putPermissions } from "./permissions";
import { closeDb } from "./index-db";
import { setRunDeps, startRun, waitForRuns } from "./runs";
import { closeState, getRun, listEvents, putAgent } from "./state-db";
import { createServer, type Server } from "node:http";
import { createHandler } from "./http";
import { accessFromEnv } from "./access";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-perm-"));
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
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

async function call(method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("permission settings", () => {
  it("gives defaults when nothing is stored, and fills a partial object", async () => {
    expect(getPermissions()).toEqual({
      tools: { read_notes: true, write_notes: true, web_fetch: true, call_agents: true },
      newAgentsStrict: true,
      maxTokenBudget: 200_000,
      retentionDays: 90,
    });
    const put = await call("PUT", "/api/settings/permissions", { tools: { web_fetch: false } });
    expect(put.status).toBe(200);
    expect(put.json.data.tools).toEqual({ read_notes: true, write_notes: true, web_fetch: false, call_agents: true });
    expect((await call("GET", "/api/settings/permissions")).json.data.tools.web_fetch).toBe(false);
  });

  it("rejects an invalid body with 400 invalid-body", async () => {
    for (const bad of [{ maxTokenBudget: -1 }, { tools: { read_notes: "yes" } }, { retentionDays: 3 }, { newAgentsStrict: "no" }]) {
      const res = await call("PUT", "/api/settings/permissions", bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.json.error.code).toBe("invalid-body");
    }
    expect(PermissionSettingsSchema.safeParse({ retentionDays: 0 }).success).toBe(true);
    // The message names the field, so the page can show it under the right input.
    expect((await call("PUT", "/api/settings/permissions", { retentionDays: 3 })).json.error.message).toMatch(/^Invalid settings: retentionDays: /);
  });

  it("effectiveGrants needs the agent grant AND the instance switch; budget is clamped", () => {
    const agent = { tools: ["read_notes", "web_fetch"] as const, tokenBudget: 500_000 };
    const settings = PermissionSettingsSchema.parse({ tools: { web_fetch: false, write_notes: false }, maxTokenBudget: 100_000 });
    expect(effectiveGrants({ tools: [...agent.tools] }, settings)).toEqual(["read_notes"]);
    expect(effectiveBudget(agent, settings)).toBe(100_000);
    expect(effectiveBudget({ tokenBudget: 5_000 }, settings)).toBe(5_000);
  });

  it("a run offers only the effective tools, logs them, and uses the clamped budget", async () => {
    putPermissions(PermissionSettingsSchema.parse({ tools: { write_notes: false }, maxTokenBudget: 1000 }));
    putAgent(AgentSchema.parse({ name: "a", systemPrompt: "x", tools: ["read_notes", "write_notes", "web_fetch"], tokenBudget: 50_000 }));
    let offered: string[] = [];
    let maxTokens = 0;
    const makeModel: ModelFactory = (tools, options) => {
      offered = tools.map((t) => t.name);
      maxTokens = options.maxTokens;
      return { invoke: async () => new AIMessage({ content: "done", usage_metadata: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }) };
    };
    setRunDeps({ makeModel });
    const run = startRun("a");
    await waitForRuns();
    expect(offered.sort()).toEqual(["list_notes", "read_note", "search_notes"]);
    expect(offered).not.toContain("write_note");
    expect(maxTokens).toBe(1000);
    expect(getRun(run.id)?.tokenBudget).toBe(1000);
    const prompt = listEvents(run.id).find((e) => e.kind === "prompt");
    expect(prompt?.data["tools"]).toEqual(expect.arrayContaining(["list_notes"]));
    expect(prompt?.data["tools"]).not.toContain("write_note");
  });

  it("a switch turned off later does not change a run already in progress", async () => {
    putAgent(AgentSchema.parse({ name: "a", systemPrompt: "x", tools: ["write_notes"] }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let offered: string[] = [];
    setRunDeps({
      makeModel: (tools) => {
        offered = tools.map((t) => t.name);
        return { invoke: async () => (await gate, new AIMessage({ content: "done" })) };
      },
    });
    startRun("a");
    putPermissions(PermissionSettingsSchema.parse({ tools: { write_notes: false } }));
    release();
    await waitForRuns();
    expect(offered).toEqual(["write_note"]);
  });

  it("newAgentsStrict sets the default for new and template agents only", async () => {
    await call("PUT", "/api/settings/permissions", { newAgentsStrict: false });
    expect((await call("POST", "/api/agents/from-template/inbox-triager", {})).json.data.strict).toBe(false);
    expect((await call("PUT", "/api/agents/fresh", { name: "fresh", systemPrompt: "x" })).json.data.strict).toBe(false);
    expect((await call("PUT", "/api/agents/pinned", { name: "pinned", systemPrompt: "x", strict: true })).json.data.strict).toBe(true);

    await call("PUT", "/api/settings/permissions", { newAgentsStrict: true });
    expect((await call("POST", "/api/agents/from-template/weekly-review", {})).json.data.strict).toBe(true);
    expect((await call("PUT", "/api/agents/fresh2", { name: "fresh2", systemPrompt: "x" })).json.data.strict).toBe(true);
    // Existing agents are unchanged, and re-saving without `strict` keeps their value.
    expect((await call("GET", "/api/agents/fresh")).json.data.strict).toBe(false);
    expect((await call("PUT", "/api/agents/fresh", { name: "fresh", systemPrompt: "y" })).json.data.strict).toBe(false);
    // The owner can switch approvals off for any agent, with no extra flag.
    expect((await call("PUT", "/api/agents/pinned", { name: "pinned", systemPrompt: "x", strict: false })).json.data.strict).toBe(false);
  });
});
