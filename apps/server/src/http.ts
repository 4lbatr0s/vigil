import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { checkAccess, type Access } from "./access";
import { AppError, isAppError } from "./errors";
import { healthPayload } from "./health";
import {
  getNote as indexGetNote,
  listNotes as indexListNotes,
  listNoteSummaries,
  backlinks as indexBacklinks,
  reindexNote,
  removeNote,
  searchNotes,
} from "./index-db";
import { AgentNameSchema, AgentSchema, PermissionSettingsSchema, TEMPLATES } from "@vigil/shared";
import { withNoteLock } from "./lock";
import { cronError, nextTickAfter } from "./cron";
import { attachStream } from "./events";
import { startRun, undoRun } from "./runs";
import { getPermissions, putPermissions } from "./permissions";
import { planRename, renameNote } from "./rename";
import { refreshSchedule } from "./scheduler";
import { llmStatus } from "./llm-status";
import { usage } from "./usage";
import { getAgent, getRun, getSchedule, listAgents, listEvents, listRuns, putAgent, putSchedule } from "./state-db";
import { createNote, deleteNote, getNote as vaultGetNote, slugify, updateNote, validateId } from "./vault";

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
    handler: (_req, res, _params, url) => {
      const fields = url.searchParams.get("fields");
      if (fields !== null && fields !== "summary") throw new AppError("invalid-query", "fields must be summary", 400);
      send(res, 200, { data: fields === "summary" ? listNoteSummaries() : indexListNotes() });
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
    method: "POST",
    pattern: /^\/api\/notes\/([^/]+)\/rename$/,
    keys: ["id"],
    handler: async (req, res, params, url) => {
      const parsed = z.object({ title: z.string().min(1).max(200) }).safeParse(await readJsonBody(req));
      if (!parsed.success) throw new AppError("invalid-body", "title is required (1 to 200 characters)", 400);
      const id = validateId(params["id"] ?? "");
      if (url.searchParams.get("dryRun") === "1") {
        send(res, 200, { data: await planRename(id, parsed.data.title) });
        return;
      }
      send(res, 200, { data: await renameNote(id, parsed.data.title) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/notes\/([^/]+)\/backlinks$/,
    keys: ["id"],
    handler: (_req, res, params) => {
      send(res, 200, { data: indexBacklinks(validateId(params["id"] ?? "")) });
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
      const note = await withNoteLock(async () => {
        const existing = (await existsInVault(id)) || indexGetNote(id) !== null;
        if (slug !== id && !existing) {
          throw new AppError("invalid-id", `Note id ${id} does not match title slug ${slug}`, 400);
        }
        const saved = existing
          ? await updateNote(id, { title, body, ...(tags ? { tags } : {}) }, { expectedUpdatedAt: baseUpdatedAt })
          : await createNote({ title, body, ...(tags ? { tags } : {}) });
        reindexNote(saved);
        return saved;
      });
      send(res, 200, { data: note });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/notes\/([^/]+)$/,
    keys: ["id"],
    handler: async (_req, res, params) => {
      const id = params["id"] ?? "";
      await withNoteLock(async () => {
        await deleteNote(id);
        removeNote(id);
      });
      send(res, 200, { data: { id } });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/agents$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: listAgents() });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/agents\/([^/]+)$/,
    keys: ["name"],
    handler: (_req, res, params) => {
      const agent = getAgent(params["name"] ?? "");
      if (!agent) throw new AppError("agent-not-found", `Agent not found: ${params["name"]}`, 404);
      send(res, 200, { data: agent });
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/agents\/([^/]+)$/,
    keys: ["name"],
    handler: async (req, res, params) => {
      const rawBody = await readJsonBody(req);
      const hasStrict = typeof rawBody === "object" && rawBody !== null && "strict" in rawBody;
      const parsed = AgentSchema.safeParse(rawBody);
      if (!parsed.success) {
        throw new AppError("invalid-body", `Invalid agent: ${parsed.error.issues[0]?.message ?? "bad shape"}`, 400);
      }
      if (parsed.data.name !== params["name"]) {
        throw new AppError("invalid-body", "Agent name in the body must match the URL", 400);
      }
      const trigger = parsed.data.trigger;
      if (trigger.kind === "cron") {
        const problem = cronError(trigger.expression, trigger.timezone);
        if (problem) throw new AppError("invalid-body", problem, 400);
      }
      if (trigger.kind === "heartbeat" && !parsed.data.tools.includes("read_notes")) {
        throw new AppError("invalid-body", "A heartbeat agent needs the read_notes tool: it has nothing to watch without it", 400);
      }
      const before = getAgent(parsed.data.name);
      // Saved without a `strict` value: a new agent gets the owner's default, an existing one keeps its setting.
      if (!hasStrict) parsed.data.strict = before ? before.strict : getPermissions().newAgentsStrict;
      const saved = putAgent(parsed.data);
      // A new or changed schedule, or a re-enabled agent, starts from a fresh baseline (no immediate past run).
      if (JSON.stringify(before?.trigger) !== JSON.stringify(saved.trigger) || before?.enabled !== saved.enabled) {
        putSchedule(saved.name, { lastScheduledFor: null, lastSkipReason: null });
      }
      refreshSchedule(saved.name);
      send(res, 200, { data: saved });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/settings\/permissions$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: getPermissions() });
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/settings\/permissions$/,
    keys: [],
    handler: async (req, res) => {
      const parsed = PermissionSettingsSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        // The field path lets the settings page show the message under the right input.
        const where = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        throw new AppError("invalid-body", `Invalid settings: ${where}${issue?.message ?? "bad shape"}`, 400);
      }
      send(res, 200, { data: putPermissions(parsed.data) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/llm\/status$/,
    keys: [],
    handler: async (req, res) => {
      const probe = new URL(req.url ?? "/", "http://localhost").searchParams.get("probe") === "1";
      send(res, 200, { data: await llmStatus(probe) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/events$/,
    keys: [],
    handler: (req, res) => {
      attachStream(req, res);
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/usage$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: usage() });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/agent-templates$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: TEMPLATES });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/agents\/from-template\/([^/]+)$/,
    keys: ["id"],
    handler: async (req, res, params) => {
      const template = TEMPLATES.find((t) => t.id === params["id"]);
      if (!template) throw new AppError("template-not-found", `Template not found: ${params["id"]}`, 404);
      const parsedBody = z.object({ name: AgentNameSchema.optional() }).safeParse(await readJsonBody(req, { emptyIs: {} }));
      if (!parsedBody.success) throw new AppError("invalid-body", "name must be lowercase letters, digits and dashes", 400);
      const name = parsedBody.data.name ?? template.id;
      if (getAgent(name)) throw new AppError("agent-exists", `An agent named ${name} already exists`, 409);
      // Templates ship switched off: nothing runs or is scheduled until the owner turns the agent on.
      const saved = putAgent(AgentSchema.parse({ ...template.agent, name, enabled: false, strict: getPermissions().newAgentsStrict }));
      send(res, 201, { data: saved });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/agents\/([^/]+)\/schedule$/,
    keys: ["name"],
    handler: (_req, res, params) => {
      const agent = getAgent(params["name"] ?? "");
      if (!agent) throw new AppError("agent-not-found", `Agent not found: ${params["name"]}`, 404);
      const state = getSchedule(agent.name);
      const nextRunAt =
        agent.enabled && agent.trigger.kind === "cron" && !cronError(agent.trigger.expression, agent.trigger.timezone)
          ? (nextTickAfter(agent.trigger.expression, agent.trigger.timezone, new Date())?.toISOString() ?? null)
          : null;
      send(res, 200, {
        data: {
          trigger: agent.trigger,
          enabled: agent.enabled,
          nextRunAt,
          lastScheduledFor: state?.lastScheduledFor ?? null,
          lastStartedAt: state?.lastStartedAt ?? null,
          lastSkipReason: state?.lastSkipReason ?? null,
        },
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/agents\/([^/]+)\/run$/,
    keys: ["name"],
    handler: async (req, res, params) => {
      const raw = await readOptionalJsonBody(req);
      const parsed = z.object({ task: z.string().min(1).optional() }).safeParse(raw);
      if (!parsed.success) throw new AppError("invalid-body", "Body must be { task?: string }", 400);
      send(res, 202, { data: startRun(params["name"] ?? "", parsed.data.task) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/runs$/,
    keys: [],
    handler: (_req, res, _params, url) => {
      const raw = url.searchParams.get("limit");
      let limit = 50;
      if (raw !== null) {
        limit = Number(raw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
          throw new AppError("invalid-query", "limit must be a whole number from 1 to 200", 400);
        }
      }
      send(res, 200, { data: listRuns(url.searchParams.get("agent") ?? undefined, limit) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/runs\/([^/]+)$/,
    keys: ["id"],
    handler: (_req, res, params, url) => {
      const run = getRun(params["id"] ?? "");
      if (!run) throw new AppError("run-not-found", `Run not found: ${params["id"]}`, 404);
      const rawAfter = url.searchParams.get("after");
      const after = rawAfter === null ? 0 : Number(rawAfter);
      if (!Number.isInteger(after) || after < 0) throw new AppError("invalid-query", "after must be a whole number, 0 or more", 400);
      send(res, 200, { data: { run, events: listEvents(run.id, after) } });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/runs\/([^/]+)\/undo$/,
    keys: ["id"],
    handler: async (_req, res, params) => {
      send(res, 200, { data: await undoRun(params["id"] ?? "") });
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

/** Like `readJsonBody`, but an empty body is fine and means `{}`. */
async function readOptionalJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new AppError("payload-too-large", "Request body exceeds 2MB", 413);
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("invalid-body", "Request body is not valid JSON", 400);
  }
}

async function readJsonBody(req: IncomingMessage, options: { emptyIs?: unknown } = {}): Promise<unknown> {
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
    if ("emptyIs" in options) return options.emptyIs;
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
