import { createPublicKey, createVerify, type KeyObject } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Cloudflare Access login (ADR-0007 amended). When Vigil runs behind Cloudflare Access, the edge
 * signs every request it lets through with a JWT in the Cf-Access-Jwt-Assertion header. A request
 * with a valid JWT counts as signed in, so the browser needs no VIGIL_TOKEN.
 *
 * The header alone proves nothing: anyone can send it. This module checks the signature against
 * the team's public keys, plus the issuer, the audience (the Access app's AUD tag) and the expiry.
 *
 * Off unless both VIGIL_ACCESS_TEAM_DOMAIN and VIGIL_ACCESS_AUD are set.
 */
export type CfAccessConfig = { teamDomain: string; aud: string };

export function cfAccessFromEnv(env: NodeJS.ProcessEnv = process.env): CfAccessConfig | null {
  const teamDomain = (env.VIGIL_ACCESS_TEAM_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const aud = (env.VIGIL_ACCESS_AUD ?? "").trim();
  if (teamDomain === "" && aud === "") return null;
  if (teamDomain === "" || aud === "") {
    throw new Error("Set both VIGIL_ACCESS_TEAM_DOMAIN and VIGIL_ACCESS_AUD, or neither.");
  }
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(teamDomain)) {
    throw new Error(`VIGIL_ACCESS_TEAM_DOMAIN must look like <team>.cloudflareaccess.com, got ${JSON.stringify(teamDomain)}`);
  }
  return { teamDomain: teamDomain.toLowerCase(), aud };
}

type Jwk = { kid?: string; kty?: string; [k: string]: unknown };
type KeySet = { keys: Map<string, KeyObject>; fetchedAt: number };

const KEYS_TTL_MS = 10 * 60 * 1000;
/** After a failed fetch, wait this long before the next try, so a bad token flood cannot hammer Cloudflare. */
const RETRY_MS = 30 * 1000;
const CLOCK_SKEW_S = 60;

export type KeyFetcher = (url: string) => Promise<{ keys?: Jwk[] }>;

const defaultFetcher: KeyFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Access certs answered ${res.status}`);
  return (await res.json()) as { keys?: Jwk[] };
};

export class CfAccessVerifier {
  private cache: KeySet | null = null;
  private lastFailure = 0;
  private inflight: Promise<KeySet | null> | null = null;

  constructor(
    private readonly config: CfAccessConfig,
    private readonly fetcher: KeyFetcher = defaultFetcher,
    private readonly now: () => number = Date.now,
  ) {}

  get issuer(): string {
    return `https://${this.config.teamDomain}`;
  }

  private async loadKeys(force: boolean): Promise<KeySet | null> {
    const t = this.now();
    if (this.cache && !force && t - this.cache.fetchedAt < KEYS_TTL_MS) return this.cache;
    if (t - this.lastFailure < RETRY_MS) return this.cache;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const body = await this.fetcher(`${this.issuer}/cdn-cgi/access/certs`);
        const keys = new Map<string, KeyObject>();
        for (const jwk of body.keys ?? []) {
          if (typeof jwk.kid !== "string" || jwk.kty !== "RSA") continue;
          keys.set(jwk.kid, createPublicKey({ key: jwk as never, format: "jwk" }));
        }
        this.cache = { keys, fetchedAt: this.now() };
        return this.cache;
      } catch (err) {
        this.lastFailure = this.now();
        console.warn(`vigil-server could not load Cloudflare Access keys: ${(err as Error).message}`);
        return this.cache;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /** The signed-in e-mail for a valid token, else null. Never throws. */
  async verify(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    let header: { alg?: unknown; kid?: unknown };
    let claims: { iss?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown; email?: unknown };
    try {
      header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
      claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    } catch {
      return null;
    }
    // Only RS256. Never let the token pick "none" or an HMAC algorithm.
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;

    let set = await this.loadKeys(false);
    let key = set?.keys.get(header.kid);
    if (!key) {
      // Cloudflare rotates keys. An unknown kid can mean our cache is old.
      set = await this.loadKeys(true);
      key = set?.keys.get(header.kid);
    }
    if (!key) return null;

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${p}`);
    if (!verifier.verify(key, Buffer.from(s, "base64url"))) return null;

    const nowS = Math.floor(this.now() / 1000);
    if (claims.iss !== this.issuer) return null;
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(this.config.aud)) return null;
    if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < nowS) return null;
    if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_S > nowS) return null;
    return typeof claims.email === "string" ? claims.email : "";
  }
}

let verifier: CfAccessVerifier | null | undefined;

function getVerifier(): CfAccessVerifier | null {
  if (verifier === undefined) {
    const config = cfAccessFromEnv();
    verifier = config ? new CfAccessVerifier(config) : null;
  }
  return verifier;
}

/** Tests swap in their own verifier (or null to turn the feature off). */
export function setCfAccessVerifierForTests(v: CfAccessVerifier | null | undefined): void {
  verifier = v;
}

const passed = new WeakSet<IncomingMessage>();

/**
 * Checks the Access JWT once per request and remembers the result, so the sync access check and
 * /api/session can ask `passedCfAccess(req)` without doing it again. Only the header is read: the
 * CF_Authorization cookie is set for the browser, and the edge always adds the header for us.
 */
export async function checkCfAccess(req: IncomingMessage): Promise<void> {
  const v = getVerifier();
  if (!v) return;
  const raw = req.headers["cf-access-jwt-assertion"];
  const token = typeof raw === "string" ? raw : undefined;
  if ((await v.verify(token)) !== null) passed.add(req);
}

export function passedCfAccess(req: IncomingMessage): boolean {
  return passed.has(req);
}
