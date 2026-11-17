import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { captureLine } from "./capture";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { closeState } from "./state-db";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-capture-"));
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

describe("captureLine", () => {
  it("makes one bullet line", () => {
    expect(captureLine("read the paper")).toBe("- read the paper");
    expect(captureLine("- already a bullet")).toBe("- already a bullet");
    expect(captureLine("two\nlines  here")).toBe("- two lines  here");
  });
});

describe("POST /api/capture", () => {
  it("creates the Inbox note, then adds lines under what is there", async () => {
    expect((await j("POST", "/api/capture", { text: "ask about the exam date" })).status).toBe(201);
    await j("POST", "/api/capture", { text: "look up FSRS" });
    const note = (await j("GET", "/api/notes/inbox")).body.data;
    expect(note.title).toBe("Inbox");
    expect(note.author).toBe("human");
    expect(note.body.trim()).toBe("- ask about the exam date\n- look up FSRS");
  });

  it("keeps what you already wrote in the Inbox", async () => {
    await j("PUT", "/api/notes/inbox", { title: "Inbox", body: "# My inbox\n\n- [x] old thing\n" });
    await j("POST", "/api/capture", { text: "new thing" });
    expect((await j("GET", "/api/notes/inbox")).body.data.body.trim()).toBe("# My inbox\n\n- [x] old thing\n- new thing");
  });

  it("refuses empty or huge text", async () => {
    expect((await j("POST", "/api/capture", { text: "   " })).status).toBe(400);
    expect((await j("POST", "/api/capture", { text: "x".repeat(2001) })).status).toBe(400);
  });
});
