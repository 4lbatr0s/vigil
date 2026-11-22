import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Note } from "@vigil/shared";
import { assembleContext, fitText } from "./context";
import { cardsForNote, closeDb, reindexNote } from "./index-db";
import { addMisconceptions } from "./misconceptions";
import { enroll } from "./recall";
import { newCardState, review } from "./srs";
import { closeState, saveReview, setGoal } from "./state-db";

let root = "";
const saved = { ...process.env };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-context-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
});
afterEach(async () => {
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const T0 = new Date("2026-11-10T10:00:00.000Z");
const note = (id: string, title: string, body: string, tags: string[] = []): Note => ({ id, title, body, tags, author: "human", updatedAt: "2026-11-09T10:00:00.000Z" });

describe("fitText", () => {
  it("keeps short text and cuts long text with a plain marker", () => {
    expect(fitText("short", 100)).toBe("short");
    const cut = fitText("x".repeat(500), 100);
    expect(cut.length).toBeLessThan(200);
    expect(cut).toContain("[the note continues; only the first part is shown]");
  });
});

describe("assembleContext", () => {
  it("returns null for a note that does not exist", () => {
    expect(assembleContext({ noteId: "nope", parts: ["note"] }, T0)).toBeNull();
  });

  it("puts the note between markers, with its title and id on top", () => {
    reindexNote(note("enthalpy", "Enthalpy", "Heat content."));
    const c = assembleContext({ noteId: "enthalpy", parts: ["note"] }, T0)!;
    expect(c.text).toBe('Note "Enthalpy" (id: enthalpy)\nNOTE START\nHeat content.\nNOTE END');
  });

  it("leaves out the card lines when asked, because a tutor that sees the answers gives them away", () => {
    reindexNote(note("cards", "Cards", "Intro.\n\nWhat is X? :: The answer.\n\nMore text."));
    const shown = assembleContext({ noteId: "cards", parts: ["note"], hideCards: true }, T0)!;
    expect(shown.text).toContain("Intro.");
    expect(shown.text).toContain("More text.");
    expect(shown.text).not.toContain("The answer.");
    expect(assembleContext({ noteId: "cards", parts: ["note"] }, T0)!.text).toContain("The answer.");
  });

  it("adds the learner's memory of the note: cards, how much is remembered, recall check, exam", () => {
    reindexNote(note("bio", "Biology", "Q1? :: A1\n\nQ2? :: A2", ["science"]));
    const card = cardsForNote("bio")[0]!;
    const { next, log } = review(newCardState(T0), "good", T0);
    saveReview(card.id, "bio", next, log, T0);
    enroll("bio", new Date("2026-11-01T00:00:00.000Z"));
    setGoal({ kind: "note", value: "bio", day: "2026-11-15" }, T0);
    const c = assembleContext({ noteId: "bio", parts: ["learner"] }, new Date("2026-11-11T10:00:00.000Z"))!;
    expect(c.text).toContain("LEARNER START");
    expect(c.text).toContain("2 cards, 1 answered");
    expect(c.text).toMatch(/about \d+% remembered/);
    expect(c.text).toContain("recall check is due");
    expect(c.text).toContain("exam in 4 days");
  });

  it("has no learner block for a note with nothing studied", () => {
    reindexNote(note("plain", "Plain", "Just text."));
    expect(assembleContext({ noteId: "plain", parts: ["learner"] }, T0)!.text).not.toContain("LEARNER START");
  });

  it("adds what the learner got wrong before, as data", () => {
    reindexNote(note("dna", "DNA", "Text."));
    addMisconceptions("dna", ["Mixed up DNA and RNA"], T0);
    const c = assembleContext({ noteId: "dna", parts: ["shaky"] }, T0)!;
    expect(c.text).toContain("SHAKY START\n- Mixed up DNA and RNA\nSHAKY END");
  });

  it("lists notes linked to or from this note by title, each once, never the note itself", () => {
    reindexNote(note("a", "Alpha", "See [[b]] and [[c]] and [[missing]]."));
    reindexNote(note("b", "Beta", "Back to [[a]]."));
    reindexNote(note("c", "Gamma", ""));
    reindexNote(note("d", "Delta", "Also [[a]]."));
    const c = assembleContext({ noteId: "a", parts: ["linked"] }, T0)!;
    expect(c.text).toContain("LINKED START");
    for (const line of ["- Beta (id: b)", "- Gamma (id: c)", "- Delta (id: d)"]) expect(c.text).toContain(line);
    expect(c.text.match(/Beta/g)).toHaveLength(1);
    expect(c.text).not.toContain("- Alpha");
    expect(c.text).not.toContain("missing");
  });

  it("keeps the whole result within the budget by cutting the note, never the small blocks", () => {
    reindexNote(note("long", "Long", "word ".repeat(10_000)));
    addMisconceptions("long", ["Keep this"], T0);
    const c = assembleContext({ noteId: "long", parts: ["note", "shaky"], budgetChars: 2000 }, T0)!;
    expect(c.text.length).toBeLessThanOrEqual(2000);
    expect(c.text).toContain("[the note continues; only the first part is shown]");
    expect(c.text).toContain("SHAKY START");
  });

  it("orders the blocks the same way every time, whatever order they were asked for", () => {
    reindexNote(note("x", "X", "Text."));
    addMisconceptions("x", ["a point"], T0);
    const one = assembleContext({ noteId: "x", parts: ["shaky", "note"] }, T0)!.text;
    const two = assembleContext({ noteId: "x", parts: ["note", "shaky"] }, T0)!.text;
    expect(one).toBe(two);
    expect(one.indexOf("NOTE START")).toBeLessThan(one.indexOf("SHAKY START"));
  });
});
