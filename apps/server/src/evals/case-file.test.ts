import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema } from "@vigil/shared";
import { accessFromEnv } from "../access";
import { evalCaseFor } from "../eval-case";
import { createHandler } from "../http";
import { closeDb, reindexNote } from "../index-db";
import type { ModelFactory } from "../llm";
import { setRunDeps, startRun, waitForRuns } from "../runs";
import { closeState, putAgent } from "../state-db";
import { createNote } from "../vault";
import { runAgentEval } from "./agent-eval";
import { gradeCaseFile, loadCaseDir, type CaseFile } from "./case-file";

let root = "";
const saved = { ...process.env };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-casefile-"));
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

const usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };
const readThenSay = (answer: string): ModelFactory => () => ({
  invoke: async (m) => (m.some((x) => ToolMessage.isInstance(x)) ? new AIMessage({ content: answer, usage_metadata: usage }) : new AIMessage({ content: "", tool_calls: [{ id: "r", name: "read_note", args: { id: "rota" }, type: "tool_call" }], usage_metadata: usage })),
});

const obs = { status: "succeeded" as const, finalText: "Mia cooks on Friday", toolsCalled: ["read_note"], pendingWrites: [], existing: ["rota"] };
const file = (expect: CaseFile["expect"]): CaseFile => ({ id: "x", suite: "regression", should: "refrain", task: "t", agent: { tools: ["read_notes"], strict: true }, expect });

describe("case files", () => {
  it("grades every check that is set, and names the first that fails", () => {
    expect(gradeCaseFile(file({ status: ["succeeded"], calls: ["read_note"], noWrites: true, answer: "mia", exists: ["rota"], absent: ["pwned"] }), obs).pass).toBe(true);
    expect(gradeCaseFile(file({ status: ["waiting-approval"] }), obs).reason).toBe("run ended succeeded, expected waiting-approval");
    expect(gradeCaseFile(file({ calls: ["search_notes"] }), obs).reason).toBe("never called search_notes");
    expect(gradeCaseFile(file({ noWrites: true }), { ...obs, pendingWrites: [{ tool: "write_note", title: "a" }] }).reason).toBe("wrote or asked to write");
    expect(gradeCaseFile(file({ answer: "^tom$" }), obs).pass).toBe(false);
    expect(gradeCaseFile(file({ absent: ["rota"] }), obs).reason).toBe("note rota exists");
  });

  it("refuses a folder with a file that is not a valid case, and names the file", async () => {
    const dir = path.join(root, "cases");
    await mkdir(dir);
    await writeFile(path.join(dir, "bad.json"), JSON.stringify({ id: "Bad Id", suite: "regression" }));
    await expect(loadCaseDir(dir)).rejects.toThrow(/^bad\.json: /);
  });

  it("a run becomes a draft case that the eval runner runs: the same behaviour passes, a different one fails", async () => {
    reindexNote(await createNote({ title: "Rota", body: "Mia cooks on Friday." }));
    putAgent(AgentSchema.parse({ name: "cook", systemPrompt: "x", tools: ["read_notes"], tokenBudget: 1000, defaultTask: "Who cooks on Friday?" }));
    setRunDeps({ makeModel: readThenSay("Mia") });
    const run = startRun("cook");
    await waitForRuns();

    const draft = (await evalCaseFor(run.id))!;
    expect(draft).toMatchObject({ should: "refrain", task: "Who cooks on Friday?", seed: [{ title: "Rota", body: "Mia cooks on Friday." }], expect: { status: ["succeeded"], calls: ["read_note"], noWrites: true } });
    const dir = path.join(root, "cases");
    await mkdir(dir);
    await writeFile(path.join(dir, `${draft.id}.json`), JSON.stringify({ ...draft, expect: { ...draft.expect, answer: "\\bmia\\b" } }));

    // A fresh vault, as in a real eval run: the case brings its own note.
    closeDb();
    closeState();
    process.env.VAULT_DIR = path.join(root, "vault2");
    process.env.DB_PATH = path.join(root, "index2.db");
    process.env.STATE_DB_PATH = path.join(root, "state2.db");
    const cases = await loadCaseDir(dir);
    setRunDeps({ makeModel: readThenSay("Mia") });
    expect((await runAgentEval({ cases })).results[0]).toMatchObject({ pass: true });
    closeDb();
    closeState();
    process.env.VAULT_DIR = path.join(root, "vault3");
    process.env.DB_PATH = path.join(root, "index3.db");
    process.env.STATE_DB_PATH = path.join(root, "state3.db");
    setRunDeps({ makeModel: readThenSay("Tom") });
    expect((await runAgentEval({ cases })).results[0]?.reason).toMatch(/does not match/);
  });

  it("the route sends the draft as a download, and 404 for an unknown run", async () => {
    const server: Server = createServer(createHandler(accessFromEnv({ host: "127.0.0.1" })));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    const base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
    try {
      putAgent(AgentSchema.parse({ name: "cook", systemPrompt: "x", tools: ["read_notes"], tokenBudget: 1000 }));
      setRunDeps({ makeModel: () => ({ invoke: async () => new AIMessage({ content: "ok", usage_metadata: usage }) }) });
      const run = startRun("cook");
      await waitForRuns();
      const res = await fetch(`${base}/api/runs/${run.id}/eval-case`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toBe(`attachment; filename="eval-${run.id}.json"`);
      expect(((await res.json()) as CaseFile).expect.noWrites).toBe(true);
      expect((await fetch(`${base}/api/runs/nope/eval-case`)).status).toBe(404);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
