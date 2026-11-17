import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { buildTools } from "./agent-tools";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { learnerReport } from "./learner";
import { enroll, recordResult } from "./recall";
import { closeState } from "./state-db";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-learner-"));
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
  return { status: res.status, body: (await res.json()) as { data?: any } };
};
const note = (id: string, body: string) => j("PUT", `/api/notes/${id}`, { title: id, body });

describe("learner_status", () => {
  it("says so when nothing has been studied", () => {
    expect(learnerReport(new Date())).toContain("No cards or recall checks yet.");
  });

  it("lists notes with cards, exam dates and recall checks", async () => {
    await note("bio", "Q1? :: A1\nQ2? :: A2");
    await note("chem", "Q3? :: A3");
    await j("PUT", "/api/goals", { kind: "note", value: "bio", day: "2099-01-10" });
    const now = new Date();
    enroll("bio", now);
    recordResult("bio", "some", now);
    const text = learnerReport(now);
    expect(text).toContain("bio (bio): 2 cards, 0 due, 2 new");
    expect(text).toContain("chem (chem): 1 cards");
    expect(text).toContain("Exam dates:");
    expect(text).toContain("note bio: 2099-01-10");
    expect(text).toContain("bio (bio): rung 0, last some");
  });

  it("narrows every section to one note", async () => {
    await note("bio", "Q1? :: A1");
    await note("chem", "Q3? :: A3");
    const text = learnerReport(new Date(), "chem");
    expect(text).toContain("chem (chem)");
    expect(text).not.toContain("bio (bio)");
  });

  it("is a read-only tool that answers with error text for a bad id", async () => {
    const tool = buildTools(["read_notes"], { runId: "r", agentName: "a" }).find((t) => t.name === "learner_status");
    expect(tool).toBeDefined();
    expect(String(await tool?.invoke({ id: "../etc" }))).toMatch(/^error: /);
    expect(String(await tool?.invoke({}))).toContain("Today:");
  });

  it("is not offered without the read_notes grant", () => {
    expect(buildTools(["write_notes"], { runId: "r", agentName: "a" }).map((t) => t.name)).not.toContain("learner_status");
  });
});
