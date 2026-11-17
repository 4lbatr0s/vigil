import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { slugify } from "@vigil/shared";
import { AppError } from "./errors";
import { withNoteLock } from "./lock";
import { validateId, vaultDir } from "./vault";

/**
 * Canvases (ADR-0027): free boards of note cards, text and groups, saved in the open JSON Canvas 1.0 format
 * (jsoncanvas.org, made for Obsidian) as `canvases/<id>.canvas` inside the vault, so Obsidian opens them too.
 * Unknown fields are kept on a round trip: another app may add its own.
 */

export const MAX_CANVAS_BYTES = 2 * 1024 * 1024;
export const MAX_NODES = 2000;
export const MAX_EDGES = 4000;
const MAX_TEXT = 100_000;

const Side = z.enum(["top", "right", "bottom", "left"]);
const End = z.enum(["none", "arrow"]);
const Color = z.string().max(20).regex(/^([1-6]|#[0-9a-fA-F]{3,8})$/, 'A color is "1" to "6" or a hex value like #ff8800');

const Common = { id: z.string().min(1).max(100), x: z.number().int(), y: z.number().int(), width: z.number().int().min(1).max(100_000), height: z.number().int().min(1).max(100_000), color: Color.optional() };

const TextNode = z.looseObject({ ...Common, type: z.literal("text"), text: z.string().max(MAX_TEXT) });
const FileNode = z.looseObject({ ...Common, type: z.literal("file"), file: z.string().min(1).max(500), subpath: z.string().max(500).optional() });
const LinkNode = z.looseObject({ ...Common, type: z.literal("link"), url: z.string().min(1).max(2000) });
const GroupNode = z.looseObject({ ...Common, type: z.literal("group"), label: z.string().max(500).optional(), background: z.string().max(500).optional(), backgroundStyle: z.enum(["cover", "ratio", "repeat"]).optional() });
export const NodeSchema = z.discriminatedUnion("type", [TextNode, FileNode, LinkNode, GroupNode]);

export const EdgeSchema = z.looseObject({ id: z.string().min(1).max(100), fromNode: z.string().min(1).max(100), fromSide: Side.optional(), fromEnd: End.optional(), toNode: z.string().min(1).max(100), toSide: Side.optional(), toEnd: End.optional(), color: Color.optional(), label: z.string().max(1000).optional() });

export const CanvasSchema = z
  .looseObject({ nodes: z.array(NodeSchema).max(MAX_NODES).optional(), edges: z.array(EdgeSchema).max(MAX_EDGES).optional() })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    for (const n of c.nodes ?? []) {
      if (ids.has(n.id)) ctx.addIssue({ code: "custom", message: `Two items share the id ${n.id}` });
      ids.add(n.id);
    }
    const nodeIds = new Set(ids);
    for (const e of c.edges ?? []) {
      if (ids.has(e.id)) ctx.addIssue({ code: "custom", message: `Two items share the id ${e.id}` });
      ids.add(e.id);
      if (!nodeIds.has(e.fromNode) || !nodeIds.has(e.toNode)) ctx.addIssue({ code: "custom", message: `The arrow ${e.id} points at a card that does not exist` });
    }
  });
export type Canvas = z.infer<typeof CanvasSchema>;

const dir = (): string => path.join(vaultDir(), "canvases");
const fileOf = (id: string): string => path.join(dir(), `${validateId(id)}.canvas`);

export type CanvasSummary = { id: string; updatedAt: string; nodes: number };

export async function listCanvases(): Promise<CanvasSummary[]> {
  let names: string[];
  try {
    names = await readdir(dir());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: CanvasSummary[] = [];
  for (const name of names) {
    const m = /^([a-z0-9][a-z0-9-]*)\.canvas$/.exec(name);
    if (!m?.[1]) continue;
    const info = await stat(path.join(dir(), name));
    let nodes = 0;
    try {
      const parsed = JSON.parse(await readFile(path.join(dir(), name), "utf8")) as { nodes?: unknown[] };
      nodes = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
    } catch {
      // A file that is not JSON (Obsidian users edit these by hand) is still listed; opening it explains the problem.
      nodes = 0;
    }
    out.push({ id: m[1], updatedAt: info.mtime.toISOString(), nodes });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readCanvas(id: string): Promise<{ id: string; updatedAt: string; canvas: Canvas }> {
  const file = fileOf(id);
  let text: string;
  let info;
  try {
    [text, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new AppError("canvas-not-found", `Canvas not found: ${id}`, 404);
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AppError("canvas-invalid", `The file ${id}.canvas is not valid JSON, so it cannot be opened here. Fix it in a text editor.`, 422);
  }
  const parsed = CanvasSchema.safeParse(json);
  if (!parsed.success) throw new AppError("canvas-invalid", `The file ${id}.canvas is not a valid JSON Canvas: ${parsed.error.issues[0]?.message ?? "unknown problem"}`, 422);
  return { id, updatedAt: info.mtime.toISOString(), canvas: parsed.data };
}

async function writeAtomic(file: string, content: string): Promise<Date> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
  return (await stat(file)).mtime;
}

/** A new empty canvas named from a title; a taken name gets `-2`, `-3`... */
export async function createCanvas(title: string): Promise<{ id: string; updatedAt: string }> {
  const base = slugify(title) || "canvas";
  return withNoteLock(async () => {
    for (let n = 1; n < 100; n++) {
      const id = n === 1 ? base : `${base.slice(0, 70)}-${n}`;
      try {
        await stat(fileOf(id));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        const at = await writeAtomic(fileOf(id), JSON.stringify({ nodes: [], edges: [] }, null, 2));
        return { id, updatedAt: at.toISOString() };
      }
    }
    throw new AppError("canvas-exists", "Too many canvases with that name", 409);
  });
}

export const SaveBodySchema = z.object({ canvas: CanvasSchema, baseUpdatedAt: z.string().optional() });

/** Replaces the canvas. When `baseUpdatedAt` is given and the file changed since, answers 409 so a newer edit is never overwritten. */
export async function saveCanvas(id: string, canvas: Canvas, baseUpdatedAt?: string): Promise<{ id: string; updatedAt: string }> {
  const text = JSON.stringify(canvas, null, 2);
  if (Buffer.byteLength(text) > MAX_CANVAS_BYTES) throw new AppError("payload-too-large", "This canvas is over 2 MB", 413);
  return withNoteLock(async () => {
    const file = fileOf(id);
    let current: Date | null = null;
    try {
      current = (await stat(file)).mtime;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (current === null) throw new AppError("canvas-not-found", `Canvas not found: ${id}`, 404);
    if (baseUpdatedAt !== undefined && current.toISOString() !== baseUpdatedAt) throw new AppError("canvas-conflict", "This canvas was changed somewhere else since you opened it. Reload it to see the newer version.", 409);
    return { id, updatedAt: (await writeAtomic(file, text)).toISOString() };
  });
}

export async function removeCanvas(id: string): Promise<void> {
  await withNoteLock(async () => {
    try {
      await unlink(fileOf(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new AppError("canvas-not-found", `Canvas not found: ${id}`, 404);
      throw err;
    }
  });
}
