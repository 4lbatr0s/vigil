import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { statePath } from "./state-db";

/**
 * Secrets the owner types into the app (model API keys, ADR-0026), encrypted at rest with AES-256-GCM.
 * The 32-byte key comes from VIGIL_SECRET_KEY (any text, hashed) or from a 0600 file beside state.db, made on first
 * use. This protects a copy of state.db on its own; someone who holds both files can read the keys.
 */

const PREFIX = "v1:";

export function secretKeyPath(): string {
  return process.env.SECRET_KEY_PATH ? path.resolve(process.env.SECRET_KEY_PATH) : path.join(path.dirname(statePath()), "secret.key");
}

let cached: { id: string; key: Buffer } | null = null;

function getKey(): Buffer {
  const fromEnv = process.env.VIGIL_SECRET_KEY;
  if (fromEnv && fromEnv.length >= 16) {
    const id = `env:${fromEnv}`;
    if (cached?.id !== id) cached = { id, key: createHash("sha256").update(`vigil-secrets-v1:${fromEnv}`).digest() };
    return cached.key;
  }
  const file = secretKeyPath();
  if (cached?.id === file) return cached.key;
  let key: Buffer;
  if (existsSync(file)) {
    key = readFileSync(file);
    if (key.length < 32) throw new Error("secret key file is too short; delete it to create a new one (saved keys stop working)");
  } else {
    mkdirSync(path.dirname(file), { recursive: true });
    key = randomBytes(32);
    writeFileSync(file, key, { mode: 0o600, flag: "wx" });
    chmodSync(file, 0o600);
  }
  cached = { id: file, key };
  return key;
}

export function resetSecretKeyCache(): void {
  cached = null;
}

/** `v1:<base64url of iv(12) + tag(16) + ciphertext>`. A fresh random iv every time. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** The text, or `null` when the value is not ours, was tampered with, or the key changed. Never throws on bad input. */
export function decryptSecret(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return null;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
  if (raw.length < 12 + 16 + 1) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", getKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    // A wrong key or a changed value fails the authentication tag; that is the "cannot read it" answer.
    return null;
  }
}

/** Keys seen this run (saved, probed, or used), so `redact` can strip them from any text. */
const known = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
  if (value && value.length >= 6) known.add(value);
}

export function knownSecrets(): string[] {
  return [...known];
}
