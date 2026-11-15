import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { AgentSchema, type Agent } from "@vigil/shared";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb } from "./index-db";
import type { ModelFactory } from "./llm";
import { setRunDeps, startRun, waitForRuns } from "./runs";
import { closeState, getRun, listEvents, listSnapshots, putAgent, snapshotsDir } from "./state-db";

// Keep every real vault export; only `createNote` fails, so the write tool reaches its drop path.
vi.mock("./vault", async (orig) => ({
  ...(await orig<typeof import("./vault")>()),
  createNote: vi.fn().mockRejectedValue(new Error("disk full")),
}));

let root = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-write-fail-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
});

afterEach(async () => {
  await waitForRuns();
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const usage = (total: number) => ({ input_tokens: Math.floor(total / 2), output_tokens: total - Math.floor(total / 2), total_tokens: total });

function call(name: string, args: Record<string, unknown>, total = 20, id = `c-${name}`): AIMessage {
  return new AIMessage({ content: "", tool_calls: [{ id, name, args, type: "tool_call" }], usage_metadata: usage(total) });
}
function say(text: string, total = 20): AIMessage {
  return new AIMessage({ content: text, usage_metadata: usage(total) });
}

/** A model that plays a fixed script, same shape as in agents.test.ts. */
function scripted(script: AIMessage[]): { make: ModelFactory } {
  let i = 0;
  const make: ModelFactory = () => ({
    invoke: async () => {
      const step = script[Math.min(i++, script.length - 1)];
      if (!step) throw new Error("empty script");
      return step;
    },
  });
  return { make };
}

function agent(over: Partial<Agent> = {}): Agent {
  return AgentSchema.parse({
    name: "morning-digest",
    systemPrompt: "Write a digest of yesterday's notes.",
    tools: ["read_notes", "write_notes"],
    tokenBudget: 1000,
    ...over,
  });
}

async function run(a: Agent, make: ModelFactory) {
  putAgent(a);
  setRunDeps({ makeModel: make });
  const started = startRun(a.name);
  await waitForRuns();
  return getRun(started.id)!;
}

/** Files anywhere under `dir`; a missing directory counts as no files. */
async function snapshotFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const nested = await Promise.all(
    entries.map((entry) => (entry.isDirectory() ? snapshotFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)])),
  );
  return nested.flat();
}

describe("agent write failure", () => {
  it("drops the snapshot of a write that failed and still answers the model with error text", async () => {
    const { make } = scripted([call("write_note", { title: "Digest", body: "# Digest\n\nNot written." }), say("ok")]);
    const finished = await run(agent(), make);

    // The tool's error came back to the model as error text, so the run itself still succeeds.
    expect(finished.status).toBe("succeeded");
    expect(finished.error).toBeNull();

    // The write never happened, so undo must not touch this note: the snapshot row is gone.
    expect(listSnapshots(finished.id)).toEqual([]);

    // And no pre-write copy was left behind under the snapshots directory either.
    expect(await snapshotFiles(snapshotsDir())).toEqual([]);

    // The model saw the failure as a tool message starting with `error:`.
    const results = listEvents(finished.id).filter((e) => e.kind === "tool-result");
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toMatch(/^error:/);
  });
});
