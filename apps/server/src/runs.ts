import { randomUUID } from "node:crypto";
import type { Run } from "@vigil/shared";
import { runAgent, type AgentRunner } from "./agent-runtime";
import { AppError } from "./errors";
import { effectiveAgent } from "./permissions";
import { reindexNote, removeNote } from "./index-db";
import { withNoteLock } from "./lock";
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
export function startRun(agentName: string, task?: string, trigger: Run["trigger"] = "manual"): Run {
  const stored = getAgent(agentName);
  if (!stored) throw new AppError("agent-not-found", `Agent not found: ${agentName}`, 404);
  // What the run may do is decided now, from the owner's instance settings: later changes do not touch it.
  const agent = effectiveAgent(stored);
  if (hasRunning(agentName)) {
    throw new AppError("agent-busy", `Agent ${agentName} already has a run in progress`, 409);
  }
  const run = createRun(randomUUID(), agent.name, agent.tokenBudget, trigger);
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
export function undoRun(runId: string): Promise<Run> {
  // Under the note lock, so no save, delete, agent write or second undo runs in between the checks
  // and the changes. Two undos of one run: the second waits, then sees `undone` and answers 409.
  return withNoteLock(() => undoLocked(runId));
}

async function undoLocked(runId: string): Promise<Run> {
  const run = getRun(runId);
  if (!run) throw new AppError("run-not-found", `Run not found: ${runId}`, 404);
  if (run.status === "running") throw new AppError("run-active", "Run is still in progress", 409);
  if (run.undone) throw new AppError("already-undone", "Run was already undone", 409);
  // A snapshot without a recorded write time means the agent never finished writing that note
  // (a crash between the snapshot and the write). Leave such notes alone: restoring or deleting
  // could destroy something a human did since.
  const all = listSnapshots(runId);
  if (all.some((s) => s.expired)) throw new AppError("undo-expired", "This run is too old to undo.", 410);
  const snapshots = all.filter((s) => s.writtenUpdatedAt !== null);

  const editedSince = async (snap: (typeof snapshots)[number]): Promise<boolean> => {
    const current = await getNote(snap.noteId).catch((err: unknown) => {
      if (err instanceof AppError && err.code === "note-not-found") return null;
      throw err;
    });
    return current !== null && current.updatedAt !== snap.writtenUpdatedAt;
  };

  const changed: string[] = [];
  for (const snap of snapshots) if (await editedSince(snap)) changed.push(snap.noteId);
  if (changed.length > 0) {
    throw new AppError(
      "undo-conflict",
      `Edited after the agent wrote it, so undo would lose your changes: ${changed.join(", ")}`,
      409,
    );
  }

  for (const snap of snapshots) {
    // Re-check right before acting: narrows the window for an editor outside this server.
    if (await editedSince(snap)) {
      throw new AppError("undo-conflict", `Changed while undoing: ${snap.noteId}. Run undo again to see what is left.`, 409);
    }
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
