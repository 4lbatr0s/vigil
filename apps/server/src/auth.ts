import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { type Access, hostNameOf } from "./access";
import { AppError } from "./errors";
import { isPublicAddress } from "./safe-fetch";
import { hasValidSession, makeSession, sessionCookie } from "./session";

const MAX_FAILURES = 5;
const WINDOW_MS = 60_000;

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
  if (typeof forwarded === "string" && access.allowedHosts.includes(hostNameOf(req.headers.host ?? ""))) {
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
/** Tests start each case with a clean slate. */
export function resetLimiterForTests(): void {
  (limiter as unknown as { seen: Map<string, unknown> }).seen.clear();
}

const MAX_LOGIN_BODY = 4096;

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_LOGIN_BODY) throw new AppError("payload-too-large", "Request body is too large", 413);
    chunks.push(chunk as Buffer);
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
    send(res, 200, { data: { required, authenticated: !required || hasValidSession(req) || bearer } });
    return true;
  }
  if (pathname === "/api/logout" && req.method === "POST") {
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
    const body = await readBody(req);
    const given = typeof body === "object" && body !== null && typeof (body as { token?: unknown }).token === "string" ? (body as { token: string }).token : "";
    if (given === "" || !sameSecret(given, access.token)) {
      limiter.fail(ip);
      throw new AppError("unauthorized", "That token isn't right.", 401);
    }
    limiter.succeed(ip);
    send(res, 200, { data: { required: true, authenticated: true } }, sessionCookie(makeSession(), cookieSecure(req, access)));
    return true;
  }
  return false;
}
