/** Todo item 38 (ADR-0011 amendment): a strict agent may add to its own tagged notes without asking, when the owner allows it. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, type Agent } from "@vigil/shared";
import { closeCheckpoints } from "./checkpoints";
import { configVersion } from "./harness-config";
import { closeDb, reindexNote } from "./index-db";
import type { ModelFactory } from "./llm";
import { setRunDeps, startRun, waitForRuns } from "./runs";
import { approvalsForRun, closeState, getRun, listEvents, putAgent } from "./state-db";
import { createNote, getNote, readNoteFile } from "./vault";

let root = "";
const saved = { ...process.env };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-appends-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
});
afterEach(async () => {
  await waitForRuns();
  closeDb();
  closeCheckpoints();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const usage = { input_tokens: 5, output_tokens: 5, total_tokens: 10 };
type Call = { name: string; args: Record<string, unknown> };
const calls = (...list: Call[]) => new AIMessage({ content: "", tool_calls: list.map((c, i) => ({ id: `c${i}`, name: c.name, args: c.args, type: "tool_call" })), usage_metadata: usage });
const append = (title: string, text = "more"): Call => ({ name: "append_note", args: { title, text } });
const write = (title: string, body: string): Call => ({ name: "write_note", args: { title, body } });

function scripted(first: AIMessage): ModelFactory {
  let i = 0;
  return () => ({ invoke: async () => (i++ === 0 ? first : new AIMessage({ content: "done", usage_metadata: usage })) });
}

const journaler = (over: Partial<Agent> = {}): Agent =>
  AgentSchema.parse({ name: "journaler", systemPrompt: "x", tools: ["read_notes", "write_notes"], tokenBudget: 1000, strict: true, writeTags: ["journal"], autoApproveAppends: true, ...over });

async function go(a: Agent, first: AIMessage) {
  putAgent(a);
  setRunDeps({ makeModel: scripted(first) });
  const run = startRun(a.name);
  await waitForRuns();
  return getRun(run.id)!;
}

async function seed(title: string, body: string): Promise<void> {
  reindexNote(await createNote({ title, body }));
}

describe("adding to its own tagged notes without asking (item 38)", () => {
  it("an append to an existing note inside the scope runs at once, and the log says why", async () => {
    await seed("Day", "#journal start");
    const run = await go(journaler(), calls(append("Day")));
    expect(run.status).toBe("succeeded");
    expect(approvalsForRun(run.id)).toHaveLength(0);
    expect((await getNote("day")).body).toContain("more");
    expect(listEvents(run.id).some((e) => e.text.includes("added without asking") && e.text.includes("#journal"))).toBe(true);
  });

  it("everything else still waits: switch off, a note outside the scope, write_note, a new note, an agent with no scope", async () => {
    await seed("Day", "#journal start");
    await seed("Plan", "no tag");
    const cases: [Agent, AIMessage][] = [
      [journaler({ autoApproveAppends: false }), calls(append("Day"))],
      [journaler(), calls(append("Plan"))],
      [journaler(), calls(write("Day", "#journal replaced"))],
      [journaler(), calls(append("Fresh", "#journal new"))],
      [journaler({ writeTags: [] }), calls(append("Day"))],
    ];
    for (const [i, [a, first]] of cases.entries()) {
      const run = await go({ ...a, name: `journaler-${i}` }, first);
      expect(run.status).toBe("waiting-approval");
      expect(approvalsForRun(run.id)).toHaveLength(1);
    }
    expect((await getNote("day")).body).toBe("#journal start");
    expect((await getNote("plan")).body).toBe("no tag");
    expect(await readNoteFile("fresh")).toBeNull();
  });

  it("in a round that also holds a call that needs approval, the append waits too and nothing is written while it waits", async () => {
    await seed("Day", "#journal start");
    const run = await go(journaler(), calls(append("Day"), write("Other", "#journal x")));
    expect(run.status).toBe("waiting-approval");
    expect(approvalsForRun(run.id).map((a) => a.tool).sort()).toEqual(["append_note", "write_note"]);
    expect((await getNote("day")).body).toBe("#journal start");
  });

  it("the switch is part of the setup fingerprint only when it is on", () => {
    expect(configVersion(journaler({ autoApproveAppends: false }))).toBe(configVersion(journaler({ autoApproveAppends: undefined })));
    expect(configVersion(journaler())).not.toBe(configVersion(journaler({ autoApproveAppends: false })));
  });
});
