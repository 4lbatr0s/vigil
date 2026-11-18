import { describe, expect, it } from "vitest";
import { AgentSchema } from "./index";
import { agentToSkill, skillToAgent } from "./skill";

const agent = AgentSchema.parse({ name: "digest", description: 'Writes a "short" digest.', systemPrompt: "Read the notes.\n\nWrite a digest.", tools: ["read_notes", "write_notes"] });

describe("agentToSkill and skillToAgent", () => {
  it("exports a SKILL.md with a name, a description and the instructions", () => {
    const text = agentToSkill(agent);
    expect(text.startsWith("---\nname: digest\ndescription: ")).toBe(true);
    expect(text).toContain("Read the notes.\n\nWrite a digest.");
    expect(text).toContain("read_notes, write_notes");
  });

  it("round-trips the words and drops the tool note", () => {
    const back = skillToAgent(agentToSkill(agent));
    expect(back).toEqual({ ok: true, skill: { name: "digest", description: 'Writes a "short" digest.', systemPrompt: "Read the notes.\n\nWrite a digest." } });
  });

  it("reads a skill from elsewhere, tidying its name", () => {
    const r = skillToAgent("---\nname: PDF Helper\ndescription: Works with PDFs\nlicense: MIT\n---\n\n# PDF\n\nUse this when asked about PDFs.\n");
    expect(r).toEqual({ ok: true, skill: { name: "pdf-helper", description: "Works with PDFs", systemPrompt: "# PDF\n\nUse this when asked about PDFs." } });
  });

  it("explains what is wrong with a file that is not a skill", () => {
    expect(skillToAgent("just text")).toMatchObject({ ok: false });
    expect(skillToAgent("---\ndescription: x\n---\nbody")).toMatchObject({ ok: false });
    expect(skillToAgent("---\nname: a\n---\n")).toMatchObject({ ok: false });
  });
});
