/** Todo item 50: an agent's state note keeps its last versions, and the owner can go back to one. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema } from "@vigil/shared";
import { accessFromEnv } from "./access";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { closeState, deleteAgentState, getAgentState, listAgentStateHistory, putAgent, putAgentState, STATE_HISTORY_KEEP } from "./state-db";

let root = "";
const saved = { ...process.env };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-statehist-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  putAgent(AgentSchema.parse({ name: "keeper", systemPrompt: "x", tools: ["read_notes"], keepState: true }));
});
afterEach(async () => {
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

describe("state note history", () => {
  it("keeps the version a save replaced, newest first, only when the text changed, and at most the last few", () => {
    putAgentState("keeper", "v1");
    expect(listAgentStateHistory("keeper")).toEqual([]);
    putAgentState("keeper", "v2");
    putAgentState("keeper", "v2");
    expect(listAgentStateHistory("keeper").map((h) => h.text)).toEqual(["v1"]);
    for (let i = 3; i <= STATE_HISTORY_KEEP + 5; i++) putAgentState("keeper", `v${i}`);
    const texts = listAgentStateHistory("keeper").map((h) => h.text);
    expect(texts).toHaveLength(STATE_HISTORY_KEEP);
    expect(texts[0]).toBe(`v${STATE_HISTORY_KEEP + 4}`);
  });

  it("Clear note keeps the cleared text, so it can be brought back", () => {
    putAgentState("keeper", "keep me");
    deleteAgentState("keeper");
    expect(getAgentState("keeper")).toBeNull();
    expect(listAgentStateHistory("keeper").map((h) => h.text)).toEqual(["keep me"]);
  });

  it("the routes list the versions and put one back; the note it replaces goes into the history", async () => {
    const server: Server = createServer(createHandler(accessFromEnv({ host: "127.0.0.1" })));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    const base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
    const send = (method: string, url: string, body?: unknown) => fetch(`${base}${url}`, { method, headers: { "content-type": "application/json", origin: base }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    try {
      putAgentState("keeper", "good");
      putAgentState("keeper", "broken by a bad run");
      const list = (await (await send("GET", "/api/agents/keeper/state/history")).json()) as { data: { id: number; text: string }[] };
      expect(list.data.map((h) => h.text)).toEqual(["good"]);
      const back = await send("POST", "/api/agents/keeper/state/restore", { id: list.data[0]!.id });
      expect(back.status).toBe(200);
      expect(getAgentState("keeper")?.text).toBe("good");
      expect(listAgentStateHistory("keeper").map((h) => h.text)).toEqual(["broken by a bad run", "good"]);
      expect((await send("POST", "/api/agents/keeper/state/restore", { id: 99999 })).status).toBe(404);
      expect((await send("GET", "/api/agents/nobody/state/history")).status).toBe(404);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
