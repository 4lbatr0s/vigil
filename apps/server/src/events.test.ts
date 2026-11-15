import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { request } from "node:http";
import { AgentSchema } from "@vigil/shared";
import { MAX_STREAMS, openStreamCount, publish, subscribe, type VigilEvent } from "./events";
import { closeDb, reindexNote, removeNote } from "./index-db";
import { start, type RunningServer } from "./server";
import { addEvent, closeState, createRun, finishRun, markUndone, putAgent } from "./state-db";
import { closeStreams } from "./events";

let root = "";
let running: RunningServer;
let port = 0;
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-events-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  running = start({ port: 0 });
  await new Promise<void>((r) => running.server.once("listening", () => r()));
  const a = running.server.address();
  port = typeof a === "object" && a ? a.port : 0;
  putAgent(AgentSchema.parse({ name: "a", systemPrompt: "SECRET PROMPT" }));
});
afterEach(async () => {
  closeStreams();
  await running.close();
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

function collect(): VigilEvent[] {
  const seen: VigilEvent[] = [];
  const stop = subscribe((e) => seen.push(e));
  afterEachStops.push(stop);
  return seen;
}
const afterEachStops: Array<() => void> = [];
afterEach(() => {
  while (afterEachStops.length) afterEachStops.pop()?.();
});

/** Opens /api/events and resolves with the response plus a reader of parsed lines. */
function openStream(): Promise<{ status: number; lines: string[]; close: () => void; waitFor: (n: number) => Promise<string[]> }> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    let buf = "";
    let notify: (() => void) | null = null;
    const req = request({ host: "127.0.0.1", port, path: "/api/events" }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          lines.push(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
        notify?.();
      });
      resolve({
        status: res.statusCode ?? 0,
        lines,
        close: () => req.destroy(),
        waitFor: async (n) => {
          const deadline = Date.now() + 3000;
          while (lines.length < n && Date.now() < deadline) await new Promise<void>((r) => ((notify = r), setTimeout(r, 50)));
          return lines;
        },
      });
    });
    req.on("error", () => undefined);
    req.on("socket", () => undefined);
    req.end();
    setTimeout(() => reject(new Error("no response")), 3000);
  });
}

describe("event bus", () => {
  it("delivers run, run-event and note events in order, and unsubscribes", () => {
    const seen = collect();
    const run = createRun("r1", "a", 100);
    addEvent("r1", "model", "reply text");
    finishRun("r1", "succeeded", 5, null);
    markUndone("r1");
    reindexNote({ id: "n", title: "N", body: "SECRET BODY", tags: [], author: "agent", updatedAt: "2026-11-15T00:00:00.000Z", agentName: "a" });
    reindexNote({ id: "n", title: "N", body: "two", tags: [], author: "human", updatedAt: "2026-11-15T00:01:00.000Z" });
    removeNote("n");
    expect(run.status).toBe("running");
    expect(seen.map((e) => (e.type === "run" ? `run:${e.run.status}` : e.type === "note" ? `note:${e.change}` : e.type === "run-event" ? `run-event:${e.kind}` : e.type))).toEqual([
      "run:running",
      "run-event:model",
      "run:succeeded",
      "run:succeeded",
      "note:created",
      "note:updated",
      "note:deleted",
    ]);
    const stop = subscribe(() => undefined);
    stop();
  });

  it("never puts bodies, prompts or run text in an event", () => {
    const seen = collect();
    createRun("r1", "a", 100);
    addEvent("r1", "prompt", "SECRET PROMPT with a key sk-abcdefghijklmnop");
    reindexNote({ id: "n", title: "N", body: "SECRET BODY", tags: [], author: "human", updatedAt: "2026-11-15T00:00:00.000Z" });
    const text = JSON.stringify(seen);
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("sk-abcdefghijklmnop");
    expect(text).not.toContain('"body"');
    expect(text).not.toContain('"text"');
  });

  it("a failing listener does not stop the others or the publisher", () => {
    const seen = collect();
    const stop = subscribe(() => {
      throw new Error("broken socket");
    });
    expect(() => publish({ type: "ping" })).not.toThrow();
    stop();
    expect(seen).toEqual([{ type: "ping" }]);
  });
});

describe("GET /api/events", () => {
  it("streams ndjson, receives events as they happen, and unsubscribes on close", async () => {
    const stream = await openStream();
    expect(stream.status).toBe(200);
    await stream.waitFor(1);
    expect(JSON.parse(stream.lines[0] ?? "{}")).toEqual({ type: "ping" });
    expect(openStreamCount()).toBe(1);
    createRun("r1", "a", 100);
    reindexNote({ id: "n", title: "N", body: "SECRET BODY", tags: [], author: "human", updatedAt: "2026-11-15T00:00:00.000Z" });
    const lines = await stream.waitFor(3);
    const parsed = lines.map((l) => JSON.parse(l) as VigilEvent);
    expect(parsed.map((e) => e.type)).toEqual(["ping", "run", "note"]);
    expect(lines.join("\n")).not.toContain("SECRET BODY");
    stream.close();
    for (let i = 0; i < 40 && openStreamCount() > 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(openStreamCount()).toBe(0);
  });

  it(`refuses the ${MAX_STREAMS + 1}st stream with 429 too-many-streams`, async () => {
    const open = [];
    for (let i = 0; i < MAX_STREAMS; i++) open.push(await openStream());
    const res = await fetch(`http://127.0.0.1:${port}/api/events`);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("too-many-streams");
    for (const s of open) s.close();
  });

  it("is protected by the same access checks (wrong Host is refused)", async () => {
    // fetch cannot override Host, so use node:http.
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/api/events", headers: { host: "evil.example" } }, (res) => {
        resolve(res.statusCode ?? 0);
        res.destroy();
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});
