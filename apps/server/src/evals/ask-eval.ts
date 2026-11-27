import { AgentSchema, TEMPLATES, type Agent } from "@vigil/shared";
import { askTask, findPassages } from "../ask";
import { reindexNote } from "../index-db";
import { startRun, waitForRuns } from "../runs";
import { getRun, getRunResult, putAgent } from "../state-db";
import { ASK_CASES, EVAL_NOTES } from "./fixtures";
import { scoreAsk, summarize, type AskCase, type AskOutcome, type AskScore, type AskSummary } from "./scoring";

/** Writes the fixed notes into the index. The caller has already pointed VAULT_DIR, DB_PATH and STATE_DB_PATH at a temp folder. */
export function loadEvalNotes(now: string = new Date().toISOString()): void {
  for (const n of EVAL_NOTES) reindexNote({ id: n.id, title: n.title, body: n.body, tags: [], author: "human", updatedAt: now });
}

/** The Note asker agent exactly as the template ships it, switched on. */
export function noteAskerAgent(): Agent {
  const template = TEMPLATES.find((t) => t.id === "note-asker");
  if (!template) throw new Error("The note-asker template is missing.");
  return putAgent(AgentSchema.parse({ ...template.agent, name: "note-asker", enabled: true }));
}

async function askOnce(c: AskCase): Promise<AskOutcome> {
  const started = Date.now();
  const passages = findPassages(c.question);
  const seconds = (): number => (Date.now() - started) / 1000;
  if (passages.length === 0) return { caseId: c.id, passages, answer: null, seconds: seconds() };
  try {
    const run = startRun("note-asker", askTask(c.question, passages), "manual");
    await waitForRuns();
    const done = getRun(run.id);
    if (!done || done.status !== "succeeded") return { caseId: c.id, passages, answer: null, seconds: seconds(), failed: done?.error ?? `run ${done?.status ?? "missing"}` };
    return { caseId: c.id, passages, answer: getRunResult(run.id) ?? "", seconds: seconds() };
  } catch (err) {
    return { caseId: c.id, passages, answer: null, seconds: seconds(), failed: err instanceof Error ? err.message : "error" };
  }
}

export type AskEvalResult = { scores: AskScore[]; outcomes: AskOutcome[]; summary: AskSummary };

/** Puts every case to Ask your notes, one at a time (a local model runs one request at a time), and scores the answers. */
export async function runAskEval(cases: AskCase[] = ASK_CASES, onCase?: (score: AskScore, c: AskCase) => void): Promise<AskEvalResult> {
  loadEvalNotes();
  noteAskerAgent();
  const outcomes: AskOutcome[] = [];
  const scores: AskScore[] = [];
  for (const c of cases) {
    const outcome = await askOnce(c);
    const score = scoreAsk(c, outcome);
    outcomes.push(outcome);
    scores.push(score);
    onCase?.(score, c);
  }
  return { scores, outcomes, summary: summarize(scores) };
}
