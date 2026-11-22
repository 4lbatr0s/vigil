import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb } from "../index-db";
import { setRunDeps, waitForRuns } from "../runs";
import { closeState } from "../state-db";
import type { ModelFactory } from "../llm";
import { runAskEval } from "./ask-eval";
import { ASK_CASES } from "./fixtures";

let root = "";
const saved = { ...process.env };
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-eval-test-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
});
afterEach(async () => {
  await waitForRuns();
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const usage = { input_tokens: 1, output_tokens: 5, total_tokens: 6 };

/** A model that reads the numbered lines in the task and answers with a mark on the first line, as a good model would. */
const sensible: ModelFactory = () => ({
  invoke: async (messages) => {
    const task = String(messages.at(-1)?.content ?? "");
    const first = /LINES START\n\[(\d+)\]/.exec(task);
    return new AIMessage({ content: first ? `The notes say so [${first[1]}].` : "Your notes do not cover this.", usage_metadata: usage });
  },
});

describe("runAskEval", () => {
  it("scores a sensible model: every answerable case cites a right note, unanswerable ones never reach the model or are refused", async () => {
    setRunDeps({ makeModel: sensible });
    const seen: string[] = [];
    const result = await runAskEval(ASK_CASES, (s) => seen.push(s.caseId));
    expect(seen).toEqual(ASK_CASES.map((c) => c.id));
    const byId = Object.fromEntries(result.scores.map((s) => [s.caseId, s]));
    // "Capital of Mongolia" shares no word with any note: no lines, no model call.
    expect(byId["not-in-notes-no-words"]).toMatchObject({ pass: true, verdict: "no-call" });
    expect(byId["direct"]?.pass).toBe(true);
    expect(result.summary.total).toBe(ASK_CASES.length);
    expect(result.summary.emptyRate).toBe(0);
  });

  it("scores a model that never cites as failing, and a model that errors as a failed run", async () => {
    setRunDeps({ makeModel: () => ({ invoke: async () => new AIMessage({ content: "It is heat.", usage_metadata: usage }) }) });
    const noMarks = await runAskEval(ASK_CASES.filter((c) => c.id === "direct"));
    expect(noMarks.scores[0]).toMatchObject({ pass: false, verdict: "no-marks" });

    setRunDeps({ makeModel: () => ({ invoke: async () => { throw Object.assign(new Error("HTTP 401"), { status: 401 }); } }) });
    const broken = await runAskEval(ASK_CASES.filter((c) => c.id === "direct"));
    expect(broken.scores[0]).toMatchObject({ pass: false, verdict: "failed" });
    expect(broken.summary.failedRate).toBe(1);
  });
});
