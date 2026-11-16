import { describe, expect, it } from "vitest";
import { slugify } from "@vigil/shared";
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
});
