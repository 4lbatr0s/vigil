import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { LADDER_DAYS, nextRung } from "./recall";
import { closeState } from "./state-db";

describe("recall ladder", () => {
  it("moves on with most, stays with some, steps back with little", () => {
    expect(LADDER_DAYS).toEqual([1, 3, 7, 21]);
    expect([nextRung(0, "most"), nextRung(3, "most")]).toEqual([1, 3]);
    expect([nextRung(2, "some"), nextRung(0, "some")]).toEqual([2, 0]);
    expect([nextRung(2, "little"), nextRung(0, "little")]).toEqual([1, 0]);
  });
});

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-recall-"));
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
  return { status: res.status, body: (await res.json()) as { data?: any; error?: { code: string } } };
};

describe("recall API", () => {
  it("enrols a note a day out, moves it on, and drops it", async () => {
    await j("PUT", "/api/notes/bio", { title: "Bio", body: "Cells divide." });
    const put = await j("PUT", "/api/recall/bio");
    expect(put.body.data).toMatchObject({ noteId: "bio", step: 0, lastResult: null });
    const dueAt = new Date(put.body.data.due).getTime();
    expect(dueAt - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect((await j("GET", "/api/recall")).body.data[0]).toMatchObject({ noteId: "bio", isDue: false });
    const after = await j("POST", "/api/recall/bio/result", { result: "most" });
    expect(after.body.data).toMatchObject({ step: 1, lastResult: "most" });
    expect(new Date(after.body.data.due).getTime() - Date.now()).toBeGreaterThan(2.9 * 86_400_000);
    await j("DELETE", "/api/recall/bio");
    expect((await j("GET", "/api/recall")).body.data).toEqual([]);
  });
  it("enrolling twice keeps the schedule", async () => {
    await j("PUT", "/api/notes/bio", { title: "Bio", body: "x" });
    const a = await j("PUT", "/api/recall/bio");
    await j("POST", "/api/recall/bio/result", { result: "most" });
    const b = await j("PUT", "/api/recall/bio");
    expect(b.body.data.step).toBe(1);
    expect(a.body.data.step).toBe(0);
  });
  it("rejects bad input", async () => {
    await j("PUT", "/api/notes/bio", { title: "Bio", body: "x" });
    expect((await j("PUT", "/api/recall/ghost")).status).toBe(404);
    expect((await j("POST", "/api/recall/bio/result", { result: "most" })).status).toBe(404);
    await j("PUT", "/api/recall/bio");
    expect((await j("POST", "/api/recall/bio/result", { result: "perfect" })).status).toBe(400);
  });
  it("the checker needs the agent, a note and a short recall", async () => {
    await j("PUT", "/api/notes/bio", { title: "Bio", body: "x" });
    expect((await j("POST", "/api/notes/bio/recall-check", { recall: "cells" })).body.error?.code).toBe("agent-not-found");
    expect((await j("POST", "/api/notes/ghost/recall-check", { recall: "cells" })).status).toBe(404);
    expect((await j("POST", "/api/notes/bio/recall-check", { recall: "x".repeat(6_001) })).status).toBe(400);
  });
});
