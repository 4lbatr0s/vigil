import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetLimiterForTests, setPressureSpacingForTests, clientIp, cookieSecure } from "./auth";
import { closeDb } from "./index-db";
import { start, type RunningServer } from "./server";
import { COOKIE_NAME, bumpSessionEpoch, makeSession, sessionEpoch, resetSessionKeyCache, sessionKeyPath, verifySession } from "./session";
import { closeState } from "./state-db";
import type { Access } from "./access";
import type { IncomingMessage } from "node:http";

let root = "";
let server: RunningServer;
const saved = { ...process.env };
const TOKEN = "correct-horse-battery";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-login-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  delete process.env.SESSION_KEY_PATH;
  delete process.env.VIGIL_COOKIE_SECURE;
  resetSessionKeyCache();
  resetLimiterForTests();
  setPressureSpacingForTests(1000);
  server = start({ port: 0, access: { token: TOKEN, allowedHosts: ["notes.example.com"] } });
  await new Promise<void>((r) => server.server.once("listening", () => r()));
});
afterEach(async () => {
  await server.close();
  closeDb();
  closeState();
  resetSessionKeyCache();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

type Res = { status: number; headers: Record<string, string | string[] | undefined>; json: any };
function call(method: string, pathname: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): Promise<Res> {
  const port = (server.server.address() as { port: number }).port;
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = request(
      { host: "127.0.0.1", port, path: pathname, method, headers: { ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}), ...opts.headers } },
      (res) => {
        let text = "";
        res.on("data", (c: Buffer) => (text += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, json: text ? JSON.parse(text) : null }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const login = (token: string, headers: Record<string, string> = {}) => call("POST", "/api/login", { body: { token }, headers });
const cookieOf = (r: Res): string => String(([] as string[]).concat((r.headers["set-cookie"] as string[] | string | undefined) ?? [])[0] ?? "");

describe("login", () => {
  it("success sets the session cookie with the expected attributes", async () => {
    const r = await login(TOKEN);
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual({ required: true, authenticated: true });
    const c = cookieOf(r);
    expect(c).toMatch(new RegExp(`^${COOKIE_NAME}=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+;`));
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Path=/");
    expect(c).toContain("Max-Age=2592000");
    expect(c).not.toContain("Secure"); // plain http on loopback
  });

  it("a wrong or missing token answers 401 and sets no cookie", async () => {
    for (const body of [{ token: "nope" }, { token: "" }, {}, { token: 5 }]) {
      const r = await call("POST", "/api/login", { body });
      expect(r.status).toBe(401);
      expect(r.json.error.code).toBe("unauthorized");
      expect(r.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("the cookie opens the API, and so does the bearer token; nothing else does", async () => {
    expect((await call("GET", "/api/notes")).status).toBe(401);
    const cookie = cookieOf(await login(TOKEN)).split(";")[0] as string;
    expect((await call("GET", "/api/notes", { headers: { cookie } })).status).toBe(200);
    expect((await call("GET", "/api/notes", { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    expect((await call("GET", "/api/notes", { headers: { cookie: `${COOKIE_NAME}=garbage` } })).status).toBe(401);
  });

  it("five failures lock that address out for the window, even for the right token; a later success resets", async () => {
    for (let i = 0; i < 5; i++) expect((await login("wrong")).status).toBe(401);
    const blocked = await login(TOKEN);
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe("too-many-attempts");
    expect(blocked.headers["set-cookie"]).toBeUndefined();
  });

  it("a burst of parallel attempts cannot slip past the lockout while earlier ones are still being read", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => login("wrong")));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(15);
    expect((await login(TOKEN)).status).toBe(429);
  });

  it("a spray from many addresses slows every attempt to one per interval, and never tells right from wrong", async () => {
    setPressureSpacingForTests(120);
    const spray = (i: number) => call("POST", "/api/login", { body: { token: "wrong" }, headers: { host: "notes.example.com", "x-forwarded-for": `${20 + (i % 200)}.1.1.${1 + i}` } });
    for (let i = 0; i < 40; i++) expect((await spray(i)).status).toBe(401); // below the cap: no delay yet
    // Now under pressure. Three attempts, wrong, right, wrong, are spaced at least two intervals apart,
    // and the statuses are the plain ones: no 429 that would reveal the right guess.
    const t0 = Date.now();
    const a = await spray(100);
    const b = await call("POST", "/api/login", { body: { token: TOKEN }, headers: { host: "notes.example.com", "x-forwarded-for": "99.9.9.9" } });
    const c = await spray(101);
    expect([a.status, b.status, c.status]).toEqual([401, 200, 401]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(200);
  });

  it("an address that signed in before is not held up by a spray from other addresses", async () => {
    setPressureSpacingForTests(400);
    const from = (ip: string, token: string) => call("POST", "/api/login", { body: { token }, headers: { host: "notes.example.com", "x-forwarded-for": ip } });
    expect((await from("88.8.8.8", TOKEN)).status).toBe(200); // the owner signs in once from their usual address
    for (let i = 0; i < 40; i++) expect((await from(`${20 + (i % 200)}.1.1.${1 + i}`, "wrong")).status).toBe(401);
    // Under pressure now: a stranger's right guess waits in the queue, the owner's usual address does not.
    const owner = Date.now();
    expect((await from("88.8.8.8", TOKEN)).status).toBe(200);
    expect(Date.now() - owner).toBeLessThan(300);
    // The known address is still limited to five wrong guesses a minute.
    const wrong = [];
    for (let i = 0; i < 6; i++) wrong.push((await from("88.8.8.8", "wrong")).status);
    expect(wrong).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("one address cannot fill the queue: under pressure it gets two places, then is refused, whatever the token", async () => {
    setPressureSpacingForTests(300);
    for (let i = 0; i < 40; i++) await call("POST", "/api/login", { body: { token: "wrong" }, headers: { host: "notes.example.com", "x-forwarded-for": `${30 + (i % 200)}.2.2.${1 + i}` } });
    const same = { host: "notes.example.com", "x-forwarded-for": "77.7.7.7" };
    const results = await Promise.all([TOKEN, "wrong", TOKEN, "wrong", TOKEN].map((token) => call("POST", "/api/login", { body: { token }, headers: same })));
    // Per-address limit (5 attempts) is not reached, but the queue allows two at a time per address.
    expect(results.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(1);
    // Another address is not affected by that one's queue places.
    expect((await call("POST", "/api/login", { body: { token: TOKEN }, headers: { host: "notes.example.com", "x-forwarded-for": "88.8.8.8" } })).status).toBe(200);
  });

  it("a parallel burst from many addresses is paced, not waved through: the global count is taken before the gate", async () => {
    setPressureSpacingForTests(100);
    const t0 = Date.now();
    const burst = await Promise.all(Array.from({ length: 60 }, (_, i) => call("POST", "/api/login", { body: { token: "wrong" }, headers: { host: "notes.example.com", "x-forwarded-for": `${100 + i}.4.4.4` } })));
    expect(burst.every((r) => r.status === 401)).toBe(true);
    // 40 pass the gate at once; the other 20 are released one per 100 ms, so the burst takes about two seconds.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1500);
  });

  it("under pressure right and wrong guesses get the same treatment: queued, then plain 200 or 401", async () => {
    setPressureSpacingForTests(50);
    for (let i = 0; i < 40; i++) await call("POST", "/api/login", { body: { token: "wrong" }, headers: { host: "notes.example.com", "x-forwarded-for": `${30 + (i % 200)}.2.2.${1 + i}` } });
    const burst = await Promise.all(Array.from({ length: 16 }, (_, i) => call("POST", "/api/login", { body: { token: i % 2 === 0 ? TOKEN : "wrong" }, headers: { host: "notes.example.com", "x-forwarded-for": `${60 + i}.3.3.3` } })));
    burst.forEach((r, i) => expect(r.status, `attempt ${i}`).toBe(i % 2 === 0 ? 200 : 401));
  });

  it("four failures then a success is fine and clears the count", async () => {
    for (let i = 0; i < 4; i++) await login("wrong");
    expect((await login(TOKEN)).status).toBe(200);
    for (let i = 0; i < 4; i++) await login("wrong");
    expect((await login(TOKEN)).status).toBe(200);
  });

  it("health, session and logout stay open; session says whether you are signed in", async () => {
    expect((await call("GET", "/api/health")).status).toBe(200);
    expect((await call("GET", "/api/session")).json.data).toEqual({ required: true, authenticated: false });
    const cookie = cookieOf(await login(TOKEN)).split(";")[0] as string;
    expect((await call("GET", "/api/session", { headers: { cookie } })).json.data).toEqual({ required: true, authenticated: true });
    const out = await call("POST", "/api/logout");
    expect(out.status).toBe(200);
    expect(cookieOf(out)).toMatch(/Max-Age=0/);
    expect(cookieOf(out)).toContain(`${COOKIE_NAME}=;`);
  });

  it("a cross-origin POST with a valid cookie is refused with bad-origin", async () => {
    const cookie = cookieOf(await login(TOKEN)).split(";")[0] as string;
    const r = await call("POST", "/api/agents/x/run", { headers: { cookie, origin: "https://evil.example" } });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe("bad-origin");
    const login2 = await call("POST", "/api/login", { body: { token: TOKEN }, headers: { origin: "https://evil.example" } });
    expect(login2.json.error.code).toBe("bad-origin");
  });

  it("a wrong Host is refused before anything else", async () => {
    const r = await call("POST", "/api/login", { body: { token: TOKEN }, headers: { host: "evil.example" } });
    expect(r.json.error.code).toBe("bad-host");
  });

  it("without a token configured there is no login: the route says so", async () => {
    await server.close();
    server = start({ port: 0, access: { token: undefined, allowedHosts: [] } });
    await new Promise<void>((r) => server.server.once("listening", () => r()));
    const r = await call("POST", "/api/login", { body: { token: "anything" } });
    expect(r.json.data).toEqual({ required: false, authenticated: true });
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect((await call("GET", "/api/session")).json.data).toEqual({ required: false, authenticated: true });
  });
});

describe("session values", () => {
  it("accepts a fresh one, rejects expired, tampered, malformed and foreign-key ones", async () => {
    const now = Date.now();
    const good = makeSession(TOKEN, now, 60);
    expect(verifySession(good, TOKEN, now)).toBe(true);
    expect(verifySession(good, TOKEN, now + 61_000)).toBe(false); // expired
    const [payload, sig] = good.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + 99_999_999 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, TOKEN, now)).toBe(false); // payload changed, signature kept
    expect(verifySession(`${payload}.${sig.slice(0, -2)}AA`, TOKEN, now)).toBe(false); // tampered signature
    for (const bad of [undefined, "", "abc", ".", "a.", ".b", "a.b.c", `${payload}.`]) expect(verifySession(bad, TOKEN, now), String(bad)).toBe(false);
    // A value signed with another key is refused.
    await rm(sessionKeyPath());
    resetSessionKeyCache();
    expect(verifySession(good, TOKEN, now)).toBe(false);
  });

  it("a session is bound to the token: a new VIGIL_TOKEN invalidates every old session", () => {
    const now = Date.now();
    const old = makeSession("old-token", now, 60);
    expect(verifySession(old, "old-token", now)).toBe(true);
    expect(verifySession(old, "new-token", now)).toBe(false);
  });

  it("the key file is created with mode 0600 and 32 bytes, and is reused", async () => {
    makeSession(TOKEN);
    const info = await stat(sessionKeyPath());
    expect(info.mode & 0o777).toBe(0o600);
    expect(info.size).toBe(32);
    const before = makeSession(TOKEN, 1_700_000_000_000, 60);
    resetSessionKeyCache();
    expect(makeSession(TOKEN, 1_700_000_000_000, 60)).toBe(before); // same key read back from the file
  });

  it("SESSION_KEY_PATH moves the key", async () => {
    process.env.SESSION_KEY_PATH = path.join(root, "elsewhere", "k.key");
    resetSessionKeyCache();
    makeSession(TOKEN);
    expect((await stat(process.env.SESSION_KEY_PATH)).mode & 0o777).toBe(0o600);
  });
});

function fakeReq(headers: Record<string, string>, remote = "10.0.0.9", encrypted = false): IncomingMessage {
  return { headers, socket: { remoteAddress: remote, encrypted } } as unknown as IncomingMessage;
}
const access: Access = { host: "0.0.0.0", token: "t", allowedHosts: ["notes.example.com"] };

describe("client address and Secure flag behind a proxy", () => {
  it("ignores x-forwarded-for unless the Host is allowed, then takes the right-most non-private entry", () => {
    const xff = "6.6.6.6, 203.0.114.5, 10.1.1.1, 192.168.0.4";
    expect(clientIp(fakeReq({ host: "localhost:3001", "x-forwarded-for": xff }, "127.0.0.1"), access)).toBe("127.0.0.1");
    expect(clientIp(fakeReq({ host: "notes.example.com", "x-forwarded-for": xff }, "172.18.0.2"), access)).toBe("203.0.114.5");
    // a client that forges the left side cannot choose the address that is counted
    expect(clientIp(fakeReq({ host: "notes.example.com", "x-forwarded-for": "1.2.3.4, 8.8.8.8" }, "172.18.0.2"), access)).toBe("8.8.8.8");
    expect(clientIp(fakeReq({ host: "notes.example.com", "x-forwarded-for": "10.0.0.1, 192.168.1.1" }, "172.18.0.2"), access)).toBe("172.18.0.2");
    expect(clientIp(fakeReq({ host: "notes.example.com", "x-forwarded-for": "not an ip" }, "172.18.0.2"), access)).toBe("172.18.0.2");
    expect(clientIp(fakeReq({ host: "x" }, "::ffff:9.9.9.9"), access)).toBe("9.9.9.9");
  });

  it("a client connecting directly from the internet cannot forge the counted address", () => {
    const direct = fakeReq({ host: "notes.example.com", "x-forwarded-for": "8.8.8.8" }, "198.51.101.7");
    expect(clientIp(direct, access)).toBe("198.51.101.7");
    process.env.VIGIL_TRUSTED_PROXIES = "198.51.101.7";
    expect(clientIp(direct, access)).toBe("8.8.8.8"); // unless the owner listed that address as a proxy
    delete process.env.VIGIL_TRUSTED_PROXIES;
  });

  it("Secure comes from https, a trusted proxy header, or VIGIL_COOKIE_SECURE", () => {
    expect(cookieSecure(fakeReq({ host: "localhost" }), access)).toBe(false);
    expect(cookieSecure(fakeReq({ host: "localhost" }, "1.1.1.1", true), access)).toBe(true);
    expect(cookieSecure(fakeReq({ host: "notes.example.com", "x-forwarded-proto": "https" }), access)).toBe(true);
    expect(cookieSecure(fakeReq({ host: "localhost", "x-forwarded-proto": "https" }), access)).toBe(false); // not a listed host: ignored
    process.env.VIGIL_COOKIE_SECURE = "1";
    expect(cookieSecure(fakeReq({ host: "localhost" }), access)).toBe(true);
  });
});

describe("logout ends every session", () => {
  const cookieHeader = (r: Res): string => cookieOf(r).split(";")[0] ?? "";

  it("a signed-in logout makes a copied cookie stop working", async () => {
    const first = cookieHeader(await login(TOKEN));
    const copy = first; // what someone who copied the cookie holds
    expect((await call("GET", "/api/notes", { headers: { cookie: copy } })).status).toBe(200);
    expect((await call("POST", "/api/logout", { headers: { cookie: first } })).status).toBe(200);
    expect((await call("GET", "/api/notes", { headers: { cookie: copy } })).status).toBe(401);
    // Signing in again works and gives a cookie of the new epoch.
    const again = cookieHeader(await login(TOKEN));
    expect((await call("GET", "/api/notes", { headers: { cookie: again } })).status).toBe(200);
  });

  it("an anonymous logout changes nothing for anyone else", async () => {
    const mine = cookieHeader(await login(TOKEN));
    const before = sessionEpoch();
    expect((await call("POST", "/api/logout")).status).toBe(200);
    expect(sessionEpoch()).toBe(before);
    expect((await call("GET", "/api/notes", { headers: { cookie: mine } })).status).toBe(200);
  });

  it("raising the epoch refuses a session made before", () => {
    const now = Date.now();
    const fresh = makeSession(TOKEN, now, 60);
    expect(verifySession(fresh, TOKEN, now)).toBe(true);
    bumpSessionEpoch();
    expect(verifySession(fresh, TOKEN, now)).toBe(false);
    expect(verifySession(makeSession(TOKEN, now, 60), TOKEN, now)).toBe(true);
  });
});
