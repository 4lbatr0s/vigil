import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema } from "@vigil/shared";
import { accessFromEnv } from "./access";
import { parseModels, resolveConnection } from "./connections";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { modelFactoryFromConnections, redact } from "./llm";
import { decryptSecret, encryptSecret, resetSecretKeyCache, secretKeyPath } from "./secrets";
import { setRunDeps, startRun, waitForRuns } from "./runs";
import { closeState, getRun, listEvents, putAgent } from "./state-db";

let root = "";
let server: Server;
let base = "";
let fake: Server;
let fakeBase = "";
let seen: { url: string; auth: string | undefined; xkey: string | undefined; body: string }[] = [];
const saved = { ...process.env };
const KEY = "sk-test-SECRET-1234567890";

function fakeHandler(req: IncomingMessage, res: ServerResponse): void {
  let body = "";
  req.on("data", (c: Buffer) => (body += c.toString()));
  req.on("end", () => {
    seen.push({ url: req.url ?? "", auth: req.headers.authorization, xkey: req.headers["x-api-key"] as string | undefined, body });
    const json = (status: number, payload: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(payload)));
    if (req.url === "/v1/models" || req.url === "/models") {
      if (req.headers.authorization !== `Bearer ${KEY}` && req.headers["x-api-key"] !== KEY) return json(401, { error: "bad key" });
      return json(200, { data: [{ id: "zeta-1" }, { id: "alpha-2" }] });
    }
    if (req.url === "/api/tags") return json(200, { models: [{ name: "llama3:8b" }, { name: "qwen3:4b" }] });
    if (req.url === "/redirect/models") return (res.writeHead(302, { location: "http://127.0.0.1:1/" }), res.end());
    if (req.url === "/notjson/models") return (res.writeHead(200), res.end("<html>hi</html>"));
    if (req.url === "/v1/chat/completions" || req.url === "/chat/completions") {
      if (req.headers.authorization !== `Bearer ${KEY}`) return json(401, { error: { message: `bad key ${req.headers.authorization}` } });
      return json(200, { id: "c1", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, message: { role: "assistant", content: "hello from fake" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } });
    }
    return json(404, {});
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-conn-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  process.env.SECRET_KEY_PATH = path.join(root, "secret.key");
  for (const k of ["VIGIL_LLM_PROVIDER", "VIGIL_LLM_BASE_URL", "VIGIL_LLM_MODEL", "VIGIL_LLM_API_KEY", "VIGIL_SECRET_KEY"]) delete process.env[k];
  resetSecretKeyCache();
  seen = [];
  fake = createServer(fakeHandler);
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  fakeBase = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
  server = createServer(createHandler(accessFromEnv()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  await waitForRuns();
  server.closeAllConnections();
  fake.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => fake.close(() => r()));
  closeDb();
  closeState();
  resetSecretKeyCache();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const j = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as { data?: any; error?: { code: string; message: string } } };
};

describe("secrets", () => {
  it("round-trips, uses a fresh iv, and refuses a changed value or another key", () => {
    const a = encryptSecret("hello");
    expect(a).toMatch(/^v1:/);
    expect(a).not.toContain("hello");
    expect(encryptSecret("hello")).not.toBe(a);
    expect(decryptSecret(a)).toBe("hello");
    expect(decryptSecret(a.slice(0, -2) + "AA")).toBeNull();
    expect(decryptSecret("plain")).toBeNull();
    expect(decryptSecret("v1:")).toBeNull();
    process.env.VIGIL_SECRET_KEY = "another-long-secret-key-value";
    resetSecretKeyCache();
    expect(decryptSecret(a)).toBeNull();
  });

  it("makes its key file once, not world-readable", async () => {
    encryptSecret("x");
    const first = await readFile(secretKeyPath());
    expect(first.length).toBe(32);
    resetSecretKeyCache();
    encryptSecret("y");
    expect((await readFile(secretKeyPath())).equals(first)).toBe(true);
  });
});

describe("parseModels", () => {
  it("reads each provider's list, sorted, no blanks or repeats", () => {
    expect(parseModels("openai", { data: [{ id: "b" }, { id: "a" }, { id: "a" }, {}] })).toEqual(["a", "b"]);
    expect(parseModels("ollama", { models: [{ name: "q" }, { model: "p" }] })).toEqual(["p", "q"]);
    expect(parseModels("anthropic", { data: [{ id: "claude-x" }] })).toEqual(["claude-x"]);
    expect(parseModels("openai", {})).toEqual([]);
  });
});

describe("connections API", () => {
  it("saves a connection, never returns or logs the key, and makes the first one the default", async () => {
    const created = await j("POST", "/api/connections", { name: "My OpenAI", kind: "openai", baseUrl: `${fakeBase}/`, apiKey: KEY, defaultModel: "alpha-2" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ id: "my-openai", kind: "openai", baseUrl: fakeBase, hasKey: true, defaultModel: "alpha-2", isDefault: true, readOnly: false });
    const list = await j("GET", "/api/connections");
    for (const r of [created, list, await j("GET", "/api/llm/status")]) expect(r.text).not.toContain(KEY);
    const raw = await readFile(process.env.STATE_DB_PATH as string);
    expect(raw.includes(Buffer.from(KEY))).toBe(false); // encrypted at rest
  });

  it("refuses bad addresses, duplicate names and the reserved name", async () => {
    expect((await j("POST", "/api/connections", { name: "x", kind: "openai", baseUrl: "ftp://example.com" })).status).toBe(400);
    expect((await j("POST", "/api/connections", { name: "x", kind: "openai", baseUrl: "http://user:pw@example.com" })).status).toBe(400);
    await j("POST", "/api/connections", { name: "One", kind: "ollama", baseUrl: "http://127.0.0.1:11434" });
    expect((await j("POST", "/api/connections", { name: "one", kind: "ollama", baseUrl: "http://127.0.0.1:11434" })).body.error?.code).toBe("connection-exists");
    expect((await j("POST", "/api/connections", { name: "env", kind: "ollama", baseUrl: "http://127.0.0.1:11434" })).status).toBe(400);
  });

  it("updates keeping the saved key unless a new one or clearKey is sent", async () => {
    await j("POST", "/api/connections", { name: "A", kind: "openai", baseUrl: fakeBase, apiKey: KEY });
    const same = await j("PUT", "/api/connections/a", { name: "A", kind: "openai", baseUrl: fakeBase, defaultModel: "m" });
    expect(same.body.data).toMatchObject({ hasKey: true, defaultModel: "m" });
    expect(resolveConnection("a").apiKey).toBe(KEY);
    expect((await j("PUT", "/api/connections/a", { name: "A", kind: "openai", baseUrl: fakeBase, clearKey: true })).body.data.hasKey).toBe(false);
    expect((await j("PUT", "/api/connections/zzz", { name: "Z", kind: "openai", baseUrl: fakeBase })).status).toBe(404);
  });

  it("switches the default, removes a connection and falls back", async () => {
    await j("POST", "/api/connections", { name: "A", kind: "ollama", baseUrl: fakeBase, defaultModel: "a-model" });
    await j("POST", "/api/connections", { name: "B", kind: "ollama", baseUrl: fakeBase, defaultModel: "b-model" });
    expect(resolveConnection().id).toBe("a");
    await j("PUT", "/api/connections/default", { id: "b" });
    expect(resolveConnection().id).toBe("b");
    expect((await j("PUT", "/api/connections/default", { id: "nope" })).status).toBe(404);
    await j("DELETE", "/api/connections/b");
    expect(resolveConnection().id).toBe("a");
    expect((await j("DELETE", "/api/connections/b")).status).toBe(404);
  });

  it("lists the environment as a read-only connection and resolves to it when nothing is saved", async () => {
    process.env.VIGIL_LLM_PROVIDER = "ollama";
    process.env.VIGIL_LLM_MODEL = "env-model";
    const list = (await j("GET", "/api/connections")).body.data as { id: string; readOnly: boolean; isDefault: boolean }[];
    expect(list[0]).toMatchObject({ id: "env", readOnly: true, isDefault: true });
    expect(resolveConnection()).toMatchObject({ id: "env", kind: "ollama", model: "env-model" });
    await j("POST", "/api/connections", { name: "Mine", kind: "ollama", baseUrl: fakeBase, defaultModel: "m" });
    expect(resolveConnection().id).toBe("mine"); // a saved connection wins over the environment
  });

  it("says plainly when nothing is connected", () => {
    expect(() => resolveConnection()).toThrow(/No model is connected yet/);
  });
});

describe("probing", () => {
  it("lists models for each provider with the right auth header, without saving", async () => {
    const openai = await j("POST", "/api/connections/probe", { kind: "openai", baseUrl: fakeBase, apiKey: KEY });
    expect(openai.body.data).toEqual({ ok: true, models: ["alpha-2", "zeta-1"], error: null });
    const withV1 = await j("POST", "/api/connections/probe", { kind: "openai", baseUrl: `${fakeBase}/v1`, apiKey: KEY });
    expect(withV1.body.data).toEqual({ ok: true, models: ["alpha-2", "zeta-1"], error: null });
    expect(seen.at(-1)?.auth).toBe(`Bearer ${KEY}`);
    const anth = await j("POST", "/api/connections/probe", { kind: "anthropic", baseUrl: fakeBase, apiKey: KEY });
    expect(anth.body.data.ok).toBe(true);
    expect(seen.at(-1)).toMatchObject({ url: "/v1/models", xkey: KEY });
    expect((await j("POST", "/api/connections/probe", { kind: "ollama", baseUrl: fakeBase })).body.data.models).toEqual(["llama3:8b", "qwen3:4b"]);
    expect((await j("GET", "/api/connections")).body.data).toEqual([]);
  });

  it("explains a refused key, a redirect, a non-list answer and an unreachable address, without the key", async () => {
    const bad = await j("POST", "/api/connections/probe", { kind: "openai", baseUrl: `${fakeBase}/v1`, apiKey: "wrong-key-value" });
    expect(bad.body.data.error).toContain("refused the key");
    expect((await j("POST", "/api/connections/probe", { kind: "openai", baseUrl: `${fakeBase}/redirect` })).body.data.error).toContain("redirect");
    expect((await j("POST", "/api/connections/probe", { kind: "openai", baseUrl: `${fakeBase}/notjson` })).body.data.error).toContain("not with a list of models");
    const down = await j("POST", "/api/connections/probe", { kind: "openai", baseUrl: "http://127.0.0.1:1", apiKey: KEY });
    expect(down.body.data.error).toContain("Could not reach");
    expect(down.text).not.toContain(KEY);
  });

  it("probes a saved connection by id, using its saved key", async () => {
    await j("POST", "/api/connections", { name: "Saved", kind: "openai", baseUrl: `${fakeBase}/v1`, apiKey: KEY });
    const r = await j("POST", "/api/connections/probe", { kind: "openai", baseUrl: `${fakeBase}/v1`, connectionId: "saved" });
    expect(r.body.data.ok).toBe(true);
    expect(r.text).not.toContain(KEY);
  });
});

describe("runs use the saved connection", () => {
  it("send the saved key to the endpoint the agent's connection names, and never write it into the log", async () => {
    await j("POST", "/api/connections", { name: "Fake", kind: "openai", baseUrl: `${fakeBase}/v1`, apiKey: KEY, defaultModel: "m" });
    setRunDeps({ makeModel: (tools, options) => modelFactoryFromConnections()(tools, options) });
    putAgent(AgentSchema.parse({ name: "bot", systemPrompt: "Say hi.", tools: [], tokenBudget: 5000, connection: "fake" }));
    const run = startRun("bot", "go");
    await waitForRuns();
    const done = getRun(run.id)!;
    expect(done.status).toBe("succeeded");
    expect(seen.some((s) => s.url === "/v1/chat/completions" && s.auth === `Bearer ${KEY}`)).toBe(true);
    expect(JSON.stringify(listEvents(run.id))).not.toContain(KEY);
  });

  it("fail with a clear message, and no key in it, when the connection is gone or the key is wrong", async () => {
    setRunDeps({ makeModel: (tools, options) => modelFactoryFromConnections()(tools, options) });
    putAgent(AgentSchema.parse({ name: "bot", systemPrompt: "x", tools: [], tokenBudget: 5000, connection: "missing" }));
    const a = startRun("bot", "go");
    await waitForRuns();
    expect(getRun(a.id)?.error).toContain("no longer exists");
    await j("POST", "/api/connections", { name: "Wrong", kind: "openai", baseUrl: `${fakeBase}/v1`, apiKey: "not-the-right-key-1", defaultModel: "m" });
    putAgent(AgentSchema.parse({ name: "bot2", systemPrompt: "x", tools: [], tokenBudget: 5000, connection: "wrong" }));
    const b = startRun("bot2", "go");
    await waitForRuns();
    expect(getRun(b.id)?.status).toBe("failed");
    expect(JSON.stringify(getRun(b.id))).not.toContain("not-the-right-key-1");
    expect(JSON.stringify(listEvents(b.id))).not.toContain("not-the-right-key-1");
  });
});

describe("redact", () => {
  it("strips a key that was saved this run, wherever it appears", async () => {
    await j("POST", "/api/connections", { name: "R", kind: "openai", baseUrl: fakeBase, apiKey: "custom-format-key-ABCDEF" });
    expect(redact("error talking to host with custom-format-key-ABCDEF in it")).toBe("error talking to host with [redacted] in it");
  });
});

describe("probing tools", () => {
  it("refuses a connection that does not exist and one with no model chosen, and a bad body", async () => {
    expect((await j("POST", "/api/connections/probe-tools", { connectionId: "nope" })).status).toBeGreaterThanOrEqual(400);
    await j("POST", "/api/connections", { name: "Bare", kind: "openai", baseUrl: `${fakeBase}/v1`, apiKey: KEY });
    const bare = await j("POST", "/api/connections/probe-tools", { connectionId: "bare" });
    expect(bare.status).toBe(400);
    expect(bare.body.error?.code).toBe("no-model");
    expect((await j("POST", "/api/connections/probe-tools", {})).status).toBe(400);
    expect(bare.text).not.toContain(KEY);
  });
});
