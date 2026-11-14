import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb } from "./index-db";
import { start, type RunningServer } from "./server";

let vault = "";
let dbFile = "";
let running: RunningServer;
let base = "";

beforeAll(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "vigil-vault-"));
  dbFile = path.join(await mkdtemp(path.join(tmpdir(), "vigil-db-")), "index.db");
  process.env.VAULT_DIR = vault;
  process.env.DB_PATH = dbFile;
  running = start({ port: 0 });
  await new Promise<void>((resolve) => running.server.once("listening", () => resolve()));
  const address = running.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await running.close();
  closeDb();
  await rm(vault, { recursive: true, force: true });
  await rm(path.dirname(dbFile), { recursive: true, force: true });
});

type Json = {
  data?: unknown;
  error?: { code?: string; message?: string };
};

function ids(data: unknown): string[] {
  return (data as { id: string }[]).map((n) => n.id);
}

function errCode(json: Json): string | undefined {
  return json.error?.code;
}

async function req(method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("json api", () => {
  it("reports health", async () => {
    const res = await req("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({ ok: true });
  });

  it("creates a note with PUT and reads it back with GET", async () => {
    const put = await req("PUT", "/api/notes/hello", { title: "Hello", body: "# Hi\n\nAgents kept vigil." });
    expect(put.status).toBe(200);
    expect(put.json.data).toMatchObject({ id: "hello", title: "Hello", body: "# Hi\n\nAgents kept vigil." });

    const get = await req("GET", "/api/notes/hello");
    expect(get.status).toBe(200);
    expect((get.json.data as { id: string }).id).toBe("hello");
  });

  it("returns a 404 envelope for a missing note", async () => {
    const res = await req("GET", "/api/notes/missing");
    expect(res.status).toBe(404);
    expect(errCode(res.json)).toBe("note-not-found");
    expect(typeof res.json.error?.message).toBe("string");
  });

  it("rejects an id that does not match the title slug", async () => {
    const res = await req("PUT", "/api/notes/mismatched", { title: "Hello", body: "x" });
    expect(res.status).toBe(400);
    expect(errCode(res.json)).toBe("invalid-id");
  });

  it("lists notes", async () => {
    const res = await req("GET", "/api/notes");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.data)).toBe(true);
    expect(ids(res.json.data)).toContain("hello");
  });

  it("searches notes", async () => {
    const res = await req("GET", "/api/search?q=vigil");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.data)).toBe(true);
    expect(ids(res.json.data)).toContain("hello");
  });

  it("answers CORS preflight", async () => {
    const res = await fetch(`${base}/api/notes`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
