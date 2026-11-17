import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { type Access, hostNameOf } from "./access";
import { AppError } from "./errors";
import { isPublicAddress } from "./safe-fetch";
import { bumpSessionEpoch, hasValidSession, makeSession, sessionCookie } from "./session";

const MAX_FAILURES = 5;
const WINDOW_MS = 60_000;
/** Across all addresses: a spray from many addresses (or forged ones) still runs into this. */
const GLOBAL_MAX_FAILURES = 40;

/** Failed logins per client address: five inside a minute locks that address out for the rest of the minute. */
export class LoginLimiter {
  private readonly seen = new Map<string, { failures: number; firstAt: number }>();

  blocked(ip: string, now: number = Date.now()): boolean {
    const entry = this.seen.get(ip);
    if (!entry) return false;
    if (now - entry.firstAt >= WINDOW_MS) {
      this.seen.delete(ip);
      return false;
    }
    return entry.failures >= MAX_FAILURES;
  }

  fail(ip: string, now: number = Date.now()): void {
    const entry = this.seen.get(ip);
    if (!entry || now - entry.firstAt >= WINDOW_MS) this.seen.set(ip, { failures: 1, firstAt: now });
    else entry.failures += 1;
    // Keep the map from growing without bound under a spray of addresses.
    if (this.seen.size > 10_000) for (const [k, v] of this.seen) if (now - v.firstAt >= WINDOW_MS) this.seen.delete(k);
  }

  succeed(ip: string): void {
    this.seen.delete(ip);
  }

  private globalFailures: number[] = [];

  /** Count an attempt against the global cap; true when the cap is already used up. */
  globalBlocked(now: number = Date.now()): boolean {
    this.globalFailures = this.globalFailures.filter((t) => now - t < WINDOW_MS);
    return this.globalFailures.length >= GLOBAL_MAX_FAILURES;
  }

  globalFail(now: number = Date.now()): void {
    this.globalFailures.push(now);
  }

  /** Gap between attempts once the global failure count is high (milliseconds). */
  spacingMs = 1000;
  private nextFree = 0;
  private queued = 0;
  static readonly MAX_QUEUE = 50;
  /** One address may hold at most this many places in the queue, so a single client cannot fill it. */
  static readonly MAX_PER_IP = 2;
  private queuedByIp = new Map<string, number>();

  /**
   * Under global pressure every login attempt, right or wrong, goes through one queue that lets one
   * through per `spacingMs`. That caps guessing at about one per second across all addresses without
   * ever looking at whether a guess is right. Returns false when the queue is full (refuse outright).
   */
  async slot(ip: string, now: number = Date.now()): Promise<boolean> {
    const mine = this.queuedByIp.get(ip) ?? 0;
    if (this.queued >= LoginLimiter.MAX_QUEUE || mine >= LoginLimiter.MAX_PER_IP) return false;
    this.queued += 1;
    this.queuedByIp.set(ip, mine + 1);
    const start = Math.max(now, this.nextFree);
    this.nextFree = start + this.spacingMs;
    await new Promise<void>((resolve) => setTimeout(resolve, start - now));
    this.queued -= 1;
    const left = (this.queuedByIp.get(ip) ?? 1) - 1;
    if (left <= 0) this.queuedByIp.delete(ip);
    else this.queuedByIp.set(ip, left);
    return true;
  }

  reset(): void {
    this.seen.clear();
    this.globalFailures = [];
    this.nextFree = 0;
    this.queued = 0;
    this.queuedByIp.clear();
  }

  /** Takes back one global count (a correct token does not count as a failure). */
  globalRefund(): void {
    this.globalFailures.pop();
  }
}

const isIpAddress = (s: string): boolean => /^[0-9a-f:.]+$/i.test(s);

/**
 * The address to rate-limit. Behind a proxy the socket address is the proxy's, so x-forwarded-for is
 * trusted only when the request's Host is one the owner listed in VIGIL_ALLOWED_HOSTS; then the
 * right-most entry that is not a private address is used (earlier entries can be forged by the client).
 */
export function clientIp(req: IncomingMessage, access: Access): string {
  const socketIp = (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
  const forwarded = req.headers["x-forwarded-for"];
  // Only a proxy may speak for the client: the connection itself must come from a private or loopback
  // address (a reverse proxy on this machine or in the same Docker network) or one listed in
  // VIGIL_TRUSTED_PROXIES, and the Host must be one the owner allowed. A client connecting directly
  // from the internet cannot pick the address that is counted.
  const trustedProxies = (process.env.VIGIL_TRUSTED_PROXIES ?? "").split(",").map((p) => p.trim()).filter((p) => p !== "");
  const fromProxy = !isPublicAddress(socketIp) || trustedProxies.includes(socketIp);
  if (typeof forwarded === "string" && fromProxy && access.allowedHosts.includes(hostNameOf(req.headers.host ?? ""))) {
    const entries = forwarded.split(",").map((e) => e.trim().replace(/^::ffff:/, "")).filter((e) => e !== "");
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as string;
      if (isIpAddress(entry) && isPublicAddress(entry)) return entry;
    }
  }
  return socketIp;
}

/** Whether to mark the cookie Secure: HTTPS here, or a trusted proxy says so, or the owner forces it. */
export function cookieSecure(req: IncomingMessage, access: Access): boolean {
  if (process.env.VIGIL_COOKIE_SECURE === "1") return true;
  if ((req.socket as { encrypted?: boolean }).encrypted) return true;
  const proto = req.headers["x-forwarded-proto"];
  return typeof proto === "string" && proto.split(",")[0]?.trim() === "https" && access.allowedHosts.includes(hostNameOf(req.headers.host ?? ""));
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const limiter = new LoginLimiter();
/** Tests shorten the gap so the queue can be exercised quickly. */
export function setPressureSpacingForTests(ms: number): void {
  limiter.spacingMs = ms;
}

/** Tests start each case with a clean slate. */
export function resetLimiterForTests(): void {
  limiter.reset();
}

const MAX_LOGIN_BODY = 4096;

const BODY_TIMEOUT_MS = 5000;

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  // A client that opens a login request and never finishes it must not hold a place forever.
  const timer = setTimeout(() => req.destroy(), BODY_TIMEOUT_MS);
  try {
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_LOGIN_BODY) throw new AppError("payload-too-large", "Request body is too large", 413);
      chunks.push(chunk as Buffer);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("invalid-body", "The request body was not received in time", 400);
  } finally {
    clearTimeout(timer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError("invalid-body", "Request body is not valid JSON", 400);
  }
}

function send(res: ServerResponse, status: number, payload: unknown, cookie?: string): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...(cookie ? { "set-cookie": cookie } : {}) });
  res.end(body);
}

/**
 * /api/login, /api/logout and /api/session. Returns true when it handled the request.
 * Host and Origin were already checked by the caller; none of these three needs a token.
 */
export async function handleAuth(req: IncomingMessage, res: ServerResponse, pathname: string, access: Access): Promise<boolean> {
  if (pathname === "/api/session" && req.method === "GET") {
    const required = access.token !== undefined;
    const bearer = (req.headers.authorization ?? "").startsWith("Bearer ") && access.token !== undefined && sameSecret((req.headers.authorization ?? "").slice(7), access.token);
    send(res, 200, { data: { required, authenticated: !required || (access.token !== undefined && hasValidSession(req, access.token)) || bearer } });
    return true;
  }
  if (pathname === "/api/logout" && req.method === "POST") {
    // Only someone who is signed in can end every session; an anonymous call just clears its own (absent) cookie.
    if (access.token !== undefined && hasValidSession(req, access.token)) bumpSessionEpoch();
    send(res, 200, { data: { ok: true } }, sessionCookie("", cookieSecure(req, access), true));
    return true;
  }
  if (pathname === "/api/login" && req.method === "POST") {
    if (!access.token) {
      send(res, 200, { data: { required: false, authenticated: true } });
      return true;
    }
    const ip = clientIp(req, access);
    if (limiter.blocked(ip)) throw new AppError("too-many-attempts", "Too many tries. Wait a minute and try again.", 429);
    // Count the attempt BEFORE reading the body, so a burst of parallel requests cannot all slip past
    // the check while earlier ones are still being read. A correct token clears it again.
    limiter.fail(ip);
    // Many failures across all addresses: slow EVERY attempt down to one per spacing interval, decided
    // before the token is looked at, so the response never tells a right guess from a wrong one.
    // The attempt is counted globally before the gate (like the per-address count), so a burst of
    // parallel requests cannot all pass it; a correct token takes its count back below.
    const pressured = limiter.globalBlocked();
    limiter.globalFail();
    if (pressured && !(await limiter.slot(ip))) {
      throw new AppError("too-many-attempts", "Too many tries. Wait a minute and try again.", 429);
    }
    const body = await readBody(req);
    const given = typeof body === "object" && body !== null && typeof (body as { token?: unknown }).token === "string" ? (body as { token: string }).token : "";
    if (given === "" || !sameSecret(given, access.token)) {
      throw new AppError("unauthorized", "That token isn't right.", 401);
    }
    limiter.succeed(ip);
    limiter.globalRefund();
    send(res, 200, { data: { required: true, authenticated: true } }, sessionCookie(makeSession(access.token), cookieSecure(req, access)));
    return true;
  }
  return false;
}
