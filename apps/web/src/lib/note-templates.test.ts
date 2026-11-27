import { describe, expect, it } from "vitest";
import { extractCards, slugify } from "@vigil/shared";
import { NOTE_TEMPLATES, fromTemplate, templateById } from "./note-templates";

describe("note templates", () => {
  it("each gives a valid note id that matches its title", () => {
    for (const t of NOTE_TEMPLATES) {
      const n = fromTemplate(t, new Date(2026, 10, 17));
      expect(slugify(n.title), t.id).toBe(n.id);
      expect(n.id).toMatch(/^[a-z]+-2026-11-17$/);
    }
  });
  it("the lecture note asks for the learner's own words and ends with a Cards section", () => {
    const lecture = templateById("lecture");
    expect(lecture?.body).toMatch(/in my own words/);
    expect(lecture?.body.trimEnd().endsWith("## Cards")).toBe(true);
  });
  it("has unique ids and finds none for an unknown id", () => {
    expect(new Set(NOTE_TEMPLATES.map((t) => t.id)).size).toBe(NOTE_TEMPLATES.length);
    expect(templateById("nope")).toBeUndefined();
  });

  it("the source note asks where it came from and the page, and ends with a Questions section", () => {
    const source = templateById("source");
    expect(source?.label).toBe("New source note");
    expect(source?.body).toMatch(/^Source: \nPage: \n/);
    expect(source?.body).toMatch(/## Questions\n/);
  });
  it("the Cornell and source notes explain the question format, and the explanation is not a card itself", () => {
    for (const id of ["cornell", "source"]) {
      const body = templateById(id)?.body ?? "";
      expect(body, id).toMatch(/two colons/);
      expect(extractCards(body), id).toEqual([]);
    }
  });
  it("the old reading template id still opens the source note", () => {
    expect(templateById("reading")?.id).toBe("source");
  });
});
