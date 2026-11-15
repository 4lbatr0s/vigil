import { randomUUID } from "node:crypto";
import type { Agent, Run } from "@vigil/shared";
import { runAgent, type AgentRunner } from "./agent-runtime";
import { AppError } from "./errors";
import { effectiveAgent } from "./permissions";
import { reindexNote, removeNote } from "./index-db";
import { withNoteLock } from "./lock";
import { modelFactoryFromEnv, redact, type ModelFactory } from "./llm";
import {
  approvalsForRun,
  createRun,
  finishRun,
  getAgent,
  getRun,
  hasRunning,
  listChildRuns,
  listWaitingRunIds,
  listSnapshots,
  listSnapshotsInOrder,
  markUndone,
  setRunStatus,
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
  launch(run.id, agent, task ?? agent.defaultTask);
  return run;
}

/** Runs the agent in the background. A run that stops at `waiting-approval` is not finished: it waits for the owner. */
function launch(runId: string, agent: Agent, task: string, resume?: { decisions: Record<string, "approve" | "reject"> }): void {
  const work = (async () => {
    try {
      const outcome = await deps.runner({ agent, task, runId, makeModel: deps.makeModel, ...(resume ? { resume } : {}) });
      if (outcome.status === "waiting-approval") setRunStatus(runId, "waiting-approval");
      else finishRun(runId, outcome.status, outcome.tokensUsed, outcome.error);
    } catch (err) {
      // The runner reports its own failures; this catches a bug in the runner itself.
      finishRun(runId, "failed", 0, redact(err instanceof Error ? err.message : "run failed"));
    }
  })();
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
}

/**
 * Continue a run that waits for approval once every one of its approvals is decided: the decisions
 * go back into the paused graph. Throws 409 when the run is not waiting or something is still pending.
 */
export function resumeRun(runId: string): Run {
  const run = getRun(runId);
  if (!run) throw new AppError("run-not-found", `Run not found: ${runId}`, 404);
  if (run.status !== "waiting-approval") throw new AppError("run-not-waiting", "This run is not waiting for approval", 409);
  const approvals = approvalsForRun(runId);
  if (approvals.length === 0 || approvals.some((a) => a.status === "pending")) {
    throw new AppError("approvals-pending", "Some writes of this run are still waiting for a decision", 409);
  }
  const decisions: Record<string, "approve" | "reject"> = {};
  for (const a of approvals) decisions[a.toolCallId] = a.status === "approved" ? "approve" : "reject";
  const stored = getAgent(run.agent);
  if (!stored) {
    finishRun(runId, "failed", run.tokensUsed, `agent ${run.agent} no longer exists`);
    return getRun(runId) as Run;
  }
  // The budget the run started with stays; tools and limits follow the owner's settings as of now.
  const agent = { ...effectiveAgent(stored), tokenBudget: run.tokenBudget };
  setRunStatus(runId, "running");
  launch(runId, agent, agent.defaultTask, { decisions });
  return getRun(runId) as Run;
}

/** At start: resume runs whose approvals were all decided just before a restart or crash. Runs still waiting stay waiting. */
export function resumeDecidedRuns(): number {
  let resumed = 0;
  for (const id of listWaitingRunIds()) {
    const approvals = approvalsForRun(id);
    if (approvals.length > 0 && approvals.every((a) => a.status !== "pending")) {
      resumeRun(id);
      resumed += 1;
    }
  }
  return resumed;
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

  // The family: children (started by call_agent) first, the run itself last. A child that was
  // already undone on its own is left out; one still running blocks the undo.
  const children = listChildRuns(runId);
  if (children.some((c) => c.status === "running")) throw new AppError("run-active", "A child run is still in progress", 409);
  const family = [...children.filter((c) => !c.undone), run];

  // A snapshot without a recorded write time means the agent never finished writing that note
  // (a crash between the snapshot and the write). Leave such notes alone.
  const all = family.flatMap((r) => listSnapshots(r.id));
  if (all.some((s) => s.expired)) throw new AppError("undo-expired", "This run is too old to undo.", 410);
  const snapshots = family.flatMap((r) => listSnapshots(r.id).filter((s) => s.writtenUpdatedAt !== null));

  // What a note's file time may be if no human touched it since the agents: any write time recorded
  // for it in this family, plus the times our own restores produce while we work.
  const expected = new Map<string, Set<string>>();
  for (const s of snapshots) {
    const set = expected.get(s.noteId) ?? new Set<string>();
    set.add(s.writtenUpdatedAt as string);
    expected.set(s.noteId, set);
  }
  const editedSince = async (noteId: string): Promise<boolean> => {
    const current = await getNote(noteId).catch((err: unknown) => {
      if (err instanceof AppError && err.code === "note-not-found") return null;
      throw err;
    });
    return current !== null && !(expected.get(noteId)?.has(current.updatedAt) ?? false);
  };

  const changed: string[] = [];
  for (const noteId of expected.keys()) if (await editedSince(noteId)) changed.push(noteId);
  if (changed.length > 0) {
    throw new AppError(
      "undo-conflict",
      `Edited after the agent wrote it, so undo would lose your changes: ${changed.join(", ")}`,
      409,
    );
  }

  // Per note, put back the EARLIEST snapshot in the family: the state before any member wrote it.
  // Restoring by run order instead would be wrong when a child ran before its parent's own write.
  const done = new Set<string>();
  for (const snap of listSnapshotsInOrder(family.map((r) => r.id)).filter((s) => s.writtenUpdatedAt !== null)) {
    if (done.has(snap.noteId)) continue;
    done.add(snap.noteId);
    // Re-check right before acting: narrows the window for an editor outside this server.
    if (await editedSince(snap.noteId)) {
      throw new AppError("undo-conflict", `Changed while undoing: ${snap.noteId}. Run undo again to see what is left.`, 409);
    }
    if (snap.existed && snap.file) {
      const restored = await restoreNoteFile(snap.noteId, await readSnapshotFile(snap.file));
      expected.get(snap.noteId)?.add(restored.updatedAt);
      reindexNote(restored);
    } else {
      await deleteNote(snap.noteId).catch((err: unknown) => {
        if (!(err instanceof AppError && err.code === "note-not-found")) throw err;
      });
      removeNote(snap.noteId);
    }
  }
  for (const member of family) markUndone(member.id);
  return getRun(runId) as Run;
}
