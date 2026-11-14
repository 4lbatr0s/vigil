import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { checkAccess, type Access } from "./access";
import { AppError, isAppError } from "./errors";
import { healthPayload } from "./health";
import {
  getNote as indexGetNote,
  listNotes as indexListNotes,
  reindexNote,
  removeNote,
  searchNotes,
} from "./index-db";
import { createNote, deleteNote, getNote as vaultGetNote, slugify, updateNote } from "./vault";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

const NoteInputSchema = z.object({
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()).optional(),
  /** `updatedAt` the client last saw. A different value on an existing note gives 409. */
  baseUpdatedAt: z.string().optional(),
});

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>,
  url: URL,
) => void | Promise<void>;

const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [
  {
    method: "GET",
    pattern: /^\/api\/health$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: healthPayload() });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/notes$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: indexListNotes() });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/notes\/([^/]+)$/,
    keys: ["id"],
    handler: async (_req, res, params) => {
      const id = params["id"] ?? "";
      const fromIndex = indexGetNote(id);
      if (fromIndex) {
        send(res, 200, { data: fromIndex });
        return;
      }
      const fromVault = await vaultGetNote(id);
      send(res, 200, { data: fromVault });
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/notes\/([^/]+)$/,
    keys: ["id"],
    handler: async (req, res, params) => {
      const id = params["id"] ?? "";
      const raw = await readJsonBody(req);
      const parsed = NoteInputSchema.safeParse(raw);
      if (!parsed.success) {
        throw new AppError(
          "invalid-body",
          "Body must be { title: string, body: string, tags?: string[], baseUpdatedAt?: string }",
          400,
        );
      }
      const { title, body, tags, baseUpdatedAt } = parsed.data;
      const slug = slugify(title);
      const existing = (await existsInVault(id)) || indexGetNote(id) !== null;
      if (slug !== id && !existing) {
        throw new AppError("invalid-id", `Note id ${id} does not match title slug ${slug}`, 400);
      }
      const note = existing
        ? await updateNote(id, { title, body, ...(tags ? { tags } : {}) }, { expectedUpdatedAt: baseUpdatedAt })
        : await createNote({ title, body, ...(tags ? { tags } : {}) });
      reindexNote(note);
      send(res, 200, { data: note });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/notes\/([^/]+)$/,
    keys: ["id"],
    handler: async (_req, res, params) => {
      const id = params["id"] ?? "";
      await deleteNote(id);
      removeNote(id);
      send(res, 200, { data: { id } });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/search$/,
    keys: [],
    handler: (_req, res, _params, url) => {
      const q = url.searchParams.get("q") ?? "";
      send(res, 200, { data: searchNotes(q) });
    },
  },
];

/** The file is the truth: a missing note is `false`, any other failure surfaces. */
async function existsInVault(id: string): Promise<boolean> {
  try {
    await vaultGetNote(id);
    return true;
  } catch (err) {
    if (isAppError(err) && err.code === "note-not-found") return false;
    throw err;
  }
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      throw new AppError("payload-too-large", "Request body exceeds 2MB", 413);
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) {
    throw new AppError("invalid-body", "Request body is empty", 400);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("invalid-body", "Request body is not valid JSON", 400);
  }
}

export function createHandler(access: Access): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      try {
        checkAccess(req, access, url.pathname);
        for (const route of routes) {
          if (route.method !== req.method) continue;
          const match = route.pattern.exec(url.pathname);
          if (!match) continue;
          const params: Record<string, string> = {};
          route.keys.forEach((key, i) => {
            params[key] = decodeURIComponent(match[i + 1] ?? "");
          });
          await route.handler(req, res, params, url);
          return;
        }
        throw new AppError("not-found", `No route for ${req.method} ${url.pathname}`, 404);
      } catch (err) {
        if (isAppError(err)) {
          send(res, err.status, { error: { code: err.code, message: err.message } });
          return;
        }
        const message = err instanceof Error ? err.message : "Unexpected error";
        send(res, 500, { error: { code: "internal", message } });
      }
    })();
  };
}
