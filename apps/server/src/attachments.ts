import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { AppError } from "./errors";
import { listNotes, vaultDir } from "./vault";

/**
 * Pasted images (ADR-0021). They live in `attachments/` inside the vault so they travel with the notes and
 * an ordinary markdown viewer shows them through the relative link `![](attachments/<name>)`.
 * Only four raster formats are accepted, decided by the file's own first bytes, never by what the client
 * claims. SVG is refused on purpose: it can carry script.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageKind = { ext: "png" | "jpg" | "gif" | "webp"; mime: string };

const KINDS: Record<string, ImageKind> = {
  png: { ext: "png", mime: "image/png" },
  jpg: { ext: "jpg", mime: "image/jpeg" },
  gif: { ext: "gif", mime: "image/gif" },
  webp: { ext: "webp", mime: "image/webp" },
};

/** What the bytes are, or null when they are not one of the four allowed images. */
export function sniffImage(b: Buffer): ImageKind | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return KINDS["png"]!;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return KINDS["jpg"]!;
  if (b.length >= 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a")) return KINDS["gif"]!;
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return KINDS["webp"]!;
  return null;
}

/** The only file names this module reads or writes: 16 hex characters of the content hash, then the extension. */
export const ATTACHMENT_NAME = /^[a-f0-9]{16}\.(png|jpg|gif|webp)$/;

const dir = (): string => path.join(vaultDir(), "attachments");

/** Stores an image under its content hash (the same picture twice is one file) and returns its name. */
export async function saveAttachment(bytes: Buffer): Promise<{ name: string; bytes: number }> {
  if (bytes.length === 0) throw new AppError("invalid-body", "The image is empty", 400);
  if (bytes.length > MAX_IMAGE_BYTES) throw new AppError("payload-too-large", "Images can be up to 5 MB", 413);
  const kind = sniffImage(bytes);
  if (!kind) throw new AppError("unsupported-image", "Only PNG, JPEG, GIF and WebP images can be added", 415);
  const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.${kind.ext}`;
  await mkdir(dir(), { recursive: true });
  const file = path.join(dir(), name);
  const exists = await stat(file).then(() => true, () => false);
  if (!exists) {
    const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await writeFile(tmp, bytes);
      await rename(tmp, file);
    } catch (err) {
      await unlink(tmp).catch(() => undefined); // best-effort cleanup; the original error is rethrown
      throw err;
    }
  }
  return { name, bytes: bytes.length };
}

export async function readAttachment(name: string): Promise<{ bytes: Buffer; mime: string }> {
  const m = ATTACHMENT_NAME.exec(name);
  if (!m) throw new AppError("attachment-not-found", "Image not found", 404);
  const kind = KINDS[m[1] ?? ""];
  try {
    return { bytes: await readFile(path.join(dir(), name)), mime: kind?.mime ?? "application/octet-stream" };
  } catch {
    throw new AppError("attachment-not-found", "Image not found", 404);
  }
}

/** A picture must be this old before it can count as unused: a fresh paste may not be saved into its note yet. */
export const UNUSED_AFTER_MS = 60 * 60 * 1000;

export type UnusedImage = { name: string; bytes: number };

const LINK = /attachments\/([a-f0-9]{16}\.(?:png|jpg|gif|webp))/g;

/** Pictures in the vault that no note links to and that are over an hour old. */
export async function unusedAttachments(now: Date): Promise<UnusedImage[]> {
  const files = await readdir(dir()).catch(() => [] as string[]);
  if (files.length === 0) return [];
  const used = new Set<string>();
  for (const note of await listNotes()) for (const m of note.body.matchAll(LINK)) used.add(m[1] ?? "");
  const out: UnusedImage[] = [];
  for (const name of files) {
    if (!ATTACHMENT_NAME.test(name) || used.has(name)) continue;
    const info = await stat(path.join(dir(), name));
    if (now.getTime() - info.mtimeMs >= UNUSED_AFTER_MS) out.push({ name, bytes: info.size });
  }
  return out;
}

/** Deletes the unused pictures and returns what went. Anything a note links to is never touched. */
export async function tidyAttachments(now: Date): Promise<{ removed: number; bytes: number }> {
  const unused = await unusedAttachments(now);
  for (const u of unused) await unlink(path.join(dir(), u.name));
  return { removed: unused.length, bytes: unused.reduce((n, u) => n + u.bytes, 0) };
}
