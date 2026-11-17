import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { learnerReport } from "./learner";
import { MAX_OPEN_PER_NOTE, addMisconceptions, shakyBlock } from "./misconceptions";
import { closeState, listMisconceptions } from "./state-db";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-shaky-"));
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
const note = (id: string, body: string) => j("PUT", `/api/notes/${id}`, { title: id, body });
const T = new Date("2026-11-17T10:00:00.000Z");

describe("misconceptions", () => {
  it("adds, lists per note, skips a repeat and resolves", async () => {
    await note("bio", "Q? :: A");
    const first = await j("POST", "/api/misconceptions", { noteId: "bio", texts: ["Said ATP is stored in the nucleus", "said atp is stored in the  nucleus", "Mixed up DNA and RNA"] });
    expect(first.status).toBe(201);
    expect(first.body.data).toHaveLength(2);
    const open = (await j("GET", "/api/misconceptions?note=bio")).body.data as { id: string; text: string }[];
    expect(open.map((m) => m.text).sort()).toEqual(["Mixed up DNA and RNA", "Said ATP is stored in the nucleus"]);
    expect((await j("GET", "/api/misconceptions?note=other")).body.data).toEqual([]);
    expect((await j("POST", `/api/misconceptions/${open[0]?.id}/resolve`, {})).status).toBe(200);
    expect((await j("GET", "/api/misconceptions")).body.data).toHaveLength(1);
    expect((await j("POST", `/api/misconceptions/${open[0]?.id}/resolve`, {})).body.error?.code).toBe("misconception-not-found");
  });

  it("refuses a missing note, empty or long text", async () => {
    expect((await j("POST", "/api/misconceptions", { noteId: "nope", texts: ["something wrong"] })).status).toBe(404);
    await note("bio", "Q? :: A");
    expect((await j("POST", "/api/misconceptions", { noteId: "bio", texts: [] })).status).toBe(400);
    expect((await j("POST", "/api/misconceptions", { noteId: "bio", texts: ["x".repeat(301)] })).status).toBe(400);
  });

  it("keeps at most 20 open per note, newest kept", () => {
    for (let i = 0; i < MAX_OPEN_PER_NOTE + 3; i++) addMisconceptions("bio", [`mistake number ${i}`], new Date(T.getTime() + i * 1000));
    const open = listMisconceptions("bio");
    expect(open).toHaveLength(MAX_OPEN_PER_NOTE);
    expect(open[0]?.text).toBe(`mistake number ${MAX_OPEN_PER_NOTE + 2}`);
  });

  it("goes to the card maker as data between markers, and to learner_status", async () => {
    await note("bio", "Q? :: A");
    expect(shakyBlock("bio")).toBe("");
    addMisconceptions("bio", ["Said ATP is stored in the nucleus"], T);
    expect(shakyBlock("bio")).toBe("\n\nSHAKY START\n- Said ATP is stored in the nucleus\nSHAKY END");
    expect(learnerReport(T)).toContain("bio (bio): Said ATP is stored in the nucleus");
  });
});
