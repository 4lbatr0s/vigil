/**
 * Saved eval results, so a nightly run can name every case that passed last time and fails now.
 * One JSON file per run: `<time>-<suite>-<model>.json` in a folder the owner picks (`--save DIR`), never in the vault.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const RecordSchema = z.object({
  at: z.string(),
  suite: z.enum(["ask", "agent"]),
  model: z.string(),
  trials: z.number().int().min(1),
  /** For the agent suite `pass` is pass^k: every trial passed. */
  cases: z.array(z.object({ caseId: z.string(), pass: z.boolean() })),
});
export type EvalRecord = z.infer<typeof RecordSchema>;

/** A file name piece made only of safe characters, so a model name such as `qwen3:4b` or `org/model` stays in the folder. */
const safe = (text: string): string => text.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "_";

export function recordFileName(r: EvalRecord): string {
  return `${r.at.replace(/[:.]/g, "-")}-${r.suite}-${safe(r.model)}.json`;
}

export async function saveRecord(dir: string, r: EvalRecord): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, recordFileName(r));
  await writeFile(file, `${JSON.stringify(r, null, 2)}\n`, "utf8");
  return file;
}

/** The newest saved record for the same suite and model, or null. A file that is not a record is skipped and named in `skipped`. */
export async function previousRecord(dir: string, suite: EvalRecord["suite"], model: string): Promise<{ record: EvalRecord | null; skipped: string[] }> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { record: null, skipped: [] }; // the first run: nothing saved yet
    throw err;
  }
  const skipped: string[] = [];
  let best: EvalRecord | null = null;
  for (const name of names.filter((n) => n.endsWith(".json"))) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    } catch {
      raw = null; // unreadable or not JSON: reported below through `skipped`
    }
    const parsed = RecordSchema.safeParse(raw);
    if (!parsed.success) {
      skipped.push(name);
      continue;
    }
    const r = parsed.data;
    if (r.suite !== suite || r.model !== model) continue;
    if (!best || r.at > best.at) best = r;
  }
  return { record: best, skipped };
}

/** Cases that passed in `before` and fail in `now`. A case that is new or was dropped is not a regression. */
export function newFailures(before: EvalRecord, now: EvalRecord): string[] {
  const passed = new Set(before.cases.filter((c) => c.pass).map((c) => c.caseId));
  return now.cases.filter((c) => !c.pass && passed.has(c.caseId)).map((c) => c.caseId);
}

/** True when `dir` is `vault` or inside it, so results are never written into the owner's notes. */
export function insideFolder(dir: string, vault: string): boolean {
  const rel = path.relative(path.resolve(vault), path.resolve(dir));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Compares `now` with the newest saved record of the same suite and model, then saves `now`. */
export async function recordAndCompare(dir: string, now: EvalRecord): Promise<{ file: string; before: EvalRecord | null; failures: string[]; skipped: string[] }> {
  const { record: before, skipped } = await previousRecord(dir, now.suite, now.model);
  const file = await saveRecord(dir, now);
  return { file, before, failures: before ? newFailures(before, now) : [], skipped };
}
