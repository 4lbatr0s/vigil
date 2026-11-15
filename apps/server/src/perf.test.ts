import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb, listNoteSummaries, reindexNote, searchNotes } from "./index-db";

// Budgets from the plan (WP4-T10): summary list of 1,000 notes <= 50 ms and search <= 30 ms on a
// developer laptop. The asserts allow 5x so a slow CI machine does not flake; a real regression
// (a missing index, a body read per row) is far bigger than that.
const LIST_BUDGET_MS = 50 * 5;
const SEARCH_BUDGET_MS = 30 * 5;

let root = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-perf-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
});
afterEach(async () => {
  closeDb();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const body = (i: number): string => `Note number ${i}. ${"lorem ipsum dolor sit amet consectetur ".repeat(40)} ${i % 10 === 0 ? "needle" : ""}`;

function timed<T>(fn: () => T): { value: T; ms: number } {
  const t0 = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t0 };
}

describe("index performance with 1,000 notes", () => {
  it("lists summaries and searches within budget", () => {
    for (let i = 0; i < 1000; i++) {
      reindexNote({ id: `note-${i}`, title: `Note ${i}`, body: body(i), tags: ["t"], author: i % 7 === 0 ? "agent" : "human", updatedAt: new Date(1_700_000_000_000 + i * 60_000).toISOString() });
    }
    listNoteSummaries(); // warm the statement cache like a running server would
    searchNotes("needle");
    const list = timed(() => listNoteSummaries());
    const search = timed(() => searchNotes("needle"));
    expect(list.value).toHaveLength(1000);
    expect(search.value.length).toBeGreaterThan(0);
    console.log(`perf: summary list ${list.ms.toFixed(1)} ms, search ${search.ms.toFixed(1)} ms`);
    expect(list.ms).toBeLessThan(LIST_BUDGET_MS);
    expect(search.ms).toBeLessThan(SEARCH_BUDGET_MS);
  });
});
