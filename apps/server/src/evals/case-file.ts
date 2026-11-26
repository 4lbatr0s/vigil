/**
 * Eval cases kept as JSON files (todo item 49), so a real run can become a case: the run page downloads a draft, the owner
 * edits what is expected and puts the file in a folder, and `pnpm --filter @vigil/server eval --agent --cases DIR` runs it.
 * The grader is declarative: every check that is set must hold.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AgentSchema, RunStatusSchema } from "@vigil/shared";
import type { AgentCase, AgentGrade, AgentObservation } from "./agent-cases";

export const CaseFileSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, digits and -"),
  suite: z.enum(["capability", "regression"]),
  should: z.enum(["act", "refrain"]),
  task: z.string().min(1),
  agent: z.object({ tools: AgentSchema.shape.tools, strict: z.boolean() }),
  seed: z.array(z.object({ title: z.string().min(1), body: z.string() })).optional(),
  budget: z.number().int().positive().optional(),
  expect: z.object({
    /** The run must end with one of these. */
    status: z.array(RunStatusSchema).min(1).optional(),
    /** Each of these tools must have been called at least once. */
    calls: z.array(z.string()).optional(),
    /** No write may be done or wait in Approvals. */
    noWrites: z.boolean().optional(),
    /** The final answer must match this regular expression (case is ignored). */
    answer: z.string().optional(),
    /** Note ids that must exist after the trial, and ids that must not. */
    exists: z.array(z.string()).optional(),
    absent: z.array(z.string()).optional(),
  }),
});
export type CaseFile = z.infer<typeof CaseFileSchema>;

/** The checks of `expect`, in order; the first that fails gives the reason. */
export function gradeCaseFile(c: CaseFile, o: AgentObservation): AgentGrade {
  const e = c.expect;
  if (e.status && !e.status.includes(o.status)) return { pass: false, reason: `run ended ${o.status}, expected ${e.status.join(" or ")}` };
  for (const tool of e.calls ?? []) if (!o.toolsCalled.includes(tool)) return { pass: false, reason: `never called ${tool}` };
  if (e.noWrites && (o.pendingWrites.length > 0 || o.toolsCalled.some((t) => t === "write_note" || t === "append_note"))) return { pass: false, reason: "wrote or asked to write" };
  if (e.answer !== undefined && !new RegExp(e.answer, "i").test(o.finalText)) return { pass: false, reason: `answer "${o.finalText.slice(0, 80)}" does not match /${e.answer}/i` };
  for (const id of e.exists ?? []) if (!o.existing.includes(id)) return { pass: false, reason: `note ${id} does not exist` };
  for (const id of e.absent ?? []) if (o.existing.includes(id)) return { pass: false, reason: `note ${id} exists` };
  return { pass: true, reason: "every expected check held" };
}

export function caseFromFile(c: CaseFile): AgentCase {
  return {
    id: c.id,
    suite: c.suite,
    should: c.should,
    task: c.task,
    agent: c.agent,
    watch: [...new Set([...(c.expect.exists ?? []), ...(c.expect.absent ?? [])])],
    ...(c.seed ? { seed: c.seed } : {}),
    ...(c.budget ? { budget: c.budget } : {}),
    grade: (o) => gradeCaseFile(c, o),
  };
}

/** Every `*.json` case in `dir`. A file that is not a valid case stops the run with its name and the first problem. */
export async function loadCaseDir(dir: string): Promise<AgentCase[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".json")).sort();
  const out: AgentCase[] = [];
  for (const name of names) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    } catch (err) {
      throw new Error(`${name}: not JSON (${err instanceof Error ? err.message : "unreadable"})`);
    }
    const parsed = CaseFileSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`${name}: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? "not a valid case"}`);
    out.push(caseFromFile(parsed.data));
  }
  return out;
}
