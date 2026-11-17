import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { CanvasSchema, MAX_NODES } from "./canvas";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { closeState } from "./state-db";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-canvas-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  server = createServer(createHandler(accessFromEnv()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
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
  return { status: res.status, body: (await res.json()) as { data?: any; error?: { code: string; message: string } } };
};

// The kind of file Obsidian writes (field names from the JSON Canvas 1.0 spec).
const OBSIDIAN = {
  nodes: [
    { id: "a1", type: "text", x: 0, y: 0, width: 250, height: 60, text: "# Idea\nWith **markdown**", color: "4", someObsidianExtra: { keep: true } },
    { id: "b2", type: "file", x: 300, y: 0, width: 300, height: 200, file: "bio.md", subpath: "#Cells" },
    { id: "c3", type: "link", x: 0, y: 150, width: 250, height: 100, url: "https://jsoncanvas.org" },
    { id: "g4", type: "group", x: -50, y: -50, width: 700, height: 400, label: "Study", backgroundStyle: "cover" },
  ],
  edges: [{ id: "e1", fromNode: "a1", fromSide: "right", fromEnd: "none", toNode: "b2", toSide: "left", toEnd: "arrow", label: "see", color: "#ff8800" }],
};

describe("CanvasSchema", () => {
  it("accepts a canvas as Obsidian writes it, and an empty one", () => {
    expect(CanvasSchema.safeParse(OBSIDIAN).success).toBe(true);
    expect(CanvasSchema.safeParse({}).success).toBe(true);
    expect(CanvasSchema.safeParse({ nodes: [], edges: [] }).success).toBe(true);
  });

  it("refuses repeated ids, arrows to nothing, bad colors, unknown node types and too many nodes", () => {
    const text = (id: string) => ({ id, type: "text", x: 0, y: 0, width: 10, height: 10, text: "t" });
    expect(CanvasSchema.safeParse({ nodes: [text("a"), text("a")] }).success).toBe(false);
    expect(CanvasSchema.safeParse({ nodes: [text("a")], edges: [{ id: "e", fromNode: "a", toNode: "zzz" }] }).success).toBe(false);
    expect(CanvasSchema.safeParse({ nodes: [text("a")], edges: [{ id: "a", fromNode: "a", toNode: "a" }] }).success).toBe(false);
    expect(CanvasSchema.safeParse({ nodes: [{ ...text("a"), color: "red" }] }).success).toBe(false);
    expect(CanvasSchema.safeParse({ nodes: [{ ...text("a"), type: "image" }] }).success).toBe(false);
    expect(CanvasSchema.safeParse({ nodes: Array.from({ length: MAX_NODES + 1 }, (_, i) => text(`n${i}`)) }).success).toBe(false);
  });
});

describe("canvas API", () => {
  it("creates a canvas in the vault as a .canvas file, with a free name each time", async () => {
    const a = await j("POST", "/api/canvases", { title: "Exam Plan" });
    expect(a.status).toBe(201);
    expect(a.body.data.id).toBe("exam-plan");
    expect((await j("POST", "/api/canvases", { title: "Exam Plan" })).body.data.id).toBe("exam-plan-2");
    const files = await readdir(path.join(root, "vault", "canvases"));
    expect(files.sort()).toEqual(["exam-plan-2.canvas", "exam-plan.canvas"]);
    expect(JSON.parse(await readFile(path.join(root, "vault", "canvases", "exam-plan.canvas"), "utf8"))).toEqual({ nodes: [], edges: [] });
    expect(((await j("GET", "/api/canvases")).body.data as { id: string }[]).map((c) => c.id).sort()).toEqual(["exam-plan", "exam-plan-2"]);
  });

  it("saves and reads back, keeping fields it does not know", async () => {
    const { id, updatedAt } = (await j("POST", "/api/canvases", { title: "Board" })).body.data;
    const put = await j("PUT", `/api/canvases/${id}`, { canvas: OBSIDIAN, baseUpdatedAt: updatedAt });
    expect(put.status).toBe(200);
    const got = (await j("GET", `/api/canvases/${id}`)).body.data;
    expect(got.canvas).toEqual(OBSIDIAN);
    expect(got.canvas.nodes[0].someObsidianExtra).toEqual({ keep: true });
    const onDisk = JSON.parse(await readFile(path.join(root, "vault", "canvases", `${id}.canvas`), "utf8"));
    expect(onDisk).toEqual(OBSIDIAN);
  });

  it("refuses to overwrite a newer version, and says so plainly", async () => {
    const { id, updatedAt } = (await j("POST", "/api/canvases", { title: "Board" })).body.data;
    await new Promise((r) => setTimeout(r, 15));
    await j("PUT", `/api/canvases/${id}`, { canvas: OBSIDIAN, baseUpdatedAt: updatedAt });
    const stale = await j("PUT", `/api/canvases/${id}`, { canvas: { nodes: [], edges: [] }, baseUpdatedAt: updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("canvas-conflict");
    expect(((await j("GET", `/api/canvases/${id}`)).body.data.canvas.nodes as unknown[]).length).toBe(4);
  });

  it("rejects an invalid canvas on save, and explains a broken file on open", async () => {
    const { id } = (await j("POST", "/api/canvases", { title: "Board" })).body.data;
    expect((await j("PUT", `/api/canvases/${id}`, { canvas: { nodes: [{ id: "a", type: "text" }] } })).status).toBe(400);
    await mkdir(path.join(root, "vault", "canvases"), { recursive: true });
    await writeFile(path.join(root, "vault", "canvases", "broken.canvas"), "{not json");
    const open = await j("GET", "/api/canvases/broken");
    expect(open.status).toBe(422);
    expect(open.body.error?.message).toContain("not valid JSON");
    expect(((await j("GET", "/api/canvases")).body.data as { id: string }[]).some((c) => c.id === "broken")).toBe(true);
  });

  it("only touches files inside canvases/, whatever the id says", async () => {
    for (const bad of ["..%2Fevil", "%2Fetc%2Fpasswd", "a.b", "..", "UPPER"]) {
      expect((await j("GET", `/api/canvases/${bad}`)).status).toBeGreaterThanOrEqual(400);
      expect((await j("PUT", `/api/canvases/${bad}`, { canvas: {} })).status).toBeGreaterThanOrEqual(400);
      expect((await j("DELETE", `/api/canvases/${bad}`)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await j("PUT", "/api/canvases/never-made", { canvas: {} })).status).toBe(404);
  });

  it("deletes a canvas", async () => {
    const { id } = (await j("POST", "/api/canvases", { title: "Gone" })).body.data;
    expect((await j("DELETE", `/api/canvases/${id}`)).status).toBe(200);
    expect((await j("GET", `/api/canvases/${id}`)).status).toBe(404);
    expect((await j("DELETE", `/api/canvases/${id}`)).status).toBe(404);
  });

  it("does not show up among the notes", async () => {
    await j("POST", "/api/canvases", { title: "Board" });
    expect((await j("GET", "/api/notes")).body.data).toEqual([]);
  });
});
