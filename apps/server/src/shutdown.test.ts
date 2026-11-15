import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, type Agent } from "@vigil/shared";
import type { ModelFactory } from "./llm";
import { setRunDeps, startRun, waitForRuns } from "./runs";
import { shutdown } from "./shutdown";
import { closeState, getRun, putAgent } from "./state-db";
import { closeDb } from "./index-db";

let root = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-shutdown-"));
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

const agent = (): Agent =>
  AgentSchema.parse({
    name: "shutdown-test",
    systemPrompt: "Do the thing.",
    tools: [],
    tokenBudget: 1000,
  });

/** A model that hangs on the gate until it is released, then answers with a plain final message. */
function gatedModel(gate: Promise<void>): ModelFactory {
  return () => ({
    invoke: async () => {
      await gate;
      return new AIMessage({ content: "done." });
    },
  });
}

describe("shutdown", () => {
  it("shutdown stops the server and waits for a running run", async () => {
    let serverClosed = false;
    let watcherClosed = false;
    const server = { close: async () => { serverClosed = true; } };
    const watcher = { close: async () => { watcherClosed = true; } };

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    putAgent(agent());
    setRunDeps({ makeModel: gatedModel(gate) });
    const run = startRun("shutdown-test");

    const stopping = shutdown({ server, watcher, timeoutMs: 10_000 });
    release();
    await stopping;

    expect(serverClosed).toBe(true);
    expect(watcherClosed).toBe(true);
    expect(getRun(run.id)?.status).toBe("succeeded");
  });

  it("shutdown gives up waiting after the timeout", async () => {
    let serverClosed = false;
    const server = { close: async () => { serverClosed = true; } };
    const watcher = { close: async () => undefined };

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    putAgent(agent());
    setRunDeps({ makeModel: gatedModel(gate) });
    const run = startRun("shutdown-test");

    await shutdown({ server, watcher, timeoutMs: 50 });

    expect(serverClosed).toBe(true);
    expect(getRun(run.id)?.status).toBe("running");

    // Let the run finish so the afterEach `waitForRuns` does not hang the suite.
    release();
    await waitForRuns();
  });
});
