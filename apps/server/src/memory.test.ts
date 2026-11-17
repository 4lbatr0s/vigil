import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Note } from "@vigil/shared";
import { buildGraphData } from "./graph";
import { cardsForNote, closeDb, noteTagsAll, reindexNote } from "./index-db";
import { memoryMap } from "./memory";
import { enroll } from "./recall";
import { newCardState, retrievability, review } from "./srs";
import { closeState, saveReview, setGoal } from "./state-db";

let root = "";
const saved = { ...process.env };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-memory-"));
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

const note = (id: string, body: string, tags: string[] = []): Note => ({ id, title: id, body, tags, author: "human", updatedAt: "2026-11-15T10:00:00.000Z" });
const T0 = new Date("2026-11-01T10:00:00.000Z");
const days = (n: number): Date => new Date(T0.getTime() + n * 86_400_000);

function answer(noteId: string, answerKind: "good" | "again"): void {
  const card = cardsForNote(noteId)[0]!;
  const { next, log } = review(newCardState(T0), answerKind, T0);
  saveReview(card.id, noteId, next, log, T0);
}

describe("retrievability", () => {
  it("is null for a card nobody answered, and falls as time passes", () => {
    expect(retrievability(newCardState(T0), T0)).toBeNull();
    const { next } = review(newCardState(T0), "good", T0);
    const soon = retrievability(next, days(1))!;
    const later = retrievability(next, days(60))!;
    expect(soon).toBeGreaterThan(later);
    expect(soon).toBeLessThanOrEqual(1);
    expect(later).toBeGreaterThan(0);
  });
});

describe("memoryMap", () => {
  it("has strength once a card is answered, none before", () => {
    reindexNote(note("fresh", "Q1? :: A1"));
    reindexNote(note("seen", "Q2? :: A2"));
    answer("seen", "good");
    const map = memoryMap(days(1), noteTagsAll);
    expect(map.get("fresh")).toMatchObject({ cards: 1, reviewed: 0, strength: null });
    expect(map.get("seen")?.reviewed).toBe(1);
    expect(map.get("seen")?.strength).toBeGreaterThan(0.5);
  });

  it("a note left alone fades", () => {
    reindexNote(note("seen", "Q? :: A"));
    answer("seen", "good");
    const early = memoryMap(days(1), noteTagsAll).get("seen")!.strength!;
    const late = memoryMap(days(90), noteTagsAll).get("seen")!.strength!;
    expect(late).toBeLessThan(early);
  });

  it("marks a due recall check and the nearest exam date, by note or tag", () => {
    reindexNote(note("bio", "Q3? :: A3", ["science"]));
    reindexNote(note("art", "Q4? :: A4"));
    enroll("bio", T0);
    setGoal({ kind: "note", value: "art", day: "2026-11-20" }, T0);
    setGoal({ kind: "tag", value: "science", day: "2026-11-12" }, T0);
    const map = memoryMap(days(3), noteTagsAll);
    expect(map.get("bio")).toMatchObject({ recallDue: true, examDays: 8 });
    expect(map.get("art")).toMatchObject({ recallDue: false, examDays: 16 });
  });

  it("ends up on the graph nodes of notes that have cards", () => {
    reindexNote(note("bio", "Q5? :: A5"));
    reindexNote(note("plain", "just text"));
    const nodes = buildGraphData(T0, []).nodes;
    expect(nodes.find((n) => n.id === "bio")?.memory).toMatchObject({ cards: 1 });
    expect(nodes.find((n) => n.id === "plain")?.memory).toBeUndefined();
  });
});
