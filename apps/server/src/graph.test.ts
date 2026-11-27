import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentSchema, type Agent, type Note } from "@vigil/shared";
import { MAX_GRAPH_NODES, buildGraphData } from "./graph";
import { closeDb, removeNote, reindexNote } from "./index-db";
import type { ModelFactory } from "./llm";
import { setRunDeps, startRun, waitForRuns } from "./runs";
import { closeState, getRun, putAgent, recentTouches } from "./state-db";
import { createNote } from "./vault";

let root = "";
const saved = { ...process.env };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-graph-"));
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

const note = (id: string, body = "", over: Partial<Note> = {}): Note => ({ id, title: id.toUpperCase(), body, tags: [], author: "human", updatedAt: "2026-11-15T10:00:00.000Z", ...over });
const usage = { input_tokens: 1, output_tokens: 9, total_tokens: 10 };
const call = (name: string, args: Record<string, unknown>, id: string) => new AIMessage({ content: "", tool_calls: [{ id, name, args, type: "tool_call" }], usage_metadata: usage });
const say = (t: string) => new AIMessage({ content: t, usage_metadata: usage });
const agent = (over: Partial<Agent> = {}): Agent => AgentSchema.parse({ name: "digest", systemPrompt: "x", tools: ["read_notes", "write_notes"], strict: false, tokenBudget: 1000, ...over });

async function runScript(a: Agent, script: AIMessage[]) {
  putAgent(a);
  let i = 0;
  const make: ModelFactory = () => ({ invoke: async () => script[Math.min(i++, script.length - 1)] as AIMessage });
  setRunDeps({ makeModel: make });
  const r = startRun(a.name);
  await waitForRuns();
  return getRun(r.id)!;
}

describe("touches", () => {
  it("records a read when read_note succeeds and a write when write_note succeeds", async () => {
    reindexNote(await createNote({ title: "Source", body: "s" }));
    const run = await runScript(agent(), [call("read_note", { id: "source" }, "a"), call("write_note", { title: "Output", body: "o" }, "b"), say("done")]);
    const touches = recentTouches("2000-01-01T00:00:00.000Z");
    expect(touches.map((t) => [t.agent, t.noteId, t.kind, t.runId]).sort()).toEqual([
      ["digest", "output", "wrote", run.id],
      ["digest", "source", "read", run.id],
    ]);
  });

  it("a read of a missing note and a failed write record nothing", async () => {
    const run = await runScript(agent(), [call("read_note", { id: "nothing-here" }, "a"), call("write_note", { title: "///", body: "x" }, "b"), say("done")]);
    expect(run.status).toBe("succeeded");
    expect(recentTouches("2000-01-01T00:00:00.000Z")).toEqual([]);
  });

  it("repeated touches by one agent collapse into one edge per kind", async () => {
    reindexNote(await createNote({ title: "Source", body: "s" }));
    await runScript(agent(), [call("read_note", { id: "source" }, "a"), call("read_note", { id: "source" }, "b"), say("done")]);
    expect(recentTouches("2000-01-01T00:00:00.000Z")).toHaveLength(1);
  });
});

describe("buildGraphData", () => {
  const now = new Date("2026-11-15T12:00:00Z");

  it("builds notes, link edges, a ghost node for a dangling link, and agent nodes and edges, with degrees", async () => {
    reindexNote(note("a", "see [[B]] and [[Missing idea]]"));
    reindexNote(note("b", "back to [[A]]"));
    reindexNote(note("c", "alone"));
    const digest = agent();
    putAgent(digest);
    const { recordTouch } = await import("./state-db");
    recordTouch("digest", "a", "read", "r1");
    recordTouch("digest", "b", "wrote", "r1");
    const g = buildGraphData(now, [digest]);

    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(Object.keys(byId).sort()).toEqual(["a", "agent:digest", "b", "c", "missing-idea"]);
    expect(byId["missing-idea"]).toMatchObject({ ghost: true, kind: "note", title: "missing-idea" });
    expect(byId["agent:digest"]).toMatchObject({ kind: "agent", title: "digest" });
    expect(byId["a"]).toMatchObject({ kind: "note", title: "A", author: "human", updatedAt: "2026-11-15T10:00:00.000Z" });

    const edges = g.edges.map((e) => `${e.kind}:${e.source}>${e.target}${e.dangling ? "!" : ""}`).sort();
    expect(edges).toEqual(["agent-read:agent:digest>a", "agent-wrote:agent:digest>b", "link:a>b", "link:a>missing-idea!", "link:b>a"]);
    // degree = edges touching the node
    expect(byId["a"]?.degree).toBe(4); // a>b, a>missing, b>a, agent read
    expect(byId["c"]?.degree).toBe(0);
    expect(byId["agent:digest"]?.degree).toBe(2);
    expect(g.truncated).toBe(false);
  });

  it("ignores touches of deleted notes, of deleted agents, and older than 90 days", async () => {
    reindexNote(note("keep"));
    reindexNote(note("gone"));
    const digest = agent();
    const { recordTouch } = await import("./state-db");
    recordTouch("digest", "keep", "read", "r1");
    recordTouch("digest", "gone", "read", "r1");
    recordTouch("ghost-agent", "keep", "read", "r1");
    removeNote("gone");
    const g = buildGraphData(now, [digest]);
    expect(g.edges.map((e) => `${e.source}>${e.target}`)).toEqual(["agent:digest>keep"]);
    // 90 days: a touch from the far past is not drawn
    const future = new Date(now.getTime() + 200 * 86_400_000);
    expect(buildGraphData(future, [digest]).edges).toEqual([]);
  });

  it("a note linking to itself or twice to the same note makes no duplicate edges", () => {
    reindexNote(note("x", "[[X]] [[Y]] [[Y]] [y](y)"));
    reindexNote(note("y"));
    const g = buildGraphData(now, []);
    expect(g.edges.filter((e) => e.kind === "link")).toHaveLength(1);
  });

  it("past 3,000 nodes it keeps the most recent notes and their direct neighbours, and says truncated", () => {
    // Old note "anchor" is linked FROM a recent note, so it is a neighbour and stays; "stale" is old and unlinked, so it goes.
    reindexNote(note("anchor", "", { updatedAt: "2020-01-01T00:00:00.000Z" }));
    reindexNote(note("stale", "", { updatedAt: "2020-01-02T00:00:00.000Z" }));
    for (let i = 0; i < MAX_GRAPH_NODES; i++) {
      reindexNote(note(`n${String(i).padStart(4, "0")}`, i === 0 ? "[[Anchor]]" : "", { updatedAt: new Date(1_700_000_000_000 + i * 1000).toISOString() }));
    }
    const g = buildGraphData(now, []);
    expect(g.truncated).toBe(true);
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids.has("anchor")).toBe(true);
    expect(ids.has("stale")).toBe(false);
    expect(ids.has("n2999")).toBe(true);
    expect(g.nodes.length).toBeLessThanOrEqual(MAX_GRAPH_NODES + 1);
    expect(g.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });
});

describe("buildGraphData focus (the local graph)", () => {
  const now = new Date("2026-11-16T12:00:00.000Z");
  const links = () => {
    reindexNote(note("a", "to [[b]] and #topic"));
    reindexNote(note("b", "to [[c]] and [[missing-idea]]"));
    reindexNote(note("c", "to [[d]]"));
    reindexNote(note("d"));
    reindexNote(note("x", "back to [[a]]"));
    reindexNote(note("far"));
  };
  const ids = (g: ReturnType<typeof buildGraphData>) => g.nodes.map((n) => n.id).sort();

  it("one hop: the note, what it links to and what links to it", () => {
    links();
    const g = buildGraphData(now, [], { focus: "a", hops: 1 });
    expect(ids(g)).toEqual(["a", "b", "x"]);
    expect(g.edges.map((e) => `${e.source}>${e.target}`).sort()).toEqual(["a>b", "x>a"]);
  });

  it("two hops reaches one step further, including a link to a note that does not exist", () => {
    links();
    const g = buildGraphData(now, [], { focus: "a", hops: 2 });
    expect(ids(g)).toEqual(["a", "b", "c", "missing-idea", "x"]);
    expect(g.nodes.find((n) => n.id === "missing-idea")).toMatchObject({ ghost: true });
    expect(g.edges.some((e) => e.dangling)).toBe(true);
  });

  it("an unknown focus gives an empty graph, not the whole vault", () => {
    links();
    expect(buildGraphData(now, [], { focus: "nope", hops: 1 })).toEqual({ nodes: [], edges: [], truncated: false });
  });

  it("carries tags, and agent edges only for notes in view (with when and which run)", async () => {
    links();
    const { recordTouch } = await import("./state-db");
    const digest = agent();
    recordTouch("digest", "a", "read", "run-1");
    recordTouch("digest", "far", "read", "run-2");
    const g = buildGraphData(now, [digest], { focus: "a", hops: 1 });
    expect(g.nodes.find((n) => n.id === "a")?.tags).toEqual(["topic"]);
    const agentEdges = g.edges.filter((e) => e.kind !== "link");
    expect(agentEdges).toHaveLength(1);
    expect(agentEdges[0]).toMatchObject({ source: "agent:digest", target: "a", runId: "run-1" });
    expect(agentEdges[0]?.at).toBeTruthy();
    // an agent that touched nothing in view is left out
    expect(ids(g)).not.toContain("agent:other");
  });
});
