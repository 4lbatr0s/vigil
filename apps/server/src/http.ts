import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { checkAccess, type Access } from "./access";
import { handleAuth } from "./auth";
import { serveStatic } from "./static";
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
import { chatTurn, chatWithMessages, newChat, removeChat, saveChatAsNote, type ChatLine } from "./chat";
import { cronError, nextTickAfter } from "./cron";
import { buildGraphData } from "./graph";
import { attachStream } from "./events";
import { bodyBeforeRun, resumeRun, startRun, undoRun } from "./runs";
import { getPermissions, putPermissions } from "./permissions";
import { planRename, renameNote } from "./rename";
import { refreshSchedule } from "./scheduler";
import { llmStatus } from "./llm-status";
import { usage } from "./usage";
import { getRunResult } from "./state-db";
import { exportTsv } from "./anki-export";
import { MAX_IMAGE_BYTES, readAttachment, saveAttachment, tidyAttachments, unusedAttachments } from "./attachments";
import { ResultBodySchema, enroll, recordResult } from "./recall";
import { GoalBodySchema, goalStatuses, validGoalDay } from "./goals";
import { StudySettingsSchema, answerCard, deckStats, dueCards, saveStudySettings, studyForecast, stuckCards, studyHistory, studySettings, studyStats, undoAnswer } from "./study";
import { cardsForNote } from "./index-db";
import { addPin, approvalsForRun, clearHeartbeat, decideApproval, getApproval, listApprovals, listChatThreads, getAgent, getHeartbeat, getRun, getSchedule, listAgents, listEvents, listPins, listRuns, putAgent, listRecall, putSchedule, removeGoal, removePin, removeRecall, setGoal } from "./state-db";
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
        removePin(id);
      });
      send(res, 200, { data: { id } });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/study\/due$/,
    keys: [],
    handler: (_req, res, _params, url) => {
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const noteId = url.searchParams.get("note") ?? undefined;
      send(res, 200, { data: dueCards(new Date(), { limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 50, ...(noteId ? { noteId } : {}) }) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/study\/stats$/,
    keys: [],
    handler: (_req, res, _params, url) => {
      send(res, 200, { data: studyStats(new Date(), url.searchParams.get("note") ?? undefined) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/study\/decks$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: deckStats(new Date()) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/study\/history$/,
    keys: [],
    handler: (_req, res, _params, url) => {
      const asked = Number(url.searchParams.get("days") ?? 14);
      const days = Number.isInteger(asked) ? Math.min(90, Math.max(1, asked)) : 14;
      send(res, 200, { data: studyHistory(new Date(), days) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/study\/stuck$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: stuckCards() });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/study\/forecast$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: studyForecast(new Date()) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/study\/settings$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: studySettings() });
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/study\/settings$/,
    keys: [],
    handler: async (req, res) => {
      const parsed = StudySettingsSchema.safeParse(await readJsonBody(req));
      if (!parsed.success) throw new AppError("invalid-body", "Body must be { newPerDay: 0 to 50, retention: 0.8 to 0.95 }", 400);
      send(res, 200, { data: saveStudySettings(parsed.data) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/study\/export$/,
    keys: [],
    handler: (_req, res, _params, url) => {
      const body = exportTsv(url.searchParams.get("note") ?? undefined);
      res.writeHead(200, {
        "content-type": "text/tab-separated-values; charset=utf-8",
        "content-disposition": 'attachment; filename="vigil-cards.txt"',
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
      });
      res.end(body);
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/study\/review$/,
    keys: [],
    handler: async (req, res) => {
      const parsed = z.object({ cardId: z.string().min(1).max(64), answer: z.string().max(16) }).safeParse(await readJsonBody(req));
      if (!parsed.success) throw new AppError("invalid-body", "Body must be { cardId: string, answer: again | hard | good | easy }", 400);
      const out = answerCard(parsed.data.cardId, parsed.data.answer, new Date());
      send(res, 200, { data: { due: out.due } });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/study\/undo$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: { cardId: undoAnswer() } });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/notes\/([^/]+)\/cards$/,
    keys: ["id"],
    handler: (_req, res, params) => {
      send(res, 200, { data: cardsForNote(params["id"] ?? "") });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/runs\/([^/]+)\/result$/,
    keys: ["id"],
    handler: (_req, res, params) => {
      const id = params["id"] ?? "";
      if (!getRun(id)) throw new AppError("run-not-found", `Run not found: ${id}`, 404);
      send(res, 200, { data: { text: getRunResult(id) } });
    },
  },
  {
    // The card maker reads the note and answers with card lines; the owner reviews them in the UI and saves
    // the ones they keep. The agent has no write tool, so nothing reaches the note unreviewed (ADR-0017).
    method: "POST",
    pattern: /^\/api\/notes\/([^/]+)\/card-proposals$/,
    keys: ["id"],
    handler: (_req, res, params) => {
      const id = params["id"] ?? "";
      if (indexGetNote(id) === null) throw new AppError("note-not-found", `Note not found: ${id}`, 404);
      const agent = getAgent("card-maker");
      if (!agent) throw new AppError("agent-not-found", "Add the Card maker agent first (Agents, then the Card maker template).", 404);
      if (!agent.enabled) throw new AppError("agent-disabled", "The Card maker agent is switched off. Turn it on from the Agents page.", 409);
      // The note travels in the task, so the agent needs no tool at all (and a weak model has no tool call to get wrong).
      const note = indexGetNote(id);
      const text = (note?.body ?? "").slice(0, 20_000);
      const run = startRun("card-maker", `Make study cards from this note (id ${id}, title "${note?.title ?? id}").\n\nNOTE START\n${text}\nNOTE END`, "manual");
      send(res, 202, { data: run });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/pins$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: listPins() });
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/pins\/([^/]+)$/,
    keys: ["id"],
    handler: (_req, res, params) => {
      const id = params["id"] ?? "";
      if (indexGetNote(id) === null) throw new AppError("note-not-found", `Note not found: ${id}`, 404);
      addPin(id);
      send(res, 200, { data: listPins() });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/pins\/([^/]+)$/,
    keys: ["id"],
    handler: (_req, res, params) => {
      removePin(params["id"] ?? "");
      send(res, 200, { data: listPins() });
    },
  },
  {
    // Starts the Study outliner on pasted text. The agent has no tools; the learner writes the answers (ADR-0020).
    method: "POST",
    pattern: /^\/api\/outline$/,
    keys: [],
    handler: async (req, res) => {
      const parsed = z.object({ source: z.string().trim().min(20).max(20_000) }).safeParse(await readJsonBody(req));
      if (!parsed.success) throw new AppError("invalid-body", "Body must be { source: string } of 20 to 20000 characters", 400);
      const agent = getAgent("outliner");
      if (!agent) throw new AppError("agent-not-found", "Add the Study outliner agent first (Agents, then the Study outliner template).", 404);
      if (!agent.enabled) throw new AppError("agent-disabled", "The Study outliner agent is switched off. Turn it on from the Agents page.", 409);
      const run = startRun("outliner", `Make a study outline from this material.\n\nSOURCE START\n${parsed.data.source}\nSOURCE END`, "manual");
      send(res, 202, { data: run });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/recall$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: listRecall().map((r) => ({ ...r, isDue: new Date(r.due).getTime() <= Date.now() })) });
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/recall\/([^/]+)$/,
    keys: ["id"],
    handler: (_req, res, params) => {
      const id = params["id"] ?? "";
      if (indexGetNote(id) === null) throw new AppError("note-not-found", `Note not found: ${id}`, 404);
      send(res, 200, { data: enroll(id, new Date()) });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/recall\/([^/]+)$/,
    keys: ["id"],
    handler: (_req, res, params) => {
      removeRecall(params["id"] ?? "");
      send(res, 200, { data: { ok: true } });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/recall\/([^/]+)\/result$/,
    keys: ["id"],
    handler: async (req, res, params) => {
      const parsed = ResultBodySchema.safeParse(await readJsonBody(req));
      if (!parsed.success) throw new AppError("invalid-body", "Body must be { result: most | some | little }", 400);
      send(res, 200, { data: recordResult(params["id"] ?? "", parsed.data.result, new Date()) });
    },
  },
  {
    // Starts the Recall checker on a note and what the learner wrote from memory. The agent has no tools (ADR-0020).
    method: "POST",
    pattern: /^\/api\/notes\/([^/]+)\/recall-check$/,
    keys: ["id"],
    handler: async (req, res, params) => {
      const id = params["id"] ?? "";
      const parsed = z.object({ recall: z.string().max(6_000) }).safeParse(await readJsonBody(req));
      if (!parsed.success) throw new AppError("invalid-body", "Body must be { recall: string } of at most 6000 characters", 400);
      const note = indexGetNote(id);
      if (note === null) throw new AppError("note-not-found", `Note not found: ${id}`, 404);
      const agent = getAgent("recall-checker");
      if (!agent) throw new AppError("agent-not-found", "Add the Recall checker agent first (Agents, then the Recall checker template).", 404);
      if (!agent.enabled) throw new AppError("agent-disabled", "The Recall checker agent is switched off. Turn it on from the Agents page.", 409);
      const text = (note.body ?? "").slice(0, 20_000);
      const run = startRun("recall-checker", `Check what I remember of this note (id ${id}, title "${note.title}").\n\nNOTE START\n${text}\nNOTE END\n\nRECALL START\n${parsed.data.recall}\nRECALL END`, "manual");
      send(res, 202, { data: run });
    },
  },
  {
    // A pasted image: the raw bytes are the body (ADR-0021). The type is decided from the bytes.
    method: "POST",
    pattern: /^\/api\/attachments$/,
    keys: [],
    handler: async (req, res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_IMAGE_BYTES) throw new AppError("payload-too-large", "Images can be up to 5 MB", 413);
        chunks.push(chunk as Buffer);
      }
      send(res, 201, { data: await saveAttachment(Buffer.concat(chunks)) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/attachments\/unused$/,
    keys: [],
    handler: async (_req, res) => {
      const unused = await unusedAttachments(new Date());
      send(res, 200, { data: { count: unused.length, bytes: unused.reduce((n, u) => n + u.bytes, 0) } });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/attachments\/tidy$/,
    keys: [],
    handler: async (_req, res) => {
      send(res, 200, { data: await tidyAttachments(new Date()) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/attachments\/([^/]+)$/,
    keys: ["name"],
    handler: async (_req, res, params) => {
      const { bytes, mime } = await readAttachment(params["name"] ?? "");
      // Served as an inert image: no sniffing, and a sandboxed empty policy in case it is opened on its own.
      res.writeHead(200, {
        "content-type": mime,
        "content-length": bytes.length,
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, max-age=31536000, immutable",
      });
      res.end(bytes);
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/runs\/([^/]+)\/before\/([^/]+)$/,
    keys: ["id", "noteId"],
    handler: async (_req, res, params) => {
      send(res, 200, { data: await bodyBeforeRun(params["id"] ?? "", params["noteId"] ?? "") });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/goals$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: goalStatuses(new Date(), studySettings().newPerDay) });
    },
  },
  {
    method: "PUT",
    pattern: /^\/api\/goals$/,
    keys: [],
    handler: async (req, res) => {
      const parsed = GoalBodySchema.safeParse(await readJsonBody(req));
      if (!parsed.success) throw new AppError("invalid-body", "Body must be { kind: note | tag, value: string, day: YYYY-MM-DD }", 400);
      validGoalDay(parsed.data.day);
      if (parsed.data.kind === "note" && indexGetNote(parsed.data.value) === null) throw new AppError("note-not-found", `Note not found: ${parsed.data.value}`, 404);
      setGoal(parsed.data, new Date());
      send(res, 200, { data: goalStatuses(new Date(), studySettings().newPerDay) });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/goals$/,
    keys: [],
    handler: (_req, res, _params, url) => {
      const kind = url.searchParams.get("kind");
      const value = url.searchParams.get("value") ?? "";
      if ((kind !== "note" && kind !== "tag") || value === "") throw new AppError("invalid-body", "kind (note or tag) and value are required", 400);
      removeGoal(kind, value);
      send(res, 200, { data: goalStatuses(new Date(), studySettings().newPerDay) });
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
        clearHeartbeat(saved.name);
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
    pattern: /^\/api\/graph$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: buildGraphData() });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/chats$/,
    keys: [],
    handler: (_req, res) => {
      send(res, 200, { data: listChatThreads() });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/chats$/,
    keys: [],
    handler: async (req, res) => {
      const parsed = z.object({ agent: AgentNameSchema }).safeParse(await readJsonBody(req));
      if (!parsed.success) throw new AppError("invalid-body", "agent is required", 400);
      send(res, 201, { data: newChat(parsed.data.agent) });
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/chats\/([^/]+)$/,
    keys: ["id"],
    handler: (_req, res, params) => {
      send(res, 200, { data: chatWithMessages(params["id"] ?? "") });
    },
  },
  {
    method: "DELETE",
    pattern: /^\/api\/chats\/([^/]+)$/,
    keys: ["id"],
    handler: async (_req, res, params) => {
      await removeChat(params["id"] ?? "");
      send(res, 200, { data: { id: params["id"] } });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/chats\/([^/]+)\/save$/,
    keys: ["id"],
    handler: async (_req, res, params) => {
      send(res, 201, { data: await saveChatAsNote(params["id"] ?? "") });
    },
  },
  {
    // Streams one turn as newline-delimited JSON. Problems found before the first line are ordinary
    // errors; later ones arrive as an `error` line. Closing the connection cancels the turn.
    method: "POST",
    pattern: /^\/api\/chats\/([^/]+)\/messages$/,
    keys: ["id"],
    handler: async (req, res, params) => {
      const parsed = z.object({ text: z.string() }).safeParse(await readJsonBody(req));
      if (!parsed.success) throw new AppError("invalid-body", "text is required", 400);
      const abort = new AbortController();
      // `res` closing before we ended it means the client went away (the request's own close fires early).
      res.on("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      const emit = (line: ChatLine): void => {
        if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(line)}\n`);
      };
      const begin = (): void => {
        res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-accel-buffering": "no" });
      };
      try {
        await chatTurn(params["id"] ?? "", parsed.data.text, begin, emit, abort.signal);
      } catch (err) {
        if (!res.headersSent) throw err; // nothing sent yet: the normal error envelope
        emit({ type: "error", message: isAppError(err) ? err.message : "The turn failed" });
      }
      if (!res.writableEnded) res.end();
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/approvals$/,
    keys: [],
    handler: async (_req, res, _params, url) => {
      const raw = url.searchParams.get("status");
      if (raw !== null && raw !== "pending" && raw !== "approved" && raw !== "rejected") {
        throw new AppError("invalid-query", "status must be pending, approved or rejected", 400);
      }
      const rows = await Promise.all(
        listApprovals(raw ?? undefined).map(async (a) => {
          const title = typeof a.args["title"] === "string" ? a.args["title"] : "";
          const noteId = slugify(title);
          // The current text, so the page can show a diff against what is on disk now (it may have changed since).
          const current = await vaultGetNote(noteId).catch(() => null);
          return {
            ...a,
            agent: getRun(a.runId)?.agent ?? null,
            noteId,
            title,
            currentBody: current?.body ?? null,
            currentUpdatedAt: current?.updatedAt ?? null,
            proposedBody: typeof a.args["body"] === "string" ? a.args["body"] : "",
            stale: current === null ? a.baseUpdatedAt !== null : current.updatedAt !== a.baseUpdatedAt,
          };
        }),
      );
      send(res, 200, { data: rows });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/approvals\/([^/]+)\/decision$/,
    keys: ["id"],
    handler: async (req, res, params) => {
      const parsed = z.object({ decision: z.enum(["approve", "reject"]), force: z.boolean().optional() }).safeParse(await readJsonBody(req));
      if (!parsed.success) throw new AppError("invalid-body", "decision must be approve or reject", 400);
      const approval = getApproval(params["id"] ?? "");
      if (!approval) throw new AppError("approval-not-found", `Approval not found: ${params["id"]}`, 404);
      if (approval.status !== "pending") throw new AppError("approval-decided", "This write was already decided", 409);
      if (parsed.data.decision === "approve" && !parsed.data.force) {
        const title = typeof approval.args["title"] === "string" ? approval.args["title"] : "";
        const current = await vaultGetNote(slugify(title)).catch(() => null);
        const stale = current === null ? approval.baseUpdatedAt !== null : current.updatedAt !== approval.baseUpdatedAt;
        if (stale) {
          throw new AppError("approval-stale", "The note changed after the agent proposed this write. Review it, then apply anyway or reject.", 409);
        }
      }
      if (!decideApproval(approval.id, parsed.data.decision)) throw new AppError("approval-decided", "This write was already decided", 409);
      // When the run's last write is decided, the paused graph continues in the background.
      let resumed = false;
      if (approvalsForRun(approval.runId).every((a) => a.status !== "pending")) {
        resumeRun(approval.runId);
        resumed = true;
      }
      send(res, 200, { data: { approval: getApproval(approval.id), runResumed: resumed } });
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
          lastCheckedAt: getHeartbeat(agent.name)?.lastCheckedAt ?? null,
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
        if (await handleAuth(req, res, url.pathname, access)) return;
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
        // The web app comes after the API, so a file can never shadow an API route.
        if (!url.pathname.startsWith("/api/") && serveStatic(req, res, url.pathname)) return;
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
