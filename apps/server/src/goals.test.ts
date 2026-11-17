import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { capDue, daysLeft, latestReview, retentionFor } from "./goals";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { closeState } from "./state-db";

const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h);

describe("exam date rules", () => {
  it("counts calendar days", () => {
    expect(daysLeft("2026-11-20", at(2026, 11, 17, 23))).toBe(3);
    expect(daysLeft("2026-11-17", at(2026, 11, 17))).toBe(0);
    expect(daysLeft("2026-11-16", at(2026, 11, 17))).toBe(-1);
    expect(daysLeft("nope", at(2026, 11, 17))).toBe(-1);
  });
  it("asks for more retention as the day gets close", () => {
    expect([100, 40, 14, 3, 0].map(retentionFor)).toEqual([0.85, 0.9, 0.92, 0.95, 0.95]);
    expect(retentionFor(-2)).toBe(0.9);
  });
  it("pulls a review that would land after the exam to the day before", () => {
    const now = at(2026, 11, 17);
    const late = at(2026, 12, 20).toISOString();
    const capped = capDue(late, "2026-11-25", now);
    expect(new Date(capped).getTime()).toBe(new Date(2026, 10, 25).getTime() - 12 * 3_600_000);
    const early = at(2026, 11, 19).toISOString();
    expect(capDue(early, "2026-11-25", now)).toBe(early);
  });
  it("is never sooner than a few hours from now, and does nothing once the day has passed", () => {
    const now = at(2026, 11, 24, 20);
    expect(latestReview("2026-11-25", now)?.getTime()).toBe(now.getTime() + 3 * 3_600_000);
    expect(latestReview("2026-11-20", now)).toBeNull();
    const due = at(2027, 1, 1).toISOString();
    expect(capDue(due, "2026-11-20", now)).toBe(due);
  });
});

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-goals-"));
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
const isoDay = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

describe("goals API", () => {
  it("sets, lists and removes an exam date for a note", async () => {
    await j("PUT", "/api/notes/bio", { title: "Bio", body: "Q1 :: A1\n\nQ2 :: A2\n" });
    const day = isoDay(5);
    const put = await j("PUT", "/api/goals", { kind: "note", value: "bio", day });
    expect(put.status).toBe(200);
    expect(put.body.data[0]).toMatchObject({ kind: "note", value: "bio", day, daysLeft: 5, cards: 2, unseen: 2, onTrack: true });
    const del = await j("DELETE", "/api/goals?kind=note&value=bio");
    expect(del.body.data).toEqual([]);
  });
  it("rejects a bad date, a bad body and an unknown note", async () => {
    await j("PUT", "/api/notes/bio", { title: "Bio", body: "Q :: A\n" });
    expect((await j("PUT", "/api/goals", { kind: "note", value: "bio", day: "2026-02-30" })).status).toBe(400);
    expect((await j("PUT", "/api/goals", { kind: "x", value: "bio", day: isoDay(3) })).status).toBe(400);
    expect((await j("PUT", "/api/goals", { kind: "note", value: "ghost", day: isoDay(3) })).status).toBe(404);
    expect((await j("DELETE", "/api/goals?kind=note")).status).toBe(400);
  });
  it("covers every note with a tag, and flags a pace that cannot fit", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `Q${i} :: A${i}`).join("\n\n");
    await j("PUT", "/api/notes/big", { title: "Big", body: `#chem\n\n${many}\n` });
    const put = await j("PUT", "/api/goals", { kind: "tag", value: "chem", day: isoDay(2) });
    expect(put.body.data[0]).toMatchObject({ kind: "tag", cards: 40, unseen: 40, onTrack: false });
  });
  it("pulls a card's next review in front of the exam", async () => {
    await j("PUT", "/api/notes/bio", { title: "Bio", body: "Q :: A\n" });
    await j("PUT", "/api/goals", { kind: "note", value: "bio", day: isoDay(3) });
    const [card] = (await j("GET", "/api/study/due")).body.data as { id: string }[];
    const out = await j("POST", "/api/study/review", { cardId: card!.id, answer: "easy" });
    const latest = new Date(isoDay(3) + "T00:00:00").getTime();
    expect(new Date(out.body.data.due).getTime()).toBeLessThanOrEqual(latest);
  });
});
