import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, type Agent, type Note, type Run } from "@vigil/shared";
import { COMBINED, MAX_TRACKED_NOTES, combinedSignature, diffHashes, heartbeatTask, visibleHashes } from "./heartbeat";
import { closeDb, reindexNote, removeNote } from "./index-db";
import { createScheduler } from "./scheduler";
import { closeState, getHeartbeat, getSchedule, listAgents, putAgent } from "./state-db";

let root = "";
const saved = { ...process.env };
let clock = new Date("2026-11-15T10:00:00Z");
let started: Array<{ name: string; task: string | undefined; trigger: string }> = [];
let running = new Set<string>();

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-beat-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  started = [];
  running = new Set();
  clock = new Date("2026-11-15T10:00:00Z");
  putAgent(beatAgent());
});
afterEach(async () => {
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

function beatAgent(over: Partial<Agent> = {}): Agent {
  return AgentSchema.parse({ name: "inbox", systemPrompt: "x", tools: ["read_notes"], trigger: { kind: "heartbeat", everyMinutes: 5 }, ...over });
}
const note = (id: string, body: string, extra: Partial<Note> = {}): Note => ({ id, title: id, body, tags: [], author: "human", updatedAt: "2026-11-15T09:00:00.000Z", ...extra });
const put = (id: string, body: string, extra: Partial<Note> = {}) => reindexNote(note(id, body, extra));
const advance = (minutes: number) => (clock = new Date(clock.getTime() + minutes * 60_000));

function make() {
  return createScheduler({
    now: () => clock,
    listAgents,
    startRun: (name, task, trigger) => {
      started.push({ name, task, trigger });
      return { id: "r" } as Run;
    },
    hasRunning: (name) => running.has(name),
    catchUpWindowMs: 86_400_000,
  });
}

describe("diffHashes", () => {
  it("lists added, changed and removed ids, sorted", () => {
    expect(diffHashes({ a: "1", b: "1", c: "1" }, { b: "2", c: "1", d: "1", e: "1" })).toEqual({ added: ["d", "e"], changed: ["b"], removed: ["a"] });
    expect(diffHashes({}, {})).toEqual({ added: [], changed: [], removed: [] });
  });
});

describe("visibleHashes", () => {
  it("leaves out notes this agent wrote, keeps those other agents wrote", () => {
    put("mine", "x", { author: "agent", agentName: "inbox" });
    put("theirs", "x", { author: "agent", agentName: "other" });
    put("human", "x");
    expect(Object.keys(visibleHashes("inbox")).sort()).toEqual(["human", "theirs"]);
  });
  it("collapses to one signature past the size guard, and the signature moves when a note changes", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i <= MAX_TRACKED_NOTES; i++) many[`n${i}`] = `h${i}`;
    const sig = combinedSignature(many);
    expect(Object.keys(sig)).toEqual([COMBINED]);
    expect(combinedSignature({ ...many, n1: "different" })[COMBINED]).not.toBe(sig[COMBINED]);
    expect(combinedSignature({ ...many })[COMBINED]).toBe(sig[COMBINED]);
    expect(heartbeatTask(diffHashes(sig, combinedSignature({ ...many, n1: "x" })))).toBe("Many notes changed since your last check. React according to your instructions.");
  });
});

describe("heartbeatTask", () => {
  it("names ids and caps each list at 50", () => {
    const ids = Array.from({ length: 53 }, (_, i) => `n${String(i).padStart(2, "0")}`);
    const task = heartbeatTask({ added: ids, changed: ["c1"], removed: [] });
    expect(task).toContain("Added: n00");
    expect(task).toContain("and 3 more.");
    expect(task).toContain("Changed: c1.");
    expect(task).not.toContain("Removed");
    expect(task).toContain("React according to your instructions.");
  });
});

describe("heartbeat in the scheduler", () => {
  it("stores a baseline on first sight and does not run", () => {
    put("old", "existing");
    const s = make();
    s.tick();
    expect(started).toEqual([]);
    expect(getHeartbeat("inbox")?.lastHashes).toHaveProperty("old");
  });

  it("unchanged: no run, skip reason 'unchanged'", () => {
    put("a", "one");
    const s = make();
    s.tick();
    advance(6);
    s.tick();
    expect(started).toEqual([]);
    expect(getSchedule("inbox")?.lastSkipReason).toBe("unchanged");
  });

  it("a human edit starts one run whose task names the note", () => {
    put("inbox-note", "v1");
    const s = make();
    s.tick();
    advance(6);
    put("inbox-note", "v2");
    s.tick();
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ name: "inbox", trigger: "heartbeat" });
    expect(started[0]?.task).toContain("Changed: inbox-note.");
    advance(6);
    s.tick();
    expect(started).toHaveLength(1); // the change was consumed
  });

  it("the agent's own write does not trigger it; another agent's write does", () => {
    put("seed", "x");
    const s = make();
    s.tick();
    advance(6);
    put("out", "written by inbox", { author: "agent", agentName: "inbox" });
    s.tick();
    expect(started).toEqual([]);
    advance(6);
    put("from-other", "written by other", { author: "agent", agentName: "other" });
    s.tick();
    expect(started).toHaveLength(1);
    expect(started[0]?.task).toContain("Added: from-other.");
  });

  it("two checks inside everyMinutes make one check only", () => {
    put("a", "1");
    const s = make();
    s.tick();
    advance(5);
    put("a", "2");
    s.tick(); // the 5-minute mark: runs
    put("a", "3");
    advance(2);
    s.tick(); // too soon: not even looked at
    expect(started).toHaveLength(1);
    advance(4);
    s.tick();
    expect(started).toHaveLength(2);
  });

  it("an overlap leaves the change pending and runs it on the next check after the run ended", () => {
    put("a", "1");
    const s = make();
    s.tick();
    advance(6);
    put("a", "2");
    running.add("inbox");
    s.tick();
    expect(started).toEqual([]);
    expect(getSchedule("inbox")?.lastSkipReason).toBe("previous run still going");
    running.delete("inbox");
    advance(6);
    s.tick();
    expect(started).toHaveLength(1);
    expect(started[0]?.task).toContain("Changed: a.");
  });

  it("a removed note shows up as removed", () => {
    put("gone", "x");
    put("stay", "y");
    const s = make();
    s.tick();
    advance(6);
    removeNote("gone");
    s.tick();
    expect(started[0]?.task).toContain("Removed: gone.");
  });

  it("writes the new hashes before starting, so a failing start cannot retry every check", () => {
    put("a", "1");
    let calls = 0;
    const s = createScheduler({
      now: () => clock,
      listAgents,
      startRun: () => {
        calls += 1;
        throw new Error("boom");
      },
      hasRunning: () => false,
      catchUpWindowMs: 86_400_000,
    });
    s.tick();
    advance(6);
    put("a", "2");
    s.tick();
    expect(getSchedule("inbox")?.lastSkipReason).toMatch(/start failed: boom/);
    advance(6);
    s.tick();
    expect(calls).toBe(1); // the failed change is not retried
    expect(getSchedule("inbox")?.lastSkipReason).toBe("unchanged");
  });

  it("a disabled heartbeat agent is never looked at, and refresh stores a baseline only", () => {
    putAgent(beatAgent({ enabled: false }));
    put("a", "1");
    const s = make();
    s.tick();
    expect(getHeartbeat("inbox")).toBeNull();
    putAgent(beatAgent({ enabled: true }));
    s.refresh("inbox");
    expect(started).toEqual([]);
    expect(getHeartbeat("inbox")?.lastHashes).toHaveProperty("a");
  });
});
