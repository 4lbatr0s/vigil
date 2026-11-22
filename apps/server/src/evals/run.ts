/**
 * Runs the Ask evals against a real model: `pnpm --filter @vigil/server eval`.
 * The model comes from the environment, like the server's own VIGIL_LLM_* settings:
 *   VIGIL_LLM_PROVIDER=ollama VIGIL_LLM_MODEL=qwen3:4b pnpm --filter @vigil/server eval
 *   VIGIL_LLM_PROVIDER=anthropic VIGIL_LLM_API_KEY=... VIGIL_LLM_MODEL=... pnpm --filter @vigil/server eval --json
 * It works in a temp folder and never reads or writes your vault, notes index or saved connections.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const json = process.argv.includes("--json");
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

try {
  setRunDeps({ makeModel: modelFactoryFromEnv() });
  const model = process.env.VIGIL_LLM_MODEL ?? "(not set)";
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
  process.exitCode = result.summary.passRate === 1 ? 0 : 1;
} finally {
  closeDb();
  closeState();
  await rm(root, { recursive: true, force: true });
}
