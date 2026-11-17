import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { closeState } from "./state-db";
import { MIN_REVIEWS_FOR_RATE, dueCards, studyStats } from "./study";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-study-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  server = createServer(createHandler(accessFromEnv()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const j = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as { data?: any; error?: { code: string } } };
};
const note = (id: string, body: string) => j("PUT", `/api/notes/${id}`, { title: id, body });

describe("study", () => {
  it("finds the cards in a note, and follows an edit and a delete", async () => {
    await note("bio", "## Cards\nWhat is ATP? :: Energy currency\nThe {{nucleus}} holds DNA.");
    const cards = (await j("GET", "/api/notes/bio/cards")).body.data as { kind: string; front: string }[];
    expect(cards.map((c) => [c.kind, c.front])).toEqual([["qa", "What is ATP?"], ["cloze", "The […] holds DNA."]]);
    await note("bio", "What is ATP? :: Energy currency");
    expect(((await j("GET", "/api/notes/bio/cards")).body.data as unknown[]).length).toBe(1);
    await j("DELETE", "/api/notes/bio");
    expect(((await j("GET", "/api/notes/bio/cards")).body.data as unknown[]).length).toBe(0);
  });

  it("offers new cards, takes an answer, and then the card waits for its due date", async () => {
    await note("bio", "Q1? :: A1\nQ2? :: A2");
    const first = (await j("GET", "/api/study/due")).body.data as { id: string; isNew: boolean }[];
    expect(first).toHaveLength(2);
    expect(first.every((c) => c.isNew)).toBe(true);
    const answered = await j("POST", "/api/study/review", { cardId: first[0]?.id, answer: "good" });
    expect(answered.status).toBe(200);
    expect(new Date(answered.body.data.due).getTime()).toBeGreaterThan(Date.now());
    const after = (await j("GET", "/api/study/due")).body.data as { id: string }[];
    expect(after.map((c) => c.id)).toEqual([first[1]?.id]);
    const stats = (await j("GET", "/api/study/stats")).body.data;
    expect(stats).toMatchObject({ total: 2, due: 0, new: 1, reviewedToday: 1, againToday: 0 });
  });

  it("an answer is checked: unknown card 404, bad answer 400, and a failed answer is counted", async () => {
    await note("bio", "Q? :: A");
    const id = ((await j("GET", "/api/study/due")).body.data as { id: string }[])[0]?.id;
    expect((await j("POST", "/api/study/review", { cardId: "nope", answer: "good" })).status).toBe(404);
    expect((await j("POST", "/api/study/review", { cardId: id, answer: "maybe" })).status).toBe(400);
    expect((await j("POST", "/api/study/review", { answer: "good" })).status).toBe(400);
    await j("POST", "/api/study/review", { cardId: id, answer: "again" });
    expect((await j("GET", "/api/study/stats")).body.data).toMatchObject({ reviewedToday: 1, againToday: 1 });
  });

  it("caps new cards per request but never hides reviews that are due", async () => {
    await note("big", Array.from({ length: 25 }, (_, i) => `Q${i}? :: A${i}`).join("\n"));
    expect(dueCards(new Date())).toHaveLength(10);
    expect(dueCards(new Date(), { newLimit: 3 })).toHaveLength(3);
    const id = dueCards(new Date())[0]?.id as string;
    await j("POST", "/api/study/review", { cardId: id, answer: "good" });
    const later = new Date(Date.now() + 30 * 86_400_000);
    const queue = dueCards(later);
    expect(queue[0]?.id).toBe(id); // the review that came due leads, then new ones
    expect(queue).toHaveLength(11);
    expect(studyStats(later)).toMatchObject({ total: 25, due: 1, new: 24 });
  });

  it("limits to one note", async () => {
    await note("a", "QA? :: A");
    await note("b", "QB? :: B");
    expect(((await j("GET", "/api/study/due?note=a")).body.data as { front: string }[]).map((c) => c.front)).toEqual(["QA?"]);
    expect((await j("GET", "/api/study/stats?note=b")).body.data).toMatchObject({ total: 1 });
  });

  it("lists a deck per note with what is waiting, and shows a recall rate only after enough answers", async () => {
    await note("a", "A1? :: x\nA2? :: y");
    await note("b", "B1? :: z");
    const first = (await j("GET", "/api/study/decks")).body.data as { noteId: string; cards: number; new: number; recall: number | null }[];
    expect(first.map((d) => [d.noteId, d.cards, d.new, d.recall])).toEqual([["a", 2, 2, null], ["b", 1, 1, null]]);
    const id = ((await j("GET", "/api/study/due?note=a")).body.data as { id: string }[])[0]?.id;
    for (let i = 0; i < MIN_REVIEWS_FOR_RATE; i++) await j("POST", "/api/study/review", { cardId: id, answer: i < 2 ? "again" : "good" });
    const after = (await j("GET", "/api/study/decks")).body.data as { noteId: string; reviews: number; recall: number | null; new: number }[];
    const a = after.find((d) => d.noteId === "a");
    expect(a).toMatchObject({ reviews: MIN_REVIEWS_FOR_RATE, recall: 75, new: 1 });
    expect(after.find((d) => d.noteId === "b")?.recall).toBeNull();
  });

  it("takes back the last answer exactly: a first answer makes the card new again, a later one restores its old schedule", async () => {
    await note("bio", "Q? :: A");
    const id = ((await j("GET", "/api/study/due")).body.data as { id: string }[])[0]?.id;
    expect((await j("POST", "/api/study/undo")).status).toBe(409); // nothing yet
    const first = (await j("POST", "/api/study/review", { cardId: id, answer: "good" })).body.data.due as string;
    expect((await j("POST", "/api/study/undo")).body.data.cardId).toBe(id);
    expect((await j("GET", "/api/study/stats")).body.data).toMatchObject({ new: 1, due: 0, reviewedToday: 0 });
    // Answer, answer again later, undo the second: back to the first schedule.
    await j("POST", "/api/study/review", { cardId: id, answer: "good" });
    await j("POST", "/api/study/review", { cardId: id, answer: "again" });
    await j("POST", "/api/study/undo");
    const decks = (await j("GET", "/api/study/decks")).body.data as { reviews: number }[];
    expect(decks[0]?.reviews).toBe(1);
    const queue = (await j("GET", "/api/study/due")).body.data as unknown[];
    expect(queue).toHaveLength(0);
    expect(new Date(first).getTime()).toBeGreaterThan(Date.now() - 1000);
  });
});

describe("study history", () => {
  it("lists 14 days, oldest first, with today's answers counted", async () => {
    await note("hist", "Q1 :: A1\n\nQ2 :: A2\n");
    const due = await j("GET", "/api/study/due");
    const ids = (due.body.data as { id: string }[]).map((c) => c.id);
    for (const id of ids) await j("POST", "/api/study/review", { cardId: id, answer: "good" });
    const res = await j("GET", "/api/study/history");
    expect(res.status).toBe(200);
    const days = res.body.data as { day: string; count: number }[];
    expect(days).toHaveLength(14);
    expect(days[13]?.count).toBe(ids.length);
    expect(days.slice(0, 13).every((d) => d.count === 0)).toBe(true);
    expect(days.map((d) => d.day)).toEqual(days.map((d) => d.day).slice().sort());
  });

  it("takes a day count, capped at 90", async () => {
    expect(((await j("GET", "/api/study/history?days=30")).body.data as unknown[]).length).toBe(30);
    expect(((await j("GET", "/api/study/history?days=5000")).body.data as unknown[]).length).toBe(90);
    expect(((await j("GET", "/api/study/history?days=abc")).body.data as unknown[]).length).toBe(14);
  });
});
