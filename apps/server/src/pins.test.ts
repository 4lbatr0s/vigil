import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { closeState } from "./state-db";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-pins-"));
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

describe("pins", () => {
  it("pins, lists newest first, unpins, and refuses a note that does not exist", async () => {
    await j("PUT", "/api/notes/a", { title: "A", body: "x" });
    await j("PUT", "/api/notes/b", { title: "B", body: "y" });
    expect((await j("PUT", "/api/pins/a")).body.data).toEqual(["a"]);
    await new Promise((r) => setTimeout(r, 5));
    expect((await j("PUT", "/api/pins/b")).body.data).toEqual(["b", "a"]);
    expect((await j("PUT", "/api/pins/b")).body.data).toEqual(["b", "a"]); // pinning twice changes nothing
    expect((await j("DELETE", "/api/pins/b")).body.data).toEqual(["a"]);
    const missing = await j("PUT", "/api/pins/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe("note-not-found");
  });

  it("a pin follows a rename and goes away with a delete, and pinning leaves the note file alone", async () => {
    const created = await j("PUT", "/api/notes/plan", { title: "Plan", body: "text" });
    await j("PUT", "/api/pins/plan");
    const renamed = await j("POST", "/api/notes/plan/rename", { title: "Roadmap" });
    expect(renamed.status).toBe(200);
    expect((await j("GET", "/api/pins")).body.data).toEqual(["roadmap"]);
    const after = await j("GET", "/api/notes/roadmap");
    expect(after.body.data.updatedAt).toBeDefined();
    expect(created.body.data.author).toBe("human");
    await j("DELETE", "/api/notes/roadmap");
    expect((await j("GET", "/api/pins")).body.data).toEqual([]);
  });
});

describe("note summaries", () => {
  it("carry a snippet and the inline tags next to the frontmatter tags, while the full note keeps only its own tags", async () => {
    await j("PUT", "/api/notes/trip", { title: "Trip", tags: ["travel"], body: "# Trip\n\nBook the **flights** for #Plans/Summer and see [[Budget]]." });
    const list = await j("GET", "/api/notes?fields=summary");
    const trip = (list.body.data as { id: string; tags: string[]; snippet: string }[]).find((n) => n.id === "trip");
    expect(trip?.tags.sort()).toEqual(["plans/summer", "travel"]);
    expect(trip?.snippet).toBe("Book the flights for and see Budget.");
    const full = await j("GET", "/api/notes/trip");
    expect(full.body.data.tags).toEqual(["travel"]);
  });
});
