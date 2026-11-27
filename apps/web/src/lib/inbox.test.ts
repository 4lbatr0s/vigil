import { describe, expect, it } from "vitest";
import { appendLine, inboxLines, noteFromLine, withoutLine } from "./inbox";

const body = "---\ntags: [x]\n---\n- Look up the Born-Haber cycle\n\n- Ask about the lab deadline\n";

describe("inbox lines", () => {
  it("lists each non-empty line after the frontmatter, without its bullet, with its line number in the body", () => {
    expect(inboxLines(body)).toEqual([
      { line: 3, text: "Look up the Born-Haber cycle" },
      { line: 5, text: "Ask about the lab deadline" },
    ]);
    expect(inboxLines("")).toEqual([]);
  });

  it("removes exactly one line and keeps the rest of the body as it was", () => {
    expect(withoutLine(body, 3)).toBe("---\ntags: [x]\n---\n\n- Ask about the lab deadline\n");
    expect(withoutLine(body, 5)).toBe("---\ntags: [x]\n---\n- Look up the Born-Haber cycle\n\n");
  });

  it("appends a bullet to a note, on its own line", () => {
    expect(appendLine("## Ideas\n- one", "two")).toBe("## Ideas\n- one\n- two\n");
    expect(appendLine("text\n", "two")).toBe("text\n- two\n");
    expect(appendLine("", "two")).toBe("- two\n");
  });

  it("makes a short line the title of a new note, and keeps a long line as its first paragraph", () => {
    expect(noteFromLine("Gibbs free energy")).toEqual({ id: "gibbs-free-energy", title: "Gibbs free energy", body: "" });
    const long = "Why does the Born-Haber cycle give the lattice energy when it cannot be measured directly in the lab";
    const made = noteFromLine(long);
    expect(made.title).toBe("Why does the Born-Haber cycle give the lattice energy when it cannot be");
    expect(made.title.length).toBeLessThanOrEqual(72);
    expect(made.body).toBe(`${long}\n`);
  });
});
