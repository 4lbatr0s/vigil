import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { MAX_IMAGE_BYTES, sniffImage } from "./attachments";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { closeState } from "./state-db";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("rest of a tiny picture")]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const GIF = Buffer.from("GIF89a....");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBPVP8 ")]);

describe("sniffImage", () => {
  it("knows the four formats by their first bytes", () => {
    expect([PNG, JPG, GIF, WEBP].map((b) => sniffImage(b)?.ext)).toEqual(["png", "jpg", "gif", "webp"]);
  });
  it("refuses svg, html, text and short input", () => {
    for (const b of [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"), Buffer.from("<html>"), Buffer.from("hello"), Buffer.alloc(0), Buffer.from([0x89, 0x50])]) {
      expect(sniffImage(b)).toBeNull();
    }
  });
});

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-att-"));
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

const upload = (body: Buffer, type = "image/png") => fetch(`${base}/api/attachments`, { method: "POST", headers: { "content-type": type }, body: new Uint8Array(body) });

describe("attachments API", () => {
  it("stores an image under its hash and serves it back as an inert image", async () => {
    const res = await upload(PNG);
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { name: string; bytes: number } };
    expect(data.name).toMatch(/^[a-f0-9]{16}\.png$/);
    const got = await fetch(`${base}/api/attachments/${data.name}`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(got.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);
  });
  it("the same picture twice is one file, and it sits inside the vault", async () => {
    const a = (await (await upload(PNG)).json()) as { data: { name: string } };
    const b = (await (await upload(PNG)).json()) as { data: { name: string } };
    expect(a.data.name).toBe(b.data.name);
    expect(await readdir(path.join(root, "vault", "attachments"))).toEqual([a.data.name]);
  });
  it("decides the type from the bytes, not from what the client says", async () => {
    const res = await upload(Buffer.from("<svg onload='x()'></svg>"), "image/png");
    expect(res.status).toBe(415);
    const ok = await upload(JPG, "text/plain");
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { data: { name: string } }).data.name.endsWith(".jpg")).toBe(true);
  });
  it("refuses empty and oversized bodies", async () => {
    expect((await upload(Buffer.alloc(0))).status).toBe(400);
    expect((await upload(Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]))).status).toBe(413);
  });
  it("only serves names it could have made", async () => {
    await upload(PNG);
    for (const name of ["..%2Fstate.db", "x.png", "0123456789abcdef.svg", "0123456789abcdef.png", ".hidden"]) {
      expect((await fetch(`${base}/api/attachments/${name}`)).status).toBe(404);
    }
  });
  it("does not turn up in the note list", async () => {
    await upload(PNG);
    await fetch(`${base}/api/notes/a`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "A", body: "x" }) });
    const list = (await (await fetch(`${base}/api/notes`)).json()) as { data: { id: string }[] };
    expect(list.data.map((n) => n.id)).toEqual(["a"]);
  });
});
