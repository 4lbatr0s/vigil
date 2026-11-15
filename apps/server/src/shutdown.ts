import { closeDb } from "./index-db";
import { waitForRuns } from "./runs";
import { closeState } from "./state-db";

/**
 * Orderly stop: refuse new work first, then let what is running finish, then drop the databases.
 * Runs still `running` when the timeout gives up are left as they are; the next start marks them
 * `interrupted`. Never exits the process itself: the caller decides the exit code.
 */
export async function shutdown(deps: {
  server: { close(): Promise<void> };
  watcher: { close(): Promise<void> };
  timeoutMs?: number;
}): Promise<void> {
  await deps.server.close();
  await deps.watcher.close();
  // Wait for the runs, but give up after the timeout and leave the stragglers running.
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      waitForRuns(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, deps.timeoutMs ?? 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  closeDb();
  closeState();
}
