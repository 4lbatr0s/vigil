import { describe, expect, it } from "vitest";
import { freeId } from "./free-id";

describe("freeId", () => {
  it("keeps a free id", () => {
    expect(freeId("notes", ["other"])).toBe("notes");
  });
  it("adds the first free number", () => {
    expect(freeId("notes", ["notes"])).toBe("notes-2");
    expect(freeId("notes", ["notes", "notes-2", "notes-3"])).toBe("notes-4");
    expect(freeId("notes", ["notes", "notes-3"])).toBe("notes-2");
  });
});
