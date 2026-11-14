import { describe, expect, it } from "vitest";
import { healthPayload } from "./health";
import { NoteSchema } from "@vigil/shared";

describe("server", () => {
  it("reports health", () => {
    expect(healthPayload()).toEqual({ ok: true, app: "vigil-server" });
  });
  it("round-trips a shared Note across packages", () => {
    const note = { id: "n1", title: "T", body: "B", updatedAt: "2026-11-14T00:00:00.000Z" };
    expect(NoteSchema.parse(note)).toMatchObject(note);
  });
});
