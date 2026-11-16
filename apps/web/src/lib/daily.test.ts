import { describe, expect, it } from "vitest";
import { slugify } from "@vigil/shared";
import { dailyNote } from "./daily";

describe("dailyNote", () => {
  it("uses the local calendar day, zero padded", () => {
    expect(dailyNote(new Date(2026, 0, 5, 23, 59))).toEqual({ id: "2026-01-05", title: "2026-01-05" });
    expect(dailyNote(new Date(2026, 10, 17, 0, 1)).id).toBe("2026-11-17");
  });
  it("is already a valid note id", () => {
    const { id, title } = dailyNote(new Date(2026, 10, 17));
    expect(slugify(title)).toBe(id);
  });
});
