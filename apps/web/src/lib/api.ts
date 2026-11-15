import type { Agent, AgentTemplate, Note, PermissionSettings, Run, RunEvent } from "@vigil/shared";

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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const payload = (await res.json()) as Envelope<T>;
  if ("error" in payload) throw new ApiError(payload.error.code, payload.error.message);
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

export const listNotes = () => request<Note[]>("/api/notes");
export const getNote = (id: string) => request<Note>(`/api/notes/${seg(id)}`);
/** `baseUpdatedAt` is the `updatedAt` you last saw; the server answers 409 if the note moved on. */
export const putNote = (id: string, input: { title: string; body: string; tags?: string[]; baseUpdatedAt?: string }) =>
  request<Note>(`/api/notes/${seg(id)}`, json("PUT", input));
export const searchNotes = (q: string) =>
  request<Array<{ id: string; title: string; snippet: string }>>(`/api/search?q=${encodeURIComponent(q)}`);

// ---- Agents and runs ----

export type Schedule = {
  trigger: Agent["trigger"];
  enabled: boolean;
  nextRunAt: string | null;
  lastScheduledFor: string | null;
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

// ---- Settings, usage, model status ----

export type Usage = { month: string; tokens: number; cap: number | null; level: "ok" | "warn" | "over" };
export type LlmStatus = { provider: string; baseUrl: string; model: string | null; hasKey: boolean; reachable: boolean | null };

export const getUsage = () => request<Usage>("/api/usage");
export const getLlmStatus = (probe = false) => request<LlmStatus>(`/api/llm/status${probe ? "?probe=1" : ""}`);
export const getPermissions = () => request<PermissionSettings>("/api/settings/permissions");
export const putPermissions = (settings: PermissionSettings) => request<PermissionSettings>("/api/settings/permissions", json("PUT", settings));
