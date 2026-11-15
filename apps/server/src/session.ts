import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { statePath } from "./state-db";

export const COOKIE_NAME = "vigil_session";
export const SESSION_SECONDS = 30 * 24 * 3600;

/** Where the signing key lives: SESSION_KEY_PATH, else next to state.db. */
export function sessionKeyPath(): string {
  return process.env.SESSION_KEY_PATH ? path.resolve(process.env.SESSION_KEY_PATH) : path.join(path.dirname(statePath()), "session.key");
}

let cached: { file: string; key: Buffer } | null = null;

/** 32 random bytes, created on first use with mode 0600 and never logged. Deleting the file logs everyone out. */
export function getSessionKey(): Buffer {
  const file = sessionKeyPath();
  if (cached && cached.file === file) return cached.key;
  let key: Buffer;
  if (existsSync(file)) {
    key = readFileSync(file);
    if (key.length < 32) throw new Error("session key file is too short; delete it to create a new one");
  } else {
    mkdirSync(path.dirname(file), { recursive: true });
    key = randomBytes(32);
    writeFileSync(file, key, { mode: 0o600, flag: "wx" });
    chmodSync(file, 0o600); // the mode above is filtered by the umask; set it for real
  }
  cached = { file, key };
  return key;
}

export function resetSessionKeyCache(): void {
  cached = null;
}

const b64 = (buf: Buffer): string => buf.toString("base64url");

/**
 * The signing key is derived from the key file AND the access token, so changing VIGIL_TOKEN
 * invalidates every session at once (ADR-0013 amended), and so does deleting the key file.
 */
function signingKey(secret: string): Buffer {
  return createHmac("sha256", getSessionKey()).update(`vigil-session-v1:${secret}`).digest();
}

function sign(payload: string, secret: string): string {
  return b64(createHmac("sha256", signingKey(secret)).update(payload).digest());
}

/** `<payload>.<signature>`: payload is base64url of {"exp": unix seconds}. `secret` is the configured access token. */
export function makeSession(secret: string, nowMs: number = Date.now(), ttlSeconds: number = SESSION_SECONDS): string {
  const payload = b64(Buffer.from(JSON.stringify({ exp: Math.floor(nowMs / 1000) + ttlSeconds })));
  return `${payload}.${sign(payload, secret)}`;
}

/** True for a well-formed, correctly signed, unexpired session value. */
export function verifySession(value: string | undefined, secret: string, nowMs: number = Date.now()): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1 || value.indexOf(".", dot + 1) !== -1) return false;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof parsed.exp === "number" && Number.isFinite(parsed.exp) && parsed.exp * 1000 > nowMs;
  } catch {
    return false;
  }
}

export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== "string") return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function hasValidSession(req: IncomingMessage, secret: string): boolean {
  return verifySession(readCookie(req, COOKIE_NAME), secret);
}

/** The Set-Cookie value for a new session (or an immediate expiry when `clear`). */
export function sessionCookie(value: string, secure: boolean, clear = false): string {
  const parts = [`${COOKIE_NAME}=${clear ? "" : value}`, "HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${clear ? 0 : SESSION_SECONDS}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
