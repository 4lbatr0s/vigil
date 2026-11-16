import { readNdjson } from "./ndjson";
import type { Agent, AgentTemplate, Note, NoteSummary, PermissionSettings, Run, RunEvent } from "@vigil/shared";

type Envelope<T> = { data: T } | { error: { code: string; message: string } };

/** Error from the API; `code` is the server's machine-readable code (for example `undo-conflict`). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
  /** Just the server's message, for showing under a field. */
  get detail(): string {
    return this.message.slice(this.code.length + 2);
  }
}

/** The server answered 401: the visitor must sign in. */
export class UnauthorizedError extends ApiError {
  constructor(message: string) {
    super("unauthorized", message);
  }
}

let unauthorizedHandler: (() => void) | null = null;
/** The layout registers one handler that sends the visitor to /login. */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const payload = (await res.json()) as Envelope<T>;
  if ("error" in payload) {
    if (res.status === 401) {
      unauthorizedHandler?.();
      throw new UnauthorizedError(payload.error.message);
    }
    throw new ApiError(payload.error.code, payload.error.message);
  }
  return payload.data;
}

/** Every value placed in a URL path goes through this, so an id like "../x" cannot reach another route. */
const seg = encodeURIComponent;

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

// ---- Notes ----

/** The list view: no bodies. A note opens in full with getNote. */
export const listNotes = () => request<NoteSummary[]>("/api/notes?fields=summary");
export const getNote = (id: string) => request<Note>(`/api/notes/${seg(id)}`);
/** `baseUpdatedAt` is the `updatedAt` you last saw; the server answers 409 if the note moved on. */
export const putNote = (id: string, input: { title: string; body: string; tags?: string[]; baseUpdatedAt?: string }) =>
  request<Note>(`/api/notes/${seg(id)}`, json("PUT", input));
/** Permanent: there is no trash. The UI asks twice. */
export const deleteNote = (id: string) => request<{ id: string }>(`/api/notes/${seg(id)}`, { method: "DELETE" });
export type RenamePlan = { newId: string; notesToChange: string[]; titles: string[] };
/** Dry run: what a rename would change. Writes nothing. */
export const planRenameNote = (id: string, title: string) => request<RenamePlan>(`/api/notes/${seg(id)}/rename?dryRun=1`, json("POST", { title }));
export const renameNote = (id: string, title: string) => request<Note>(`/api/notes/${seg(id)}/rename`, json("POST", { title }));
export type Backlink = { id: string; title: string; snippet: string };
/** Notes that link to this one (the note itself may not exist yet). */
export const getBacklinks = (id: string) => request<Backlink[]>(`/api/notes/${seg(id)}/backlinks`);
export const searchNotes = (q: string) =>
  request<Array<{ id: string; title: string; snippet: string }>>(`/api/search?q=${encodeURIComponent(q)}`);

/** Pinned note ids, most recently pinned first. A pin is the owner's choice, kept out of the note file. */
export const listPins = () => request<string[]>("/api/pins");
export const pinNote = (id: string) => request<string[]>(`/api/pins/${seg(id)}`, { method: "PUT" });
export const unpinNote = (id: string) => request<string[]>(`/api/pins/${seg(id)}`, { method: "DELETE" });

// ---- Study (ADR-0017) ----

export type StudyCard = { id: string; noteId: string; kind: "qa" | "cloze"; front: string; back: string; line: number; isNew: boolean; due: string | null };
export type StudyStats = { total: number; due: number; new: number; reviewedToday: number; againToday: number };
export type Answer = "again" | "hard" | "good" | "easy";
export const getDueCards = (opts: { note?: string; limit?: number } = {}) => {
  const q = new URLSearchParams();
  if (opts.note) q.set("note", opts.note);
  if (opts.limit) q.set("limit", String(opts.limit));
  return request<StudyCard[]>(`/api/study/due${q.size ? `?${q}` : ""}`);
};
export const getStudyStats = (note?: string) => request<StudyStats>(`/api/study/stats${note ? `?note=${encodeURIComponent(note)}` : ""}`);
export type DeckStats = { noteId: string; cards: number; due: number; new: number; reviews: number; recall: number | null };
export const getDecks = () => request<DeckStats[]>("/api/study/decks");
export const answerStudyCard = (cardId: string, answer: Answer) => request<{ due: string }>("/api/study/review", json("POST", { cardId, answer }));
/** Starts the card maker on a note; the answer is read with getRunResult when the run has succeeded. */
export const startCardProposals = (noteId: string) => request<Run>(`/api/notes/${seg(noteId)}/card-proposals`, json("POST"));
export const getRunResult = (runId: string) => request<{ text: string | null }>(`/api/runs/${seg(runId)}/result`);
export const undoStudyAnswer = () => request<{ cardId: string }>("/api/study/undo", json("POST"));
export const getNoteCards = (id: string) => request<StudyCard[]>(`/api/notes/${seg(id)}/cards`);

// ---- Agents and runs ----

export type Schedule = {
  trigger: Agent["trigger"];
  enabled: boolean;
  nextRunAt: string | null;
  lastScheduledFor: string | null;
  /** Heartbeat agents: when the notes were last compared. */
  lastCheckedAt: string | null;
  lastStartedAt: string | null;
  lastSkipReason: string | null;
};

export const listAgents = () => request<Agent[]>("/api/agents");
export const getAgent = (name: string) => request<Agent>(`/api/agents/${seg(name)}`);
export const putAgent = (agent: Agent) => request<Agent>(`/api/agents/${seg(agent.name)}`, json("PUT", agent));
export const getSchedule = (name: string) => request<Schedule>(`/api/agents/${seg(name)}/schedule`);
export const runAgent = (name: string, task?: string) => request<Run>(`/api/agents/${seg(name)}/run`, json("POST", task === undefined ? {} : { task }));
export const listTemplates = () => request<AgentTemplate[]>("/api/agent-templates");
export const createFromTemplate = (id: string, name?: string) =>
  request<Agent>(`/api/agents/from-template/${seg(id)}`, json("POST", name === undefined ? {} : { name }));

export const listRuns = (opts: { agent?: string; limit?: number } = {}) => {
  const q = new URLSearchParams();
  if (opts.agent) q.set("agent", opts.agent);
  if (opts.limit) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return request<Run[]>(`/api/runs${qs ? `?${qs}` : ""}`);
};
/** `after` returns only events with a larger sequence number, so a live log can append. */
export const getRun = (id: string, after?: number) =>
  request<{ run: Run; events: RunEvent[] }>(`/api/runs/${seg(id)}${after ? `?after=${after}` : ""}`);
export const undoRun = (id: string) => request<Run>(`/api/runs/${seg(id)}/undo`, json("POST"));

// ---- Session ----

export type Session = { required: boolean; authenticated: boolean };
export const getSession = () => request<Session>("/api/session");
export const login = (token: string) => request<Session>("/api/login", json("POST", { token }));
export const logout = () => request<{ ok: boolean }>("/api/logout", json("POST"));

// ---- Graph ----

export const getGraph = () => request<import("./graph-model").GraphApi>("/api/graph");

// ---- Chat ----

export type ChatThread = { id: string; agent: string; title: string; createdAt: string; updatedAt: string };
export type ChatMessage = { seq: number; role: "user" | "assistant" | "error"; content: string; runId: string | null; createdAt: string };
/** One line of a streamed turn (mirrors apps/server/src/chat.ts). */
export type ChatLine =
  | { type: "token"; text: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; status: "call" | "result" }
  | { type: "approval"; approvalId: string }
  | { type: "done"; run: Run }
  | { type: "error"; message: string };

export const listChats = () => request<ChatThread[]>("/api/chats");
export const createChat = (agent: string) => request<ChatThread>("/api/chats", json("POST", { agent }));
export const getChat = (id: string) => request<{ thread: ChatThread; messages: ChatMessage[] }>(`/api/chats/${seg(id)}`);
export const deleteChat = (id: string) => request<{ id: string }>(`/api/chats/${seg(id)}`, { method: "DELETE" });
export const saveChat = (id: string) => request<{ id: string; title: string }>(`/api/chats/${seg(id)}/save`, json("POST"));

/**
 * Sends one message and calls `onLine` for every streamed line. Aborting `signal` stops the turn on
 * the server too (it sees the connection close). Rejects with an ApiError when the server refuses
 * the turn before streaming (busy agent, unknown chat, empty text).
 */
export async function streamTurn(id: string, text: string, signal: AbortSignal, onLine: (line: ChatLine) => void): Promise<void> {
  const res = await fetch(`/api/chats/${seg(id)}/messages`, { ...json("POST", { text }), signal });
  if (res.status === 401) {
    unauthorizedHandler?.();
    throw new UnauthorizedError("Sign in to continue.");
  }
  if (!res.ok || !res.body) {
    const payload = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(payload?.error?.code ?? "request-failed", payload?.error?.message ?? `The server answered ${res.status}`);
  }
  for await (const line of readNdjson<ChatLine>(res.body)) onLine(line);
}

// ---- Approvals ----

export type ApprovalItem = {
  id: string;
  runId: string;
  agent: string | null;
  tool: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  noteId: string;
  title: string;
  /** The note as it is on disk now; null when it does not exist. */
  currentBody: string | null;
  proposedBody: string;
  /** The note changed (or appeared) after the agent proposed this write. */
  stale: boolean;
};
export const listApprovals = (status: "pending" | "approved" | "rejected" = "pending") => request<ApprovalItem[]>(`/api/approvals?status=${status}`);
export const decideApproval = (id: string, decision: "approve" | "reject", force = false) =>
  request<{ approval: ApprovalItem; runResumed: boolean }>(`/api/approvals/${seg(id)}/decision`, json("POST", force ? { decision, force } : { decision }));

// ---- Settings, usage, model status ----

export type Usage = { month: string; tokens: number; cap: number | null; level: "ok" | "warn" | "over" };
export type LlmStatus = { provider: string; baseUrl: string; model: string | null; hasKey: boolean; reachable: boolean | null };

export const getUsage = () => request<Usage>("/api/usage");
export const getLlmStatus = (probe = false) => request<LlmStatus>(`/api/llm/status${probe ? "?probe=1" : ""}`);
export const getPermissions = () => request<PermissionSettings>("/api/settings/permissions");
export const putPermissions = (settings: PermissionSettings) => request<PermissionSettings>("/api/settings/permissions", json("PUT", settings));
