import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { askTask, findPassages, gapPassages, gapTask, questionWords, topWords } from "./ask";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { closeState } from "./state-db";

describe("questionWords", () => {
  it("drops filler words and repeats, keeps other languages", () => {
    expect(questionWords("What is the second law of thermodynamics? What is it?")).toEqual(["second", "law", "thermodynamics"]);
    expect(questionWords("Entropi nedir?")).toEqual(["entropi", "nedir"]);
  });
});

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-ask-"));
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

describe("findPassages", () => {
  it("returns the best lines with their note and line number, numbered from 1", async () => {
    await note("thermo", "# Thermo\n\nEntropy is a measure of disorder.\nThe second law says entropy of an isolated system never decreases.\nUnrelated line about lunch.");
    await note("cooking", "Boil water for pasta.");
    const found = findPassages("What does the second law say about entropy?");
    expect(found.map((p) => [p.n, p.noteId, p.line])).toEqual([
      [1, "thermo", 4],
      [2, "thermo", 3],
    ]);
    expect(found[0]?.text).toContain("never decreases");
  });

  it("finds nothing when no note shares a word with the question", async () => {
    await note("thermo", "Entropy is a measure of disorder.");
    expect(findPassages("Who won the match yesterday?")).toEqual([]);
  });

  it("caps the number of lines", async () => {
    await note("many", Array.from({ length: 40 }, (_, i) => `entropy fact ${i}`).join("\n"));
    expect(findPassages("entropy").length).toBe(10);
  });
});

describe("askTask", () => {
  it("puts the question and the numbered lines between markers", () => {
    const t = askTask("Why?", [{ n: 1, noteId: "a", title: "A", line: 2, text: "Because." }]);
    expect(t).toContain("QUESTION START\nWhy?\nQUESTION END");
    expect(t).toContain("LINES START\n[1] (A) Because.\nLINES END");
  });
});

describe("POST /api/ask", () => {
  it("does not start an agent when the notes have nothing on the question", async () => {
    await note("thermo", "Entropy is a measure of disorder.");
    const r = await j("POST", "/api/ask", { question: "Who won the match yesterday?" });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ run: null, passages: [] });
  });

  it("asks for the agent to be added when there are matching lines", async () => {
    await note("thermo", "Entropy is a measure of disorder.");
    const r = await j("POST", "/api/ask", { question: "What is entropy?" });
    expect(r.status).toBe(404);
    expect(r.body.error?.code).toBe("agent-not-found");
  });

  it("refuses while the agent is switched off, then starts it", async () => {
    await note("thermo", "Entropy is a measure of disorder.");
    const agent = (await j("POST", "/api/agents/from-template/note-asker", {})).body.data;
    expect((await j("POST", "/api/ask", { question: "What is entropy?" })).body.error?.code).toBe("agent-disabled");
    await j("PUT", "/api/agents/note-asker", { ...agent, enabled: true });
    const r = await j("POST", "/api/ask", { question: "What is entropy?" });
    expect(r.status).toBe(202);
    expect(r.body.data.passages).toHaveLength(1);
    expect(r.body.data.run.agent).toBe("note-asker");
  });

  it("refuses a missing or too short question", async () => {
    expect((await j("POST", "/api/ask", { question: "x" })).status).toBe(400);
    expect((await j("POST", "/api/ask", {})).status).toBe(400);
  });
});

describe("gap check", () => {
  const source = "Entropy measures disorder. The second law of thermodynamics says entropy never decreases in an isolated system. Enthalpy is heat content at constant pressure, and entropy matters for enthalpy too.";

  it("picks the words the text is about, most repeated first", () => {
    expect(topWords(source, 3)).toEqual(["entropy", "enthalpy", "constant"]);
  });

  it("finds the note lines that share those words", async () => {
    await note("thermo", "Entropy is a measure of disorder.\nUnrelated lunch plan.");
    const found = gapPassages(source);
    expect(found.map((p) => p.text)).toEqual(["Entropy is a measure of disorder."]);
    expect(gapTask(source, found)).toContain("NOTES START\n[1] (thermo) Entropy is a measure of disorder.\nNOTES END");
    expect(gapTask(source, [])).toContain("NOTES START\n(none)\nNOTES END");
  });

  it("POST /api/gap needs the agent, then starts it; short text is refused", async () => {
    await note("thermo", "Entropy is a measure of disorder.");
    expect((await j("POST", "/api/gap", { source })).body.error?.code).toBe("agent-not-found");
    const agent = (await j("POST", "/api/agents/from-template/gap-checker", {})).body.data;
    expect((await j("POST", "/api/gap", { source })).body.error?.code).toBe("agent-disabled");
    await j("PUT", "/api/agents/gap-checker", { ...agent, enabled: true });
    const r = await j("POST", "/api/gap", { source });
    expect(r.status).toBe(202);
    expect(r.body.data.run.agent).toBe("gap-checker");
    expect(r.body.data.passages).toHaveLength(1);
    expect((await j("POST", "/api/gap", { source: "too short" })).status).toBe(400);
  });
});
