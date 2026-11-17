import { describe, expect, it } from "vitest";
import { AgentSchema } from "./index";
import { TEMPLATES } from "./templates";

describe("agent templates", () => {
  it("ships the v1 templates and the card maker with unique ids", () => {
    expect(TEMPLATES.map((t) => t.id)).toEqual(["morning-digest", "weekly-review", "inbox-triager", "backlink-gardener", "research-scout", "card-maker", "socratic-tutor", "explain-it-back", "quiz-master", "recall-checker"]);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  it("every template is a valid agent once it has a name, and has a short summary", () => {
    for (const t of TEMPLATES) {
      expect(AgentSchema.safeParse({ ...t.agent, name: t.id }).success, t.id).toBe(true);
      expect(t.summary.length, t.id).toBeLessThanOrEqual(160);
      expect(t.title.length).toBeGreaterThan(0);
    }
  });

  it("web_fetch templates are strict, and heartbeat templates can read notes (ADR-0006)", () => {
    for (const t of TEMPLATES) {
      if (t.agent.tools.includes("web_fetch")) expect(t.agent.strict, t.id).toBe(true);
      if (t.agent.trigger.kind === "heartbeat") expect(t.agent.tools, t.id).toContain("read_notes");
      expect(t.needs.includes("web"), t.id).toBe(t.agent.tools.includes("web_fetch"));
    }
  });

  it("matches the plan: triggers, budgets, strictness", () => {
    const by = Object.fromEntries(TEMPLATES.map((t) => [t.id, t.agent]));
    expect(by["morning-digest"]).toMatchObject({ trigger: { kind: "cron", expression: "0 7 * * *" }, tokenBudget: 30000, strict: false });
    expect(by["weekly-review"]).toMatchObject({ trigger: { kind: "cron", expression: "0 18 * * 5" }, tokenBudget: 40000 });
    expect(by["inbox-triager"]).toMatchObject({ trigger: { kind: "heartbeat", everyMinutes: 30 }, tokenBudget: 15000, strict: true });
    expect(by["backlink-gardener"]).toMatchObject({ trigger: { kind: "heartbeat", everyMinutes: 60 }, tokenBudget: 20000, strict: true });
    expect(by["research-scout"]).toMatchObject({ trigger: { kind: "manual" }, tokenBudget: 40000, strict: true, allowedHosts: [] });
  });
});

describe("study agents", () => {
  const study = TEMPLATES.filter((t) => ["card-maker", "socratic-tutor", "explain-it-back", "quiz-master"].includes(t.id));
  it("have no tools, so they cannot write, read other notes or reach the web", () => {
    for (const t of study) expect(t.agent.tools, t.id).toEqual([]);
  });
  it("tutors keep to the note and make the learner think: hints before answers, one question at a time", () => {
    const by = Object.fromEntries(study.map((t) => [t.id, t.agent.systemPrompt]));
    expect(by["socratic-tutor"]).toMatch(/hint ladder/);
    expect(by["socratic-tutor"]).toMatch(/ONE question at a time/);
    expect(by["socratic-tutor"]).toMatch(/Never give the answer first/);
    expect(by["explain-it-back"]).toMatch(/Do not rewrite their explanation/);
    for (const id of ["socratic-tutor", "quiz-master", "explain-it-back"]) expect(by[id], id).toMatch(/FIRST reply/);
    expect(by["quiz-master"]).toMatch(/ONE at a time/);
    for (const id of ["socratic-tutor", "explain-it-back", "quiz-master"]) expect(by[id], id).toMatch(/NOTE START/);
  });
});
