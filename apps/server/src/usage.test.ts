import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { closeState, createRun, finishRun } from "./state-db";
import { monthTokens, usage } from "./usage";

let root = "";
const saved = { ...process.env };
const now = new Date("2026-11-15T12:00:00Z");

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-usage-"));
  process.env.STATE_DB_PATH = path.join(root, "state.db");
});
afterEach(async () => {
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

/** Insert a finished run with a chosen start time and token count. */
function run(id: string, startedAt: string, tokens: number): void {
  createRun(id, "a", 1000);
  finishRun(id, "succeeded", tokens, null);
  closeState();
  const raw = new Database(process.env.STATE_DB_PATH as string);
  raw.prepare("UPDATE runs SET started_at = ? WHERE id = ?").run(startedAt, id);
  raw.close();
}

describe("usage", () => {
  it("sums runs of this month and excludes last month", () => {
    run("r1", "2026-11-02T08:00:00.000Z", 300);
    run("r2", "2026-11-14T08:00:00.000Z", 200);
    run("old", "2026-10-31T23:59:59.000Z", 9999);
    expect(monthTokens(now)).toBe(500);
    expect(usage(now, {})).toEqual({ month: "2026-11", tokens: 500, cap: null, level: "ok" });
  });

  it("levels: ok below 80%, warn from 80%, over from 100%", () => {
    run("r1", "2026-11-02T08:00:00.000Z", 79);
    const env = { VIGIL_MONTHLY_TOKEN_CAP: "100" };
    expect(usage(now, env).level).toBe("ok");
    run("r2", "2026-11-03T08:00:00.000Z", 1);
    expect(usage(now, env).level).toBe("warn");
    run("r3", "2026-11-04T08:00:00.000Z", 20);
    expect(usage(now, env)).toMatchObject({ tokens: 100, cap: 100, level: "over" });
  });

  it("treats a bad cap as no cap", () => {
    for (const bad of ["", "abc", "0", "-5"]) expect(usage(now, { VIGIL_MONTHLY_TOKEN_CAP: bad }).cap).toBeNull();
  });
});
