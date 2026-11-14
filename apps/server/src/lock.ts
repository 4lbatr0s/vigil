/**
 * One lock for every operation that changes a note and its record of change: API saves and deletes,
 * the agent's write tool, and undo. The server is one process, so a promise chain is enough. It
 * closes the check-then-act gap between processes in this server; an editor outside it (Obsidian)
 * can still write in between, which the per-note re-check in undo narrows to a few milliseconds.
 */
let tail: Promise<unknown> = Promise.resolve();

export function withNoteLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(fn, fn);
  tail = result.catch(() => undefined);
  return result;
}
