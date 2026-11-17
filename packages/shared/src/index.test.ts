import { describe, expect, it } from "vitest";
import { AgentSchema, NoteSchema, allTags, extractCards, extractInlineTags, normalizeHost, slugify, snippetOf } from "./index";

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


describe("note text helpers", () => {
  it("finds inline tags, nested, lowercased, outside code", () => {
    const body = "Plan #Work/Launch and #ideas.\nNot a tag: C# and #1 and `#code` and\n```\n#fenced\n```\nTitle#nope (#paren)";
    expect(extractInlineTags(body).sort()).toEqual(["ideas", "paren", "work/launch"]);
  });
  it("merges frontmatter and inline tags without duplicates", () => {
    expect(allTags(["Work", "x"], "see #work and #y")).toEqual(["work", "x", "y"]);
  });
  it("builds a one-line snippet without markdown noise", () => {
    expect(snippetOf("# Title\n\nSee [[Hiring|the hiring plan]] and **bold** [link](http://x.y) #tag\n\n- item")).toBe("See the hiring plan and bold link item");
    expect(snippetOf("a ".repeat(200), 20).length).toBeLessThanOrEqual(20);
    expect(snippetOf("")).toBe("");
  });
});

describe("extractCards", () => {
  it("keeps the same question under different headings as separate cards, and drops a repeat under the same heading", () => {
    const cards = extractCards("## A\nWhat does it make? :: ATP\nWhat does it make? :: again\n## B\nWhat does it make? :: Sugar");
    expect(cards.map((c) => [c.context, c.back])).toEqual([["A", "ATP"], ["B", "Sugar"]]);
    expect(new Set(cards.map((c) => c.id)).size).toBe(2);
    expect(extractCards("What does it make? :: ATP")[0]?.id).toBe(cards[0]?.id);
  });

  it("remembers the nearest heading above each card, and ignores headings in code", () => {
    const body = "Before? :: none\n# Bio\n## The cell\nWhat is ATP? :: energy\n```\n# not a heading\n```\nWhere is DNA? :: nucleus\n### Cells #\nThe {{nucleus}} holds DNA.";
    expect(extractCards(body).map((c) => [c.front, c.context])).toEqual([
      ["Before?", ""],
      ["What is ATP?", "The cell"],
      ["Where is DNA?", "The cell"],
      ["The […] holds DNA.", "Cells"],
    ]);
  });

  it("reads question and answer lines, with list and quote marks before them", () => {
    const cards = extractCards("# Bio\n\nWhat is ATP? :: The cell's energy currency\n- Where is DNA kept? :: In the nucleus\n> Quoted? :: yes");
    expect(cards.map((c) => [c.kind, c.front, c.back, c.line])).toEqual([
      ["qa", "What is ATP?", "The cell's energy currency", 3],
      ["qa", "Where is DNA kept?", "In the nucleus", 4],
      ["qa", "Quoted?", "yes", 5],
    ]);
  });
  it("reads cloze sentences: hidden parts on the front, full text on the back", () => {
    const [card] = extractCards("The {{mitochondria}} makes {{ATP}}.");
    expect(card).toMatchObject({ kind: "cloze", front: "The […] makes […].", back: "The mitochondria makes ATP." });
  });
  it("ignores fenced code, lines without a separator, and empty sides", () => {
    expect(extractCards("```\nQ :: A\n{{x}}\n```\nplain line\nAlone ::\n :: Orphan\nA :: B")).toHaveLength(1);
    expect(extractCards("~~~\nQ :: A\n~~~")).toHaveLength(0);
  });
  it("gives the same id for the same front wherever it sits, and one card for a repeat", () => {
    const a = extractCards("Q? :: A");
    const b = extractCards("intro\n\n  q?   :: A (changed answer)\nQ? :: again");
    expect(b).toHaveLength(1);
    expect(b[0]?.id).toBe(a[0]?.id);
    expect(extractCards("Q2? :: A")[0]?.id).not.toBe(a[0]?.id);
  });
});
