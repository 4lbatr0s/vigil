import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { closeState, createRun, recordSnapshot } from "./state-db";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-before-"));
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

const get = async (url: string) => {
  const res = await fetch(`${base}${url}`);
  return { status: res.status, body: (await res.json()) as { data?: { existed: boolean; body: string | null }; error?: { code: string } } };
};

describe("GET /api/runs/:id/before/:noteId", () => {
  it("returns the body a note had before the run wrote it, without frontmatter", async () => {
    createRun("run-1", "agent-a", 1000);
    await recordSnapshot("run-1", "plan", "---\ntitle: Plan\ntags: []\nauthor: human\n---\nOld line one\nOld line two\n");
    const res = await get("/api/runs/run-1/before/plan");
    expect(res.status).toBe(200);
    expect(res.body.data?.existed).toBe(true);
    expect(res.body.data?.body).toContain("Old line one");
    expect(res.body.data?.body).not.toContain("author:");
  });
  it("says the note did not exist when the run created it", async () => {
    createRun("run-2", "agent-a", 1000);
    await recordSnapshot("run-2", "fresh", null);
    expect((await get("/api/runs/run-2/before/fresh")).body.data).toEqual({ existed: false, body: null });
  });
  it("404 when the run never touched the note", async () => {
    createRun("run-3", "agent-a", 1000);
    expect((await get("/api/runs/run-3/before/nope")).status).toBe(404);
  });
});
