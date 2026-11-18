import type { AgentTemplate } from "@vigil/shared";

export const TEMPLATE_GROUPS = [
  { id: "study", title: "Study", blurb: "Helpers that make you think, not copy answers.", ids: ["card-maker", "socratic-tutor", "explain-it-back", "quiz-master", "recall-checker", "outliner", "study-review", "note-asker", "gap-checker"] },
  { id: "daily", title: "Your daily rhythm", blurb: "Run on a schedule while you are away.", ids: ["morning-digest", "weekly-review"] },
  { id: "tidy", title: "Keeping notes tidy", blurb: "Look after your notes in the background.", ids: ["inbox-triager", "backlink-gardener", "wiki-keeper", "research-scout"] },
] as const;

/** Templates under their group headings, in the order above; a template no group names goes under "More" so none is ever lost. */
/** Helpers the app starts for you (the new-agent wizard); not listed in the gallery. */
export const HIDDEN_TEMPLATES: readonly string[] = ["agent-designer"];

export function groupTemplates(templates: readonly AgentTemplate[]): { id: string; title: string; blurb: string; items: AgentTemplate[] }[] {
  templates = templates.filter((t) => !HIDDEN_TEMPLATES.includes(t.id));
  const byId = new Map(templates.map((t) => [t.id, t]));
  const used = new Set<string>();
  const groups = TEMPLATE_GROUPS.map((g) => {
    const items = g.ids.flatMap((id) => {
      const t = byId.get(id);
      if (!t) return [];
      used.add(id);
      return [t];
    });
    return { id: g.id, title: g.title, blurb: g.blurb, items };
  }).filter((g) => g.items.length > 0);
  const rest = templates.filter((t) => !used.has(t.id));
  return rest.length > 0 ? [...groups, { id: "more", title: "More", blurb: "", items: rest }] : groups;
}

/** Short plain labels that tell what a ready-made agent does, worked out from its real settings so they cannot drift. */
export function templateTags(t: AgentTemplate): string[] {
  const tags: string[] = [];
  const trigger = t.agent.trigger.kind;
  tags.push(trigger === "cron" ? "Runs on a schedule" : trigger === "heartbeat" ? "Runs when notes change" : "You start it");
  if (t.agent.tools.includes("write_notes")) tags.push("Writes notes");
  else if (t.agent.tools.includes("read_notes")) tags.push("Reads notes");
  else tags.push("Works on one note you give it");
  if (t.agent.tools.includes("web_fetch")) tags.push("Uses the web");
  return tags;
}
