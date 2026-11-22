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

  it("lists summaries without bodies, and full notes by default", async () => {
    const full = await req("GET", "/api/notes");
    const summary = await req("GET", "/api/notes?fields=summary");
    expect(summary.status).toBe(200);
    expect(ids(summary.json.data)).toEqual(ids(full.json.data));
    const first = (summary.json.data as Array<Record<string, unknown>>)[0] ?? {};
    expect(first).toMatchObject({ id: expect.any(String), title: expect.any(String), author: expect.any(String), updatedAt: expect.any(String) });
    expect(Array.isArray(first["tags"])).toBe(true);
    expect("body" in first).toBe(false);
    expect("body" in ((full.json.data as Array<Record<string, unknown>>)[0] ?? {})).toBe(true);
    expect(errCode((await req("GET", "/api/notes?fields=everything")).json)).toBe("invalid-query");
  });

  it("lists backlinks, including to a note that does not exist yet", async () => {
    await req("PUT", "/api/notes/bl-a", { title: "BL A", body: "intro\nSee [[Future note]] and more." });
    await req("PUT", "/api/notes/bl-b", { title: "BL B", body: "Also [text](future-note) here." });
    await req("PUT", "/api/notes/bl-c", { title: "BL C", body: "No links at all." });
    const res = await req("GET", "/api/notes/future-note/backlinks");
    expect(res.status).toBe(200);
    const rows = res.json.data as Array<{ id: string; title: string; snippet: string }>;
    expect(rows.map((r) => r.id).sort()).toEqual(["bl-a", "bl-b"]);
    expect(rows.find((r) => r.id === "bl-a")).toEqual({ id: "bl-a", title: "BL A", snippet: "See [[Future note]] and more." });
    expect(rows.find((r) => r.id === "bl-b")?.snippet).toBe("Also [text](future-note) here.");
    expect((await req("GET", "/api/notes/bl-c/backlinks")).json.data).toEqual([]);
    expect(errCode((await req("GET", "/api/notes/..%2Fx/backlinks")).json)).toBeDefined();
  });

  it("lists a note's links: outgoing (with ghosts), backlinks and unlinked mentions", async () => {
    await req("PUT", "/api/notes/ln-a", { title: "LN A", body: "See [[LN B]] and [[Not written]]." });
    await req("PUT", "/api/notes/ln-b", { title: "LN B", body: "Back to [[LN A]]." });
    await req("PUT", "/api/notes/ln-c", { title: "LN C", body: "A line about ln a without a link." });
    const res = await req("GET", "/api/notes/ln-a/links");
    expect(res.status).toBe(200);
    const d = res.json.data as { outgoing: { id: string; ghost: boolean }[]; backlinks: { id: string }[]; mentions: { id: string; snippet: string }[] };
    expect(d.outgoing.map((o) => [o.id, o.ghost])).toEqual([["ln-b", false], ["not-written", true]]);
    expect(d.backlinks.map((b) => b.id)).toEqual(["ln-b"]);
    expect(d.mentions).toEqual([{ id: "ln-c", title: "LN C", snippet: "A line about ln a without a link." }]);
  });

  it("serves the local graph with ?focus and ?hops, and an empty one for an unknown note", async () => {
    await req("PUT", "/api/notes/lg-a", { title: "LG A", body: "[[LG B]]" });
    await req("PUT", "/api/notes/lg-b", { title: "LG B", body: "[[LG C]]" });
    await req("PUT", "/api/notes/lg-c", { title: "LG C", body: "end" });
    const one = (await req("GET", "/api/graph?focus=lg-a&hops=1")).json.data as { nodes: { id: string }[] };
    expect(one.nodes.map((n) => n.id).sort()).toEqual(["lg-a", "lg-b"]);
    const two = (await req("GET", "/api/graph?focus=lg-a&hops=2")).json.data as { nodes: { id: string }[] };
    expect(two.nodes.map((n) => n.id).sort()).toEqual(["lg-a", "lg-b", "lg-c"]);
    expect((await req("GET", "/api/graph?focus=nothing-here")).json.data).toEqual({ nodes: [], edges: [], truncated: false });
  });

  it("caps a long backlink snippet at 160 characters", async () => {
    await req("PUT", "/api/notes/bl-long", { title: "BL Long", body: `[[Cap target]] ${"x".repeat(400)}` });
    const rows = (await req("GET", "/api/notes/cap-target/backlinks")).json.data as Array<{ snippet: string }>;
    expect(rows[0]?.snippet.length).toBe(160);
    expect(rows[0]?.snippet.endsWith("…")).toBe(true);
  });

  it("renames a note over the API: dry run first, then the real thing", async () => {
    await req("PUT", "/api/notes/rn-old", { title: "RN Old", body: "x" });
    await req("PUT", "/api/notes/rn-user", { title: "RN User", body: "points at [[RN Old]]" });
    const dry = await req("POST", "/api/notes/rn-old/rename?dryRun=1", { title: "RN Fresh" });
    expect(dry.status).toBe(200);
    expect(dry.json.data).toEqual({ newId: "rn-fresh", notesToChange: ["rn-user"], titles: ["RN User"] });
    expect((await req("GET", "/api/notes/rn-old")).status).toBe(200); // nothing moved
    const real = await req("POST", "/api/notes/rn-old/rename", { title: "RN Fresh" });
    expect(real.status).toBe(200);
    expect(real.json.data).toMatchObject({ id: "rn-fresh", title: "RN Fresh" });
    expect((await req("GET", "/api/notes/rn-old")).status).toBe(404);
    expect((await req("GET", "/api/notes/rn-user")).json.data).toMatchObject({ body: "points at [[RN Fresh]]" });
    expect(errCode((await req("POST", "/api/notes/rn-user/rename", { title: "RN Fresh" })).json)).toBe("note-exists");
    expect(errCode((await req("POST", "/api/notes/rn-user/rename", {})).json)).toBe("invalid-body");
    expect(errCode((await req("POST", "/api/notes/nope/rename", { title: "Z" })).json)).toBe("note-not-found");
  });

  it("searches notes", async () => {
    const res = await req("GET", "/api/search?q=vigil");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.json.data)).toBe(true);
    expect(ids(res.json.data)).toContain("hello");
  });

  it("answers 409 when the note changed since the client read it", async () => {
    const put = await req("PUT", "/api/notes/conflict", { title: "Conflict", body: "one" });
    const seen = (put.json.data as { updatedAt: string }).updatedAt;
    const stale = await req("PUT", "/api/notes/conflict", { title: "Conflict", body: "two", baseUpdatedAt: "1999-01-01T00:00:00.000Z" });
    expect(stale.status).toBe(409);
    expect(errCode(stale.json)).toBe("note-conflict");
    const fresh = await req("PUT", "/api/notes/conflict", { title: "Conflict", body: "two", baseUpdatedAt: seen });
    expect(fresh.status).toBe(200);
  });

  it("stores tags", async () => {
    const put = await req("PUT", "/api/notes/with-tags", { title: "With Tags", body: "x", tags: ["a"] });
    expect(put.json.data).toMatchObject({ tags: ["a"], author: "human" });
    const get = await req("GET", "/api/notes/with-tags");
    expect(get.json.data).toMatchObject({ tags: ["a"] });
  });

  it("deletes a note and answers 404 for a missing one", async () => {
    await req("PUT", "/api/notes/doomed", { title: "Doomed", body: "x" });
    const del = await req("DELETE", "/api/notes/doomed");
    expect(del.status).toBe(200);
    expect((await req("GET", "/api/notes/doomed")).status).toBe(404);
    expect(ids((await req("GET", "/api/notes")).json.data)).not.toContain("doomed");
    const again = await req("DELETE", "/api/notes/doomed");
    expect(again.status).toBe(404);
    expect(errCode(again.json)).toBe("note-not-found");
  });

  it("sends no CORS headers and rejects a preflight", async () => {
    const res = await fetch(`${base}/api/notes`, { method: "OPTIONS" });
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
