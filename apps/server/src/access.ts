import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { AppError } from "./errors";
import { hasValidSession } from "./session";

/** Who may reach the API (ADR-0007). */
export type Access = {
  host: string;
  /** Bearer token. Required whenever `host` is not a loopback address. */
  token: string | undefined;
  /** Extra Host header names accepted besides localhost, for example a reverse-proxy domain. */
  allowedHosts: string[];
};

/** API routes that work without credentials: health, and the login flow itself (which checks the token on its own). */
const OPEN_PATHS = new Set(["/api/health", "/api/login", "/api/logout", "/api/session"]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/** Reads HOST, VIGIL_TOKEN and VIGIL_ALLOWED_HOSTS. Defaults are local-only and need no token. */
export function accessFromEnv(overrides: Partial<Access> = {}): Access {
  const access: Access = {
    host: overrides.host ?? process.env.HOST ?? "127.0.0.1",
    token: overrides.token ?? (process.env.VIGIL_TOKEN || undefined),
    allowedHosts:
      overrides.allowedHosts ??
      (process.env.VIGIL_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length > 0),
  };
  if (!isLoopback(access.host) && !access.token) {
    throw new Error(
      `Refusing to listen on ${access.host} without VIGIL_TOKEN: set a token or bind to 127.0.0.1.`,
    );
  }
  return access;
}

export function hostNameOf(hostHeader: string): string {
  // "localhost:3001" -> "localhost"; "[::1]:3001" -> "[::1]".
  const match = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(hostHeader.trim().toLowerCase());
  return match?.[1] ?? "";
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Throws 403 for a Host header we did not expect (blocks DNS rebinding), 403 for a cross-site
 * Origin, and 401 for a missing or wrong token when one is configured. `/api/health` skips the token.
 */
export function checkAccess(req: IncomingMessage, access: Access, pathname: string): void {
  const hostHeader = req.headers.host ?? "";
  const name = hostNameOf(hostHeader);
  if (!LOCAL_NAMES.has(name) && !access.allowedHosts.includes(name)) {
    throw new AppError("bad-host", `Host not allowed: ${JSON.stringify(hostHeader)}`, 403);
  }
  const origin = req.headers.origin;
  if (typeof origin === "string") {
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      throw new AppError("bad-origin", "Origin header is not a valid URL", 403);
    }
    if (originHost !== hostHeader.trim().toLowerCase()) {
      throw new AppError("bad-origin", "Cross-origin requests are not allowed", 403);
    }
  }
  // Only the API holds data. The web app's files (everything outside /api/) and a few open API routes
  // need no credentials; the Host and Origin checks above still apply to them.
  if (access.token && pathname.startsWith("/api/") && !OPEN_PATHS.has(pathname)) {
    const auth = req.headers.authorization ?? "";
    const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!sameToken(given, access.token) && !hasValidSession(req, access.token)) {
      throw new AppError("unauthorized", "Missing or wrong token", 401);
    }
  }
}
