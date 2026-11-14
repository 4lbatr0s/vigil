import { randomUUID } from "node:crypto";
import type { Run } from "@vigil/shared";
import { runAgent, type AgentRunner } from "./agent-runtime";
import { AppError } from "./errors";
import { reindexNote, removeNote } from "./index-db";
import { modelFactoryFromEnv, redact, type ModelFactory } from "./llm";
import {
  createRun,
  finishRun,
  getAgent,
  getRun,
  hasRunning,
  listSnapshots,
  markUndone,
  readSnapshotFile,
} from "./state-db";
import { deleteNote, getNote, restoreNoteFile } from "./vault";

type Deps = { runner: AgentRunner; makeModel: ModelFactory };

// The model is built per call from the current environment, so a changed env needs no restart.
let deps: Deps = { runner: runAgent, makeModel: (tools, options) => modelFactoryFromEnv()(tools, options) };
const inFlight = new Set<Promise<void>>();

/** Tests swap in a fake runner or model. */
export function setRunDeps(next: Partial<Deps>): void {
  deps = { ...deps, ...next };
}

/** Resolves when every started run has finished. Used by tests and by shutdown. */
export async function waitForRuns(): Promise<void> {
  await Promise.all([...inFlight]);
}

/** Starts a run in the background and returns at once with the new `running` row. */
export function startRun(agentName: string, task?: string): Run {
  const agent = getAgent(agentName);
  if (!agent) throw new AppError("agent-not-found", `Agent not found: ${agentName}`, 404);
  if (hasRunning(agentName)) {
    throw new AppError("agent-busy", `Agent ${agentName} already has a run in progress`, 409);
  }
  const run = createRun(randomUUID(), agent.name, agent.tokenBudget);
  const work = (async () => {
    try {
      const outcome = await deps.runner({
        agent,
        task: task ?? agent.defaultTask,
        runId: run.id,
        makeModel: deps.makeModel,
      });
      finishRun(run.id, outcome.status, outcome.tokensUsed, outcome.error);
    } catch (err) {
      // The runner reports its own failures; this catches a bug in the runner itself.
      finishRun(run.id, "failed", 0, redact(err instanceof Error ? err.message : "run failed"));
    }
  })();
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
  return run;
}

/**
 * Put every note the run touched back as it was before the run (or delete it if the run created
 * it). Refuses, changing nothing, when a note was edited after the agent wrote it.
 */
export async function undoRun(runId: string): Promise<Run> {
  const run = getRun(runId);
  if (!run) throw new AppError("run-not-found", `Run not found: ${runId}`, 404);
  if (run.status === "running") throw new AppError("run-active", "Run is still in progress", 409);
  if (run.undone) throw new AppError("already-undone", "Run was already undone", 409);
  const snapshots = listSnapshots(runId);

  const changed: string[] = [];
  for (const snap of snapshots) {
    const current = await getNote(snap.noteId).catch((err: unknown) => {
      if (err instanceof AppError && err.code === "note-not-found") return null;
      throw err;
    });
    if (current && snap.writtenUpdatedAt && current.updatedAt !== snap.writtenUpdatedAt) changed.push(snap.noteId);
  }
  if (changed.length > 0) {
    throw new AppError(
      "undo-conflict",
      `Edited after the agent wrote it, so undo would lose your changes: ${changed.join(", ")}`,
      409,
    );
  }

  for (const snap of snapshots) {
    if (snap.existed && snap.file) {
      reindexNote(await restoreNoteFile(snap.noteId, await readSnapshotFile(snap.file)));
    } else {
      await deleteNote(snap.noteId).catch((err: unknown) => {
        if (!(err instanceof AppError && err.code === "note-not-found")) throw err;
      });
      removeNote(snap.noteId);
    }
  }
  markUndone(runId);
  return getRun(runId) as Run;
}
