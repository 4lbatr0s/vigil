import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb } from "./index-db";
import { start, type RunningServer } from "./server";
import { closeState } from "./state-db";

let root = "";
let server: RunningServer;
const saved = { ...process.env };
const META = `default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self' 'sha256-abc123='; style-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'`;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-static-"));
  const dir = path.join(root, "web");
  await mkdir(path.join(dir, "_app", "immutable", "chunks"), { recursive: true });
  await writeFile(path.join(root, "secret.txt"), "TOP SECRET OUTSIDE THE DIRECTORY");
  await writeFile(path.join(dir, "index.html"), `<!doctype html><meta http-equiv="content-security-policy" content="${META}"><title>Vigil</title><script>boot()</script>`);
  await writeFile(path.join(dir, "robots.txt"), "User-agent: *");
  await writeFile(path.join(dir, "manifest.webmanifest"), "{}");
  await writeFile(path.join(dir, "api"), "a file named api, which must not shadow the API");
  await writeFile(path.join(dir, "_app", "immutable", "chunks", "abc.js"), "export default 1;");
  await mkdir(path.join(dir, "sub"));
  await writeFile(path.join(dir, "sub", "index.html"), "<p>sub page</p>");
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  process.env.VIGIL_STATIC_DIR = dir;
  server = start({ port: 0, access: { token: "tok", allowedHosts: [] } });
  await new Promise<void>((r) => server.server.once("listening", () => r()));
});
afterEach(async () => {
  await server.close();
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

type Res = { status: number; headers: Record<string, string | string[] | undefined>; text: string };
function get(rawPath: string, opts: { method?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  const port = (server.server.address() as { port: number }).port;
  return new Promise((resolve, reject) => {
    // node:http sends the path exactly as given, so encoded and dot forms reach the server untouched.
    const req = request({ host: "127.0.0.1", port, path: rawPath, method: opts.method ?? "GET", headers: opts.headers }, (res) => {
      let text = "";
      res.on("data", (c: Buffer) => (text += c.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("static files", () => {
  it("serves index.html at / with no credentials, and the security headers", async () => {
    const r = await get("/");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(r.text).toContain("<title>Vigil</title>");
    expect(r.headers["cache-control"]).toBe("no-cache");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    const csp = String(r.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self' 'sha256-abc123='"); // the bootstrap hash from index.html
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("serves a hashed asset with an immutable cache and the right type", async () => {
    const r = await get("/_app/immutable/chunks/abc.js");
    expect(r.status).toBe(200);
    expect(r.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(r.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(String(r.headers["content-security-policy"])).toContain("default-src");
  });

  it("content types for the other kinds of file", async () => {
    expect((await get("/manifest.webmanifest")).headers["content-type"]).toBe("application/manifest+json");
    expect((await get("/robots.txt")).headers["content-type"]).toBe("text/plain; charset=utf-8");
  });

  it("falls back to index.html for client routes, and 404s unknown files with an extension", async () => {
    const route = await get("/agents/digest");
    expect(route.status).toBe(200);
    expect(route.text).toContain("<title>Vigil</title>");
    expect((await get("/missing.js")).status).toBe(404);
    expect((await get("/_app/immutable/nothing.css")).status).toBe(404);
    expect((await get("/chat/123?x=1")).status).toBe(200);
  });

  it("serves a directory's index.html", async () => {
    expect((await get("/sub/")).text).toBe("<p>sub page</p>");
  });

  it("path traversal never leaves the directory", async () => {
    for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/a/../../secret.txt", "/%2e%2e%2fsecret.txt", "/..%5csecret.txt", "/%00", "/x%00.js", "/..\\secret.txt", "//../secret.txt", "/_app/../../secret.txt", "/%252e%252e/secret.txt"]) {
      const r = await get(p);
      expect(r.text, p).not.toContain("TOP SECRET");
      expect([200, 400, 404], p).toContain(r.status);
      if (r.status === 200) expect(r.text, p).toContain("<title>Vigil</title>"); // only ever the app shell
    }
    expect((await get("/..%2fsecret.txt")).status).toBe(404);
    expect((await get("/%zz")).status).toBe(400); // undecodable
  });

  it("HEAD works and sends no body; other methods are not served", async () => {
    const head = await get("/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.text).toBe("");
    expect(head.headers["content-length"]).toBeDefined();
    const post = await get("/", { method: "POST" });
    expect(post.status).toBe(404); // falls through to the API's not-found answer
  });

  it("the API route wins over a static file named api, and the API still needs its token", async () => {
    const r = await get("/api/notes");
    expect(r.status).toBe(401);
    expect(r.text).not.toContain("shadow");
    const health = await get("/api/health");
    expect(health.status).toBe(200);
    expect(JSON.parse(health.text).data.ok).toBe(true);
    // Unknown API paths are API 404s, never the app shell.
    const unknown = await get("/api/nope", { headers: { authorization: "Bearer tok" } });
    expect(unknown.status).toBe(404);
    expect(JSON.parse(unknown.text).error.code).toBe("not-found");
  });

  it("the Host check still applies to static requests", async () => {
    const r = await get("/", { headers: { host: "evil.example" } });
    expect(r.status).toBe(403);
  });

  it("without VIGIL_STATIC_DIR the server is API only", async () => {
    await server.close();
    delete process.env.VIGIL_STATIC_DIR;
    server = start({ port: 0, access: { token: undefined, allowedHosts: [] } });
    await new Promise<void>((r) => server.server.once("listening", () => r()));
    expect((await get("/")).status).toBe(404);
  });
});
