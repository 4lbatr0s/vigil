import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@vigil/shared";
import { groupTemplates } from "./template-groups";

describe("groupTemplates", () => {
  it("puts every shipped template under a group, none twice, none lost", () => {
    const groups = groupTemplates(TEMPLATES);
    const ids = groups.flatMap((g) => g.items.map((t) => t.id));
    expect(ids.sort()).toEqual(TEMPLATES.map((t) => t.id).sort());
    expect(groups.map((g) => g.id)).toEqual(["study", "daily", "tidy"]);
  });
  it("shows an unknown template under More", () => {
    const extra = { ...TEMPLATES[0]!, id: "brand-new" };
    const groups = groupTemplates([...TEMPLATES, extra]);
    expect(groups.at(-1)).toMatchObject({ id: "more" });
    expect(groups.at(-1)?.items.map((t) => t.id)).toEqual(["brand-new"]);
  });
});
