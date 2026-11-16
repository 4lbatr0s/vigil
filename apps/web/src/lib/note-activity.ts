import type { Run } from "@vigil/shared";

/** Runs that touched `noteId`, newest first. */
export function runsForNote(runs: readonly Run[], noteId: string): Run[] {
  return runs.filter((r) => r.touched.includes(noteId)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * The run behind an agent-written note's "Undo this run": the newest run of that agent that touched the
 * note and has not been undone. Null when there is none (the note was written by the owner, or the run is gone).
 */
export function undoableRun(runs: readonly Run[], noteId: string, agentName: string | undefined): Run | null {
  if (!agentName) return null;
  return runsForNote(runs, noteId).find((r) => r.agent === agentName && !r.undone && r.status !== "running") ?? null;
}
