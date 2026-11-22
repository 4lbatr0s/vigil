import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, type Agent } from "@vigil/shared";
import { closeState, createChatThread, createRun, deleteChatThread, getAgent, getChatSummary, getRun, listRuns, putAgent, putChatSummary, MIGRATIONS, statePath } from "./state-db";

let root = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-state-db-"));
  process.env.STATE_DB_PATH = path.join(root, "state.db");
});

afterEach(async () => {
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

function agent(over: Partial<Agent> = {}): Agent {
  return AgentSchema.parse({
    name: "morning-digest",
    systemPrompt: "Write a digest of yesterday's notes.",
    tools: ["read_notes"],
    tokenBudget: 1000,
    ...over,
  });
}

/** Build a genuine M1-era state file: migration 1 only, one agent row, one runs row. */
function seedV1File(): void {
  const db = new Database(statePath());
  db.exec(MIGRATIONS[0]!);
  db.pragma("user_version = 1"); // what migration 1 left behind in a real M1-era file
  db.prepare("INSERT INTO agents (name, definition, updated_at) VALUES (?, ?, ?)").run(
    "old-agent",
    JSON.stringify(agent({ name: "old-agent", tools: [] })),
    new Date().toISOString(),
  );
  db.prepare("INSERT INTO runs (id, agent, status, started_at, token_budget) VALUES (?, ?, 'running', ?, 500)").run(
    "v1-run",
    "old-agent",
    new Date().toISOString(),
  );
  db.close();
}

describe("state-db migrations", () => {
  it("a database created by migration 1 only upgrades to version 3 and keeps its rows", () => {
    seedV1File();

    // The new code opens the same file, appends migrations 2 and 3, and the data survives.
    putAgent(agent({ name: "new-agent", tools: [] }));
    expect(getAgent("old-agent")!.name).toBe("old-agent");
    expect(getAgent("new-agent")!.name).toBe("new-agent");
    const runs = listRuns("old-agent");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.id).toBe("v1-run");
    expect(runs[0]!.trigger).toBe("manual");
    expect(runs[0]!.parentRunId).toBeNull();

    // Read the file version back through a separate connection, not the cached one.
    const check = new Database(statePath(), { readonly: true });
    try {
      expect(check.pragma("user_version", { simple: true })).toBe(MIGRATIONS.length);
    } finally {
      check.close();
    }
  });

  it("createRun stores trigger and parent and round-trips them", () => {
    createRun("r1", "digest", 100, "cron", "parent-1");
    expect(getRun("r1")).toMatchObject({ trigger: "cron", parentRunId: "parent-1" });

    createRun("r2", "digest", 100);
    expect(getRun("r2")).toMatchObject({ trigger: "manual", parentRunId: null });
  });
});

describe("chat summaries", () => {
  it("are kept in the state file, so a restart does not lose them", () => {
    createChatThread("t1", "morning-digest");
    expect(getChatSummary("t1")).toBeNull();
    putChatSummary("t1", { covered: 6, text: "The user is studying enthalpy." });
    closeState(); // the server stops and starts again
    expect(getChatSummary("t1")).toEqual({ covered: 6, text: "The user is studying enthalpy." });
  });

  it("a newer summary replaces the older one", () => {
    createChatThread("t2", "morning-digest");
    putChatSummary("t2", { covered: 4, text: "first" });
    putChatSummary("t2", { covered: 9, text: "second" });
    expect(getChatSummary("t2")).toEqual({ covered: 9, text: "second" });
  });

  it("go away with their chat", () => {
    createChatThread("t3", "morning-digest");
    putChatSummary("t3", { covered: 2, text: "gone soon" });
    deleteChatThread("t3");
    expect(getChatSummary("t3")).toBeNull();
  });
});
