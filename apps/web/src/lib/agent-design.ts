import { AgentNameSchema, AgentSchema, slugify, type Agent, type ToolGrant, type Trigger } from "@vigil/shared";

export type Design = { name: string; description: string; systemPrompt: string; defaultTask: string };

/** The first `{ ... }` in a model's reply, parsed; models sometimes wrap JSON in fences or add a sentence. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    // Not JSON after all: the caller says the draft could not be read.
    return null;
  }
}

export type DesignResult = { ok: true; design: Design } | { ok: false; message: string };

/** A usable draft from the designer's reply, or why not. The name is made valid and short; text is trimmed to the limits. */
export function parseDesign(text: string): DesignResult {
  const json = extractJson(text);
  if (typeof json !== "object" || json === null) return { ok: false, message: "The draft could not be read. Try again, or write the agent yourself." };
  const o = json as Record<string, unknown>;
  const str = (k: string): string => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const systemPrompt = str("systemPrompt");
  if (systemPrompt.length < 20) return { ok: false, message: "The draft had no instructions for the agent. Try again, or write the agent yourself." };
  const name = slugify(str("name")).slice(0, 40).replace(/-+$/g, "") || "new-agent";
  return { ok: true, design: { name, description: str("description").slice(0, 280), systemPrompt: systemPrompt.slice(0, 6000), defaultTask: str("defaultTask").slice(0, 300) || "Do your job now." } };
}

/** `name`, or `name-2`, `name-3`... when it is taken. */
export function uniqueName(name: string, taken: readonly string[]): string {
  const base = AgentNameSchema.safeParse(name).success ? name : "new-agent";
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base.slice(0, 55)}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return base;
}

export type When = "manual" | "daily" | "weekly" | "changes";

/** The schedule from the wizard's choices. The designer never picks it: the person does. */
export function whenToTrigger(when: When, time: string, day: number, minutes: number): Trigger {
  if (when === "manual") return { kind: "manual" };
  if (when === "changes") return { kind: "heartbeat", everyMinutes: Math.min(1440, Math.max(5, Math.round(minutes))) };
  const [h = "7", m = "0"] = time.split(":");
  const hour = Math.min(23, Math.max(0, Number(h) || 0));
  const min = Math.min(59, Math.max(0, Number(m) || 0));
  return { kind: "cron", expression: `${min} ${hour} * * ${when === "weekly" ? Math.min(6, Math.max(0, day)) : "*"}` };
}

/**
 * The agent to save from a draft and the person's choices. It starts switched off, and any agent that writes notes
 * or reads notes while fetching the web starts with approvals on: the person may turn that off, the draft may not.
 */
export function designToAgent(input: { design: Design; tools: ToolGrant[]; trigger: Trigger; hosts: string[]; taken: readonly string[]; connection?: string }): Agent {
  const { design, tools, trigger, hosts } = input;
  const strict = tools.includes("write_notes") || (tools.includes("read_notes") && tools.includes("web_fetch"));
  return AgentSchema.parse({
    name: uniqueName(design.name, input.taken),
    description: design.description,
    systemPrompt: design.systemPrompt,
    tools,
    trigger,
    enabled: false,
    strict,
    tokenBudget: 20_000,
    defaultTask: design.defaultTask,
    allowedHosts: tools.includes("web_fetch") ? hosts : [],
    callable: [],
    ...(input.connection ? { connection: input.connection } : {}),
  });
}
