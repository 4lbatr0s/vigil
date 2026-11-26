/**
 * Runs the evals against a real model: `pnpm --filter @vigil/server eval`.
 * Add `--agent` for the agent evals (tool use, the approval path, a planted instruction, jobs the agent must not do)
 * and `--trials 3` to run each case three times and report pass^k. A regression case that fails once fails the run.
 * The model comes from the environment, like the server's own VIGIL_LLM_* settings:
 *   VIGIL_LLM_PROVIDER=ollama VIGIL_LLM_MODEL=qwen3:4b pnpm --filter @vigil/server eval
 *   VIGIL_LLM_PROVIDER=anthropic VIGIL_LLM_API_KEY=... VIGIL_LLM_MODEL=... pnpm --filter @vigil/server eval --json
 * It works in a temp folder and never reads or writes your vault, notes index or saved connections.
 * Add `--token-cap N` (or VIGIL_EVAL_TOKEN_CAP=N) to stop starting agent trials once N tokens are used; skipped trials are
 * reported, not failed. Add `--long` for the long-read case (tens of thousands of tokens per trial).
 * Add `--save DIR` to keep the result in DIR (outside the vault) and name every case that passed in the last saved run of
 * the same suite and model and fails now; such a case fails the run. For a nightly check, for example in crontab:
 *   0 3 * * * cd ~/vigil && VIGIL_LLM_PROVIDER=ollama VIGIL_LLM_MODEL=qwen3:4b pnpm --filter @vigil/server eval --agent --trials 3 --save ~/vigil-evals
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { insideFolder, recordAndCompare, type EvalRecord } from "./history";

const json = process.argv.includes("--json");
const agentMode = process.argv.includes("--agent");
const trialsAt = process.argv.indexOf("--trials");
const trials = trialsAt >= 0 ? Math.max(1, Number(process.argv[trialsAt + 1]) || 1) : 1;
const capAt = process.argv.indexOf("--token-cap");
const capText = capAt >= 0 ? process.argv[capAt + 1] : process.env.VIGIL_EVAL_TOKEN_CAP;
const tokenCap = capText === undefined || capText === "" ? undefined : Number(capText);
const long = process.argv.includes("--long");
const saveAt = process.argv.indexOf("--save");
const saveDir = saveAt >= 0 ? process.argv[saveAt + 1] : undefined;
const stopWith = (text: string): never => {
  console.error(text);
  process.exit(2);
};
if (tokenCap !== undefined && !(Number.isInteger(tokenCap) && tokenCap > 0)) stopWith("--token-cap needs a whole number of tokens above 0, for example --token-cap 100000");
if (saveAt >= 0 && (!saveDir || saveDir.startsWith("--"))) stopWith("--save needs a folder, for example --save ~/vigil-evals");
// The owner's vault, read before the temp folders replace it: results never go into it.
const ownerVault = process.env.VAULT_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../vault");
if (saveDir && insideFolder(saveDir, ownerVault)) stopWith(`--save ${saveDir} is inside the vault; pick a folder outside it`);
const root = await mkdtemp(path.join(tmpdir(), "vigil-eval-"));
process.env.VAULT_DIR = path.join(root, "vault");
process.env.DB_PATH = path.join(root, "index.db");
process.env.STATE_DB_PATH = path.join(root, "state.db");

// Imported after the folders are set, so nothing opens a database in the real data folder.
const { runAskEval } = await import("./ask-eval");
const { setRunDeps, waitForRuns } = await import("../runs");
const { modelFactoryFromEnv } = await import("../llm");
const { closeDb } = await import("../index-db");
const { closeState } = await import("../state-db");
const { ASK_CASES } = await import("./fixtures");
const { runAgentEval } = await import("./agent-eval");
const { AGENT_CASES, LONG_CASES } = await import("./agent-cases");

/** With `--save`: compare with the last saved run, save this one, print what newly fails. Returns how many cases newly fail. */
async function keep(now: EvalRecord): Promise<number> {
  if (!saveDir) return 0;
  const out = await recordAndCompare(saveDir, now);
  if (!json) {
    for (const name of out.skipped) console.log(`Skipped ${name} in ${saveDir}: not a saved eval result.`);
    console.log(out.before ? (out.failures.length > 0 ? `Newly failing since ${out.before.at}: ${out.failures.join(", ")}.` : `Nothing newly failing since ${out.before.at}.`) : "No earlier result for this suite and model to compare with.");
    console.log(`Saved ${out.file}`);
  } else {
    console.error(JSON.stringify({ saved: out.file, comparedWith: out.before?.at ?? null, newlyFailing: out.failures }));
  }
  return out.failures.length;
}

try {
  setRunDeps({ makeModel: modelFactoryFromEnv() });
  const model = process.env.VIGIL_LLM_MODEL ?? "(not set)";
  if (agentMode) {
    const cases = long ? [...AGENT_CASES, ...LONG_CASES] : AGENT_CASES;
    if (!json) console.log(`Agent evals, ${cases.length} cases x ${trials} trial(s), model ${model}${tokenCap ? `, token cap ${tokenCap}` : ""}\n`);
    const out = await runAgentEval({ cases, trials, ...(tokenCap ? { tokenCap } : {}), onTrial: (r) => { if (!json) console.log(`${r.skipped ? "skip" : r.pass ? "pass" : "FAIL"}  ${r.caseId.padEnd(28)} #${r.trial} ${r.status.padEnd(16)} ${r.seconds.toFixed(1).padStart(5)} s ${String(r.tokens).padStart(7)} tok ${String(r.modelCalls).padStart(3)} calls  ${r.reason}`); } });
    await waitForRuns();
    if (json) console.log(JSON.stringify({ model, trials, summary: out.summary, results: out.results }, null, 2));
    else {
      const s = out.summary;
      console.log(`\nTotal: ${s.totals.tokens} tokens, ${s.totals.modelCalls} model calls, ${s.totals.seconds.toFixed(1)} s.${s.skipped > 0 ? ` ${s.skipped} trial(s) skipped: the token cap was reached.` : ""}`);
      console.log(`${Math.round(s.trialPassRate * 100)}% of trials passed. ${s.passAllCount} of ${s.cases.length} cases passed every trial (pass^${trials}).${s.regressionFailures.length > 0 ? ` Regression failures: ${s.regressionFailures.join(", ")}.` : ""}`);
    }
    const fresh = await keep({ at: new Date().toISOString(), suite: "agent", model, trials, cases: out.summary.cases.map((c) => ({ caseId: c.caseId, pass: c.passAll })) });
    process.exitCode = out.summary.regressionFailures.length === 0 && fresh === 0 ? 0 : 1;
  } else {
    if (!json) console.log(`Ask evals, ${ASK_CASES.length} cases, model ${model}\n`);
    const result = await runAskEval(ASK_CASES, (s) => {
      if (!json) console.log(`${s.pass ? "pass" : "FAIL"}  ${s.caseId.padEnd(24)} ${s.verdict.padEnd(11)} ${s.seconds.toFixed(1).padStart(5)} s  ${s.reason}`);
    });
    await waitForRuns();
    if (json) console.log(JSON.stringify({ model, summary: result.summary, scores: result.scores }, null, 2));
    else {
      const s = result.summary;
      const pct = (n: number): string => `${Math.round(n * 100)}%`;
      console.log(`\n${s.passed} of ${s.total} passed (${pct(s.passRate)}). Empty replies ${pct(s.emptyRate)}, bad marks ${pct(s.badMarksRate)}, failed runs ${pct(s.failedRate)}, average ${s.avgSeconds.toFixed(1)} s.`);
    }
    const fresh = await keep({ at: new Date().toISOString(), suite: "ask", model, trials: 1, cases: result.scores.map((c) => ({ caseId: c.caseId, pass: c.pass })) });
    process.exitCode = result.summary.passRate === 1 && fresh === 0 ? 0 : 1;
  }
} finally {
  closeDb();
  closeState();
  await rm(root, { recursive: true, force: true });
}
