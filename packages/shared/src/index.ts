import { z } from "zod";

/** Who wrote the note last. Drives the amber "agent-written" look (ADR-0005). */
export const AuthorSchema = z.enum(["human", "agent"]);
export type Author = z.infer<typeof AuthorSchema>;

export const NoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()).default([]),
  author: AuthorSchema.default("human"),
  /** File modification time, so edits made outside the API (Obsidian, agents) still count. */
  updatedAt: z.string(),
  /** Name of the agent that last wrote this note (provenance; heartbeat loop prevention, UI). */
  agentName: z.string().optional(),
});

export type Note = z.infer<typeof NoteSchema>;

/** Lowercase, dash-separated, [a-z0-9-] only, max 80 chars. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

// ---- Agents (ADR-0004, ADR-0009) ----

export const ToolGrantSchema = z.enum(["read_notes", "write_notes", "web_fetch", "call_agents"]);
export type ToolGrant = z.infer<typeof ToolGrantSchema>;

export const AgentNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/, "lowercase letters, digits and dashes");

export const TriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("cron"), expression: z.string().min(1), timezone: z.string().optional() }),
  z.object({ kind: z.literal("heartbeat"), everyMinutes: z.number().int().min(5).max(1440) }),
]);
export type Trigger = z.infer<typeof TriggerSchema>;

export const AgentSchema = z.object({
  name: AgentNameSchema,
  description: z.string().max(280).default(""),
  systemPrompt: z.string().min(1),
  /** Tool allowlist. An empty list means a model with no tools. */
  tools: z.array(ToolGrantSchema).default([]),
  /** M1 runs agents by hand; cron and heartbeat triggers arrive in M2 and M3. */
  trigger: z.preprocess(
    (v) => (v === "manual" ? { kind: "manual" } : v), // definitions saved by M1 stored the string
    TriggerSchema,
  ).default({ kind: "manual" }),
  enabled: z.boolean().default(true),
  /** Writes wait for approval (WP8). The owner decides per agent in the UI; the default for a new agent comes from instance permission settings (WP3-T5). */
  strict: z.boolean().default(false),
  /** Per-run token cap (input + output, summed over every model call). */
  tokenBudget: z.number().int().positive().max(1_000_000).default(20_000),
  /** Overrides VIGIL_LLM_MODEL for this agent. */
  model: z.string().min(1).optional(),
  /** User message for a run that is started without one. */
  defaultTask: z.string().default("Do your job now."),
  /** Hosts `web_fetch` may call (WP10). Exact host names, no wildcards. */
  allowedHosts: z.array(z.string().min(1)).default([]),
  /** Agents this one may start with `call_agent` (WP7). Empty means none. */
  callable: z.array(AgentNameSchema).default([]),
  /** Instruction for a chat agent: appended to the system prompt in chat threads (WP9). */
  archetypeHint: z.string().optional(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const RunStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "budget-exceeded",
  "step-limit",
  "interrupted",
  "waiting-approval",
  "skipped",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunSchema = z.object({
  id: z.string(),
  agent: z.string(),
  status: RunStatusSchema,
  trigger: z.enum(["manual", "cron", "heartbeat", "chat", "call"]),
  parentRunId: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  tokensUsed: z.number().int(),
  tokenBudget: z.number().int(),
  error: z.string().nullable(),
  /** Notes this run created or changed (ids), for the undo button. */
  touched: z.array(z.string()),
  undone: z.boolean(),
});
export type Run = z.infer<typeof RunSchema>;

export const RunEventSchema = z.object({
  seq: z.number().int(),
  at: z.string(),
  kind: z.enum(["prompt", "model", "tool-call", "tool-result", "tool-denied", "note", "stop"]),
  /** Short human-readable text. Never holds an API key. */
  text: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

// ---- Instance permission settings (WP3-T5, ADR-0015) ----

export const PermissionSettingsSchema = z.object({
  /** Instance-wide switches. A tool that is off here is unavailable to every agent, whatever its own grants say. */
  tools: z
    .object({
      read_notes: z.boolean().default(true),
      write_notes: z.boolean().default(true),
      web_fetch: z.boolean().default(true),
      call_agents: z.boolean().default(true),
    })
    .default({ read_notes: true, write_notes: true, web_fetch: true, call_agents: true }),
  /** New agents (and agents created from templates) start with approvals on or off. */
  newAgentsStrict: z.boolean().default(true),
  /** No run may use more tokens than this, whatever an agent's own budget says. */
  maxTokenBudget: z.number().int().positive().max(1_000_000).default(200_000),
  /** Days to keep run logs and undo snapshots. 0 keeps everything; otherwise 7 or more (WP3-T6). */
  retentionDays: z
    .number()
    .int()
    .max(3650)
    .refine((n) => n === 0 || n >= 7, "0 (keep forever) or at least 7 days")
    .default(90),
});
export type PermissionSettings = z.infer<typeof PermissionSettingsSchema>;

export * from "./templates";
