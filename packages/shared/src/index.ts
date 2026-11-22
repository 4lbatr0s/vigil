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
/**
 * A note without its body, for lists (GET /api/notes?fields=summary).
 * `tags` are the note's frontmatter tags plus its inline #tags; `snippet` is the first words of the body.
 */
export type NoteSummary = Omit<Note, "body"> & { snippet?: string };

/** Inline `#tags` in a note body, lowercased, without the `#`, nested with `/`. Code blocks and inline code are ignored. */
export function extractInlineTags(body: string): string[] {
  const text = body.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ").replace(/`[^`\n]*`/g, " ");
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s(])#([a-zA-Z][\w-]*(?:\/[\w-]+)*)/gm)) found.add((m[1] as string).toLowerCase());
  return [...found];
}

/** Frontmatter tags and inline tags together, unique, in first-seen order. */
export function allTags(tags: string[], body: string): string[] {
  return [...new Set([...tags.map((t) => t.toLowerCase()), ...extractInlineTags(body)])];
}

/** A short plain-text preview of a note body: no headings marks, links reduced to their text, one line. */
export function snippetOf(body: string, max = 140): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+.*$/m, " ") // the first heading usually repeats the title
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b ?? a)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(^|\s)#[a-zA-Z][\w/-]*/g, "$1")
    .replace(/[*_~`>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

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

/** Message shown when a host is not a plain host name. */
export const HOST_HELP = "Enter a host like example.com, without https:// or a path.";

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** A host name for the web allowlist: lower-case ASCII labels with at least one dot. No scheme, path, port, user info or wildcard. Returns the host or null. */
export function normalizeHost(input: string): string | null {
  const host = input.trim().toLowerCase();
  return host.length <= 253 && HOST_PATTERN.test(host) ? host : null;
}

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
  /** The saved model connection this agent uses (Settings, Models); the default connection when absent. */
  connection: z.string().min(1).max(60).optional(),
  /** User message for a run that is started without one. */
  defaultTask: z.string().default("Do your job now."),
  /** Hosts `web_fetch` may call (WP10). Exact host names, no wildcards. */
  allowedHosts: z
    .array(z.string().refine((h) => normalizeHost(h) === h, HOST_HELP))
    .refine((list) => new Set(list).size === list.length, "Each host may be listed once")
    .default([]),
  /** Agents this one may start with `call_agent` (WP7). Empty means none. */
  callable: z.array(AgentNameSchema).default([]),
  /** Instruction for a chat agent: appended to the system prompt in chat threads (WP9). */
  archetypeHint: z.string().optional(),
  /** Up to five sample tasks the owner keeps to re-run after changing the agent's instructions. */
  testTasks: z.array(z.string().trim().min(1).max(2000)).max(5).optional(),
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
  trigger: z.enum(["manual", "cron", "heartbeat", "chat", "call", "mcp"]),
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

export * from "./citations";
export * from "./templates";
export * from "./skill";

// ---- Study cards (ADR-0017) ----

export type CardKind = "qa" | "cloze";
export type Card = {
  /** Stable for the same front text (hash of the normalised front), so scheduling survives moving a card around a note. */
  id: string;
  kind: CardKind;
  front: string;
  back: string;
  /** 1-based line in the note body. */
  line: number;
  /** Text of the nearest heading above the card, to tell apart cards that read alike; empty when there is none. */
  context: string;
};

/** 32-bit FNV-1a, hex. Enough to tell cards in one vault apart; not a security hash. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const norm = (t: string): string => t.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Cards written in a note: `Question :: Answer` on one line, and cloze sentences with `{{hidden}}`.
 * Fenced code is ignored, and so are list markers and quote marks before a card. A cloze card shows the
 * sentence with the hidden parts as `[…]` on the front and the full sentence on the back. The same front
 * text twice in one note gives one card, unless the two sit under different headings.
 */
export function extractCards(body: string): Card[] {
  const cards: Card[] = [];
  let heading = "";
  const contextOf = new Map<string, string>();
  const seen = new Set<string>();
  let fence: string | null = null;
  body.split("\n").forEach((raw, i) => {
    const marker = /^\s*(```|~~~)/.exec(raw)?.[1];
    if (marker) {
      fence = fence === null ? marker : fence === marker ? null : fence;
      return;
    }
    if (fence !== null) return;
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(raw);
    if (h?.[1]) {
      heading = h[1].trim().slice(0, 120);
      return;
    }
    const text = raw.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)+/, "").trim();
    if (text === "") return;
    let card: Omit<Card, "id" | "line" | "context"> | null = null;
    const cloze = text.match(/\{\{([^{}]+)\}\}/g);
    if (cloze) {
      card = { kind: "cloze", front: text.replace(/\{\{([^{}]+)\}\}/g, "[…]"), back: text.replace(/\{\{([^{}]+)\}\}/g, "$1") };
    } else {
      const at = text.indexOf(" :: ");
      if (at > 0 && at < text.length - 4) card = { kind: "qa", front: text.slice(0, at).trim(), back: text.slice(at + 4).trim() };
    }
    if (!card || card.front === "" || card.back === "") return;
    let id = fnv1a(`${card.kind}:${norm(card.front)}`);
    // The same question under another heading is another card ("What does it make?" under Mitochondria and under Chloroplast).
    if (seen.has(id) && contextOf.get(id) !== heading) id = fnv1a(`${card.kind}:${norm(card.front)}|${norm(heading)}`);
    if (seen.has(id)) return;
    seen.add(id);
    contextOf.set(id, heading);
    cards.push({ ...card, id, line: i + 1, context: heading });
  });
  return cards;
}

export type CardHint = { code: "long-answer" | "list" | "yes-no" | "many-blanks" | "not-a-question" | "not-in-note"; message: string };

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

/**
 * Plain-language hints that a card is hard to learn from: the "one fact per card" rule of thumb
 * (Wozniak's minimum information principle). Hints only; nothing is changed or blocked.
 */
const wordsOf = (text: string): string[] => (text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).map((w) => w.slice(0, 5));

/**
 * A check that the answer of a card (often written by an AI) is grounded in the note it came from: most of the answer's
 * longer words must appear in the note. A hint, not a verdict. A short answer with no long word cannot be judged, so it
 * passes. Words are compared by their first five letters, so "produces" matches "produce".
 */
export function groundingHint(card: Pick<Card, "back">, noteBody: string): CardHint | null {
  const answer = [...new Set(wordsOf(card.back))];
  if (answer.length === 0) return null;
  const note = new Set(wordsOf(noteBody));
  const found = answer.filter((w) => note.has(w)).length;
  return found / answer.length >= 0.6 ? null : { code: "not-in-note", message: "Part of this answer is not in your note. Check it is true before you keep it." };
}

export function lintCard(card: Pick<Card, "kind" | "front" | "back">): CardHint[] {
  const hints: CardHint[] = [];
  if (card.kind === "cloze") {
    const blanks = card.front.split("[…]").length - 1;
    if (blanks > 1) hints.push({ code: "many-blanks", message: "Several blanks in one card. Try one blank per card." });
    return hints;
  }
  if (words(card.back) > 25) hints.push({ code: "long-answer", message: "Long answer. Try splitting it into smaller cards." });
  const items = card.back.split(/[;,]|\band\b/i).filter((p) => p.trim() !== "");
  if (items.length >= 3 || /(^|\s)(1[.)]|[-*]\s)/.test(card.back)) hints.push({ code: "list", message: "This looks like a list. One card per item is easier to remember." });
  if (/^(yes|no|true|false)\b/i.test(card.back.trim())) hints.push({ code: "yes-no", message: "Yes or no is easy to guess. Ask what or why instead." });
  if (!card.front.trim().endsWith("?")) hints.push({ code: "not-a-question", message: "Phrase the front as a question." });
  return hints;
}

/** The note without its card lines: they are question and answer pairs, and a tutor that sees the answers gives them away. */
export function withoutCards(body: string): string {
  const card = new Set(extractCards(body).map((c) => c.line));
  return body
    .split("\n")
    .filter((_, i) => !card.has(i + 1))
    .join("\n")
    .replace(/^##\s+Cards\s*$\n?/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
