import { HOST_HELP, normalizeHost, type Agent, type PermissionSettings, type ToolGrant, type Trigger } from "@vigil/shared";

export type TriggerKind = "manual" | "daily" | "weekly" | "changes" | "custom";

/** The schedule as the page edits it: plain choices, turned into a cron expression or heartbeat on save. */
export type TriggerForm = {
  kind: TriggerKind;
  /** `HH:MM`, for daily and weekly. */
  time: string;
  /** 0 (Sunday) to 6, for weekly. */
  day: number;
  /** Minutes between checks, for "when my notes change". */
  minutes: string;
  /** A cron expression the choices above cannot express, kept as it is. */
  expression: string;
};

export const DEFAULT_TRIGGER_FORM: TriggerForm = { kind: "manual", time: "07:00", day: 1, minutes: "30", expression: "" };

const two = (n: number): string => String(n).padStart(2, "0");

export function triggerToForm(t: Trigger): TriggerForm {
  if (t.kind === "manual") return { ...DEFAULT_TRIGGER_FORM };
  if (t.kind === "heartbeat") return { ...DEFAULT_TRIGGER_FORM, kind: "changes", minutes: String(t.everyMinutes) };
  const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-7])$/.exec(t.expression.trim());
  if (m && Number(m[1]) <= 59 && Number(m[2]) <= 23) {
    const time = `${two(Number(m[2]))}:${two(Number(m[1]))}`;
    return m[3] === "*" ? { ...DEFAULT_TRIGGER_FORM, kind: "daily", time } : { ...DEFAULT_TRIGGER_FORM, kind: "weekly", time, day: Number(m[3]) % 7 };
  }
  return { ...DEFAULT_TRIGGER_FORM, kind: "custom", expression: t.expression };
}

export type TriggerResult = { ok: true; trigger: Trigger } | { ok: false; message: string };

/** The trigger to save, or what is wrong with the form. A cron trigger keeps the time zone it had. */
export function formToTrigger(f: TriggerForm, timezone?: string): TriggerResult {
  if (f.kind === "manual") return { ok: true, trigger: { kind: "manual" } };
  if (f.kind === "changes") {
    const n = Number(f.minutes);
    if (!Number.isInteger(n) || n < 5 || n > 1440) return { ok: false, message: "Check for changes every 5 to 1440 minutes." };
    return { ok: true, trigger: { kind: "heartbeat", everyMinutes: n } };
  }
  const tz = timezone ? { timezone } : {};
  if (f.kind === "custom") {
    const expression = f.expression.trim();
    return expression.split(/\s+/).length === 5 ? { ok: true, trigger: { kind: "cron", expression, ...tz } } : { ok: false, message: "A schedule has five parts, like 0 7 * * *." };
  }
  const t = /^(\d{1,2}):(\d{2})$/.exec(f.time.trim());
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) return { ok: false, message: "Enter a time like 07:30." };
  const day = f.kind === "weekly" ? String(Math.min(6, Math.max(0, Math.trunc(f.day)))) : "*";
  return { ok: true, trigger: { kind: "cron", expression: `${Number(t[2])} ${Number(t[1])} * * ${day}`, ...tz } };
}

export type ApproveTool = NonNullable<Agent["approveTools"]>[number];

/** What the agent page edits. Strings stay strings until saved, so a half-typed number is not lost. */
export type AgentForm = {
  description: string;
  systemPrompt: string;
  enabled: boolean;
  strict: boolean;
  /** The agent keeps a short state note between runs. */
  keepState: boolean;
  /** Strict agents with a write scope: appends to its own tagged notes skip approval (item 38). */
  autoApproveAppends: boolean;
  /** Ask before this agent reads a web page or calls another agent. */
  approveTools: ApproveTool[];
  /** Tags the agent may write, typed as text (commas or spaces); empty means no limit. */
  writeTags: string;
  tokenBudget: string;
  /** Tokens per day this agent may use; empty means no limit. */
  dailyTokenCap: string;
  model: string;
  /** Hosts `fetch_url` may call. */
  allowedHosts: string[];
  trigger: TriggerForm;
  tools: ToolGrant[];
  /** A saved connection id, or empty for the default one. */
  connection: string;
  defaultTask: string;
};

export function agentToForm(agent: Agent): AgentForm {
  return {
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    enabled: agent.enabled,
    strict: agent.strict,
    keepState: agent.keepState === true,
    autoApproveAppends: agent.autoApproveAppends === true,
    approveTools: [...(agent.approveTools ?? [])],
    writeTags: (agent.writeTags ?? []).join(", "),
    tokenBudget: String(agent.tokenBudget),
    dailyTokenCap: agent.dailyTokenCap === undefined ? "" : String(agent.dailyTokenCap),
    model: agent.model ?? "",
    allowedHosts: [...agent.allowedHosts],
    trigger: triggerToForm(agent.trigger),
    tools: [...agent.tools],
    connection: agent.connection ?? "",
    defaultTask: agent.defaultTask,
  };
}

/** Tags typed as text ("#Journal, daily/log journal"): split on commas and spaces, # dropped, lowercase, no repeats. */
export function parseTagList(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((t) => t.replace(/^#/, "").toLowerCase()).filter((t) => t !== ""))];
}

/**
 * The whole definition to PUT: the loaded agent with the form's edits laid over it. Fields the form
 * does not know (trigger, tools, hosts, callable, defaultTask) are carried over untouched, and an
 * empty model is left out rather than sent as an empty string.
 */
export function formToAgent(base: Agent, form: AgentForm): Agent {
  const { model: _m, connection: _c, keepState: _k, dailyTokenCap: _d, approveTools: _a, writeTags: _w, autoApproveAppends: _aa, ...rest } = base;
  const writeTags = parseTagList(form.writeTags);
  const model = form.model.trim();
  const trigger = formToTrigger(form.trigger, base.trigger.kind === "cron" ? base.trigger.timezone : undefined);
  return {
    ...rest,
    description: form.description,
    systemPrompt: form.systemPrompt,
    enabled: form.enabled,
    strict: form.strict,
    allowedHosts: [...form.allowedHosts],
    tools: [...form.tools],
    defaultTask: form.defaultTask,
    // A trigger that cannot be saved keeps the old one here; the page shows the message from `triggerProblem` first.
    trigger: trigger.ok ? trigger.trigger : base.trigger,
    tokenBudget: form.tokenBudget.trim() === "" ? Number.NaN : Number(form.tokenBudget),
    ...(model === "" ? {} : { model }),
    ...(form.connection === "" ? {} : { connection: form.connection }),
    ...(form.keepState ? { keepState: true } : {}),
    // Counts only for a strict agent with a write scope (ADR-0011), so it is saved only then.
    ...(form.autoApproveAppends && form.strict && writeTags.length > 0 ? { autoApproveAppends: true } : {}),
    ...(form.approveTools.length > 0 ? { approveTools: [...form.approveTools] } : {}),
    ...(writeTags.length > 0 ? { writeTags } : {}),
    ...(form.dailyTokenCap.trim() === "" ? {} : { dailyTokenCap: Number(form.dailyTokenCap) }),
  };
}

/** What is wrong with the schedule choices, or null. */
export function triggerProblem(form: AgentForm, base: Agent): string | null {
  const r = formToTrigger(form.trigger, base.trigger.kind === "cron" ? base.trigger.timezone : undefined);
  return r.ok === false ? r.message : null;
}

export const TOOL_LABELS: Record<ToolGrant, { label: string; detail: string }> = {
  read_notes: { label: "Read my notes", detail: "It can list, search and read every note." },
  write_notes: { label: "Write notes", detail: "It can create and replace notes. Each write is saved first so you can undo it." },
  web_fetch: { label: "Fetch web pages", detail: "Only from sites you list below. Pages it reads are treated as untrusted text." },
  call_agents: { label: "Ask other helpers", detail: "It can start other helpers you allow, one level deep." },
};

export type GrantLine = { tool: ToolGrant; text: string; blocked: boolean };

/** Plain-English permission lines for the Turn on panel; `blocked` when an instance switch is off. */
export function describeGrants(agent: Agent, settings: PermissionSettings): GrantLine[] {
  const text: Record<ToolGrant, string> = {
    read_notes: "Can read your notes.",
    write_notes: "Can write notes: every write is saved first so you can undo.",
    web_fetch: agent.allowedHosts.length > 0 ? `Can fetch web pages from: ${agent.allowedHosts.join(", ")}.` : "Can fetch web pages, but no sites are allowed yet.",
    call_agents: agent.callable.length > 0 ? `Can start these helpers: ${agent.callable.join(", ")}.` : "Can start other helpers, but none are chosen yet.",
  };
  return agent.tools.map((tool) => ({ tool, text: text[tool], blocked: !settings.tools[tool] }));
}

/** True when the agent can both read notes and fetch the web with approvals off: the combination ADR-0006 warns about. */
export function riskyCombination(agent: Pick<Agent, "tools" | "strict">): boolean {
  return agent.tools.includes("read_notes") && agent.tools.includes("web_fetch") && !agent.strict;
}

export type Exposure = { label: string; on: boolean; text: string };

/**
 * The three things that together let a web page steal notes: the agent sees private notes, reads text from outside
 * (web pages), and can send something out (a request to a site). Plain lines for the agent page, so the person sees at
 * a glance which of the three are on. `all` is true when every one is.
 */
export function exposure(agent: Pick<Agent, "tools" | "allowedHosts" | "strict">): { lines: Exposure[]; all: boolean } {
  const reads = agent.tools.includes("read_notes");
  const web = agent.tools.includes("web_fetch");
  const hosts = agent.allowedHosts.length;
  const lines: Exposure[] = [
    { label: "Sees your notes", on: reads, text: reads ? "It can read every note." : "It cannot read your notes." },
    { label: "Reads outside text", on: web && hosts > 0, text: web && hosts > 0 ? `It reads pages from ${hosts === 1 ? "1 site" : `${hosts} sites`}. A page can contain tricks aimed at the helper.` : "It reads nothing from the web." },
    { label: "Can send data out", on: web && hosts > 0, text: web && hosts > 0 ? "Each page it asks for is a request to that site." : "It sends nothing out." },
  ];
  return { lines, all: lines.every((l) => l.on) };
}

export type HostAdd = { ok: true; hosts: string[] } | { ok: false; message: string };

/** Adds a host to the list: normalizes it, refuses non-host text and duplicates, keeps the list sorted by entry order. */
export function addHost(list: string[], input: string): HostAdd {
  const host = normalizeHost(input);
  if (host === null) return { ok: false, message: HOST_HELP };
  if (list.includes(host)) return { ok: false, message: `${host} is already on the list.` };
  return { ok: true, hosts: [...list, host] };
}

/** Warning for an agent that has the web tool but no host it may reach. */
export function noHostsWarning(agent: Pick<Agent, "tools">, hosts: string[]): string | null {
  return agent.tools.includes("web_fetch") && hosts.length === 0 ? "This helper can't reach any site until you add a host." : null;
}
