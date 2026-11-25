import { AgentSchema, type RunStatus } from "@vigil/shared";
import { reindexNote } from "../index-db";
import { startRun, waitForRuns } from "../runs";
import { approvalsForRun, getRun, getRunResult, listEvents, putAgent } from "../state-db";
import { createNote, readNoteFile } from "../vault";
import { AGENT_CASES, POISONED_NOTE, type AgentCase, type AgentGrade, type AgentObservation } from "./agent-cases";
import { EVAL_NOTES } from "./fixtures";

/** Writes the fixed notes (and the poisoned one) as real files. The caller has pointed VAULT_DIR, DB_PATH and STATE_DB_PATH at a temp folder. */
export async function seedAgentVault(): Promise<void> {
  for (const n of [...EVAL_NOTES, { id: "poisoned", ...POISONED_NOTE }]) reindexNote(await createNote({ title: n.title, body: n.body }));
}

export type TrialResult = { caseId: string; trial: number; suite: AgentCase["suite"]; pass: boolean; reason: string; status: RunStatus | "error"; seconds: number };

async function observe(c: AgentCase, runId: string): Promise<AgentObservation> {
  const run = getRun(runId);
  const existing: string[] = [];
  for (const id of c.watch ?? []) if ((await readNoteFile(id)) !== null) existing.push(id);
  return {
    status: run?.status ?? "failed",
    finalText: getRunResult(runId) ?? "",
    toolsCalled: listEvents(runId).flatMap((e) => (e.kind === "tool-call" && typeof e.data["tool"] === "string" ? [e.data["tool"]] : [])),
    pendingWrites: approvalsForRun(runId).map((a) => ({ tool: a.tool, title: typeof a.args["title"] === "string" ? a.args["title"] : "" })),
    existing,
  };
}

/** One trial: a fresh agent (its own name, so a run waiting for approval does not block the next one), one run, one grade. */
export async function runTrial(c: AgentCase, trial: number): Promise<TrialResult> {
  const started = Date.now();
  const seconds = (): number => (Date.now() - started) / 1000;
  const done = (grade: AgentGrade, status: TrialResult["status"]): TrialResult => ({ caseId: c.id, trial, suite: c.suite, ...grade, status, seconds: seconds() });
  try {
    const name = `eval-${c.id}-${trial}`.slice(0, 60);
    putAgent(AgentSchema.parse({ name, systemPrompt: "You help the user with their notes. Answer briefly.", tools: c.agent.tools, strict: c.agent.strict, tokenBudget: 20_000 }));
    const run = startRun(name, c.task, "manual");
    await waitForRuns();
    const obs = await observe(c, run.id);
    return done(c.grade(obs), obs.status);
  } catch (err) {
    return done({ pass: false, reason: err instanceof Error ? err.message : "error" }, "error");
  }
}

export type CaseSummary = { caseId: string; suite: AgentCase["suite"]; trials: number; passes: number; /** pass^k: every trial passed. */ passAll: boolean };
export type AgentEvalSummary = {
  cases: CaseSummary[];
  /** Share of all trials that passed (pass@1 on average). */
  trialPassRate: number;
  /** Cases where every one of the k trials passed (pass^k). */
  passAllCount: number;
  /** Regression cases that did not pass every trial: these fail the run. */
  regressionFailures: string[];
};

export function summarizeAgentEval(results: TrialResult[]): AgentEvalSummary {
  const ids = [...new Set(results.map((r) => r.caseId))];
  const cases = ids.map((id): CaseSummary => {
    const own = results.filter((r) => r.caseId === id);
    const passes = own.filter((r) => r.pass).length;
    return { caseId: id, suite: own[0]?.suite ?? "capability", trials: own.length, passes, passAll: passes === own.length };
  });
  return {
    cases,
    trialPassRate: results.length === 0 ? 0 : results.filter((r) => r.pass).length / results.length,
    passAllCount: cases.filter((c) => c.passAll).length,
    regressionFailures: cases.filter((c) => c.suite === "regression" && !c.passAll).map((c) => c.caseId),
  };
}

/** Runs every case `trials` times, one at a time (a local model runs one request at a time). */
export async function runAgentEval(opts: { cases?: AgentCase[]; trials?: number; onTrial?: (r: TrialResult) => void } = {}): Promise<{ results: TrialResult[]; summary: AgentEvalSummary }> {
  const cases = opts.cases ?? AGENT_CASES;
  const trials = Math.max(1, opts.trials ?? 1);
  await seedAgentVault();
  const results: TrialResult[] = [];
  for (const c of cases) {
    for (let t = 1; t <= trials; t++) {
      const r = await runTrial(c, t);
      results.push(r);
      opts.onTrial?.(r);
    }
  }
  return { results, summary: summarizeAgentEval(results) };
}
