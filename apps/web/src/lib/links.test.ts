import { describe, expect, it } from "vitest";
import { dailyHref, NOTE_VIEWS, noteHref, notesRedirect } from "./links";

describe("links to Notes", () => {
  it("a note link goes to /notes with the id encoded, and an optional line", () => {
    expect(noteHref("study-plan")).toBe("/notes?note=study-plan");
    expect(noteHref("a b/c")).toBe("/notes?note=a%20b%2Fc");
    expect(noteHref("x", 12)).toBe("/notes?note=x&line=12");
  });

  it("a daily link goes to /notes", () => {
    expect(dailyHref("2026-11-26")).toBe("/notes?daily=2026-11-26");
  });

  it("an old Notes link on / is sent on to /notes with its query; plain / and unknown queries stay on Today", () => {
    const at = (s: string) => notesRedirect(new URL(s, "http://localhost"));
    expect(at("/?note=study-plan&line=3")).toBe("/notes?note=study-plan&line=3");
    expect(at("/?daily=2026-11-26")).toBe("/notes?daily=2026-11-26");
    expect(at("/?new=1")).toBe("/notes?new=1");
    expect(at("/?template=lecture")).toBe("/notes?template=lecture");
    expect(at("/")).toBeNull();
    expect(at("/?utm=x")).toBeNull();
  });

  it("the view switch offers the list, the graph and boards, in that order", () => {
    expect(NOTE_VIEWS.map((v) => v.href)).toEqual(["/notes", "/graph", "/canvas"]);
    expect(NOTE_VIEWS.map((v) => v.label)).toEqual(["List", "Graph", "Boards"]);
  });
});
