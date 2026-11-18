import { AgentNameSchema, type Agent } from "./index";

/**
 * Agent Skills (SKILL.md) in and out. A skill is a folder whose SKILL.md has a little front matter (`name`, `description`)
 * and plain instructions, an open format many AI tools read. An agent exports as one, and a skill imports as an agent.
 * Import brings only the words: the new agent has NO tools, no web sites, is switched off and asks before writing, so a
 * skill from anywhere can never give itself power. The person grants what it needs on the agent page.
 */

export type ImportedSkill = { name: string; description: string; systemPrompt: string };

const quote = (text: string): string => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

/** The SKILL.md text for an agent. What the agent may touch is listed in a comment line for the reader, not as a grant. */
export function agentToSkill(agent: Pick<Agent, "name" | "description" | "systemPrompt" | "tools">): string {
  const description = agent.description.trim() || `The ${agent.name} agent from a Vigil notes vault.`;
  const tools = agent.tools.length === 0 ? "none" : agent.tools.join(", ");
  return ["---", `name: ${agent.name}`, `description: ${quote(description)}`, "---", "", agent.systemPrompt.trim(), "", `<!-- Written by Vigil. It used these Vigil tools: ${tools}. Importing a skill never grants tools. -->`, ""].join("\n");
}

const unquote = (v: string): string => {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return t;
};

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** Reads a SKILL.md. Returns a message instead of a skill when it has no usable name or instructions. */
export function skillToAgent(markdown: string): { ok: true; skill: ImportedSkill } | { ok: false; message: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown.trim());
  if (!m) return { ok: false, message: "This is not a skill file: it must start with a --- block holding a name and a description." };
  const front = new Map<string, string>();
  for (const line of (m[1] ?? "").split("\n")) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) front.set((kv[1] ?? "").toLowerCase(), unquote(kv[2] ?? ""));
  }
  const name = slug(front.get("name") ?? "");
  const body = (m[2] ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!AgentNameSchema.safeParse(name).success) return { ok: false, message: "The skill needs a name made of letters, digits and dashes." };
  if (body === "") return { ok: false, message: "The skill has no instructions under the --- block." };
  return { ok: true, skill: { name, description: (front.get("description") ?? "").slice(0, 280), systemPrompt: body } };
}
