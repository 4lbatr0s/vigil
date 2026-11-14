import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { closeDb } from "./index-db";
import { start, type RunningServer } from "./server";

let vault = "";
let dbDir = "";
let open: RunningServer;
let guarded: RunningServer;

function portOf(s: RunningServer): number {
  const a = s.server.address();
  return typeof a === "object" && a ? a.port : 0;
}

async function listening(s: RunningServer): Promise<void> {
  await new Promise<void>((resolve) => s.server.once("listening", () => resolve()));
}

/** fetch cannot set Host or Origin freely, so use node:http. */
function call(
  port: number,
  headers: Record<string, string>,
  pathname = "/api/notes",
): Promise<{ status: number; code: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: pathname, method: "GET", headers }, (res) => {
      let text = "";
      res.on("data", (c: Buffer) => (text += c.toString()));
      res.on("end", () => {
        const json = JSON.parse(text) as { error?: { code?: string } };
        resolve({ status: res.statusCode ?? 0, code: json.error?.code });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  vault = await mkdtemp(path.join(tmpdir(), "vigil-vault-"));
  dbDir = await mkdtemp(path.join(tmpdir(), "vigil-db-"));
  process.env.VAULT_DIR = vault;
  process.env.DB_PATH = path.join(dbDir, "index.db");
  open = start({ port: 0 });
  guarded = start({ port: 0, access: { token: "s3cret", allowedHosts: ["notes.example.com"] } });
  await Promise.all([listening(open), listening(guarded)]);
});

afterAll(async () => {
  await Promise.all([open.close(), guarded.close()]);
  closeDb();
  await rm(vault, { recursive: true, force: true });
  await rm(dbDir, { recursive: true, force: true });
});

describe("access control", () => {
  it("binds to loopback by default", () => {
    const a = open.server.address();
    expect(typeof a === "object" && a ? a.address : "").toBe("127.0.0.1");
  });

  it("refuses a non-loopback bind without a token", () => {
    expect(() => accessFromEnv({ host: "0.0.0.0", token: undefined })).toThrow(/VIGIL_TOKEN/);
    expect(accessFromEnv({ host: "0.0.0.0", token: "x" }).host).toBe("0.0.0.0");
  });

  it("rejects an unexpected Host header (DNS rebinding)", async () => {
    const res = await call(portOf(open), { host: "evil.example.com" });
    expect(res).toEqual({ status: 403, code: "bad-host" });
  });

  it("rejects a cross-site Origin", async () => {
    const res = await call(portOf(open), { host: "localhost", origin: "https://evil.example.com" });
    expect(res).toEqual({ status: 403, code: "bad-origin" });
  });

  it("accepts a same-origin request", async () => {
    const res = await call(portOf(open), { host: "localhost:5173", origin: "http://localhost:5173" });
    expect(res.status).toBe(200);
  });

  it("requires the token when one is set", async () => {
    const port = portOf(guarded);
    expect((await call(port, { host: "localhost" })).code).toBe("unauthorized");
    expect((await call(port, { host: "localhost", authorization: "Bearer wrong" })).status).toBe(401);
    expect((await call(port, { host: "localhost", authorization: "Bearer s3cret" })).status).toBe(200);
  });

  it("leaves /api/health open and accepts allowed host names", async () => {
    const port = portOf(guarded);
    expect((await call(port, { host: "localhost" }, "/api/health")).status).toBe(200);
    const res = await call(port, { host: "notes.example.com", authorization: "Bearer s3cret" });
    expect(res.status).toBe(200);
  });
});
