import { describe, expect, it } from "vitest";
import { AgentSchema, NoteSchema, slugify, normalizeHost } from "./index";

describe("NoteSchema", () => {
  it("parses a valid note", () => {
    const note = { id: "n1", title: "T", body: "B", updatedAt: "2026-11-14T00:00:00.000Z" };
    expect(NoteSchema.parse(note)).toMatchObject(note);
  });
  it("defaults tags to none and author to human", () => {
    const parsed = NoteSchema.parse({ id: "n1", title: "T", body: "B", updatedAt: "t" });
    expect(parsed.tags).toEqual([]);
    expect(parsed.author).toBe("human");
  });
  it("rejects an unknown author", () => {
    expect(() =>
      NoteSchema.parse({ id: "n1", title: "T", body: "B", updatedAt: "t", author: "robot" }),
    ).toThrow();
  });
  it("rejects a note without id", () => {
    expect(() => NoteSchema.parse({ title: "T", body: "B" })).toThrow();
  });
});

describe("slugify", () => {
  it("dash-separates words", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });
  it("strips non-ascii characters and collapses dashes", () => {
    expect(slugify("Ärger & Straße!")).toBe("rger-strae");
  });
  it("clamps long titles to 80 characters", () => {
    expect(slugify("a".repeat(120))).toHaveLength(80);
  });
  it("trims leading and trailing dashes", () => {
    expect(slugify("  --Hello--  ")).toBe("hello");
  });
});

describe("AgentSchema", () => {
  it("parses an old stored definition with trigger as the string manual to kind manual", () => {
    const parsed = AgentSchema.parse({ name: "digest", systemPrompt: "Write a digest.", trigger: "manual" });
    expect(parsed.trigger).toEqual({ kind: "manual" });
  });
  it("rejects a cron trigger without expression", () => {
    expect(() =>
      AgentSchema.parse({ name: "digest", systemPrompt: "Write a digest.", trigger: { kind: "cron" } }),
    ).toThrow();
  });
  it("rejects a heartbeat trigger with everyMinutes below 5", () => {
    expect(() =>
      AgentSchema.parse({
        name: "digest",
        systemPrompt: "Write a digest.",
        trigger: { kind: "heartbeat", everyMinutes: 1 },
      }),
    ).toThrow();
  });
  it("rejects an unknown tool grant", () => {
    expect(() =>
      AgentSchema.parse({ name: "digest", systemPrompt: "Write a digest.", tools: ["shell"] }),
    ).toThrow();
  });
  it("applies every default", () => {
    const parsed = AgentSchema.parse({ name: "digest", systemPrompt: "Write a digest." });
    expect(parsed).toMatchObject({
      description: "",
      tools: [],
      trigger: { kind: "manual" },
      enabled: true,
      strict: false,
      tokenBudget: 20000,
      defaultTask: "Do your job now.",
      allowedHosts: [],
      callable: [],
    });
  });
});

describe("allowedHosts", () => {
  it("normalizes plain host names and refuses everything else", () => {
    expect(normalizeHost("  Example.COM ")).toBe("example.com");
    expect(normalizeHost("docs.example.co.uk")).toBe("docs.example.co.uk");
    expect(normalizeHost("93.184.216.34")).toBe("93.184.216.34");
    for (const bad of ["", "localhost", "https://example.com", "example.com/path", "example.com:8080", "user@example.com", "*.example.com", "exa mple.com", "-a.com", "a..com", "example.com.", "ünicode.com", "[::1]"]) {
      expect(normalizeHost(bad), bad).toBeNull();
    }
  });
  it("the agent schema accepts normalized hosts only, with no duplicates", () => {
    const parse = (allowedHosts: string[]) => AgentSchema.safeParse({ name: "a", systemPrompt: "x", allowedHosts });
    expect(parse(["example.com", "docs.example.com"]).success).toBe(true);
    expect(parse([]).success).toBe(true);
    expect(parse(["Example.com"]).success).toBe(false);
    expect(parse(["https://example.com"]).success).toBe(false);
    expect(parse(["example.com", "example.com"]).success).toBe(false);
  });
});
