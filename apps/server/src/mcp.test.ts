import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { handleMcp, MAX_WRITES_PER_MINUTE } from "./mcp";
import { closeState } from "./state-db";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-mcp-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  server = createServer(createHandler(accessFromEnv()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const j = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as any };
};
const rpc = (method: string, params?: unknown, id: number | null = 1) => j("POST", "/api/mcp", { jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params === undefined ? {} : { params }) });
const call = (name: string, args: unknown) => rpc("tools/call", { name, arguments: args });
const on = (write = false) => j("PUT", "/api/mcp/settings", { enabled: true, write });

describe("MCP over HTTP", () => {
  it("is off until the owner switches it on", async () => {
    expect((await j("GET", "/api/mcp/settings")).body.data).toEqual({ enabled: false, write: false });
    const r = await rpc("initialize", { protocolVersion: "2025-06-18" });
    expect(r.status).toBe(403);
    expect(r.body.error.message).toContain("switched off");
  });

  it("will not let write stay on once MCP is off", async () => {
    const r = await j("PUT", "/api/mcp/settings", { enabled: false, write: true });
    expect(r.body.data).toEqual({ enabled: false, write: false });
  });

  it("answers initialize, ping and an unknown method", async () => {
    await on();
    const init = await rpc("initialize", { protocolVersion: "2025-03-26" });
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-03-26", serverInfo: { name: "vigil" } });
    expect((await rpc("initialize", { protocolVersion: "1999-01-01" })).body.result.protocolVersion).toBe("2025-06-18");
    expect((await rpc("ping")).body.result).toEqual({});
    expect((await rpc("nope")).body.error.code).toBe(-32601);
    const note = await rpc("notifications/initialized", undefined, null);
    expect(note.status).toBe(202);
  });

  it("lists only read tools until write is switched on", async () => {
    await on();
    const read = (await rpc("tools/list")).body.result.tools.map((t: { name: string }) => t.name);
    expect(read).toEqual(["search_notes", "read_note", "list_notes", "learner_status"]);
    await on(true);
    expect((await rpc("tools/list")).body.result.tools.map((t: { name: string }) => t.name)).toContain("write_note");
  });

  it("searches and reads notes", async () => {
    await on();
    await j("PUT", "/api/notes/entropy", { title: "entropy", body: "Entropy is disorder." });
    const found = await call("search_notes", { query: "disorder" });
    expect(found.body.result.content[0].text).toContain("entropy");
    expect(found.body.result.isError).toBe(false);
    const read = await call("read_note", { id: "entropy" });
    expect(read.body.result.content[0].text).toContain("Entropy is disorder.");
    const bad = await call("read_note", { id: "../etc/passwd" });
    expect(bad.body.result.isError).toBe(true);
  });

  it("refuses write_note while write is off", async () => {
    await on();
    const r = await call("write_note", { title: "x", body: "y" });
    expect(r.body.result.isError).toBe(true);
    expect((await j("GET", "/api/notes/x")).status).toBe(404);
  });

  it("writes a note as its own run that can be undone", async () => {
    await on(true);
    await j("PUT", "/api/notes/plan", { title: "plan", body: "my words" });
    const r = await call("write_note", { title: "plan", body: "replaced by an agent" });
    expect(r.body.result.isError).toBe(false);
    const note = (await j("GET", "/api/notes/plan")).body.data;
    expect(note.body).toContain("replaced by an agent");
    expect(note.author).toBe("agent");
    const runs = (await j("GET", "/api/runs")).body.data as { id: string; agent: string; trigger: string; status: string }[];
    const run = runs.find((x) => x.agent === "mcp");
    expect(run).toMatchObject({ trigger: "mcp", status: "succeeded" });
    expect((await j("POST", `/api/runs/${run?.id}/undo`, {})).status).toBe(200);
    expect((await j("GET", "/api/notes/plan")).body.data.body).toContain("my words");
  });

  it("limits how many writes it takes in a minute, and how long one may be", async () => {
    await on(true);
    const big = await call("write_note", { title: "big", body: "x".repeat(200_001) });
    expect(big.body.result.content[0].text).toMatch(/over 200000/);
    const settings = { enabled: true, write: true };
    const now = 1_000_000;
    for (let i = 0; i < MAX_WRITES_PER_MINUTE; i++) {
      await handleMcp({ jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "write_note", arguments: { title: `n${i}`, body: "b" } } }, settings, now);
    }
    const over = await handleMcp({ jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "write_note", arguments: { title: "late", body: "b" } } }, settings, now + 1000);
    expect((over.body as any).result.content[0].text).toContain("too many writes");
    const later = await handleMcp({ jsonrpc: "2.0", id: 100, method: "tools/call", params: { name: "write_note", arguments: { title: "later", body: "b" } } }, settings, now + 61_000);
    expect((later.body as any).result.isError).toBe(false);
  });

  it("handles a batch and rejects junk", async () => {
    await on();
    const batch = await j("POST", "/api/mcp", [{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]);
    expect(batch.body).toHaveLength(1);
    expect((await j("POST", "/api/mcp", [])).status).toBe(400);
    const res = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(res.status).toBe(400);
  });

  it("keeps the usual Host and Origin checks", async () => {
    await on();
    const res = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    expect(res.status).toBe(403);
  });
});
