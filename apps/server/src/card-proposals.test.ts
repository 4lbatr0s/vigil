import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, TEMPLATES, extractCards } from "@vigil/shared";
import { accessFromEnv } from "./access";
import { closeCheckpoints } from "./checkpoints";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { setRunDeps, waitForRuns } from "./runs";
import { closeState, putAgent } from "./state-db";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-cardmaker-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  server = createServer(createHandler(accessFromEnv()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterEach(async () => {
  await waitForRuns();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  closeDb();
  closeCheckpoints();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const j = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as { data?: any; error?: { code: string } } };
};
const template = TEMPLATES.find((t) => t.id === "card-maker")!;
const addAgent = (over: Record<string, unknown> = {}) => putAgent(AgentSchema.parse({ ...template.agent, name: "card-maker", ...over }));

describe("card proposals", () => {
  it("the template is read-only, manual and cannot write notes", () => {
    expect(template.agent.tools).toEqual(["read_notes"]);
    expect(template.agent.trigger).toEqual({ kind: "manual" });
    expect(template.agent.systemPrompt).toMatch(/ONLY facts stated in that note/);
  });

  it("needs a real note and an enabled card maker, and says what to do", async () => {
    await j("PUT", "/api/notes/bio", { title: "Bio", body: "x" });
    expect((await j("POST", "/api/notes/nope/card-proposals")).status).toBe(404);
    const missing = await j("POST", "/api/notes/bio/card-proposals");
    expect(missing).toMatchObject({ status: 404, body: { error: { code: "agent-not-found" } } });
    addAgent({ enabled: false });
    expect((await j("POST", "/api/notes/bio/card-proposals")).body.error?.code).toBe("agent-disabled");
  });

  it("runs the card maker on the note, keeps its whole answer, and the answer parses into cards", async () => {
    await j("PUT", "/api/notes/bio", { title: "Bio", body: "ATP is energy. The nucleus holds DNA." });
    addAgent();
    const answer = ["What is ATP? :: The cell's energy currency", "The {{nucleus}} holds DNA.", ...Array.from({ length: 40 }, (_, i) => `Filler question ${i}? :: Filler answer ${i}`)].join("\n");
    let task = "";
    setRunDeps({
      makeModel: () => ({
        invoke: async (messages) => {
          task = messages.map((m) => String(m.content)).join("\n");
          return new AIMessage({ content: answer, usage_metadata: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
        },
      }),
    });
    const started = await j("POST", "/api/notes/bio/card-proposals");
    expect(started.status).toBe(202);
    await waitForRuns();
    expect(task).toContain("the note with id bio");
    const result = await j("GET", `/api/runs/${started.body.data.id}/result`);
    expect(result.body.data.text).toBe(answer); // far over the 1000 characters a run event keeps
    expect(answer.length).toBeGreaterThan(1000);
    const cards = extractCards(result.body.data.text as string);
    expect(cards).toHaveLength(42);
    expect(cards[0]).toMatchObject({ kind: "qa", front: "What is ATP?" });
    expect(cards[1]).toMatchObject({ kind: "cloze", front: "The […] holds DNA." });
    expect((await j("GET", "/api/runs/nope/result")).status).toBe(404);
  });
});
