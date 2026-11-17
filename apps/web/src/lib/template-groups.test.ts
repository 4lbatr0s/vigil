import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@vigil/shared";
import { HIDDEN_TEMPLATES, groupTemplates, templateTags } from "./template-groups";

describe("groupTemplates", () => {
  it("puts every shipped template under a group, none twice, none lost", () => {
    const groups = groupTemplates(TEMPLATES);
    const ids = groups.flatMap((g) => g.items.map((t) => t.id));
    // Helpers the app starts itself (the agent designer) are the only ones left out of the gallery.
    expect(ids.sort()).toEqual(TEMPLATES.map((t) => t.id).filter((id) => !HIDDEN_TEMPLATES.includes(id)).sort());
    expect(ids).not.toContain("agent-designer");
    expect(groups.map((g) => g.id)).toEqual(["study", "daily", "tidy"]);
  });
  it("shows an unknown template under More", () => {
    const extra = { ...TEMPLATES[0]!, id: "brand-new" };
    const groups = groupTemplates([...TEMPLATES, extra]);
    expect(groups.at(-1)).toMatchObject({ id: "more" });
    expect(groups.at(-1)?.items.map((t) => t.id)).toEqual(["brand-new"]);
  });
});

describe("templateTags", () => {
  const tags = (id: string) => templateTags(TEMPLATES.find((t) => t.id === id)!);
  it("says when it runs, what it touches and whether it uses the web", () => {
    expect(tags("morning-digest")).toEqual(["Runs on a schedule", "Writes notes"]);
    expect(tags("research-scout")).toContain("Uses the web");
    expect(tags("card-maker")).toEqual(["You start it", "Works on one note you give it"]);
  });
  it("gives every shipped template a when and a what", () => {
    for (const t of TEMPLATES) expect(templateTags(t).length).toBeGreaterThanOrEqual(2);
  });
});
