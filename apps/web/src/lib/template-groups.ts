import type { AgentTemplate } from "@vigil/shared";

export const TEMPLATE_GROUPS = [
  { id: "study", title: "Study", blurb: "Helpers that make you think, not copy answers.", ids: ["card-maker", "socratic-tutor", "explain-it-back", "quiz-master", "recall-checker", "outliner", "study-review"] },
  { id: "daily", title: "Your daily rhythm", blurb: "Run on a schedule while you are away.", ids: ["morning-digest", "weekly-review"] },
  { id: "tidy", title: "Keeping notes tidy", blurb: "Look after your notes in the background.", ids: ["inbox-triager", "backlink-gardener", "research-scout"] },
] as const;

/** Templates under their group headings, in the order above; a template no group names goes under "More" so none is ever lost. */
export function groupTemplates(templates: readonly AgentTemplate[]): { id: string; title: string; blurb: string; items: AgentTemplate[] }[] {
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
