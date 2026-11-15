import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { prune } from "./housekeeping";
import { undoRun } from "./runs";
import { addEvent, closeState, createRun, finishRun, getRun, listEvents, listSnapshots, recordSnapshot, putAgent } from "./state-db";
import { closeDb } from "./index-db";
import { AgentSchema } from "@vigil/shared";

let root = "";
const saved = { ...process.env };
const now = new Date("2026-11-15T12:00:00Z");

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-house-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  putAgent(AgentSchema.parse({ name: "a", systemPrompt: "x" }));
});
afterEach(async () => {
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

/** A run `daysAgo` days old with one event and one snapshot file. */
async function oldRun(id: string, daysAgo: number, status: "succeeded" | "running" | "waiting-approval" = "succeeded") {
  const at = new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  createRun(id, "a", 1000);
  addEvent(id, "model", "hello");
  await recordSnapshot(id, `note-${id}`, "old body");
  if (status === "succeeded") finishRun(id, "succeeded", 5, null);
  closeState();
  const raw = new Database(process.env.STATE_DB_PATH as string);
  raw.prepare("UPDATE runs SET started_at = ?, status = ? WHERE id = ?").run(at, status, id);
  raw.prepare("UPDATE run_events SET at = ? WHERE run_id = ?").run(at, id);
  raw.close();
}

const exists = (p: string) => access(p).then(() => true, () => false);

describe("housekeeping", () => {
  it("prunes old events and snapshots, keeps recent ones and every run row", async () => {
    await oldRun("old", 100);
    await oldRun("recent", 10);
    const file = listSnapshots("old")[0]?.file as string;
    expect(await exists(file)).toBe(true);
    expect(await prune(now, 90)).toEqual({ events: 1, snapshots: 1 });
    expect(listEvents("old")).toHaveLength(0);
    expect(listEvents("recent")).toHaveLength(1);
    expect(await exists(file)).toBe(false);
    expect(getRun("old")?.touched).toEqual(["note-old"]); // still shown
    expect(getRun("recent")).not.toBeNull();
    expect(await prune(now, 90)).toEqual({ events: 0, snapshots: 0 }); // idempotent
  });

  it("never touches a running or waiting run", async () => {
    await oldRun("live", 200, "running");
    await oldRun("wait", 200, "waiting-approval");
    expect(await prune(now, 90)).toEqual({ events: 0, snapshots: 0 });
    expect(listEvents("live")).toHaveLength(1);
    expect(listEvents("wait")).toHaveLength(1);
  });

  it("0 keeps everything", async () => {
    await oldRun("ancient", 5000);
    expect(await prune(now, 0)).toEqual({ events: 0, snapshots: 0 });
    expect(listEvents("ancient")).toHaveLength(1);
  });

  it("undo of an expired run answers 410 undo-expired", async () => {
    await oldRun("old", 100);
    await prune(now, 90);
    await expect(undoRun("old")).rejects.toMatchObject({ code: "undo-expired", status: 410, message: "This run is too old to undo." });
  });

  it("uses retentionDays from the permission settings by default", async () => {
    await oldRun("old", 100);
    expect((await prune(now)).events).toBe(1);
  });
});
