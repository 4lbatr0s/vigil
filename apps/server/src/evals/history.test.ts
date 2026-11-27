import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { insideFolder, newFailures, previousRecord, recordAndCompare, saveRecord, type EvalRecord } from "./history";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vigil-evalhist-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const rec = (at: string, cases: Record<string, boolean>, over: Partial<EvalRecord> = {}): EvalRecord => ({
  at,
  suite: "agent",
  model: "qwen3:4b",
  trials: 3,
  cases: Object.entries(cases).map(([caseId, pass]) => ({ caseId, pass })),
  ...over,
});

describe("eval history", () => {
  it("names only the cases that passed last time and fail now", () => {
    const before = rec("2026-11-25T02:00:00.000Z", { a: true, b: true, c: false, gone: true });
    const now = rec("2026-11-26T02:00:00.000Z", { a: true, b: false, c: false, fresh: false });
    expect(newFailures(before, now)).toEqual(["b"]);
  });

  it("finds the newest record of the same suite and model, keeps a model name with : and / inside the folder, and skips files that are not records", async () => {
    await saveRecord(dir, rec("2026-11-24T02:00:00.000Z", { a: true }));
    await saveRecord(dir, rec("2026-11-25T02:00:00.000Z", { a: false }));
    await saveRecord(dir, rec("2026-11-26T02:00:00.000Z", { a: true }, { model: "org/other" }));
    await saveRecord(dir, rec("2026-11-26T02:00:00.000Z", { a: true }, { suite: "ask" }));
    await writeFile(path.join(dir, "broken.json"), "{ not json", "utf8");
    const files = await readdir(dir);
    expect(files.every((f) => !f.includes(":") && !f.includes("/"))).toBe(true);
    const { record, skipped } = await previousRecord(dir, "agent", "qwen3:4b");
    expect(record?.at).toBe("2026-11-25T02:00:00.000Z");
    expect(skipped).toEqual(["broken.json"]);
  });

  it("has nothing to compare on the first run", async () => {
    expect((await previousRecord(path.join(dir, "missing"), "agent", "m")).record).toBeNull();
  });

  it("knows when a folder is the vault or inside it", () => {
    expect(insideFolder("/home/o/vault", "/home/o/vault")).toBe(true);
    expect(insideFolder("/home/o/vault/evals", "/home/o/vault")).toBe(true);
    expect(insideFolder("/home/o/vault-evals", "/home/o/vault")).toBe(false);
    expect(insideFolder("/home/o/evals", "/home/o/vault")).toBe(false);
  });

  it("compares a night with the one before and then saves it, so the next night compares with this one", async () => {
    const first = await recordAndCompare(dir, rec("2026-11-25T02:00:00.000Z", { a: true, b: true }));
    expect(first.before).toBeNull();
    expect(first.failures).toEqual([]);
    const second = await recordAndCompare(dir, rec("2026-11-26T02:00:00.000Z", { a: true, b: false }));
    expect(second.failures).toEqual(["b"]);
    const third = await recordAndCompare(dir, rec("2026-11-27T02:00:00.000Z", { a: true, b: false }));
    expect(third.failures).toEqual([]); // b failed the night before too: not new
    expect(await readdir(dir)).toHaveLength(3);
  });
});
