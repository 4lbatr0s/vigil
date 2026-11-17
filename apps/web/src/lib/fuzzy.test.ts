import { describe, expect, it } from "vitest";
import { fuzzyScore, rank } from "./fuzzy";
import { buildCommands } from "./commands";

describe("fuzzyScore", () => {
  it("ranks prefix over word start over substring, and rejects non-matches", () => {
    const prefix = fuzzyScore("dig", "Digest") as number;
    const word = fuzzyScore("dig", "Morning digest") as number;
    const sub = fuzzyScore("ges", "Digest") as number;
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(fuzzyScore("zzz", "Digest")).toBeNull();
  });
  it("is case-insensitive, treats empty as a match, and prefers the shorter text", () => {
    expect(fuzzyScore("DIG", "digest")).not.toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("a", "ab") as number).toBeGreaterThan(fuzzyScore("a", "abcdef") as number);
  });
  it("does not choke on regex characters", () => {
    expect(fuzzyScore("(", "a (b)")).not.toBeNull();
    expect(fuzzyScore("[", "no")).toBeNull();
  });
  it("rank keeps original order for ties", () => {
    expect(rank(["bb", "ba", "ab"], "b", (s) => s)).toEqual(["bb", "ba", "ab"]);
  });
});

describe("buildCommands", () => {
  const base = { noteHits: [{ id: "plan", title: "Launch plan" }], agents: ["morning-digest", "weekly-review"] };
  it("shows only the fixed commands for an empty query", () => {
    expect(buildCommands({ ...base, query: "" }).map((c) => c.label)).toEqual(["New note", "Today's note", "Study cards", "Open Today", "New lecture note", "New meeting note", "New Cornell note", "New reading note", "Ask your notes", "Gap check", "Open Canvas", "New chat", "Open Graph", "Open Agents", "Open Settings", "Open Approvals"]);
  });
  it("lists notes, agents and matching commands for a query", () => {
    const out = buildCommands({ ...base, query: "digest" });
    expect(out.map((c) => c.id)).toEqual(["note:plan", "agent:morning-digest", "run:morning-digest"]);
    expect(out[0]?.action).toEqual({ type: "goto", href: "/?note=plan" });
    expect(out.at(-1)?.action).toEqual({ type: "run", agent: "morning-digest" });
  });
  it("typing run offers a Run command per agent, and set offers Settings", () => {
    expect(buildCommands({ ...base, noteHits: [], query: "run" }).map((c) => c.label)).toEqual(["Run weekly-review", "Run morning-digest"]) // shorter label first;
    expect(buildCommands({ ...base, noteHits: [], query: "set" }).map((c) => c.label)).toEqual(["Open Settings"]);
  });
  it("encodes ids placed in links", () => {
    const out = buildCommands({ query: "x", noteHits: [{ id: "a/b", title: "x" }], agents: [] });
    expect(out[0]?.action).toEqual({ type: "goto", href: "/?note=a%2Fb" });
  });
});
