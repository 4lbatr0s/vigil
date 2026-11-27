import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { CfAccessVerifier, cfAccessFromEnv, setCfAccessVerifierForTests } from "./cf-access";
import { closeDb } from "./index-db";
import { start, type RunningServer } from "./server";

const TEAM = "team.cloudflareaccess.com";
const ISS = `https://${TEAM}`;
const AUD = "aud-tag-123";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "k1", kty: "RSA" };

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64url");

function makeJwt(claims: Record<string, unknown>, opts: { key?: KeyObject; kid?: string; alg?: string } = {}): string {
  const head = b64({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" });
  const body = b64(claims);
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(opts.key ?? privateKey).toString("base64url")}`;
}

const nowS = (): number => Math.floor(Date.now() / 1000);
const good = (): Record<string, unknown> => ({ iss: ISS, aud: [AUD], exp: nowS() + 600, email: "owner@example.com" });

function verifier(): { v: CfAccessVerifier; calls: () => number } {
  let n = 0;
  const v = new CfAccessVerifier({ teamDomain: TEAM, aud: AUD }, async (url) => {
    n += 1;
    expect(url).toBe(`${ISS}/cdn-cgi/access/certs`);
    return { keys: [jwk] };
  });
  return { v, calls: () => n };
}

describe("cfAccessFromEnv", () => {
  it("is off when neither variable is set", () => {
    expect(cfAccessFromEnv({})).toBeNull();
  });
  it("refuses half a configuration", () => {
    expect(() => cfAccessFromEnv({ VIGIL_ACCESS_AUD: "x" })).toThrow(/both/);
    expect(() => cfAccessFromEnv({ VIGIL_ACCESS_TEAM_DOMAIN: TEAM })).toThrow(/both/);
  });
  it("refuses a team domain that is not a Cloudflare Access domain", () => {
    expect(() => cfAccessFromEnv({ VIGIL_ACCESS_TEAM_DOMAIN: "evil.example.com", VIGIL_ACCESS_AUD: "x" })).toThrow(/cloudflareaccess/);
  });
  it("strips a scheme and a trailing slash", () => {
    expect(cfAccessFromEnv({ VIGIL_ACCESS_TEAM_DOMAIN: `https://${TEAM}/`, VIGIL_ACCESS_AUD: AUD })).toEqual({ teamDomain: TEAM, aud: AUD });
  });
});

describe("CfAccessVerifier", () => {
  it("accepts a valid token and returns the e-mail", async () => {
    expect(await verifier().v.verify(makeJwt(good()))).toBe("owner@example.com");
  });
  it("accepts a plain-string aud", async () => {
    expect(await verifier().v.verify(makeJwt({ ...good(), aud: AUD }))).toBe("owner@example.com");
  });
  it("rejects a missing or malformed token", async () => {
    const { v } = verifier();
    expect(await v.verify(undefined)).toBeNull();
    expect(await v.verify("abc")).toBeNull();
    expect(await v.verify("a.b.c")).toBeNull();
  });
  it("rejects a token signed by another key", async () => {
    expect(await verifier().v.verify(makeJwt(good(), { key: other.privateKey }))).toBeNull();
  });
  it("rejects a tampered payload", async () => {
    const [h, , s] = makeJwt(good()).split(".");
    expect(await verifier().v.verify(`${h}.${b64({ ...good(), email: "x@y.z" })}.${s}`)).toBeNull();
  });
  it("rejects alg none and HS256", async () => {
    const { v } = verifier();
    const [, p] = makeJwt(good()).split(".");
    expect(await v.verify(`${b64({ alg: "none", kid: "k1" })}.${p}.`)).toBeNull();
    expect(await v.verify(makeJwt(good(), { alg: "HS256" }))).toBeNull();
  });
  it("rejects the wrong issuer, audience, an expired and a not-yet-valid token", async () => {
    const { v } = verifier();
    expect(await v.verify(makeJwt({ ...good(), iss: "https://other.cloudflareaccess.com" }))).toBeNull();
    expect(await v.verify(makeJwt({ ...good(), aud: ["other-app"] }))).toBeNull();
    expect(await v.verify(makeJwt({ ...good(), exp: nowS() - 3600 }))).toBeNull();
    expect(await v.verify(makeJwt({ ...good(), exp: undefined }))).toBeNull();
    expect(await v.verify(makeJwt({ ...good(), nbf: nowS() + 3600 }))).toBeNull();
  });
  it("rejects an unknown kid and caches the key set", async () => {
    const { v, calls } = verifier();
    await v.verify(makeJwt(good()));
    await v.verify(makeJwt(good()));
    expect(calls()).toBe(1);
    expect(await v.verify(makeJwt(good(), { kid: "nope" }))).toBeNull();
    expect(calls()).toBe(2); // one forced refresh for the unknown kid
  });
  it("returns null when the key fetch fails", async () => {
    const v = new CfAccessVerifier({ teamDomain: TEAM, aud: AUD }, async () => {
      throw new Error("down");
    });
    expect(await v.verify(makeJwt(good()))).toBeNull();
  });
});

describe("Access JWT on the API", () => {
  let vault = "";
  let dbDir = "";
  let guarded: RunningServer;

  function call(headers: Record<string, string>, pathname = "/api/notes"): Promise<{ status: number; body: string }> {
    const a = guarded.server.address();
    const port = typeof a === "object" && a ? a.port : 0;
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: pathname, method: "GET", headers }, (res) => {
        let text = "";
        res.on("data", (c: Buffer) => (text += c.toString()));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
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
    setCfAccessVerifierForTests(verifier().v);
    guarded = start({ port: 0, access: { token: "s3cret", allowedHosts: ["notes.example.com"] } });
    await new Promise<void>((resolve) => guarded.server.once("listening", () => resolve()));
  });

  afterAll(async () => {
    setCfAccessVerifierForTests(undefined);
    await guarded.close();
    closeDb();
    await rm(vault, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  });

  const host = { host: "notes.example.com" };

  it("opens the API for a valid Access JWT without a token", async () => {
    expect((await call({ ...host, "cf-access-jwt-assertion": makeJwt(good()) })).status).toBe(200);
  });
  it("still refuses a forged or missing JWT", async () => {
    expect((await call(host)).status).toBe(401);
    expect((await call({ ...host, "cf-access-jwt-assertion": makeJwt(good(), { key: other.privateKey }) })).status).toBe(401);
  });
  it("still accepts the bearer token", async () => {
    expect((await call({ ...host, authorization: "Bearer s3cret" })).status).toBe(200);
  });
  it("reports the session as signed in for a valid JWT", async () => {
    const signedIn = await call({ ...host, "cf-access-jwt-assertion": makeJwt(good()) }, "/api/session");
    expect(JSON.parse(signedIn.body).data).toEqual({ required: true, authenticated: true });
    const anon = await call(host, "/api/session");
    expect(JSON.parse(anon.body).data).toEqual({ required: true, authenticated: false });
  });
  it("does not let a JWT bypass the Host check", async () => {
    expect((await call({ host: "evil.example.com", "cf-access-jwt-assertion": makeJwt(good()) })).status).toBe(403);
  });
});
