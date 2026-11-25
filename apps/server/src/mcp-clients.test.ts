import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { closeState, listEvents, listRuns } from "./state-db";
import { createMcpClient, listMcpClients } from "./mcp-clients";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };
const GLOBAL = "global-token-for-tests";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-mcp-clients-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  server = createServer(createHandler(accessFromEnv({ host: "127.0.0.1", token: GLOBAL })));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const j = async (method: string, url: string, token: string | null, body?: unknown) => {
  const res = await fetch(`${base}${url}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
};
const rpc = (token: string | null, method: string, params?: unknown) => j("POST", "/api/mcp", token, { jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) });
const writeCall = (token: string | null, title: string) => rpc(token, "tools/call", { name: "write_note", arguments: { title, body: "text" } });

describe("MCP client tokens", () => {
  it("creates a client, shows the token once, and stores only a hash", async () => {
    const made = await j("POST", "/api/mcp/clients", GLOBAL, { name: "claude-desktop" });
    expect(made.status).toBe(201);
    const token = made.body.data.token as string;
    expect(token).toMatch(/^vgl_[A-Za-z0-9_-]{40,}$/);
    const list = await j("GET", "/api/mcp/clients", GLOBAL);
    expect(list.body.data).toEqual([expect.objectContaining({ name: "claude-desktop", lastUsedAt: null })]);
    expect(list.text).not.toContain(token);
    expect((await readFile(process.env.STATE_DB_PATH as string)).includes(Buffer.from(token))).toBe(false);
  });

  it("a client token works on /api/mcp and nowhere else", async () => {
    await j("PUT", "/api/mcp/settings", GLOBAL, { enabled: true, write: true });
    const token = (await j("POST", "/api/mcp/clients", GLOBAL, { name: "script" })).body.data.token as string;
    expect((await rpc(token, "ping")).status).toBe(200);
    expect((await j("GET", "/api/notes", token)).status).toBe(401);
    expect((await j("GET", "/api/mcp/clients", token)).status).toBe(401);
    expect((await j("PUT", "/api/mcp/settings", token, { enabled: false, write: false })).status).toBe(401);
    expect((await rpc("vgl_wrong", "ping")).status).toBe(401);
    expect((await rpc(null, "ping")).status).toBe(401);
  });

  it("names the client in the run log of a write, and records when it was last used", async () => {
    await j("PUT", "/api/mcp/settings", GLOBAL, { enabled: true, write: true });
    const token = (await j("POST", "/api/mcp/clients", GLOBAL, { name: "claude-desktop" })).body.data.token as string;
    await writeCall(token, "From client");
    await writeCall(GLOBAL, "From owner token");
    const runs = listRuns("mcp", 10);
    expect(runs).toHaveLength(2);
    const lines = runs.map((r) => listEvents(r.id).map((e) => e.text).join("|"));
    expect(lines.filter((l) => l.includes('written by MCP client "claude-desktop"'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes("MCP client"))).toHaveLength(1);
    expect(listMcpClients()[0]?.lastUsedAt).not.toBeNull();
  });

  it("revoking stops the token at once, and a duplicate or bad name is refused", async () => {
    await j("PUT", "/api/mcp/settings", GLOBAL, { enabled: true, write: false });
    const made = (await j("POST", "/api/mcp/clients", GLOBAL, { name: "script" })).body.data;
    expect((await rpc(made.token, "ping")).status).toBe(200);
    expect((await j("DELETE", `/api/mcp/clients/${made.id}`, GLOBAL)).status).toBe(200);
    expect((await rpc(made.token, "ping")).status).toBe(401);
    expect((await j("DELETE", `/api/mcp/clients/${made.id}`, GLOBAL)).status).toBe(404);
    await j("POST", "/api/mcp/clients", GLOBAL, { name: "again" });
    expect((await j("POST", "/api/mcp/clients", GLOBAL, { name: "again" })).body.error.code).toBe("mcp-client-exists");
    expect((await j("POST", "/api/mcp/clients", GLOBAL, { name: "  " })).status).toBe(400);
  });

  it("createMcpClient never returns the same token twice", () => {
    const a = createMcpClient("a");
    const b = createMcpClient("b");
    expect(a.token).not.toBe(b.token);
  });
});
